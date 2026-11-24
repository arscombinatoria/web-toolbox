import { beforeEach, describe, expect, it } from 'vitest';
import { parseMarkdown } from './logic';
import { buildMarkdownPreview, PREVIEW_LIMITS } from './preview';

beforeEach(() => { document.body.replaceChildren(); });

function tableSource(rows: number, columns: number): string {
  const formatRow = (row: string[]) => `| ${row.join(' | ')} |`;
  return [
    formatRow(Array.from({ length: columns }, (_, index) => `h${index}`)),
    formatRow(Array.from({ length: columns }, () => '---')),
    ...Array.from({ length: rows - 1 }, () => formatRow(Array.from({ length: columns }, () => 'x'))),
  ].join('\n');
}

function tableData(rows: number, columns: number): { rows: string[][] } {
  return { rows: Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => row === 0 ? `h${column}` : 'x')) };
}

describe('Markdown preview', () => {
  it('builds a table with alignment and allowed inline formatting and line breaks', () => {
    const source = '| Head | Center | Right |\n| --- | :---: | ---: |\n| **bold** *em* ~~del~~ `code` | a<br>b<br/>c<br />d | value |';
    const result = buildMarkdownPreview(source, parseMarkdown(source));
    expect(result.reason).toBeUndefined();
    const root = result.element!;
    document.body.append(root);
    expect(root.getAttribute('role')).toBe('region');
    expect(root.tabIndex).toBe(0);
    expect(root.querySelectorAll('table, thead, tbody, th, td')).toHaveLength(9);
    expect(root.querySelector('td strong')?.textContent).toBe('bold');
    expect(root.querySelector('td em')?.textContent).toBe('em');
    expect(root.querySelector('td s')?.textContent).toBe('del');
    expect(root.querySelector('td code')?.textContent).toBe('code');
    expect(root.querySelectorAll('br')).toHaveLength(3);
    expect(root.querySelectorAll('td.table-preview-align-center')).toHaveLength(1);
    expect(root.querySelectorAll('td.table-preview-align-right')).toHaveLength(1);
  });

  it('renders empty cells and a header-only table', () => {
    const source = '| empty | |\n| --- | --- |';
    const result = buildMarkdownPreview(source, parseMarkdown(source));
    expect(result.reason).toBeUndefined();
    expect(result.element?.querySelectorAll('th')).toHaveLength(2);
    expect(result.element?.querySelectorAll('td')).toHaveLength(0);
    expect(result.element?.querySelector('th + th')?.textContent).toBe('');
  });

  it('keeps link and image destinations inert and never turns raw HTML into elements', () => {
    const source = '| cell |\n| --- |\n| [click](javascript:alert(1)) ![alt](https://example.invalid/a.png) <img src="https://example.invalid/x" onerror="alert(1)"> <strong>raw</strong> |';
    const result = buildMarkdownPreview(source, parseMarkdown(source));
    expect(result.reason).toBeUndefined();
    const root = result.element!;
    document.body.append(root);
    expect(root.querySelector('a, img, script, strong[onerror], style')).toBeNull();
    expect(root.querySelector('[href], [src], [style], [onerror]')).toBeNull();
    expect(root.querySelector('.table-preview-image-alt')?.textContent).toBe('alt');
    expect(root.textContent).toContain('click');
    expect(root.textContent).toContain('<img src="https://example.invalid/x" onerror="alert(1)">');
    expect(root.textContent).toContain('<strong>raw</strong>');
  });

  it('treats code and escaped br as literal text while only exact safe br tags become breaks', () => {
    const source = '| h |\n| --- |\n| `x<br>` \\<br> <br class="unsafe"> <br> |';
    const result = buildMarkdownPreview(source, parseMarkdown(source));
    expect(result.reason).toBeUndefined();
    expect(result.element?.querySelectorAll('br')).toHaveLength(1);
    expect(result.element?.querySelector('code')?.textContent).toBe('x<br>');
    expect(result.element?.textContent).toContain('<br>');
    expect(result.element?.textContent).toContain('<br class="unsafe">');
  });

  it('converts only standalone br tokens and keeps attribute/comment text literal', () => {
    const source = '| h |\n| --- |\n| a<br>b<br/>c<br />d <span title="<br>">x</span> <!-- <br> --> |';
    const result = buildMarkdownPreview(source, parseMarkdown(source));
    expect(result.reason).toBeUndefined();
    expect(result.element?.querySelectorAll('br')).toHaveLength(3);
    expect(result.element?.textContent).toContain('<span title="<br>">x</span>');
    expect(result.element?.textContent).toContain('<!-- <br> -->');
  });

  it('reports converter/parser structural differences before returning a table', () => {
    const source = `| a | b |\n| --- | --- |\n| x${'\\'.repeat(2)}| y |`;
    expect(() => parseMarkdown(source)).not.toThrow();
    expect(buildMarkdownPreview(source, parseMarkdown(source)).reason).toContain('形が一致しない');
  });

  it('accepts odd backslash runs before an escaped pipe', () => {
    const source = `| h |\n| --- |\n| x${'\\'.repeat(3)}|y |`;
    const expected = parseMarkdown(source);
    expect(expected.rows[1]).toEqual(['x\\|y']);
    expect(buildMarkdownPreview(source, expected).reason).toBeUndefined();
  });

  it('accepts exact row, column, and cell limits and rejects the next over-limit shape', () => {
    const maxRows = tableData(PREVIEW_LIMITS.rows, 1);
    expect(buildMarkdownPreview(tableSource(PREVIEW_LIMITS.rows, 1), maxRows).reason).toBeUndefined();
    const tooManyRows = tableData(PREVIEW_LIMITS.rows + 1, 1);
    expect(buildMarkdownPreview(tableSource(PREVIEW_LIMITS.rows + 1, 1), tooManyRows).reason).toContain('プレビューは');

    const maxColumns = tableData(1, PREVIEW_LIMITS.columns);
    expect(buildMarkdownPreview(tableSource(1, PREVIEW_LIMITS.columns), maxColumns).reason).toBeUndefined();
    const tooManyColumns = tableData(1, PREVIEW_LIMITS.columns + 1);
    expect(buildMarkdownPreview(tableSource(1, PREVIEW_LIMITS.columns + 1), tooManyColumns).reason).toContain('プレビューは');

    const maxCells = tableData(100, 50);
    expect(buildMarkdownPreview(tableSource(100, 50), maxCells).reason).toBeUndefined();
    const tooManyCells = tableData(101, 50);
    expect(buildMarkdownPreview(tableSource(101, 50), tooManyCells).reason).toContain('プレビューは');
  });

  it('accepts an exact UTF-16 source limit and rejects one code unit more', () => {
    const prefix = '| h |\n| --- |\n| ';
    const suffix = ' |';
    const exact = `${prefix}${'x'.repeat(PREVIEW_LIMITS.sourceLength - prefix.length - suffix.length)}${suffix}`;
    expect(exact.length).toBe(PREVIEW_LIMITS.sourceLength);
    expect(buildMarkdownPreview(exact, { rows: [['h'], ['x'.repeat(PREVIEW_LIMITS.sourceLength - prefix.length - suffix.length)]] }).reason).toBeUndefined();
    const over = exact + 'x';
    expect(buildMarkdownPreview(over, { rows: [['h'], ['x'.repeat(over.length)]] }).reason).toContain('プレビューは');
  });

  it('enforces the token limit before creating preview DOM nodes', () => {
    const source = '| h |\n| --- |\n| ' + '**a** '.repeat(17_000) + ' |';
    const expected = { rows: [['h'], ['a '.repeat(17_000)]] };
    const result = buildMarkdownPreview(source, expected);
    expect(result.element).toBeUndefined();
    expect(result.reason).toContain('トークン');
    expect(document.body.childElementCount).toBe(0);
  });
});
