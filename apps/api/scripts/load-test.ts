/**
 * Load test ช่วงเปิดรอบจอง (Phase 4.6) — `pnpm test:load` ที่ root
 *
 * 1. DB แยก `*_load` (สร้าง + migrate + ล้างข้อมูล) และ Redis db 13 — ไม่แตะข้อมูล dev
 * 2. seed: ผู้ค้า APPROVED 1,000 คน, ล็อค 300 ล็อค, รอบที่จะเปิดในอีก ~40 วินาที (จองได้ 1 ล็อค/วัน)
 * 3. เปิด API (`dist/main.js`) แล้วรัน k6 (Docker `grafana/k6`) — 500 socket + ยิง hold ตอนเปิดรอบ + 100 req/s
 * 4. ตรวจ SQL: ไม่มีการจองซ้ำ, ไม่มีใครเกินโควตา; เก็บ CPU/RAM ของ API, Postgres, Redis
 *
 * ผลอยู่ที่ `load-test/.data/` (summary.json ของ k6 + result.json) — สรุปลง docs/load-test-results.md เอง
 */
import { execFile, execSync, spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { JwtService } from '@nestjs/jwt';
import { PrismaPg } from '@prisma/adapter-pg';
import Redis from 'ioredis';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from '../src/modules/auth/auth.constants';

const run = promisify(execFile);
const ROOT = resolve(__dirname, '../../..');
const API_DIR = resolve(__dirname, '..');
const DATA_DIR = resolve(ROOT, 'load-test/.data');

try {
  process.loadEnvFile(resolve(ROOT, '.env'));
} catch {
  // ไม่มี .env — ใช้ env ของระบบ
}

const VENDORS = Number(process.env.LOAD_VENDORS ?? 1000);
const STALLS = Number(process.env.LOAD_STALLS ?? 300);
/** เวลาให้ socket 500 ตัวต่อให้เสร็จก่อนเปิดรอบ */
const OPEN_IN_SECONDS = Number(process.env.LOAD_OPEN_IN_SECONDS ?? 40);
const PORT = Number(process.env.LOAD_API_PORT ?? 3200);
/** จำนวน API instance (port ต่อกัน) — k6 กระจายผู้ใช้เท่าๆ กัน เหมือน Nginx round-robin */
const INSTANCES = Number(process.env.LOAD_API_INSTANCES ?? 1);
const PORTS = Array.from({ length: INSTANCES }, (_, i) => PORT + i);
const K6_IMAGE = process.env.K6_IMAGE ?? 'grafana/k6:1.0.0';

function withPath(url: string, path: string): string {
  const u = new URL(url);
  u.pathname = path;
  return u.toString();
}

const baseDb =
  process.env.DATABASE_URL ?? 'postgresql://market:market_dev@localhost:5433/market_booking';
const DATABASE_URL = process.env.LOAD_DATABASE_URL ?? withPath(baseDb, '/market_booking_load');
const REDIS_URL =
  process.env.LOAD_REDIS_URL ?? withPath(process.env.REDIS_URL ?? 'redis://localhost:6379', '/13');
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'load-access-secret';

const dbName = decodeURIComponent(new URL(DATABASE_URL).pathname.slice(1));
if (!dbName.endsWith('_load')) {
  throw new Error(`Refusing to use "${dbName}" for load test (must end in _load)`);
}

const client = (url: string) =>
  new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (msg: string) => console.log(`[load] ${msg}`);

async function prepareDatabase() {
  const admin = client(withPath(DATABASE_URL, '/postgres'));
  const exists = await admin.$queryRaw<
    unknown[]
  >`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
  if (exists.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  await admin.$disconnect();

  execSync('pnpm exec prisma migrate deploy', {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL },
    stdio: 'ignore',
  });
  const prisma = client(DATABASE_URL);
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
  const redis = new Redis(REDIS_URL);
  await redis.flushdb();
  redis.disconnect();
  return prisma;
}

async function seed(prisma: PrismaClient) {
  const market = await prisma.market.create({ data: { name: 'ตลาด load test', address: '-' } });
  const admin = await prisma.adminUser.create({
    data: {
      marketId: market.id,
      username: 'load-admin',
      passwordHash: 'x',
      displayName: 'load',
      role: 'ADMIN',
    },
  });
  const zone = await prisma.zone.create({
    data: { marketId: market.id, name: 'โซนโหลด', color: '#3B82F6', sortOrder: 0 },
  });
  // 300 ล็อค วางเป็นตาราง 20 คอลัมน์
  await prisma.stall.createMany({
    data: Array.from({ length: STALLS }, (_, i) => ({
      marketId: market.id,
      zoneId: zone.id,
      code: `L${i + 1}`,
      widthM: 2,
      lengthM: 2,
      price: 100,
      posX: 20 + (i % 20) * 70,
      posY: 20 + Math.floor(i / 20) * 70,
      shapeW: 60,
      shapeH: 60,
    })),
  });
  await prisma.vendor.createMany({
    data: Array.from({ length: VENDORS }, (_, i) => ({
      marketId: market.id,
      firstName: 'โหลด',
      lastName: String(i + 1),
      phone: `09${String(i + 1).padStart(8, '0')}`,
      address: '-',
      pdpaConsentAt: new Date(),
      status: 'APPROVED' as const,
    })),
  });

  const openAt = new Date(Date.now() + OPEN_IN_SECONDS * 1000);
  const round = await prisma.bookingRound.create({
    data: {
      marketId: market.id,
      name: 'รอบ load test',
      openAt,
      closeAt: new Date(openAt.getTime() + 86_400_000),
      maxStallsPerVendor: 1,
      status: 'PUBLISHED',
      createdById: admin.id,
    },
  });
  const day = await prisma.marketDay.create({
    data: {
      marketId: market.id,
      roundId: round.id,
      marketDate: new Date(Date.UTC(2030, 0, 5)),
    },
  });

  const jwt = new JwtService({});
  const vendors = await prisma.vendor.findMany({ select: { id: true }, orderBy: { phone: 'asc' } });
  const stalls = await prisma.stall.findMany({ select: { id: true }, orderBy: { posY: 'asc' } });
  const fixture = {
    openAt: openAt.toISOString(),
    marketDayId: day.id,
    stallIds: stalls.map((s) => s.id),
    vendors: vendors.map((v) => ({
      id: v.id,
      // token เดียวกับที่ API ออกให้ (อายุ 15 นาที — พอสำหรับการทดสอบ)
      token: jwt.sign(
        { sub: v.id, typ: 'VENDOR', mkt: market.id },
        {
          secret: JWT_ACCESS_SECRET,
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE.ACCESS,
          algorithm: 'HS256',
        },
      ),
    })),
  };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(resolve(DATA_DIR, 'fixture.json'), JSON.stringify(fixture));
  return { fixture, marketDayId: day.id };
}

function startApi(port: number) {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: API_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      // LOAD_API_LOG=1 → เก็บ request log (มี responseTime ฝั่ง server) ไว้แยกเวลาของ API ออกจากเครือข่าย Docker
      LOG_LEVEL: process.env.LOAD_API_LOG ? 'info' : 'warn',
      PORT: String(port),
      DATABASE_URL,
      REDIS_URL,
      JWT_ACCESS_SECRET,
      WORKERS_ENABLED: 'true',
      DATABASE_POOL_SIZE: process.env.LOAD_DB_POOL ?? '10',
      // k6 ยิงทุก request จาก IP เดียว — ปิด limit ต่อ IP (limit hold ต่อผู้ค้ายังทำงาน)
      RATE_LIMIT_DISABLED: 'true',
    },
    stdio: ['ignore', process.env.LOAD_API_LOG ? 'pipe' : 'inherit', 'inherit'],
  });
  if (process.env.LOAD_API_LOG) {
    mkdirSync(DATA_DIR, { recursive: true });
    child.stdout?.pipe(createWriteStream(resolve(DATA_DIR, `api-${port}.log`)));
  }
  return child;
}

async function waitForHealth(port: number) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/api/v1/health`);
      if (res.ok) return;
    } catch {
      // ยังไม่พร้อม
    }
    await sleep(500);
  }
  throw new Error('API did not become healthy');
}

interface Sample {
  t: number;
  apiCpuSec: number;
  apiRssMb: number;
  docker: string;
}

/** เก็บ CPU (วินาทีสะสม) + RAM รวมของทุก API instance และ docker stats ของ Postgres/Redis ทุก 2 วินาที */
function sampleResources(pids: number[], samples: Sample[]) {
  let stopped = false;
  const loop = async () => {
    while (!stopped) {
      try {
        const [ps, docker] = await Promise.all([
          run('powershell', [
            '-NoProfile',
            '-Command',
            `$p = Get-Process -Id ${pids.join(',')}; "$(($p | Measure-Object CPU -Sum).Sum) $(($p | Measure-Object WorkingSet64 -Sum).Sum)"`,
          ]),
          run('docker', [
            'stats',
            '--no-stream',
            '--format',
            '{{.Name}} {{.CPUPerc}} {{.MemUsage}}',
            'market-booking-postgres-1',
            'market-booking-redis-1',
          ]),
        ]);
        const [cpu, ws] = ps.stdout.trim().split(' ').map(Number);
        samples.push({
          t: Date.now(),
          apiCpuSec: cpu ?? 0,
          apiRssMb: Math.round((ws ?? 0) / 1_048_576),
          docker: docker.stdout.trim().replace(/\r?\n/g, ' | '),
        });
      } catch {
        // process จบแล้ว
      }
      await sleep(2000);
    }
  };
  void loop();
  return () => {
    stopped = true;
  };
}

async function verify(prisma: PrismaClient, marketDayId: string) {
  const duplicates = await prisma.$queryRaw<{ stall_id: string; n: bigint }[]>`
    SELECT stall_id, COUNT(*) AS n FROM bookings
    WHERE market_day_id = ${marketDayId}::uuid
      AND status IN ('HOLD','PENDING_PAYMENT','PENDING_VERIFY','CONFIRMED')
    GROUP BY stall_id HAVING COUNT(*) > 1`;
  const overQuota = await prisma.$queryRaw<{ vendor_id: string; n: bigint }[]>`
    SELECT b.vendor_id, COUNT(*) AS n FROM bookings b
    JOIN market_days d ON d.id = b.market_day_id
    JOIN booking_rounds r ON r.id = d.round_id
    WHERE b.market_day_id = ${marketDayId}::uuid
      AND b.status IN ('HOLD','PENDING_PAYMENT','PENDING_VERIFY','CONFIRMED')
    GROUP BY b.vendor_id, r.max_stalls_per_vendor HAVING COUNT(*) > r.max_stalls_per_vendor`;
  const byStatus = await prisma.$queryRaw<{ status: string; n: bigint }[]>`
    SELECT status::text, COUNT(*) AS n FROM bookings GROUP BY status ORDER BY status`;
  return {
    duplicateActiveBookings: duplicates.length,
    vendorsOverQuota: overQuota.length,
    bookingsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])),
  };
}

async function main() {
  log(`database ${dbName}, redis ${REDIS_URL}`);
  const prisma = await prepareDatabase();
  const apis = PORTS.map(startApi);
  try {
    await Promise.all(PORTS.map(waitForHealth));
    log(`API ready (${INSTANCES} instance: ${PORTS.join(', ')})`);
    const samples: Sample[] = [];
    const stopSampling = sampleResources(
      apis.map((a) => a.pid!),
      samples,
    );

    // seed หลัง API พร้อม เพื่อให้เวลาเปิดรอบนับจากตอนที่ทดสอบได้จริง
    const { marketDayId } = await seed(prisma);
    log(`seeded ${VENDORS} vendors, ${STALLS} stalls — round opens in ${OPEN_IN_SECONDS}s`);

    const started = Date.now();
    // spawn แบบ async — execFileSync บล็อก event loop ทำให้เก็บ CPU/RAM ระหว่างทดสอบไม่ได้
    const k6Exit = await new Promise<number | null>((done) => {
      const k6 = spawn(
        'docker',
        [
          'run',
          '--rm',
          '-v',
          `${resolve(ROOT, 'load-test')}:/scripts`,
          '-e',
          `APIS=${PORTS.map((p) => `http://host.docker.internal:${p}`).join(',')}`,
          // ปรับขนาดการทดสอบได้จาก env เดียวกัน (เช่น SOCKETS=0 เทียบผลไม่มี realtime)
          ...['SOCKETS', 'RUSH_VUS', 'STEADY_RATE', 'STEADY_SECONDS'].flatMap((k) =>
            process.env[k] ? ['-e', `${k}=${process.env[k]}`] : [],
          ),
          K6_IMAGE,
          'run',
          '--quiet',
          '--summary-export=/scripts/.data/summary.json',
          '/scripts/k6/booking-rush.js',
        ],
        { stdio: 'inherit' },
      );
      k6.on('exit', done);
    });
    if (k6Exit !== 0) log('k6 reported failed thresholds (see summary above)');
    stopSampling();
    // ให้ worker/event ที่ค้างเสร็จก่อนตรวจ
    await sleep(2000);

    const checks = await verify(prisma, marketDayId);
    const window = samples.filter((s) => s.t >= started);
    const cpuPercent = window.slice(1).map((s, i) => {
      const prev = window[i]!;
      return Math.round(((s.apiCpuSec - prev.apiCpuSec) / ((s.t - prev.t) / 1000)) * 100);
    });
    const result = {
      ranAt: new Date().toISOString(),
      instances: INSTANCES,
      vendors: VENDORS,
      stalls: STALLS,
      checks,
      api: {
        peakCpuPercentOfOneCore: Math.max(0, ...cpuPercent),
        avgCpuPercentOfOneCore: cpuPercent.length
          ? Math.round(cpuPercent.reduce((a, b) => a + b, 0) / cpuPercent.length)
          : 0,
        peakRssMb: Math.max(0, ...window.map((s) => s.apiRssMb)),
      },
      dockerSamples: window.map((s) => s.docker),
    };
    writeFileSync(resolve(DATA_DIR, 'result.json'), JSON.stringify(result, null, 2));
    log(JSON.stringify({ checks, api: result.api }, null, 2));
    if (checks.duplicateActiveBookings > 0 || checks.vendorsOverQuota > 0) process.exitCode = 1;
  } finally {
    for (const a of apis) a.kill();
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
