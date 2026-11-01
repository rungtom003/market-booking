import ExcelJS from 'exceljs';

export interface ReportColumn<T> {
  header: string;
  width?: number;
  /** รูปแบบตัวเลขใน Excel เช่น '#,##0.00', '0.0%' */
  numFmt?: string;
  value: (row: T) => string | number | null;
}

export interface ReportFile {
  filename: string;
  contentType: string;
  buffer: Buffer;
}

/** ไฟล์ xlsx แผ่นเดียว: หัวตารางตัวหนา + ตรึงแถวแรก + แถวสรุป (ถ้ามี) ตัวหนา */
export async function toXlsx<T>(
  sheetName: string,
  columns: ReportColumn<T>[],
  rows: readonly T[],
  footer?: T,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map((c, i) => ({
    header: c.header,
    key: String(i),
    width: c.width ?? 14,
    ...(c.numFmt && { style: { numFmt: c.numFmt } }),
  }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow(columns.map((c) => c.value(row)));
  if (footer) sheet.addRow(columns.map((c) => c.value(footer))).font = { bold: true };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** ให้ Excel รู้ว่าเป็น UTF-8 (ภาษาไทยไม่เพี้ยน) */
const BOM = String.fromCharCode(0xfeff);

function csvCell(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * CSV (UTF-8 + BOM ให้ Excel อ่านภาษาไทยถูก) — ตัวเลขเป็นค่าดิบ ไม่ใส่จุลภาค
 * ค่าที่ขึ้นต้นด้วย = + - @ ใส่ ' นำหน้า กันสูตรทำงานเมื่อเปิดใน Excel (CSV injection)
 */
export function toCsv<T>(columns: ReportColumn<T>[], rows: readonly T[], footer?: T): Buffer {
  const line = (cells: (string | number | null)[]) =>
    cells
      .map((v) => (typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : v))
      .map(csvCell)
      .join(',');
  const lines = [
    line(columns.map((c) => c.header)),
    ...rows.map((r) => line(columns.map((c) => c.value(r)))),
    ...(footer ? [line(columns.map((c) => c.value(footer)))] : []),
  ];
  return Buffer.from(`${BOM}${lines.join('\r\n')}\r\n`, 'utf8');
}

export async function toReportFile<T>(
  format: 'xlsx' | 'csv',
  name: string,
  sheetName: string,
  columns: ReportColumn<T>[],
  rows: readonly T[],
  footer?: T,
): Promise<ReportFile> {
  return format === 'xlsx'
    ? {
        filename: `${name}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: await toXlsx(sheetName, columns, rows, footer),
      }
    : {
        filename: `${name}.csv`,
        contentType: 'text/csv; charset=utf-8',
        buffer: toCsv(columns, rows, footer),
      };
}
