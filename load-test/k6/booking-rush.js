// k6 load test ช่วงเปิดรอบจอง (Phase 4.6) — รันผ่าน `pnpm test:load` (apps/api/scripts/load-test.ts)
// เป้าหมาย Overview §13: ≥ 500 socket พร้อมกัน, hold p95 < 300 ms ที่ 100 req/s, 0 การจองซ้ำ, event < 1 วินาที
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';
import ws from 'k6/ws';

/** API หลาย instance คั่นด้วย , — ผู้ใช้แต่ละคน (VU) ผูกกับ instance เดียว เหมือน Nginx round-robin */
const APIS = (__ENV.APIS || __ENV.API || 'http://host.docker.internal:3200').split(',');
const apiOf = () => APIS[(exec.vu.idInTest - 1) % APIS.length];
const SOCKETS = Number(__ENV.SOCKETS || 500);
const RUSH_VUS = Number(__ENV.RUSH_VUS || 500);
const STEADY_RATE = Number(__ENV.STEADY_RATE || 100);
const STEADY_SECONDS = Number(__ENV.STEADY_SECONDS || 30);

const fx = JSON.parse(open('../.data/fixture.json'));
const openAtMs = Date.parse(fx.openAt);
const secondsToOpen = Math.max(1, Math.ceil((openAtMs - Date.now()) / 1000));
/** ผู้ค้ากดจองพร้อมกันที่เวลานี้ (หลังเปิดรอบ 1 วินาที กันนาฬิกา container กับ server ต่างกันเล็กน้อย) */
const fireAtMs = openAtMs + 1000;
/** ผู้ค้ากลุ่มเปิดรอบเข้าหน้าผังก่อนเปิด (กระจายใน 5 วินาที) — มี keep-alive connection อยู่แล้วตอนกดจอง */
const rushStart = Math.max(0, secondsToOpen - 8);
const steadyStart = secondsToOpen + 11;
const socketSeconds = steadyStart + STEADY_SECONDS + 10;
const socketsEndMs = Date.now() + socketSeconds * 1000;

/** ล็อคยอดนิยม 10 ล็อค — ครึ่งหนึ่งของคนตอนเปิดรอบแย่งกันที่นี่ */
const popular = fx.stallIds.slice(0, 10);

const wsConnected = new Counter('ws_connected');
const wsConnectErrors = new Counter('ws_connect_errors');
const mdJoined = new Counter('md_joined');
const stallUpdates = new Counter('stall_updates_received');
const stallUpdateDelay = new Trend('stall_update_delay', true);
const holdCreated = new Counter('hold_created');
const holdTaken = new Counter('hold_stall_taken');
const holdQuota = new Counter('hold_quota_exceeded');
/** เกิน 5 ครั้ง/10 วินาทีต่อผู้ค้า (§10.4) — ระบบป้องกันทำงานตามที่ออกแบบ */
const holdRateLimited = new Counter('hold_rate_limited');
const holdUnexpected = new Counter('hold_unexpected');

export const options = {
  scenarios: {
    // SOCKETS=0 → ไม่เปิด socket (เทียบผลเมื่อไม่มี realtime fan-out)
    ...(SOCKETS > 0 && {
      sockets: {
        executor: 'per-vu-iterations',
        exec: 'socketUser',
        vus: SOCKETS,
        iterations: 1,
        maxDuration: `${socketSeconds + 30}s`,
      },
    }),
    open_rush: {
      executor: 'per-vu-iterations',
      exec: 'rushHold',
      vus: RUSH_VUS,
      iterations: 1,
      startTime: `${rushStart}s`,
      maxDuration: `${secondsToOpen - rushStart + 60}s`,
    },
    steady: {
      executor: 'constant-arrival-rate',
      exec: 'steadyHold',
      rate: STEADY_RATE,
      timeUnit: '1s',
      duration: `${STEADY_SECONDS}s`,
      preAllocatedVUs: 100,
      maxVUs: 400,
      startTime: `${steadyStart}s`,
    },
  },
  thresholds: {
    'http_req_duration{scenario:steady}': ['p(95)<300'],
    'http_req_failed{scenario:steady}': ['rate<0.01'],
    // ไม่มีเป้าใน §13 (เป้าคือ 100 req/s) — ตั้งไว้ให้ summary แสดง latency ของช่วงกดพร้อมกัน
    'http_req_duration{scenario:open_rush,name:POST /bookings/hold}': ['p(95)<2000'],
    hold_unexpected: ['count==0'],
    ws_connect_errors: ['count==0'],
    ws_connected: [`count>=${SOCKETS}`],
    stall_update_delay: ['p(95)<1000'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const NS = '/booking';

/** ผู้ค้าเปิดผังวันขายค้างไว้: Socket.IO (Engine.IO v4) ผ่าน websocket ตรง → join ห้องวันขาย → นับ stall:updated */
export function socketUser() {
  const vendor = fx.vendors[(exec.vu.idInTest - 1) % fx.vendors.length];
  // ผู้ค้าเปิดหน้าผังไม่พร้อมกันเป๊ะ — กระจายการต่อใน 15 วินาทีแรก
  sleep(Math.random() * 15);
  const url = `${apiOf().replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`;
  const res = ws.connect(url, null, (socket) => {
    socket.on('message', (msg) => {
      if (msg.startsWith('0')) {
        // engine.io open → connect namespace พร้อม token
        socket.send(`40${NS},${JSON.stringify({ token: vendor.token })}`);
      } else if (msg === '2') {
        socket.send('3'); // ping → pong
      } else if (msg.startsWith(`40${NS},`)) {
        wsConnected.add(1);
        socket.send(`42${NS},0${JSON.stringify(['md:join', { marketDayId: fx.marketDayId }])}`);
      } else if (msg.startsWith(`44${NS},`)) {
        wsConnectErrors.add(1);
        socket.close();
      } else if (msg.startsWith(`43${NS},0`)) {
        const [ack] = JSON.parse(msg.slice(`43${NS},0`.length));
        if (ack && ack.ok) mdJoined.add(1);
      } else if (msg.startsWith(`42${NS},`)) {
        const [event, payload] = JSON.parse(msg.slice(`42${NS},`.length));
        if (event === 'stall:updated') {
          stallUpdates.add(1);
          stallUpdateDelay.add(Date.now() - Date.parse(payload.updatedAt));
        }
      }
    });
    socket.on('error', () => wsConnectErrors.add(1));
    socket.setTimeout(() => socket.close(), Math.max(1000, socketsEndMs - Date.now()));
  });
  check(res, { 'websocket upgraded (101)': (r) => r && r.status === 101 });
}

let unexpectedLogged = 0;

function hold(vendor, stallId) {
  const res = http.post(
    `${apiOf()}/api/v1/bookings/hold`,
    JSON.stringify({ stallId, marketDayId: fx.marketDayId }),
    {
      headers: { Authorization: `Bearer ${vendor.token}`, 'Content-Type': 'application/json' },
      tags: { name: 'POST /bookings/hold' },
      // 409 (ล็อคถูกจอง/เกินโควตา) และ 429 (กดถี่เกิน) เป็นผลปกติของการแย่งกันจอง ไม่ใช่ error
      responseCallback: http.expectedStatuses(201, 409, 429),
    },
  );
  const code = res.status === 409 ? res.json('error.code') : null;
  if (res.status === 201) holdCreated.add(1);
  else if (code === 'STALL_TAKEN') holdTaken.add(1);
  else if (code === 'QUOTA_EXCEEDED') holdQuota.add(1);
  else if (res.status === 429) holdRateLimited.add(1);
  else {
    holdUnexpected.add(1, { status: String(res.status), code: String(code) });
    if (unexpectedLogged++ < 3) console.warn(`hold unexpected: ${res.status} ${code} ${res.error}`);
  }
}

const randomStall = () => fx.stallIds[Math.floor(Math.random() * fx.stallIds.length)];

/** ตอนเปิดรอบ: ผู้ค้า 500 คนกดพร้อมกันที่ fireAtMs — ครึ่งหนึ่งแย่ง 10 ล็อคยอดนิยม */
export function rushHold() {
  const i = exec.scenario.iterationInTest;
  const vendor = fx.vendors[i % fx.vendors.length];
  // เข้าหน้าผังก่อนเปิดรอบ (โหลดผัง = เปิด keep-alive connection) แล้วรอกดพร้อมกัน
  sleep(Math.random() * 5);
  http.get(`${apiOf()}/api/v1/market-days/${fx.marketDayId}/stalls`, {
    headers: { Authorization: `Bearer ${vendor.token}` },
    tags: { name: 'GET /market-days/:id/stalls' },
  });
  sleep(Math.max(0, (fireAtMs - Date.now()) / 1000));
  hold(vendor, Math.random() < 0.5 ? popular[i % popular.length] : randomStall());
}

/** หลังเปิด: 100 req/s ต่อเนื่อง (สุ่มจากผู้ค้าทั้งหมด) — วัด p95 ตามเป้า */
export function steadyHold() {
  const vendor = fx.vendors[Math.floor(Math.random() * fx.vendors.length)];
  hold(vendor, randomStall());
}
