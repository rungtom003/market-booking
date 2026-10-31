import { ALLOWED_IMAGE_TYPES, AllowedImageType, MAX_UPLOAD_BYTES } from '@market-booking/shared';
import type { StorageService } from './storage.service';

export const IMAGE_EXTENSION: Record<AllowedImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// ไฟล์ขึ้นต้นด้วย byte เหล่านี้ — ตรวจว่าเป็นรูปจริง ไม่ใช่ไฟล์อื่นที่ตั้ง Content-Type หลอก
const MAGIC: Record<AllowedImageType, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) =>
    b.length >= 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) =>
    b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};

/**
 * ตรวจไฟล์รูปที่ผู้ใช้อัปโหลดผ่าน presigned URL: มีจริง, JPEG/PNG/WebP, ≤ 5 MB, เนื้อไฟล์เป็นรูปจริง
 * ไม่ผ่าน (ชนิด/ขนาด/เนื้อไฟล์) = ลบทิ้งแล้วคืน `invalid`
 */
export async function checkUploadedImage(
  storage: StorageService,
  key: string,
  onDeleteError: (error: unknown) => void,
): Promise<'ok' | 'missing' | 'invalid'> {
  const info = await storage.stat(key);
  if (!info) return 'missing';

  const type = info.contentType as AllowedImageType | undefined;
  const typeOk = type !== undefined && (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type);
  const sizeOk = info.size > 0 && info.size <= MAX_UPLOAD_BYTES;
  const contentOk = typeOk && sizeOk && MAGIC[type](await storage.readStart(key, 12));
  if (contentOk) return 'ok';

  await storage.delete(key).catch(onDeleteError);
  return 'invalid';
}
