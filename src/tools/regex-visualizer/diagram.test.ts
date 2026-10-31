import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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
    ['a*', '* · 合計0回以上'], ['a+', '+ · 合計1回以上'], ['a?', '? · 合計0〜1回'],
    ['a{2,4}', '{2,4} · 合計2〜4回'], ['a{3,}', '{3,} · 合計3回以上'],
    ['a*?', '*? · 合計0回以上'], ['a+?', '+? · 合計1回以上'],
    ['a??', '?? · 合計0〜1回'], ['a{2,4}?', '{2,4}? · 合計2〜4回'],
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

describe('Railroadレイアウト', () => {
  it.each([
    ['a?', 1, 0, '0〜1回'], ['a*', 1, 1, '0回以上'], ['a+', 0, 1, '1回以上'],
    ['a{2,4}', 0, 1, '2〜4回'], ['a{0,4}?', 1, 1, '0〜4回'],
    ['a{1}', 0, 0, '1回'], ['a{0}', 0, 0, '0回'], ['a{0,0}', 0, 0, '0回'],
  ])('%sの省略・戻り経路と合計回数', (pattern, bypasses, loops, counts) => {
    const { document, text } = diagram(pattern);
    expect(document.querySelectorAll('.bypass')).toHaveLength(bypasses);
    expect(document.querySelectorAll('.loopback')).toHaveLength(loops);
    expect(text).toContain(counts);
    if (pattern !== 'a{0}' && pattern !== 'a{0,0}') {
      expect(text).toContain(pattern.endsWith('}?') ? '非貪欲マッチ' : '貪欲マッチ');
    }
    expect(document.querySelectorAll('.group')).toHaveLength(0);
    for (const bypass of document.querySelectorAll('.bypass')) {
      expect(bypass.querySelectorAll('path')).toHaveLength(2);
      expect(bypass.lastElementChild?.getAttribute('d')).toContain('l4 4 -4 4');
    }
    for (const loop of document.querySelectorAll('.loopback')) {
      expect(loop.querySelectorAll('path')).toHaveLength(2);
      expect(loop.lastElementChild?.getAttribute('d')).toContain('l-4 4 4 4');
    }
  });

  it.each(['?', '*', '+', '{2,4}', '{3,}'])('%sの貪欲・非貪欲で経路と優先順位ラベルを維持', quantifier => {
    const greedy = diagram(`a${quantifier}`).document;
    const lazy = diagram(`a${quantifier}?`).document;
    expect(greedy.querySelector('.repeat')?.lastElementChild?.textContent).toBe('貪欲マッチ');
    expect(lazy.querySelector('.repeat')?.lastElementChild?.textContent).toBe('非貪欲マッチ');
    for (const selector of ['.bypass', '.loopback']) {
      expect(lazy.querySelectorAll(selector)).toHaveLength(greedy.querySelectorAll(selector).length);
    }
  });

  it('サンプルと入れ子をコンパクトにし、短い式に固定の最小幅を設けない', () => {
    const sample = diagram('^([A-Za-z]+)(?:-[0-9]{2,4})?$').document.documentElement;
    expect(Number(sample.getAttribute('width'))).toBeLessThanOrEqual(980);
    expect(Number(sample.getAttribute('height'))).toBeLessThanOrEqual(340);
    const nested = diagram('((?:a+)?)');
    expect(nested.document.querySelectorAll('.group')).toHaveLength(2);
    expect(nested.document.querySelectorAll('.repeat')).toHaveLength(2);
    expect(Number(diagram('a').document.documentElement.getAttribute('width'))).toBeLessThan(300);
  });
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
    // コンパクト化後も面積制限を超える、長いラベルを持つ反復の選択肢。
    expect(createDiagram(Array(60).fill('(a{1234567890123456789012345}b{1234567890123456789012345})*').join('|'), '')).toMatchObject({ ok: false, kind: 'limit', message: expect.stringContaining('面積') });
    expect(createDiagram('('.repeat(2000), '')).toMatchObject({ ok: false });
  });
});

it('SVGに既存の両テーマのトークンと全面の不透明な背景を内包する', () => {
  const themeCss = readFileSync('src/styles/main.css', 'utf8');
  const { document } = diagram('(?<x>a+)?(?=b)\\k<x>');
  const style = document.querySelector('style')!.textContent!;
  for (const [siteSelector, svgSelector] of [[':root', 'svg'], [':root[data-theme="dark"]', 'svg[data-theme="dark"]']]) {
    const site = themeCss.slice(themeCss.indexOf(siteSelector + ' {')).split('}')[0]!;
    const embedded = style.slice(style.indexOf(svgSelector + '{')).split('}')[0]!;
    for (const token of ['page', 'surface', 'text', 'muted', 'border', 'accent', 'accent-soft']) {
      const match = site.match(new RegExp('--' + token + ':\\s*(#[a-f0-9]+);'));
      expect(match, siteSelector + ' ' + token + ' ' + site).not.toBeNull();
      const value = match![1];
      expect(embedded).toContain('--' + token + ':' + value);
    }
  }
  const root = document.documentElement;
  const background = root.querySelector('.canvas-background')!;
  expect(background.parentElement).toBe(root);
  expect(background.getAttribute('width')).toBe(root.getAttribute('width'));
  expect(background.getAttribute('height')).toBe(root.getAttribute('height'));
  expect(background.nextElementSibling?.tagName).toBe('g');
  expect(style).toContain('.canvas-background{fill:var(--page);stroke:none}');
  expect(style).not.toContain('prefers-color-scheme');
  expect(style).toContain('.group>rect{fill:none;stroke:var(--muted)}');
  expect(style).toContain('stroke-dasharray:5 3'); expect(style).toContain('stroke-dasharray:2 2');
});
