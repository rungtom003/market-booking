// tsc ไม่สร้าง package.json ใน output — ต้องบอก Node ว่าแต่ละโฟลเดอร์เป็น ESM หรือ CJS
// ไม่งั้น dist/esm จะถูกอ่านเป็น CommonJS (เพราะ package.json หลักไม่มี "type")
import { writeFileSync } from 'node:fs';

const targets = { esm: 'module', cjs: 'commonjs' };

for (const [dir, type] of Object.entries(targets)) {
  writeFileSync(
    new URL(`../dist/${dir}/package.json`, import.meta.url),
    `${JSON.stringify({ type }, null, 2)}\n`,
  );
}
