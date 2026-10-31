import { bulkCreateStallsSchema, bulkStallCodes, stallCodeSchema } from '@market-booking/shared';
import { compareStalls } from './stall-mapper';

describe('stall rules', () => {
  it('bulkStallCodes: prefix + ช่วงเลข + เติม 0', () => {
    expect(bulkStallCodes({ prefix: 'A', from: 1, to: 3, padLength: 0 })).toEqual([
      'A1',
      'A2',
      'A3',
    ]);
    expect(bulkStallCodes({ prefix: 'B', from: 9, to: 11, padLength: 2 })).toEqual([
      'B09',
      'B10',
      'B11',
    ]);
    expect(bulkStallCodes({ prefix: 'C', from: 5, to: 4, padLength: 0 })).toEqual([]);
  });

  it('compareStalls เรียงเลขแบบตัวเลข (A2 ก่อน A10)', () => {
    const codes = ['A10', 'B1', 'A2', 'A1'].map((code) => ({ code })).sort(compareStalls);
    expect(codes.map((c) => c.code)).toEqual(['A1', 'A2', 'A10', 'B1']);
  });

  it('stallCodeSchema: ตัดช่องว่างหัวท้าย, ตัวใหญ่, ห้ามช่องว่างกลางคำ', () => {
    expect(stallCodeSchema.parse(' a12 ')).toBe('A12');
    expect(stallCodeSchema.safeParse('A 12').success).toBe(false);
    expect(stallCodeSchema.safeParse('').success).toBe(false);
  });

  it('bulkCreateStallsSchema: ค่า default ของผังและขอบเขตจำนวน', () => {
    const base = {
      zoneId: '0195f0a0-0000-7000-8000-000000000000',
      prefix: 'a',
      widthM: 2,
      lengthM: 2,
      price: 1,
    };
    expect(bulkCreateStallsSchema.parse({ ...base, from: 1, to: 200 })).toMatchObject({
      prefix: 'A',
      padLength: 0,
      columns: 10,
      gap: 10,
      originX: 20,
      shapeW: 60,
    });
    expect(bulkCreateStallsSchema.safeParse({ ...base, from: 1, to: 201 }).success).toBe(false);
  });
});
