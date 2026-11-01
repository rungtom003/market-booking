/**
 * อ่าน QR ด้วย jsQR (โหลดเมื่อใช้ครั้งแรก ~130 kB ไม่ให้หน้าอื่นหนักขึ้น)
 * — เลือกแทน html5-qrcode 2.3.8 ที่อ่าน QR ปกติไม่ได้ราว 3–8% ของ token สุ่ม (ทดสอบ 2026-11-01)
 */
async function decode(image: ImageData, invert: boolean): Promise<string | null> {
  const { default: jsQR } = await import('jsqr');
  const found = jsQR(image.data, image.width, image.height, {
    inversionAttempts: invert ? 'attemptBoth' : 'dontInvert',
  });
  return found?.data ?? null;
}

/** วาดลง canvas ย่อให้ด้านยาวไม่เกิน `maxSide` (รูปจากกล้องมือถือใหญ่หลายพันพิกเซล — อ่านช้า) */
function pixels(
  source: CanvasImageSource,
  width: number,
  height: number,
  maxSide: number,
  canvas = document.createElement('canvas'),
): ImageData {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is not supported');
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** QR จากไฟล์รูป — ไม่พบ = null */
export async function decodeQrFile(file: Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  try {
    return await decode(pixels(bitmap, bitmap.width, bitmap.height, 1280), true);
  } finally {
    bitmap.close();
  }
}

/**
 * เปิดกล้องหลังแสดงใน `video` แล้วอ่านภาพทุก ~150 ms จนกว่า `signal` จะ abort (ปิดกล้อง)
 * เปิดกล้องไม่ได้ (ไม่อนุญาต/ไม่มีกล้อง/ไม่ใช่ https) → throw; abort ระหว่างรอสิทธิ์ → ปิดเงียบๆ
 * โดยไม่แตะ `video` — ตัวที่เปิดใหม่อาจใช้อยู่แล้ว (เช่น React StrictMode mount ซ้ำ)
 */
export async function startQrCamera(
  video: HTMLVideoElement,
  onCode: (text: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' },
    audio: false,
  });
  if (signal.aborted) {
    stream.getTracks().forEach((t) => t.stop());
    return;
  }
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const canvas = document.createElement('canvas');
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    stream.getTracks().forEach((t) => t.stop());
    if (video.srcObject === stream) video.srcObject = null;
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    video.srcObject = stream;
    await video.play();
  } catch (error) {
    stop();
    if (signal.aborted) return;
    throw error;
  }
  const tick = async () => {
    if (stopped) return;
    if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
      const text = await decode(
        pixels(video, video.videoWidth, video.videoHeight, 640, canvas),
        false,
      ).catch(() => null);
      if (text && !stopped) onCode(text);
    }
    if (!stopped) timer = setTimeout(() => void tick(), 150);
  };
  void tick();
}
