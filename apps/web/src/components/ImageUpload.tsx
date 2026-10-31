import { useEffect, useId, useRef, useState } from 'react';
import type { UploadRequestInput, UploadTicket, VendorImageKind } from '@market-booking/shared';
import { uploadToStorage } from '../api/vendor';
import { errorMessage } from '../lib/errors';
import { ImageNotSupportedError, compressImage } from '../lib/image';

interface ImageUploadProps {
  label: string;
  kind: VendorImageKind;
  required?: boolean;
  /** รูปปัจจุบัน (presigned URL) ตอนแก้โปรไฟล์ */
  currentUrl?: string | null;
  error?: string;
  /** ขอ URL อัปโหลดจาก API (ตอนสมัครใช้ registrationToken, ตอนแก้โปรไฟล์ใช้ access token) */
  requestUpload: (input: UploadRequestInput) => Promise<UploadTicket>;
  /** ได้ key เมื่ออัปโหลดเสร็จ — ส่งไปกับฟอร์ม */
  onUploaded: (key: string) => void;
  onBusyChange?: (busy: boolean) => void;
}

/** เลือกรูป → ย่อ/บีบอัดในเครื่อง → แสดงตัวอย่าง → อัปโหลดตรงไป storage */
export function ImageUpload({
  label,
  kind,
  required,
  currentUrl,
  error,
  requestUpload,
  onUploaded,
  onBusyChange,
}: ImageUploadProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'done'>('idle');
  const [localError, setLocalError] = useState<string | null>(null);

  // คืนหน่วยความจำของ object URL เมื่อเปลี่ยนรูป/ออกจากหน้า
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setLocalError(null);
    setStatus('uploading');
    onBusyChange?.(true);
    try {
      const blob = await compressImage(file);
      setPreview(URL.createObjectURL(blob));
      const ticket = await requestUpload({ kind, contentType: 'image/jpeg', size: blob.size });
      await uploadToStorage(ticket, blob);
      onUploaded(ticket.key);
      setStatus('done');
    } catch (e) {
      setStatus('idle');
      setLocalError(
        e instanceof ImageNotSupportedError
          ? 'เปิดรูปนี้ไม่ได้ กรุณาเลือกรูป JPG หรือ PNG (หรือถ่ายรูปใหม่)'
          : e instanceof Error && e.message.startsWith('Upload failed')
            ? 'อัปโหลดไม่สำเร็จ กรุณาลองใหม่'
            : errorMessage(e),
      );
    } finally {
      onBusyChange?.(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const shown = preview ?? currentUrl ?? null;
  const message = localError ?? error;

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-gray-700">
        {label}
        {required && (
          <span aria-hidden="true" className="text-red-600">
            {' '}
            *
          </span>
        )}
      </span>
      <label
        htmlFor={inputId}
        className={`flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border-2 border-dashed bg-white p-3 text-center text-sm ${message ? 'border-red-400' : 'border-gray-300'}`}
      >
        {shown ? (
          <img src={shown} alt={label} className="max-h-48 w-auto rounded-md object-contain" />
        ) : (
          <span className="text-gray-500">แตะเพื่อถ่ายรูปหรือเลือกรูป</span>
        )}
        <span className="font-medium text-green-800">
          {status === 'uploading' ? 'กำลังอัปโหลด…' : shown ? 'เปลี่ยนรูป' : 'เลือกรูป'}
        </span>
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label={label}
        disabled={status === 'uploading'}
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      {status === 'done' && !message && <p className="text-sm text-green-700">อัปโหลดแล้ว</p>}
      {message && (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      )}
    </div>
  );
}
