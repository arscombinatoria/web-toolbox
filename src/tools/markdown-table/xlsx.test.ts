import { describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { generateXlsx, validateXlsxTable } from './xlsx';

async function readXlsx(rows: string[][]): Promise<ExcelJS.Worksheet> {
  const bytes = await generateXlsx({ rows });
  expect(bytes).toBeInstanceOf(Uint8Array);
  expect(Array.from(bytes.slice(0, 2))).toEqual([80, 75]);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes.buffer);
  expect(book.worksheets.map(sheet => sheet.name)).toEqual(['Table']);
  return book.getWorksheet('Table')!;
}

describe('generateXlsx', () => {
  it('ヘッダーと複数のデータ行を文字列型のまま保持し、入力を変更しない', async () => {
    const rows = [['番号', '長い数字', '日付'], ['00123', '12345678901234567890', '2026-10-17'], ['00000', '0', '1E10']];
    const original = rows.map(row => [...row]);
    const sheet = await readXlsx(rows);
    expect(sheet.rowCount).toBe(3);
    expect(sheet.columnCount).toBe(3);
    rows.forEach((row, r) => row.forEach((value, c) => {
      const cell = sheet.getCell(r + 1, c + 1);
      expect(cell.value).toBe(value);
      expect(cell.type).toBe(ExcelJS.ValueType.String);
      expect(cell.formula).toBeUndefined();
    }));
    expect(rows).toEqual(original);
  });

  it.each(['=SUM(A1:A3)', '+123', '-123', '@ABC'])('ヘッダーとデータの %s を数式に変換しない', async value => {
    const sheet = await readXlsx([[value], [value]]);
    for (const address of ['A1', 'A2']) {
      const cell = sheet.getCell(address);
      expect(cell.value).toBe(value);
      expect(cell.type).toBe(ExcelJS.ValueType.String);
      expect(cell.formula).toBeUndefined();
    }
  });

  it('セル内のタブ・LF・CRLF・CR・引用符・Unicode・前後の空白を保持', async () => {
    const values = ['a\tb', 'a\nb', 'a\r\nb', 'a\rb', '"引用符"と""', '日本語é😀e\u0301𝄞', '  空白　 '];
    const sheet = await readXlsx([values, values]);
    for (let r = 1; r <= 2; r++) {
      values.forEach((value, c) => expect(sheet.getCell(r, c + 1).value).toBe(value));
    }
  });

  it('先頭・途中・末尾の空文字列と、すべて空の行・列を保持', async () => {
    const rows = [['', '見出し', '', '末尾', ''], ['', '', '値', '', ''], ['', '', '', '', '']];
    const sheet = await readXlsx(rows);
    expect(sheet.rowCount).toBe(3);
    expect(sheet.columnCount).toBe(5);
    rows.forEach((row, r) => row.forEach((value, c) => {
      const cell = sheet.getCell(r + 1, c + 1);
      expect(cell.value).toBe(value);
      expect(cell.type).toBe(ExcelJS.ValueType.String);
    }));
  });

  it('OOXMLエスケープ風文字列とXML特殊文字を文字列のまま保持', async () => {
    const values = ['_x000D_', '_x0041_', '_x005F_x0041_', '_x000D_x0041_', '_x00ff_', 'a_x000A_b\r\nc', '&<>\'"'];
    const sheet = await readXlsx([values, values]);
    for (let r = 1; r <= 2; r++) {
      values.forEach((value, c) => expect(sheet.getCell(r, c + 1).value).toBe(value));
    }
  });

  it('空文字列1セルの表と空表を区別', async () => {
    const single = await readXlsx([['']]);
    expect(single.rowCount).toBe(1);
    expect(single.getCell('A1').value).toBe('');
    const empty = await readXlsx([]);
    expect(empty.rowCount).toBe(0);
    expect(empty.columnCount).toBe(0);
    expect(empty.getCell('A1').value).toBeNull();
    expect(empty.getCell('A1').font?.bold).toBeFalsy();
  });

  it('空セルを含む全セルに文字列書式・折り返し・上揃えを適用し、ヘッダーだけを太字にする', async () => {
    const rows = [['', '見出し'], ['', '値'], ['', '']];
    const sheet = await readXlsx(rows);
    rows.forEach((row, r) => row.forEach((_, c) => {
      const cell = sheet.getCell(r + 1, c + 1);
      expect(cell.numFmt).toBe('@');
      expect(cell.alignment.wrapText).toBe(true);
      expect(cell.alignment.vertical).toBe('top');
      expect(Boolean(cell.font?.bold)).toBe(r === 0);
    }));
  });

  it.each([
    { name: '空文字列は最小幅8', values: ['', ''], width: 8 },
    { name: 'ASCII 6文字に余白2', values: ['h', '123456'], width: 8 },
    { name: 'ASCII 7文字に余白2', values: ['h', '1234567'], width: 9 },
    { name: 'ヘッダーも計算対象', values: ['1234567890', 'x'], width: 12 },
    { name: '途中の行の最大幅を保持', values: ['h', '123456789', 'x'], width: 11 },
    { name: 'コードポイント255は幅1', values: ['h', 'ÿ'.repeat(7)], width: 9 },
    { name: 'コードポイント256は幅2', values: ['h', 'Ā'.repeat(4)], width: 10 },
    { name: 'ASCIIと日本語の混在', values: ['h', 'ABC日本'], width: 9 },
    { name: '絵文字はコードポイントごとに幅2', values: ['h', '😀'.repeat(4)], width: 10 },
    ...['\n', '\r\n', '\r'].map(newline => ({ name: `改行 ${JSON.stringify(newline)} ごとの最長行`, values: ['h', `ab${newline}1234567${newline}c`], width: 9 })),
    { name: '上限直前の幅59', values: ['h', 'x'.repeat(57)], width: 59 },
    { name: '上限ちょうどの幅60', values: ['h', 'x'.repeat(58)], width: 60 },
    { name: '幅61を上限60に制限', values: ['h', 'x'.repeat(59)], width: 60 },
    { name: '長い日本語を上限60に制限', values: ['h', '長'.repeat(1000)], width: 60 },
  ])('列幅: $name', async ({ values, width }) => {
    const sheet = await readXlsx(values.map(value => [value, '短い']));
    expect(sheet.getColumn(1).width).toBe(width);
    expect(sheet.getColumn(2).width).toBe(8);
  });

  it.each([
    { name: '上限直前32766', value: 'a'.repeat(32766) },
    { name: '上限32767', value: 'a'.repeat(32767) },
    { name: '絵文字を含むUTF-16長32767', value: `${'😀'.repeat(16383)}a` },
  ])('セル長: $name を切り詰めずに保持', async ({ value }) => {
    const sheet = await readXlsx([[value], [value]]);
    expect(sheet.getCell('A1').value).toBe(value);
    expect(sheet.getCell('A2').value).toBe(value);
  });

  it.each([
    { name: '列がない行', rows: [[]], error: '列数が一致しません' },
    { name: 'ヘッダーが空の不揃いな表', rows: [[], ['x']], error: '列数が一致しません' },
    { name: 'ヘッダーより短い行', rows: [['a', 'b'], ['x']], error: '列数が一致しません' },
    { name: 'ヘッダーより長い行', rows: [['a'], ['x', 'y']], error: '列数が一致しません' },
    { name: '途中に空行', rows: [['a'], [], ['x']], error: '列数が一致しません' },
    { name: '列数超過', rows: [Array<string>(16385).fill('')], error: 'Excelの行数・列数の上限' },
    { name: 'ヘッダーのセル長超過', rows: [['x'.repeat(32768)]], error: 'Excelの1セルの上限（32767文字）' },
    { name: 'データのセル長超過', rows: [['h'], ['x'.repeat(32768)]], error: 'Excelの1セルの上限（32767文字）' },
    { name: 'UTF-16コード単位でセル長超過', rows: [['😀'.repeat(16384)]], error: 'Excelの1セルの上限（32767文字）' },
  ])('$name はワークブック生成前に拒否する', async ({ rows, error }) => {
    const create = vi.spyOn(ExcelJS, 'Workbook').mockImplementation(function () {
      throw new Error('不正入力からWorkbookを生成しました。');
    });
    await expect(generateXlsx({ rows })).rejects.toThrow(error);
    expect(create).not.toHaveBeenCalled();
  });

  it('行数超過はワークブック生成前に拒否する', async () => {
    // 同じ短い行を共有し、生成処理に進む退行があっても巨大なXLSXを作らせない。
    const rows = Array<string[]>(1048577).fill(['']);
    const create = vi.spyOn(ExcelJS, 'Workbook').mockImplementation(function () {
      throw new Error('不正入力からWorkbookを生成しました。');
    });
    await expect(generateXlsx({ rows })).rejects.toThrow('Excelの行数・列数の上限');
    expect(create).not.toHaveBeenCalled();
  });

  it('ExcelJSの書き込み失敗を呼び出し元へ伝える', async () => {
    const writer = new ExcelJS.Workbook().xlsx;
    const error = new Error('書き込み失敗');
    vi.spyOn(writer, 'writeBuffer').mockRejectedValue(error);
    vi.spyOn(ExcelJS.Workbook.prototype, 'xlsx', 'get').mockReturnValue(writer);
    await expect(generateXlsx({ rows: [['h'], ['x']] })).rejects.toBe(error);
  });
});

describe('validateXlsxTable', () => {
  it.each([1048575, 1048576])('ヘッダーを含む行数 %i を受理する', count => {
    // 約8MiBの参照配列のみで上限を検証し、行・セル・XLSXは大量生成しない。
    const rows = Array<string[]>(count).fill(['']);
    expect(() => validateXlsxTable({ rows })).not.toThrow();
  });

  it('ヘッダーを含む行数1048577を拒否する', () => {
    expect(() => validateXlsxTable({ rows: Array<string[]>(1048577).fill(['']) })).toThrow('Excelの行数・列数の上限');
  });

  it.each([16383, 16384])('列数 %i を受理する', count => {
    expect(() => validateXlsxTable({ rows: [Array<string>(count).fill('')] })).not.toThrow();
  });

  it('列数16385を拒否する', () => {
    expect(() => validateXlsxTable({ rows: [Array<string>(16385).fill('')] })).toThrow('Excelの行数・列数の上限');
  });
});
