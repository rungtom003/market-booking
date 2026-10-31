import { MAX_UPLOAD_BYTES } from '@market-booking/shared';

/** ด้านยาวสุดของรูปหลังย่อ — พอให้อ่านรูปบัตรได้ชัด และไฟล์เล็กพอสำหรับเน็ตมือถือ */
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

export class ImageNotSupportedError extends Error {}

/**
 * ย่อ/บีบอัดรูปเป็น JPEG ในเครื่องก่อนอัปโหลด (รูปจากกล้องมือถือมักใหญ่ 3–10 MB)
 * อ่านไม่ได้ (เช่น HEIC บนเบราว์เซอร์ที่ไม่รองรับ) → ImageNotSupportedError
 */
export async function compressImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    // imageOrientation: 'from-image' หมุนตาม EXIF — รูปถ่ายแนวตั้งไม่กลายเป็นแนวนอน
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ImageNotSupportedError('Unsupported image');
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageNotSupportedError('Canvas not available');
  // พื้นขาวกันรูป PNG โปร่งใสกลายเป็นพื้นดำตอนแปลงเป็น JPEG
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  );
  if (!blob) throw new ImageNotSupportedError('Encoding failed');
  if (blob.size > MAX_UPLOAD_BYTES) throw new ImageNotSupportedError('Still too large');
  return blob;
}
