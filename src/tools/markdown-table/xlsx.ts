import ExcelJS from 'exceljs';
import { validateTable, type TableData } from './logic';

// 巨大なワークブックを作らずにExcelの上限を検証できるよう、生成と分離する。
export function validateXlsxTable(table: TableData): void {
  validateTable(table);
  if (table.rows.length > 1048576 || (table.rows[0]?.length ?? 0) > 16384) {
    throw new Error('Excelの行数・列数の上限を超えています。');
  }
  if (table.rows.some(row => row.some(cell => cell.length > 32767))) {
    throw new Error('Excelの1セルの上限（32767文字）を超えています。');
  }
}

export async function generateXlsx(table: TableData): Promise<Uint8Array<ArrayBuffer>> {
  validateXlsxTable(table);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Table');
  for (const values of table.rows) {
    // XMLの改行正規化を避ける。既存のOOXMLエスケープ風文字列は先に保護する。
    const row = sheet.addRow(values.map(value => value
      .replace(/_(?=x[0-9A-Fa-f]{4}_)/g, '_x005F_')
      .replace(/\r/g, '_x000D_')));
    row.eachCell({ includeEmpty: true }, cell => {
      cell.numFmt = '@';
      cell.alignment = { wrapText: true, vertical: 'top' };
    });
  }
  if (table.rows.length) sheet.getRow(1).font = { bold: true };
  table.rows[0]?.forEach((_, index) => {
    let width = 8;
    for (const row of table.rows) {
      for (const line of row[index]!.split(/\r\n|\r|\n/)) {
        let length = 0;
        for (const char of line) length += char.codePointAt(0)! > 255 ? 2 : 1;
        width = Math.min(60, Math.max(width, length + 2));
      }
    }
    const column = sheet.getColumn(index + 1);
    column.width = width;
    // ExcelJSは幅9・書式なしの列を省略するため、列にも文字列書式を設定する。
    column.numFmt = '@';
  });
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
