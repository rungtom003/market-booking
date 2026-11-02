import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { privacyApi } from '../api/privacy';
import { errorCode, errorMessage } from '../lib/errors';
import { session } from '../lib/session';
import { Alert, Button, Card, TextField } from './ui';

/** ดาวน์โหลดไฟล์ JSON ในเบราว์เซอร์ */
function saveJson(data: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** สิทธิ์ตาม PDPA (Phase 11.3): ขอสำเนาข้อมูล และลบบัญชี */
export function PrivacyActions() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  const download = useMutation({
    mutationFn: privacyApi.export,
    onSuccess: (data) => saveJson(data, `ข้อมูลของฉัน-${data.exportedAt.slice(0, 10)}.json`),
    onError: (e) => setError(errorMessage(e)),
  });
  const erase = useMutation({
    mutationFn: () => privacyApi.deleteAccount({ confirmPhone: phone }),
    onSuccess: () => {
      queryClient.clear();
      // RequireAuth พาไปหน้า login เอง — ข้อความแจ้งส่งผ่าน session
      session.signOut('ลบบัญชีและข้อมูลส่วนบุคคลของคุณแล้ว');
    },
    onError: (e) => {
      // ช่องเดียวที่ตรวจ = เบอร์ยืนยัน
      if (errorCode(e) === 'VALIDATION_ERROR') setPhoneError('เบอร์โทรไม่ตรงกับบัญชีนี้');
      else setError(errorMessage(e));
    },
  });

  return (
    <Card className="flex flex-col gap-3 text-sm text-gray-700">
      <h2 className="text-base font-semibold text-gray-900">ข้อมูลส่วนบุคคลของฉัน</h2>
      <p>
        ขอสำเนาข้อมูลที่ตลาดเก็บไว้ หรือลบบัญชีได้ตาม{' '}
        <Link to="/privacy" className="font-semibold text-green-800 underline">
          นโยบายความเป็นส่วนตัว
        </Link>
      </p>
      {error && <Alert>{error}</Alert>}
      <Button variant="secondary" onClick={() => download.mutate()} loading={download.isPending}>
        ดาวน์โหลดข้อมูลของฉัน (JSON)
      </Button>
      {confirming ? (
        <div className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="font-semibold text-red-900">ลบบัญชีและข้อมูลส่วนบุคคล — ย้อนกลับไม่ได้</p>
          <ul className="list-disc pl-5 text-red-900">
            <li>ชื่อ เบอร์ ที่อยู่ รูปบัตร/รูปร้าน รูปสลิป และการผูก LINE จะถูกลบ</li>
            <li>ประวัติการจอง/ยอดชำระเก็บไว้เป็นบัญชีของตลาดโดยไม่ระบุตัวคุณ</li>
            <li>ต้องไม่มีการจองที่ยังไม่ถึงวันขาย (ยกเลิกก่อน)</li>
          </ul>
          <TextField
            label="พิมพ์เบอร์มือถือของบัญชีนี้เพื่อยืนยัน"
            inputMode="tel"
            value={phone}
            error={phoneError}
            onChange={(e) => {
              setPhone(e.target.value);
              setPhoneError(undefined);
            }}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              ไม่ลบ
            </Button>
            <Button variant="danger" onClick={() => erase.mutate()} loading={erase.isPending}>
              ยืนยันลบบัญชี
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" onClick={() => setConfirming(true)}>
          ลบบัญชีและข้อมูลของฉัน
        </Button>
      )}
    </Card>
  );
}
