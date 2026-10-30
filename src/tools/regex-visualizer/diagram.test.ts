import { describe, expect, it } from 'vitest';
import { createDiagram } from './diagram';
import { FLAGS, MAX_PATTERN_LENGTH } from './protocol';

function diagram(pattern: string, flags = '') {
  const result = createDiagram(pattern, flags);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(result.message);
  const document = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
  expect(document.querySelector('parsererror')).toBeNull();
  return { ...result, document, text: document.documentElement.textContent! };
}

describe('ECMAScriptの構造', () => {
  it.each([
    ['abc', '文字列 “abc”'], ['[a-zA-Z0-9_]', '文字集合 [a-zA-Z0-9_]'],
    ['[^a-z]', '文字集合 [^a-z]'], ['a|b|', '空（0文字）'],
    ['a*', '*（合計回数）・貪欲'], ['a+', '+（合計回数）・貪欲'], ['a?', '?（合計回数）・貪欲'],
    ['a{2,4}', '{2,4}（合計回数）・貪欲'], ['a{3,}', '{3,}（合計回数）・貪欲'],
    ['a*?', '*?（合計回数）・非貪欲'], ['a+?', '+?（合計回数）・非貪欲'],
    ['a??', '??（合計回数）・非貪欲'], ['a{2,4}?', '{2,4}?（合計回数）・非貪欲'],
    ['(ab)(?:cd)', '非キャプチャグループ'], ['(?<name>a)\\k<name>', '捕捉 #1 <name>'],
    ['(a)\\1', '後方参照 \\1 → #1'], ['\\1(a)', '後方参照 \\1 → #1'],
    ['^a$\\b\\B', '非単語境界'], ['', '空（0文字）'], [' a ', '“␣a␣”'],
    ['a{99999999999999999999}', '{99999999999999999999}'],
  ])('%s', (pattern, expected) => { expect(diagram(pattern).text).toContain(expected); });

  it('0回は本体を通らず、正の有限回数・無限回数を展開しない', () => {
    const zero = diagram('UNREACHABLE{0}');
    expect(zero.text).toContain('0回（本体を通らない・0文字）');
    expect(zero.text).not.toContain('文字 “E”');
    expect(diagram('a{1000000}').svg.length).toBeLessThan(6000);
    expect(diagram('a{0,0}').text).not.toContain('“a”');
    expect(diagram('a{1}').text).toContain('{1}');
  });

  it.each(['(?:(?=a)){0}b', '(?:(?<=a)){0}b', '(?:(?=a)){0,0}b', '(?:(?<=a)){0,0}b'])('%sの実行されない条件を登録しない', pattern => {
    const result = diagram(pattern);
    expect(result.text).toContain('0回（本体を通らない・0文字）');
    expect(result.text).toContain('文字列 “b”');
    expect(result.text).not.toContain('内部構造');
    expect(result.text).not.toContain('条件1');
    expect(result.warnings).toEqual([]);
  });

  it('1回の量指定子では先読みの内部図を維持する', () => {
    const result = diagram('(?:(?=a)){1}b');
    expect(result.text).toContain('条件1（0文字）');
    expect(result.text).toContain('条件1：肯定先読みの内部構造');
    expect(result.text).toContain('文字列 “a”');
    expect(result.text).toContain('文字列 “b”');
  });

  it('0回の本体を省略しても全体の捕捉番号と後方参照先を維持する', () => {
    const result = diagram('(?:(?=(a))){0}(b)\\2');
    expect(result.text).not.toContain('内部構造');
    expect(result.text).not.toContain('捕捉 #1');
    expect(result.text).toContain('捕捉 #2');
    expect(result.text).toContain('後方参照 \\2 → #2');
  });

  it.each(['(?=ab)c', '(?!ab)c', '(?<=ab)c', '(?<!ab)c', '(?=(?<!x)y)z'])('アサーション%sは主経路から内部を分離', pattern => {
    const result = diagram(pattern);
    expect(result.text).toContain('条件1（0文字）');
    expect(result.text).toContain('内部構造');
    expect(result.warnings.join('')).toContain('主経路で消費しません');
    const mainLabel = [...result.document.querySelectorAll('g.condition')].find(node => node.textContent?.includes('条件1'))!;
    expect(mainLabel.querySelector('path')).toBeNull();
    if (pattern.includes('(?<')) expect(result.text).toContain('評価は右→左');
  });

  it.each(FLAGS)('フラグ%sを受理', flag => { expect(diagram('.', flag).text).toContain(`フラグ：${flag}`); });
  it('m/sと局所フラグを反映し、外側へ漏らさない', () => {
    expect(diagram('^.$', 'ms').text).toContain('行境界も含む');
    expect(diagram('.', 's').text).toContain('改行を含む');
    expect(diagram('.').text).toContain('改行を除く');
    const text = diagram('(?s:.).').text;
    expect(text).toContain('局所フラグ'); expect(text).toContain('改行を含む'); expect(text).toContain('改行を除く');
    expect(diagram('(?-s:.)', 's').text).toContain('改行を除く');
  });
  it.each([
    ['\\p{Script=Hiragana}\\P{Number}', 'u'], ['[\\p{Letter}&&\\p{ASCII}]', 'v'],
    ['[\\p{ASCII}--[A-Z]]', 'v'], ['[[a-c]--[b]]', 'v'], ['[\\q{ab|cd}]', 'v'],
    ['\\p{RGI_Emoji}', 'v'], ['日本語😀\\u{1F680}', 'u'], ['(?<x>a)|(?<x>b)\\k<x>', ''],
  ])('Unicode・集合・名前付きグループ %s', (pattern, flags) => { diagram(pattern, flags); });
});

describe('構文・警告・安全性・負荷', () => {
  it.each(['(', '[z-a]', 'a{4,2}', '*', '\\k<missing>', '(?<x>a)(?<x>b)'])('不正構文%sと位置', pattern => {
    expect(createDiagram(pattern, 'u')).toMatchObject({ ok: false, kind: 'syntax', position: expect.any(Number) });
  });
  it.each(['gg', 'x', 'uv', 'dgimsuvy'])('不正フラグ%s', flags => {
    expect(createDiagram('a', flags)).toMatchObject({ ok: false, kind: 'syntax' });
  });
  it('有効な空文字・空集合も無言の空白にせず、意味上の警告を構文エラーと分離', () => {
    expect(diagram('').svg).toContain('<path');
    const emptyClass = diagram('[]', 'u');
    expect(emptyClass.warnings).toContain('空の文字クラス [] は何にも一致しません。');
    expect(diagram('(a)\\1').warnings.join('')).toContain('未参加');
    expect(diagram('a^').text).toContain('条件（0文字）');
  });
  it('SVGにマークアップ・外部参照を注入せず、単体のXMLとして成立する', () => {
    for (const input of ['</text><script>alert(1)</script>', '<image href="https://evil.example/x" onload="bad">', '&"\'<>', '\u0000\u0008\uffff\ufffe\ud800\u202e\u0085\n', '😀']) {
      const { document, svg, text } = diagram(input);
      expect(document.querySelector('script, image, foreignObject, a, use')).toBeNull();
      for (const node of document.querySelectorAll('*')) {
        for (const attr of node.attributes) expect(attr.name).not.toMatch(/^(on|href|style)/);
      }
      expect(svg).not.toMatch(/[\u0000\u0008\uffff\ufffe\ud800]/u);
      if (input.includes('\u0000')) expect(text).toContain('\\u{0}');
    }
  });
  it('入力長・ノード数・深さ・寸法の上限で拒否し、展開しない', () => {
    expect(createDiagram('a'.repeat(MAX_PATTERN_LENGTH + 1), '')).toMatchObject({ ok: false, kind: 'limit' });
    diagram('a'.repeat(798)); // Pattern + Alternative + 798文字 = 800ノード
    expect(createDiagram('a'.repeat(799), '')).toMatchObject({ ok: false, kind: 'limit' });
    expect(createDiagram('('.repeat(50) + 'a' + ')'.repeat(50), '')).toMatchObject({ ok: false, kind: 'limit' });
    expect(createDiagram(Array(350).fill('a').join('|'), '')).toMatchObject({ ok: false, kind: 'limit' });
    expect(createDiagram('(ab)'.repeat(150), '')).toMatchObject({ ok: false, kind: 'limit' });
    expect(createDiagram(Array(80).fill('a*b*c*').join('|'), '')).toMatchObject({ ok: false, kind: 'limit' });
    expect(createDiagram('('.repeat(2000), '')).toMatchObject({ ok: false });
  });
});
