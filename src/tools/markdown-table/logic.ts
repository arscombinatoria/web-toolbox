export type TableData = { rows: string[][] };

export function validateTable(table: TableData): void {
  const width = table.rows[0]?.length;
  if (table.rows.length && (!width || table.rows.some(row => row.length !== width))) {
    throw new Error('列数が一致しません。すべての行の列数を揃えてください。');
  }
}

// パイプの直前のバックスラッシュは偶数なら区切り、奇数なら文字。
function splitMarkdownRow(line: string): string[] {
  const cells: string[] = [];
  let start = 0;
  let slashes = 0;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '|' && slashes % 2 === 0) {
      cells.push(line.slice(start, i));
      start = i + 1;
    }
    slashes = char === '\\' ? slashes + 1 : 0;
  }
  cells.push(line.slice(start));
  if (cells.length > 1 && /^[ \t]*$/.test(cells[0]!)) cells.shift();
  if (cells.length > 1 && /^[ \t]*$/.test(cells.at(-1)!)) cells.pop();
  // 両端のASCIIスペース1文字のみを構文上の余白とする。
  return cells.map(cell => cell.replace(/^ /, '').replace(/ $/, ''));
}

function decodeCell(cell: string): string {
  let result = '';
  for (let i = 0; i < cell.length;) {
    if (cell[i] === '\\' && /[\\|<`]/.test(cell[i + 1] ?? '')) {
      result += cell[i + 1]; i += 2; continue;
    }
    if (cell[i] === '`') {
      const run = /^`+/.exec(cell.slice(i))![0];
      // 同じ長さのバッククォート列で閉じるコードスパンのみ保護する。
      const rest = cell.slice(i + run.length);
      const closing = [...rest.matchAll(/`+/g)].find(match => match[0].length === run.length);
      if (closing) {
        const end = i + run.length + closing.index! + run.length;
        result += cell.slice(i, end).replace(/\\([\\|])/g, '$1');
        i = end; continue;
      }
      result += run; i += run.length; continue;
    }
    const br = /^<br(?:>|\/>| \/>)/i.exec(cell.slice(i));
    if (br) {
      result += '\n'; i += br[0].length; continue;
    }
    result += cell[i++];
  }
  return result;
}

export function parseMarkdown(input: string): TableData {
  if (!input.trim()) return { rows: [] };
  const lines = input.replace(/\r\n?/g, '\n').split('\n');
  while (lines[0]?.trim() === '') lines.shift();
  while (lines.at(-1)?.trim() === '') lines.pop();
  if (lines.length < 2) throw new Error('ヘッダーと区切り行が必要です。');
  if (lines.some(line => !line.trim())) throw new Error('表の途中に空行は使用できません。単一の表を入力してください。');
  const raw = lines.map(splitMarkdownRow);
  validateTable({ rows: raw });
  if (!raw[1]!.every(cell => /^:?-{3,}:?$/.test(cell.trim()))) {
    throw new Error('2行目には ---、:---、---:、:---: の区切りを指定してください。');
  }
  return { rows: raw.filter((_, i) => i !== 1).map(row => row.map(decodeCell)) };
}

export function parseTsv(input: string): TableData {
  if (input === '') return { rows: [] };
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let state: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
  const finishCell = () => { row.push(cell); cell = ''; state = 'start'; };
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (state === 'quoted') {
      if (char === '"') {
        if (input[i + 1] === '"') { cell += '"'; i++; }
        else state = 'closed';
      } else cell += char;
      continue;
    }
    if (char === '\t' || char === '\r' || char === '\n') {
      finishCell();
      if (char !== '\t') {
        rows.push(row); row = [];
        if (char === '\r' && input[i + 1] === '\n') i++;
      }
    } else if (char === '"' && state === 'start') state = 'quoted';
    else {
      if (char === '"' || state === 'closed') throw new Error('引用符の構造が不正です。セル全体を引用符で囲み、内部の引用符は "" としてください。');
      cell += char; state = 'plain';
    }
  }
  if (state === 'quoted') throw new Error('引用符が閉じられていません。');
  if (state !== 'start' || row.length || !/[\r\n]$/.test(input)) {
    finishCell(); rows.push(row);
  }
  const table = { rows };
  validateTable(table);
  return table;
}

export function toTsv(table: TableData): string {
  validateTable(table);
  return table.rows.map(row => row.map(cell => (cell === '' && row.length === 1) || /["\t\r\n]/.test(cell)
    ? `"${cell.replace(/"/g, '""')}"` : cell).join('\t')).join('\r\n');
}

export function toMarkdown(table: TableData): string {
  validateTable(table);
  if (!table.rows.length) return '';
  const rows = table.rows.map(row => `| ${row.map(cell => cell
    .replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
    // リテラルのタグとバッククォートを保護し、実際の改行だけをタグにする。
    .replace(/`/g, '\\`').replace(/<(?=br(?:>|\/>| \/>))/gi, '\\<')
    .replace(/\r\n|\r|\n/g, '<br>')).join(' | ')} |`);
  rows.splice(1, 0, `| ${table.rows[0]!.map(() => '---').join(' | ')} |`);
  return rows.join('\n');
}
