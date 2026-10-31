import { expect, it } from 'vitest';
import { highlightJwt, highlightJson, renderHighlight, MAX_HIGHLIGHT_TOKENS } from './highlight';

it('3セグメントと通常色のピリオド・周辺空白を分類する', () => {
  const source = ' \nabc.def.AQID\t';
  const tokens = highlightJwt(source);
  expect(tokens.filter(t => t.kind).map(t => [t.text, t.kind])).toEqual([
    ['abc', 'header'], ['def', 'payload'], ['AQID', 'signature'],
  ]);
  expect(tokens.filter(t => t.text === '.').every(t => !t.kind)).toBe(true);
  expect(tokens.map(t => t.text).join('')).toBe(source);
  expect(highlightJwt('e30.e30.').find(t => t.kind === 'signature')?.text).toBe('');
});
it.each(['', 'abc', 'a.b', 'a.b.c.d.e', 'a.!.c', '.b.c', 'a.b.c\nx'])('不正JWTはプレーン表示: %s', source => {
  expect(highlightJwt(source)).toEqual([{ text: source }]);
});
it('ネスト・配列・Unicode・エスケープを元の文字列のまま分類する', () => {
  const source = String.raw`{ "日本語😀": [{"\u006b\"": "<script> & \\ \n \t \u65e5", "n": -0}, true, false, null] }`;
  const tokens = highlightJson(source);
  expect(tokens.filter(t => t.kind === 'key').map(t => t.text)).toEqual(['"日本語😀"', String.raw`"\u006b\""`, '"n"']);
  expect(tokens.filter(t => t.kind === 'literal').map(t => t.text)).toEqual(['true', 'false', 'null']);
  expect(tokens.filter(t => t.kind === 'string').map(t => t.text)).toEqual([String.raw`"<script> & \\ \n \t \u65e5"`]);
  expect(tokens.filter(t => !t.kind).every(t => /^[\s{}[\],:]*$/.test(t.text))).toBe(true);
  expect(tokens.map(t => t.text).join('')).toBe(source);
});
it('巨大整数・小数・指数・負のゼロ・重複キーとキー順を保持する', () => {
  const numbers = ['9223372036854775807', '0.1234567890123456789012345', '1.2300e+10', '1e-400', '1E400', '-0'];
  const source = `{ "z": [${numbers.join(',')}], "a": 1, "a": 2 }`;
  const tokens = highlightJson(source);
  expect(tokens.filter(t => t.kind === 'number').map(t => t.text)).toEqual([...numbers, '1', '2']);
  expect(tokens.map(t => t.text).join('')).toBe(source);
});
it.each(['', 'undefined', '{"x":01}', '{"x":1e}', '{"x":"unterminated}', '{"x":"bad\n"}', String.raw`{"x":"\uXXXX"}`, String.raw`{"x":"\q"}`])('空・不正JSON字句でも文字列を保持する: %s', source => {
  const tokens = highlightJson(source);
  expect(tokens.every(t => !t.kind)).toBe(true);
  expect(tokens.map(t => t.text).join('')).toBe(source);
});
it('HTMLを安全なDOM APIで表示し、入力と完全一致する', () => {
  const source = '{"html":"<img src=x onerror=alert(1)><script>alert(1)</script>&amp;"}';
  const layer = document.createElement('pre');
  expect(renderHighlight(layer, highlightJson(source))).toBe(true);
  expect(layer.textContent).toBe(source);
  expect(layer.querySelector('img,script')).toBeNull();
  expect([...layer.children].every(node => node.tagName === 'SPAN')).toBe(true);
  renderHighlight(layer, highlightJwt('!'));
  expect(layer.textContent).toBe('!'); expect(layer.children).toHaveLength(0);
});
it('256KiBと大量トークン・大きな整形結果は独立してフォールバックする', () => {
  const jwt = 'a'.repeat(256 * 1024 - 4) + '.b.c';
  expect(highlightJwt(jwt).some(t => t.kind)).toBe(true);
  const source = '[' + '0,'.repeat(MAX_HIGHLIGHT_TOKENS) + '0]';
  expect(highlightJson(source)).toEqual([{ text: source }]);
  const large = ' '.repeat(256 * 1024 + 1);
  expect(highlightJson(large)).toEqual([{ text: large }]);
  expect(highlightJwt(large)).toEqual([{ text: large }]);
});
