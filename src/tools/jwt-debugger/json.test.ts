// @vitest-environment node
import { expect, it } from 'vitest';
import { decodeJwt, analyzeClaims } from './logic';
import { formatJson, losesNumericPrecision } from './json';
const numbers = ['9223372036854775807', '-9223372036854775808', '9007199254740993', '1e400', '1e-400', '0.1234567890123456789012345', '1.2300e+10', '-0'];
const encode = (source: string) => Buffer.from(source).toString('base64url');
const decode = (source: string) => decodeJwt(`${encode(source)}.${encode(source)}.`);
const numericTokens = (source: string) => [...source.matchAll(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)].map(m => m[0]).filter(t => !t.startsWith('"'));
it('Header・Payloadの数値トークンをネスト・配列内も含めて保持する', () => {
  const source = `{ "nested": {"numbers": [${numbers.join(',')}]}, "value": 1.2300e+10 }`;
  const result = decode(source);
  expect(result.headerSource).toBe(source); expect(result.payloadSource).toBe(source);
  for (const output of [result.headerJson, result.payloadJson]) {
    expect(numericTokens(output)).toEqual(numericTokens(source));
    expect(JSON.parse(output)).toEqual(JSON.parse(source));
  }
});
it('文字列内の空白・記号・エスケープ・Unicodeと構造を保持する', () => {
  const source = String.raw`{ "text": " , : \" \\ \u65e5 日本語😀  ", "empty": [{},[]], "bool": true, "nil": null }`;
  const output = decode(source).payloadJson;
  expect(output).toContain(String.raw`" , : \" \\ \u65e5 日本語😀  "`);
  expect(JSON.parse(output)).toEqual(JSON.parse(source));
  expect(formatJson(output).formatted).toBe(output);
  expect(decode('{\n\t"x" : [ 1, 2 ]\r\n}').payloadJson).toContain('1,\n');
});
it.each(['{"n":01}', '{"n":1e}', '{"n":NaN}', '{"s":"bad\n"}', '{"a":1,}', '{'])('不正JSONを整形前に拒否する: %s', source => {
  expect(() => decode(source)).toThrow('JSON');
});
it.each(['exp', 'nbf', 'iat'])('丸め・オーバーフロー・アンダーフローした%sは断定しない', name => {
  for (const value of [...numbers.slice(0, 6), '100.00000000000000001']) {
    const result = decode(`{"${name}":${value}}`);
    const detail = analyzeClaims(result.payload, 100, result.impreciseClaims).find(c => c.name === name)!.detail;
    expect(detail).toContain('数値精度'); expect(detail).not.toContain('UTC:');
  }
  for (const value of ['100', '100.5', '0.1', '1.2300e+10', '-0']) {
    const result = decode(`{"${name}":${value}}`);
    expect(result.impreciseClaims).toEqual([]);
  }
});
it('エスケープされたキー・重複キーはJSON.parseの最後の値と対応する', () => {
  expect(decode(String.raw`{"\u0065xp":1e-400}`).impreciseClaims).toEqual(['exp']);
  expect(decode('{"exp":1e400,"exp":100}').impreciseClaims).toEqual([]);
  expect(decode('{"exp":1e400,"exp":"100"}').impreciseClaims).toEqual([]);
  expect(decode('{"exp":{"nested":1e400}}').impreciseClaims).toEqual([]);
});
it('極端な指数と深い入力でも指数展開や無制限インデントを行わない', () => {
  expect(losesNumericPrecision('1e999999999999999999999999', Infinity)).toBe(true);
  const source = '{"nested":' + '['.repeat(1000) + '1' + ']'.repeat(1000) + '}';
  const result = decode(source);
  expect(result.payloadJson.length).toBeLessThan(source.length * 70);
});
