import ExcelJS from 'exceljs';
import { type ReportColumn, toCsv, toXlsx } from './report-file';

interface Row {
  name: string;
  amount: number;
  note: string | null;
}

const columns: ReportColumn<Row>[] = [
  { header: 'ชื่อ', value: (r) => r.name },
  { header: 'ยอด', numFmt: '#,##0.00', value: (r) => r.amount },
  { header: 'หมายเหตุ', value: (r) => r.note },
];

describe('report files', () => {
  it('CSV: BOM + CRLF, escape จุลภาค/เครื่องหมายคำพูด, ค่าว่าง', () => {
    const csv = toCsv(columns, [
      { name: 'ร้าน "ป้าแดง", ข้าวมันไก่', amount: 1500.5, note: null },
    ]).toString('utf8');

    expect(csv).toBe('﻿ชื่อ,ยอด,หมายเหตุ\r\n"ร้าน ""ป้าแดง"", ข้าวมันไก่",1500.5,\r\n');
  });

  it('CSV: ค่าที่ขึ้นต้นด้วย = + - @ ไม่กลายเป็นสูตรใน Excel', () => {
    const csv = toCsv(columns, [
      { name: '=HYPERLINK("http://x")', amount: -5, note: '@SUM(A1)' },
    ]).toString('utf8');

    const line = csv.split('\r\n')[1];
    expect(line).toBe(`"'=HYPERLINK(""http://x"")",-5,'@SUM(A1)`);
  });

  it('xlsx: หัวตารางตัวหนา ตรึงแถวแรก และแถวสรุปตัวหนา', async () => {
    const buffer = await toXlsx('รายงาน', columns, [{ name: 'ก', amount: 100, note: 'x' }], {
      name: 'รวม',
      amount: 100,
      note: null,
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet('รายงาน')!;

    expect(sheet.getRow(1).font?.bold).toBe(true);
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.getRow(2).values).toEqual([undefined, 'ก', 100, 'x']);
    expect(sheet.getRow(3).font?.bold).toBe(true);
    expect(sheet.getColumn(2).numFmt).toBe('#,##0.00');
  });
});
