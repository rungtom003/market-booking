/**
 * LINE Login ผ่าน LIFF — เปิดใช้เมื่อตั้ง `VITE_LINE_LIFF_ID` (ไม่ตั้ง = ซ่อนปุ่ม LINE)
 * โหลด SDK แบบ dynamic import เฉพาะตอนใช้ ไม่ให้ bundle หลักหนัก
 */
const LIFF_ID = import.meta.env.VITE_LINE_LIFF_ID as string | undefined;

export const lineLoginEnabled = Boolean(LIFF_ID);

async function liffClient() {
  if (!LIFF_ID) throw new Error('LINE Login is not configured');
  const { default: liff } = await import('@line/liff');
  await liff.init({ liffId: LIFF_ID });
  return liff;
}

/** เริ่ม login — ถ้ายังไม่ได้ login กับ LINE จะ redirect ไปหน้า LINE แล้วกลับมาที่หน้าเดิม */
export async function startLineLogin(): Promise<string | null> {
  const liff = await liffClient();
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: window.location.href });
    return null;
  }
  return liff.getIDToken();
}

/** หลัง redirect กลับจาก LINE — ได้ ID token ถ้า login กับ LINE อยู่แล้ว */
export async function lineIdTokenAfterRedirect(): Promise<string | null> {
  if (!LIFF_ID) return null;
  const liff = await liffClient();
  return liff.isLoggedIn() ? liff.getIDToken() : null;
}
