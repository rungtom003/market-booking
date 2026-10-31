/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** LIFF ID ของ LINE Login — ไม่ตั้ง = ซ่อนปุ่ม LINE */
  readonly VITE_LINE_LIFF_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
