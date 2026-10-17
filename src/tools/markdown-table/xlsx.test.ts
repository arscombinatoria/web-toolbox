import { expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { generateXlsx } from './xlsx';

it('実ファイルを生成し、文字列型・値・書式・列幅を再読み込みで検証', async () => {
  const rows = [['番号', '長い数字', '日付', '数式', '改行', '空', '幅'], ['00123', '12345678901234567890', '2026-10-17', '=SUM(A1:A3)', '青森県産\n甘みが強い', '', '長'.repeat(1000)]];
  const bytes = await generateXlsx({ rows });
  expect(Array.from(bytes.slice(0, 2))).toEqual([80, 75]);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes.buffer);
  const sheet = book.getWorksheet('Table')!;
  rows.forEach((row, r) => row.forEach((value, c) => {
    const cell = sheet.getCell(r + 1, c + 1);
    expect(cell.value).toBe(value);
    expect(cell.type).toBe(ExcelJS.ValueType.String);
    expect(cell.numFmt).toBe('@');
    expect(cell.alignment.wrapText).toBe(true);
    expect(cell.formula).toBeUndefined();
  }));
  expect(sheet.getCell('A1').font.bold).toBe(true);
  expect(sheet.getColumn(7).width).toBe(60);
  expect(sheet.getColumn(1).width).toBeGreaterThanOrEqual(8);
});

it('Excelの制限を超える値を黙って切り詰めない', async () => {
  await expect(generateXlsx({ rows: [['x'.repeat(32768)]] })).rejects.toThrow('32767');
  await expect(generateXlsx({ rows: [Array<string>(16385).fill('')] })).rejects.toThrow('上限');
});
