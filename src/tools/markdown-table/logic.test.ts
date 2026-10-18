// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { parseMarkdown, parseTsv, toMarkdown, toTsv, type TableData } from './logic';

describe('Markdown', () => {
  it.each(['---', ':---', '---:', ':---:'])('区切り %s と任意の外側パイプ', separator => {
    expect(parseMarkdown(`a | b\n${separator} | ${separator}\n1 | 2`)).toEqual({ rows: [['a', 'b'], ['1', '2']] });
    expect(parseMarkdown(`| a | b |\n| ${separator} | ${separator} |`)).toEqual({ rows: [['a', 'b']] });
  });
  it('装飾、Unicode、構文以外の空白と空セルを保持', () => {
    expect(parseMarkdown('| a | b | c |\n| --- | --- | --- |\n|  **青森**  |\t　| |')).toEqual({ rows: [['a', 'b', 'c'], [' **青森** ', '\t　', '']] });
  });
  it('連続バックスラッシュの偶奇', () => {
    for (let count = 0; count <= 6; count++) {
      const slashes = '\\'.repeat(count);
      const input = count % 2 ? `| h |\n| --- |\n| a${slashes}|b |` : `| h | j |\n| --- | --- |\n| a${slashes}|b |`;
      expect(parseMarkdown(input).rows[1]).toEqual(count % 2 ? [`a${'\\'.repeat(Math.floor(count / 2))}|b`] : [`a${'\\'.repeat(count / 2)}`, 'b']);
    }
  });
  it('通常のbrのみ改行にし、コードスパン・エスケープを保護', () => {
    const source = '| h |\n| --- |\n| a<br>b<br/>c<br />d<BR>e `x<br>` ``x`<br/>`` \\<br> \\`<br> |';
    expect(parseMarkdown(source).rows[1]).toEqual(['a\nb\nc\nd\ne `x<br>` ``x`<br/>`` <br> `\n']);
    expect(parseMarkdown('| h |\n| --- |\n| `unclosed<br> &lt;br&gt; <br class="x"> |').rows[1]).toEqual(['`unclosed\n &lt;br&gt; <br class="x">']);
  });
  it('異なる長さのコードスパン内で引用符・brを保持し、パイプとバックスラッシュを復元', () => {
    expect(parseMarkdown('| h |\n| --- |\n| ``a`\\|b\\\\c<br>`` "q" `tail\\|x` |').rows[1])
      .toEqual(['``a`|b\\c<br>`` "q" `tail|x`']);
  });
  it('エスケープ対象外と末尾の単独バックスラッシュを保持', () => {
    expect(parseMarkdown('| h |\n| --- |\n| C:\\path\\q |\n末尾\\'))
      .toEqual({ rows: [['h'], ['C:\\path\\q'], ['末尾\\']] });
  });
  it.each(['h', 'h\n--', 'a|b\n---', 'a|b\n---|---\nx', 'h\n---\n\nx'])('不正入力を拒否 %s', input => {
    expect(() => parseMarkdown(input)).toThrow();
  });
  it('空入力と前後の空行', () => {
    expect(parseMarkdown('')).toEqual({ rows: [] });
    expect(parseMarkdown(' \n\t')).toEqual({ rows: [] });
    expect(parseMarkdown('\r\nh\r\n---\r\n')).toEqual({ rows: [['h']] });
  });
  it('CRLF・LF・CRが混在する複数行を解析', () => {
    expect(parseMarkdown('| h | 空欄 |\r\n| --- | --- |\n| か\u3099🙂 |  |\r| e\u0301 | 終 |'))
      .toEqual({ rows: [['h', '空欄'], ['か\u3099🙂', ''], ['e\u0301', '終']] });
  });
});

describe('TSV', () => {
  it.each(['\n', '\r\n', '\r'])('行区切り %j、最終改行、空セル', newline => {
    for (const end of ['', newline]) {
      expect(parseTsv(`a\tb\tc${newline}x\t\t${end}`)).toEqual({ rows: [['a', 'b', 'c'], ['x', '', '']] });
    }
  });
  it('引用符、セル内タブ・改行・エスケープ', () => {
    expect(parseTsv('"a\tb"\t"x\r\ny\nz\rw"\t"a""b"\t""\r\n')).toEqual({ rows: [['a\tb', 'x\r\ny\nz\rw', 'a"b', '']] });
  });
  it.each(['"unclosed', 'a"b', '"a"b', '"a" ', 'a\tb\nx'])('不正入力を拒否 %s', input => {
    expect(() => parseTsv(input)).toThrow();
  });
  it('空文字、空セル、空行を区別', () => {
    expect(parseTsv('')).toEqual({ rows: [] });
    expect(parseTsv('""')).toEqual({ rows: [['']] });
    expect(parseTsv('\t')).toEqual({ rows: [['', '']] });
    expect(parseTsv('\n\n')).toEqual({ rows: [[''], ['']] });
    expect(parseTsv(' ')).toEqual({ rows: [[' ']] });
  });
  it('混在する行区切りと引用符内の改行を区別', () => {
    expect(parseTsv('h\t備考\r\n"a\r\nb\nc\rd"\t""\n🙂\te\u0301\r末尾\t\r\n'))
      .toEqual({ rows: [['h', '備考'], ['a\r\nb\nc\rd', ''], ['🙂', 'e\u0301'], ['末尾', '']] });
  });
});

describe('出力と往復', () => {
  it('TSV出力の引用符処理と末尾空セル', () => {
    expect(toTsv({ rows: [['a\tb', 'a"b', 'a\nb', '']] })).toBe('"a\tb"\t"a""b"\t"a\nb"\t');
  });
  it('Markdown出力のエスケープ・標準区切りと改行の正規化', () => {
    expect(toMarkdown({ rows: [['a|b', '\\'], ['x\r\ny\rz\nw', '']] })).toBe('| a\\|b | \\\\ |\n| --- | --- |\n| x<br>y<br>z<br>w |  |');
  });
  it('空表と不正な共通データ', () => {
    expect(toMarkdown({ rows: [] })).toBe('');
    expect(toTsv({ rows: [] })).toBe('');
    for (const serialize of [toMarkdown, toTsv]) {
      for (const rows of [[[]], [['a'], []], [['a'], ['b', 'c']]]) {
        expect(() => serialize({ rows })).toThrow('列数');
      }
    }
  });
});

// 矩形の表（空表以外は1列以上）。Markdownはセル内CR/CRLFをLFへ
// 正規化するため、完全一致の往復はLFのみを含むモデルを対象とする。
const roundTripCases: { name: string; table: TableData }[] = [
  { name: '空表', table: { rows: [] } },
  { name: '空ヘッダー1セル', table: { rows: [['']] } },
  { name: '1列の空セル2行', table: { rows: [[''], ['']] } },
  { name: '1列の空行と末尾空行', table: { rows: [[''], ['内容'], [''], ['']] } },
  { name: '複数列の空ヘッダー・空セル・末尾空行', table: { rows: [['', '', ''], ['', '中', ''], ['', '', '']] } },
  { name: '連続パイプとバックスラッシュ', table: { rows: [['|', '\\', '末尾\\'], ['||||', '\\\\||\\\\\\', '\\|\\|']] } },
  { name: '引用符・バッククォート・タブ・複数行', table: { rows: [['"""', '``a`|b``', '\t'], ['"`\\|`"', '\n\n終\n', ' "引用"\t値 ']] } },
  { name: 'Unicode・絵文字・結合文字と空白', table: { rows: [['日本語🙂👩‍💻', 'e\u0301か\u3099', '  \t　'], ['\u00a0\u200b', '👨‍👩‍👧‍👦🏳️‍🌈', '終']] } },
  { name: '改行とリテラルbr・コード・HTML', table: { rows: [['<br><BR/><br />', '`<br>` ``<BR />``', '\\<br>'], ['a\nb', '&lt;br&gt;', '<br class="x">']] } },
  { name: '先頭ゼロ・長い数字・数式風文字列と複合セル', table: { rows: [['h', '', '備考'], ['00123', '12345678901234567890', '=SUM(A1:A3)'], ['2026-10-17', 'a\tb"c\nd', '  空白  '], ['a|b\\c', '<br> `x`', '']] } },
];

// 新しい依存を増やさず、失敗を再現できる固定シードで文字列の組み合わせを探索する。
function generatedTables(): TableData[] {
  let seed = 0x5eed1234;
  const next = (max: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % max;
  };
  const atoms = ['a', ' ', '\t', '\n', '|', '\\', '"', '`', '``', '<br>', '<BR/>', '<br />', '&lt;br&gt;', '日本語', '🙂', 'e\u0301', 'か\u3099'];
  return Array.from({ length: 128 }, () => {
    const width = next(5) + 1;
    return { rows: Array.from({ length: next(5) + 1 }, () =>
      Array.from({ length: width }, () => Array.from({ length: next(8) }, () => atoms[next(atoms.length)]!).join(''))) };
  });
}

describe.each([
  { name: 'TSV', parse: parseTsv, serialize: toTsv },
  { name: 'Markdown', parse: parseMarkdown, serialize: toMarkdown },
])('$nameのモデル往復', ({ parse, serialize }) => {
  it.each(roundTripCases)('$name', ({ table }) => {
    expect(parse(serialize(table))).toEqual(table);
  });
  it('固定シードの128表を往復して値と列数を保持', () => {
    generatedTables().forEach((table, index) => {
      expect(parse(serialize(table)), `seed=0x5eed1234, table=${index}`).toEqual(table);
    });
  });
});

describe('形式をまたぐ往復と改行の制約', () => {
  it.each(roundTripCases)('$nameをMarkdown→TSV→Markdownで保持', ({ table }) => {
    const markdown = toMarkdown(table);
    const tsv = toTsv(parseMarkdown(markdown));
    expect(parseTsv(tsv)).toEqual(table);
    expect(toMarkdown(parseTsv(tsv))).toBe(markdown);
  });
  it('TSVはセル内CRLF・CRを保持し、Markdown経由ではLFに正規化', () => {
    const table = { rows: [['改行', 'リテラル'], ['a\r\nb\rc\nd\r\n', '<br>\\r\\n']] };
    const normalized = { rows: [['改行', 'リテラル'], ['a\nb\nc\nd\n', '<br>\\r\\n']] };
    expect(parseTsv(toTsv(table))).toEqual(table);
    const throughMarkdown = parseMarkdown(toMarkdown(parseTsv(toTsv(table))));
    expect(throughMarkdown).toEqual(normalized);
    expect(parseTsv(toTsv(throughMarkdown))).toEqual(normalized);
  });
});
