import { describe, expect, it } from 'vitest';
import { MAX_PADDED_MARKDOWN_LENGTH } from './format';
import { parseMarkdown, toMarkdown, type TableData } from './logic';

describe('Markdown出力の列配置', () => {
  it('省略時の出力は従来どおりで、区切り行だけに配置を指定できる', () => {
    const table = { rows: [['h', 'h', 'h', 'h'], ['1', '2', '3', '4']] };
    expect(toMarkdown(table)).toBe('| h | h | h | h |\n| --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 |');
    expect(toMarkdown(table, { alignments: ['none', 'left', 'center', 'right'] }))
      .toBe('| h | h | h | h |\n| --- | :--- | :---: | ---: |\n| 1 | 2 | 3 | 4 |');
  });

  it('左・指定なしは右、右は左、中央は両側へ空白を足し区切りを伸ばす', () => {
    const table = { rows: [['h', 'a', 'xy', 'z'], ['long', 'bc', 'q', 'w']] };
    expect(toMarkdown(table, { alignments: ['left', 'center', 'right', 'none'], padding: true }))
      .toBe('| h    |   a   |   xy | z   |\n| :--- | :---: | ---: | --- |\n| long |  bc   |    q | w   |');
  });

  it('幅をエスケープ済みソースで測り、Unicode列幅と出力文字列を保持する', () => {
    const table = { rows: [['x', 'x', 'x', 'x', 'x'], ['日本', 'ｶﾞ', '👩‍💻', 'か\u3099', 'e\u0301']] };
    const output = toMarkdown(table, { padding: true });
    const rows = output.split('\n');
    expect(rows[0]).toBe('| x    | x   | x   | x   | x   |');
    expect(rows[2]).toBe('| 日本 | ｶﾞ  | 👩‍💻  | か\u3099  | e\u0301   |');
    expect(parseMarkdown(toMarkdown(table))).toEqual(table);
    expect(toMarkdown({ rows: [['header'], ['x\u1ab0']] }, { padding: true }).split('\n')[2])
      .toBe('| x\u1ab0      |');

    const escaped = toMarkdown({ rows: [['x'], ['a|b\\c<br>']] }, { padding: true });
    expect(escaped).toContain('a\\|b\\\\c\\<br>');
    expect(parseMarkdown(escaped).rows[1]).toEqual(['a|b\\c<br>']);
    const escapedWidth = toMarkdown({ rows: [['a|b', '\\', '<br>'], ['x', 'y', 'z']] }, { padding: true });
    expect(escapedWidth.split('\n')[0]).toBe('| a\\|b | \\\\  | \\<br> |');
    expect(escapedWidth.split('\n')[2]).toBe('| x    | y   | z     |');
  });

  it('タブと制御文字を内容として保ち、パディング前のサイズ見積で上限を守る', () => {
    const withControls = { rows: [['h'], ['a\t\u0001']] };
    expect(toMarkdown(withControls, { padding: true })).toContain('a\t\u0001');
    expect(MAX_PADDED_MARKDOWN_LENGTH).toBe(1_000_000);

    const within: TableData = { rows: [['h'], ['x'.repeat(249_995)], ['x'.repeat(249_995)]] };
    expect(toMarkdown(within, { padding: true }).length).toBe(MAX_PADDED_MARKDOWN_LENGTH - 1);
    const over: TableData = { rows: [['h'], ['x'.repeat(249_996)], ['x'.repeat(249_996)]] };
    expect(() => toMarkdown(over, { padding: true })).toThrow(/1,000,000 UTF-16文字/);
    expect(toMarkdown(over).length).toBeLessThan(MAX_PADDED_MARKDOWN_LENGTH);
  });

  it('空セル・末尾空セル・タブの幅を保持したまま区切りを残す', () => {
    const table = { rows: [['', ''], ['\t', '']] };
    const output = toMarkdown(table, { padding: true });
    expect(output.split('\n')).toHaveLength(3);
    expect(output.split('\n')[0]).toBe('|     |     |');
    expect(output.split('\n')[2]).toMatch(/^\| .* \| .* \|$/);
  });
});
