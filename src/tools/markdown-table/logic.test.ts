import { describe, expect, it } from 'vitest';
import { parseMarkdown, parseTsv, toMarkdown, toTsv } from './logic';

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
  it.each(['h', 'h\n--', 'a|b\n---', 'a|b\n---|---\nx', 'h\n---\n\nx'])('不正入力を拒否 %s', input => {
    expect(() => parseMarkdown(input)).toThrow();
  });
  it('空入力と前後の空行', () => {
    expect(parseMarkdown(' \n\t')).toEqual({ rows: [] });
    expect(parseMarkdown('\r\nh\r\n---\r\n')).toEqual({ rows: [['h']] });
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
});

describe('出力と往復', () => {
  const table = { rows: [['h', '', '備考'], ['00123', '12345678901234567890', '=SUM(A1:A3)'], ['2026-10-17', 'a\tb"c\nd', '  空白  '], ['a|b\\c', '<br> `x`', '']] };
  it('TSVの引用符処理と値の保持', () => {
    expect(toTsv({ rows: [['a\tb', 'a"b', 'a\nb', '']] })).toBe('"a\tb"\t"a""b"\t"a\nb"\t');
    expect(parseTsv(toTsv(table))).toEqual(table);
    expect(parseTsv(toTsv({ rows: [[''], ['']] }))).toEqual({ rows: [[''], ['']] });
  });
  it('Markdownのエスケープと標準区切り、改行を保持', () => {
    expect(toMarkdown({ rows: [['a|b', '\\'], ['x\r\ny\rz\nw', '']] })).toBe('| a\\|b | \\\\ |\n| --- | --- |\n| x<br>y<br>z<br>w |  |');
    expect(parseMarkdown(toMarkdown(table))).toEqual(table);
  });
  it('空表と不正な共通データ', () => {
    expect(toMarkdown({ rows: [] })).toBe('');
    expect(toTsv({ rows: [] })).toBe('');
    for (const serialize of [toMarkdown, toTsv]) expect(() => serialize({ rows: [['a'], []] })).toThrow();
  });
});
