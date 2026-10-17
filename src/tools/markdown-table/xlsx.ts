import ExcelJS from 'exceljs';
import { validateTable, type TableData } from './logic';

export async function generateXlsx(table: TableData): Promise<Uint8Array<ArrayBuffer>> {
  validateTable(table);
  if (table.rows.length > 1048576 || (table.rows[0]?.length ?? 0) > 16384) {
    throw new Error('Excelの行数・列数の上限を超えています。');
  }
  if (table.rows.some(row => row.some(cell => cell.length > 32767))) {
    throw new Error('Excelの1セルの上限（32767文字）を超えています。');
  }
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Table');
  for (const values of table.rows) {
    const row = sheet.addRow(values);
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
    sheet.getColumn(index + 1).width = width;
  });
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
