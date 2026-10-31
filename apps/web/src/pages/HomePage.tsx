import { useHealth } from '../api/health';

export function HomePage() {
  const health = useHealth();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-bold text-green-700">จองล็อคตลาด</h1>
        <p className="text-sm text-gray-500">สำหรับผู้ค้า</p>
      </header>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 font-semibold">สถานะระบบ</h2>
        {health.isPending && <p className="text-gray-500">กำลังตรวจสอบ…</p>}
        {health.isError && <p className="text-red-600">เชื่อมต่อเซิร์ฟเวอร์ไม่ได้</p>}
        {health.isSuccess && (
          <p className="text-green-700">
            เซิร์ฟเวอร์ทำงานปกติ ·{' '}
            {new Date(health.data.timestamp).toLocaleString('th-TH', {
              timeZone: 'Asia/Bangkok',
            })}
          </p>
        )}
      </section>
    </main>
  );
}
