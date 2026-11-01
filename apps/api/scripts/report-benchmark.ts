/**
 * Benchmark รายงาน (Phase 8 AC: ข้อมูล 1 ปี ตอบ < 2 วินาที) — `pnpm bench:reports`
 * 1. DB แยก `*_bench` (สร้าง + migrate + ล้าง) — ไม่แตะข้อมูล dev
 * 2. สร้างข้อมูลจำลอง 1 ปีด้วย SQL (generate_series): 300 ล็อค, 1,500 ผู้ค้า, 104 วันขาย (เสาร์-อาทิตย์),
 *    การจอง ~85% ของล็อค + ยกเลิก/หมดเวลา, ชำระเงิน, audit log หลายแสนแถว
 * 3. เรียก ReportService/AuditLogService ตัวจริงกับช่วง 1 ปี วัดเวลา (warm 3 รอบ เก็บค่าที่ช้าสุด)
 *    และ EXPLAIN ANALYZE ของ SQL ที่ Prisma ส่งจริง → docs/report-benchmark.md
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  auditLogQuerySchema,
  occupancyReportQuerySchema,
  revenueReportQuerySchema,
  vendorReportQuerySchema,
} from '@market-booking/shared';
import { PrismaClient } from '../src/generated/prisma/client';
import { AuditLogService } from '../src/modules/report/audit-log.service';
import { ReportService } from '../src/modules/report/report.service';
import type { PrismaService } from '../src/prisma/prisma.service';

const API_DIR = resolve(__dirname, '..');
const ROOT = resolve(API_DIR, '../..');
try {
  process.loadEnvFile(resolve(ROOT, '.env'));
} catch {
  // CI: env มาจากระบบ
}

const LIMIT_MS = 2_000;
const STALLS = 300;
const VENDORS = 1_500;

function withPath(url: string, path: string): string {
  const u = new URL(url);
  u.pathname = path;
  return u.toString();
}
const baseDb =
  process.env.DATABASE_URL ?? 'postgresql://market:market_dev@localhost:5433/market_booking';
const DATABASE_URL = process.env.BENCH_DATABASE_URL ?? withPath(baseDb, '/market_booking_bench');
const dbName = decodeURIComponent(new URL(DATABASE_URL).pathname.slice(1));
if (!dbName.endsWith('_bench')) {
  throw new Error(`Refusing to use "${dbName}" for benchmark (must end in _bench)`);
}

const log = (msg: string) => console.log(`[bench] ${msg}`);
const client = (url: string) =>
  new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
/** client ที่ส่ง event ของทุก query (เอา SQL จริงไป EXPLAIN) */
const tracingClient = (url: string) =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
    log: [{ emit: 'event', level: 'query' }],
  });

async function prepareDatabase() {
  const admin = client(withPath(DATABASE_URL, '/postgres'));
  const exists = await admin.$queryRaw<unknown[]>`
    SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
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
    `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(', ')} CASCADE`,
  );
  return prisma;
}

/** ข้อมูล 1 ปีย้อนหลังจากวันนี้ — สร้างใน DB ทั้งหมด (เร็วกว่า insert ทีละแถวหลายร้อยเท่า) */
async function seed(prisma: PrismaClient): Promise<{ marketId: string; from: string; to: string }> {
  const market = await prisma.market.create({ data: { name: 'ตลาด benchmark', address: '-' } });
  const admin = await prisma.adminUser.create({
    data: {
      marketId: market.id,
      username: 'bench',
      passwordHash: 'x',
      displayName: 'bench',
      role: 'ADMIN',
    },
  });
  const m = market.id;
  const steps: [string, string][] = [
    [
      'zones',
      `INSERT INTO zones (id, market_id, name, color, sort_order, updated_at)
       SELECT gen_random_uuid(), '${m}', 'โซน ' || i, '#3B82F6', i, now() FROM generate_series(1, 4) i`,
    ],
    [
      'stalls',
      `INSERT INTO stalls (id, market_id, zone_id, code, width_m, length_m, price, shape_w, shape_h, is_active, updated_at)
       SELECT gen_random_uuid(), '${m}', z.id, 'S' || i, 2, 2, 100 + (i % 5) * 20, 60, 60, i % 50 <> 0, now()
       FROM generate_series(1, ${STALLS}) i
       JOIN (SELECT id, row_number() OVER (ORDER BY sort_order) - 1 AS n FROM zones) z ON z.n = i % 4`,
    ],
    [
      'vendors',
      `INSERT INTO vendors (id, market_id, first_name, last_name, phone, address, pdpa_consent_at, status, noshow_count, updated_at)
       SELECT gen_random_uuid(), '${m}', 'ผู้ค้า', 'ที่' || i, '08' || lpad(i::text, 8, '0'), '-', now(),
         (CASE WHEN i % 40 = 0 THEN 'PENDING' ELSE 'APPROVED' END)::"VendorStatus", (i % 17 = 0)::int * (i % 4), now()
       FROM generate_series(1, ${VENDORS}) i`,
    ],
    [
      'rounds (weekly)',
      `INSERT INTO booking_rounds (id, market_id, name, open_at, close_at, max_stalls_per_vendor, status, created_by, updated_at)
       SELECT gen_random_uuid(), '${m}', 'รอบสัปดาห์ ' || w, d - interval '6 days', d - interval '1 day', 2, 'PUBLISHED', '${admin.id}', now()
       FROM generate_series(0, 51) w,
       LATERAL (SELECT (date_trunc('week', now()) - (w || ' weeks')::interval + interval '5 days') AS d) x`,
    ],
    [
      'market days (Sat + Sun)',
      `INSERT INTO market_days (id, market_id, round_id, market_date, updated_at)
       SELECT gen_random_uuid(), '${m}', r.id, (r.close_at + interval '1 day' + (k || ' days')::interval)::date, now()
       FROM booking_rounds r, generate_series(0, 1) k`,
    ],
    [
      'closed overrides (~2%)',
      `INSERT INTO stall_day_overrides (id, stall_id, market_day_id, is_closed, updated_at)
       SELECT gen_random_uuid(), s.id, d.id, true, now() FROM stalls s CROSS JOIN market_days d WHERE random() < 0.02`,
    ],
    [
      'bookings (CONFIRMED ~85%)',
      `INSERT INTO bookings (id, market_id, vendor_id, stall_id, market_day_id, status, amount, payment_due_at, confirmed_at, updated_at)
       SELECT gen_random_uuid(), '${m}', v.id, s.id, d.id, 'CONFIRMED', s.price, d.market_date - interval '2 days', d.market_date - interval '3 days', now()
       FROM stalls s CROSS JOIN market_days d
       JOIN LATERAL (SELECT id FROM vendors WHERE status = 'APPROVED' OFFSET floor(random() * ${VENDORS * 0.97})::int LIMIT 1) v ON true
       WHERE s.is_active AND random() < 0.85`,
    ],
    [
      'bookings (cancelled/expired history)',
      `INSERT INTO bookings (id, market_id, vendor_id, stall_id, market_day_id, status, amount, payment_due_at, cancelled_at, updated_at)
       SELECT gen_random_uuid(), market_id, vendor_id, stall_id, market_day_id,
         (CASE WHEN random() < 0.5 THEN 'CANCELLED' ELSE 'EXPIRED' END)::"BookingStatus", amount,
         CASE WHEN random() < 0.7 THEN payment_due_at END, now(), now()
       FROM bookings WHERE random() < 0.25`,
    ],
    [
      'payments (approved + some rejected)',
      `INSERT INTO payments (id, booking_id, method, amount, slip_image_key, status, verified_at, updated_at)
       SELECT gen_random_uuid(), b.id, CASE WHEN random() < 0.8 THEN 'PROMPTPAY_SLIP' ELSE 'CASH' END, b.amount, 'k', 'APPROVED'::"PaymentStatus", now(), now()
       FROM bookings b WHERE b.status = 'CONFIRMED'
       UNION ALL
       SELECT gen_random_uuid(), b.id, 'PROMPTPAY_SLIP', b.amount, 'k', 'REJECTED'::"PaymentStatus", now(), now()
       FROM bookings b WHERE b.status = 'CONFIRMED' AND random() < 0.1`,
    ],
    [
      'audit logs (~6 per booking)',
      `INSERT INTO audit_logs (id, actor_type, actor_id, action, entity_type, entity_id, after, created_at)
       SELECT gen_random_uuid(),
         CASE WHEN a.n <= 3 THEN 'VENDOR' WHEN a.n = 6 THEN 'SYSTEM' ELSE 'ADMIN' END,
         CASE WHEN a.n <= 3 THEN b.vendor_id WHEN a.n = 6 THEN NULL ELSE '${admin.id}'::uuid END,
         (ARRAY['booking.hold','booking.confirm','payment.submit','payment.approve','vendor.update','booking.expire'])[a.n],
         'booking', b.id, '{"bench":true}'::jsonb,
         now() - random() * interval '365 days'
       FROM bookings b CROSS JOIN generate_series(1, 6) a(n)`,
    ],
    [
      'audit logs (action หายาก: settings.update 12 ครั้ง)',
      `INSERT INTO audit_logs (id, actor_type, actor_id, action, entity_type, created_at)
       SELECT gen_random_uuid(), 'ADMIN', '${admin.id}', 'settings.update', 'settings',
         now() - (i * 30 || ' days')::interval
       FROM generate_series(0, 11) i`,
    ],
    ['analyze', 'ANALYZE'],
  ];
  for (const [name, sql] of steps) {
    const t = Date.now();
    const rows = await prisma.$executeRawUnsafe(sql);
    log(`seed ${name}: ${rows} rows (${Date.now() - t} ms)`);
  }
  const range = await prisma.$queryRaw<{ from: string; to: string }[]>`
    SELECT min(market_date)::text AS from, max(market_date)::text AS to FROM market_days`;
  return { marketId: m, from: range[0]!.from, to: range[0]!.to };
}

interface Result {
  name: string;
  ms: number;
  rows: number;
  plans: string[];
}

async function main() {
  const seeded = await prepareDatabase();
  log(`database ${dbName} ready`);
  const { marketId, from, to } = await seed(seeded);
  await seeded.$disconnect();

  const prisma = tracingClient(DATABASE_URL);
  let captured: { query: string; params: string }[] = [];
  prisma.$on('query', (e) => captured.push({ query: e.query, params: e.params }));
  const reports = new ReportService(prisma as unknown as PrismaService);
  const audit = new AuditLogService(prisma as unknown as PrismaService);

  const counts = await prisma.$queryRaw<{ t: string; n: number }[]>`
    SELECT 'bookings' AS t, count(*)::int AS n FROM bookings UNION ALL
    SELECT 'payments', count(*)::int FROM payments UNION ALL
    SELECT 'audit_logs', count(*)::int FROM audit_logs UNION ALL
    SELECT 'market_days', count(*)::int FROM market_days UNION ALL
    SELECT 'vendors', count(*)::int FROM vendors`;
  log(`data: ${counts.map((c) => `${c.t}=${c.n}`).join(', ')} (${from} → ${to})`);

  const cases: [string, () => Promise<{ length: number } | number>][] = [
    ['dashboard', async () => ((await reports.dashboard(marketId)).round ? 1 : 0)],
    [
      'revenue by day (1 ปี)',
      async () =>
        (await reports.revenue(marketId, revenueReportQuerySchema.parse({ from, to }))).rows,
    ],
    [
      'revenue by round',
      async () =>
        (
          await reports.revenue(
            marketId,
            revenueReportQuerySchema.parse({ from, to, groupBy: 'round' }),
          )
        ).rows,
    ],
    [
      'revenue by zone',
      async () =>
        (
          await reports.revenue(
            marketId,
            revenueReportQuerySchema.parse({ from, to, groupBy: 'zone' }),
          )
        ).rows,
    ],
    [
      'occupancy by day',
      async () =>
        (await reports.occupancy(marketId, occupancyReportQuerySchema.parse({ from, to }))).rows,
    ],
    [
      'occupancy by zone',
      async () =>
        (
          await reports.occupancy(
            marketId,
            occupancyReportQuerySchema.parse({ from, to, groupBy: 'zone' }),
          )
        ).rows,
    ],
    [
      'vendors top (bookings)',
      async () =>
        (await reports.vendors(marketId, vendorReportQuerySchema.parse({ from, to }), true)).rows,
    ],
    [
      'vendors top (noshow, 500)',
      async () =>
        (
          await reports.vendors(
            marketId,
            vendorReportQuerySchema.parse({ from, to, sort: 'noshow', limit: 500 }),
            true,
          )
        ).rows,
    ],
    [
      'audit log: หน้าแรก (ไม่กรอง)',
      async () => (await audit.list(auditLogQuerySchema.parse({}), 'Asia/Bangkok')).items,
    ],
    [
      'audit log: action + ช่วง 1 เดือน',
      async () =>
        (
          await audit.list(
            auditLogQuerySchema.parse({ action: 'payment.', from: to.slice(0, 8) + '01', to }),
            'Asia/Bangkok',
          )
        ).items,
    ],
    [
      'audit log: action หายาก ทั้งปี',
      async () =>
        (
          await audit.list(
            auditLogQuerySchema.parse({ action: 'settings.update', from, to }),
            'Asia/Bangkok',
          )
        ).items,
    ],
    [
      'audit log: หน้าลึก (page 500)',
      async () =>
        (await audit.list(auditLogQuerySchema.parse({ page: 500, pageSize: 50 }), 'Asia/Bangkok'))
          .items,
    ],
    ['audit log: รายการ action', async () => audit.actions()],
  ];

  const results: Result[] = [];
  for (const [name, run] of cases) {
    await run(); // warm-up (cache/plan)
    let worst = 0;
    let rows = 0;
    let queries: { query: string; params: string }[] = [];
    for (let i = 0; i < 3; i++) {
      captured = [];
      const t = performance.now();
      const out = await run();
      worst = Math.max(worst, performance.now() - t);
      rows = typeof out === 'number' ? out : out.length;
      queries = captured;
    }
    // แผนของ query ที่ช้าสุดในเคสนี้ (SELECT เท่านั้น)
    const plans: string[] = [];
    for (const q of queries.filter((x) => /^\s*(WITH|SELECT)/i.test(x.query)).slice(0, 3)) {
      const params = JSON.parse(q.params) as unknown[];
      const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN (ANALYZE, BUFFERS OFF, TIMING OFF, SUMMARY ON) ${q.query}`,
        ...params,
      );
      plans.push(plan.map((p) => p['QUERY PLAN']).join('\n'));
    }
    results.push({ name, ms: Math.round(worst), rows, plans });
    log(`${worst < LIMIT_MS ? 'OK  ' : 'SLOW'} ${name}: ${Math.round(worst)} ms (${rows} rows)`);
  }
  await prisma.$disconnect();

  const failed = results.filter((r) => r.ms >= LIMIT_MS);
  const md = [
    '# ผล benchmark รายงาน (Phase 8)',
    '',
    `> \`pnpm bench:reports\` — ${new Date().toISOString().slice(0, 10)} · เกณฑ์ < ${LIMIT_MS} ms ต่อรายงาน (เวลาที่ช้าสุดจาก 3 รอบหลัง warm-up)`,
    '',
    `ข้อมูลจำลอง 1 ปี (${from} → ${to}): ${counts.map((c) => `${c.t} ${c.n.toLocaleString('en-US')}`).join(' · ')} · ล็อค ${STALLS}`,
    '',
    '| รายงาน | เวลา (ms) | แถว | ผล |',
    '|---|--:|--:|:-:|',
    ...results.map((r) => `| ${r.name} | ${r.ms} | ${r.rows} | ${r.ms < LIMIT_MS ? '✅' : '❌'} |`),
    '',
    '## Query plan (EXPLAIN ANALYZE)',
    '',
    ...results.flatMap((r) => [
      `### ${r.name}`,
      '',
      ...r.plans.map((p) => ['```', p, '```', ''].join('\n')),
    ]),
  ].join('\n');
  const out = resolve(ROOT, 'docs/report-benchmark.md');
  writeFileSync(out, `${md}\n`);
  log(`wrote ${out}`);
  if (failed.length > 0) {
    log(`FAILED: ${failed.map((f) => f.name).join(', ')}`);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
