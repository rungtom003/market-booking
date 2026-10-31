import { useState } from 'react';
import { Link } from 'react-router';
import { StallMap, StallMapLegend } from '@market-booking/stall-map';
import { useMarketLayout } from '../api/market';
import { Layout } from '../components/Layout';
import { Alert, Button, Card, Spinner } from '../components/ui';
import { errorCode, errorMessage } from '../lib/errors';
import { formatBaht } from '../lib/format';

/** ผังตลาดสำหรับดูก่อนเปิดรอบจอง — แตะล็อคเพื่อดูขนาด/ราคา (การจองจริงอยู่ Phase 4) */
export function MarketMapPage() {
  const layout = useMarketLayout();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (layout.isPending) {
    return (
      <Layout title="ผังตลาด">
        <Spinner label="กำลังโหลดผัง…" />
      </Layout>
    );
  }
  if (layout.isError) {
    const notApproved = ['VENDOR_NOT_APPROVED', 'VENDOR_SUSPENDED'].includes(
      errorCode(layout.error),
    );
    return (
      <Layout title="ผังตลาด">
        <Alert>{errorMessage(layout.error)}</Alert>
        {notApproved ? (
          <Link to="/" className="font-semibold text-green-800 underline">
            กลับหน้าหลัก
          </Link>
        ) : (
          <Button variant="secondary" onClick={() => void layout.refetch()}>
            ลองใหม่
          </Button>
        )}
      </Layout>
    );
  }

  const { zones, stalls } = layout.data;
  const zoneById = new Map(zones.map((z) => [z.id, z]));
  const items = stalls.map((s) => ({
    ...s,
    status: s.isReserved ? ('UNAVAILABLE' as const) : ('AVAILABLE' as const),
  }));
  const selected = stalls.find((s) => s.id === selectedId);

  return (
    <Layout title="ผังตลาด">
      {stalls.length === 0 ? (
        <Alert tone="warning">ตลาดยังไม่ได้ตั้งค่าผัง</Alert>
      ) : (
        <>
          <StallMap
            stalls={items}
            zones={zones}
            selectedId={selectedId}
            onSelect={(s) => setSelectedId(s.id)}
            describe={(s) =>
              `ล็อค ${s.code} ${zoneById.get(s.zoneId)?.name ?? ''}${s.status === 'UNAVAILABLE' ? ' ไม่เปิดจอง' : ''}`
            }
          />
          <StallMapLegend zones={zones} statuses={['UNAVAILABLE']} />
          <p className="text-sm text-gray-500">แตะล็อคเพื่อดูรายละเอียด · ใช้สองนิ้วเพื่อซูม</p>
          {selected && (
            <Card className="text-sm text-gray-700">
              <h2 className="mb-2 text-base font-semibold text-gray-900">ล็อค {selected.code}</h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-gray-500">โซน</dt>
                <dd>{zoneById.get(selected.zoneId)?.name ?? '—'}</dd>
                <dt className="text-gray-500">ขนาด</dt>
                <dd>
                  {selected.widthM} × {selected.lengthM} ม.
                </dd>
                <dt className="text-gray-500">ราคา</dt>
                <dd>{formatBaht(selected.price)} / วัน</dd>
              </dl>
              {selected.isReserved && (
                <p className="mt-2 text-amber-700">ล็อคนี้สงวนไว้ ไม่เปิดให้จองออนไลน์</p>
              )}
            </Card>
          )}
        </>
      )}
    </Layout>
  );
}
