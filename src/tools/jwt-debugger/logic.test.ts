// @vitest-environment node
import { expect, it } from 'vitest';
import { analyzeClaims, decodeJwt, MAX_BYTES } from './logic';
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (payload: unknown) => `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.`;
it('JSON・Unicode・署名をデコードする', () => {
  expect(decodeJwt(token({ sub: '日本語😀' })).payload.sub).toBe('日本語😀');
  expect(decodeJwt(`${encode({})}.${encode({})}.AQID`).signatureBytes).toBe(3);
});
it.each([
  ['a.b', '3セグメント'], ['a.b.c.d.e', 'JWE'], ['!.e30.', 'Base64URL'],
  ['_w.e30.', 'UTF-8'], ['ew.e30.', 'JSON'], ['W10.e30.', 'オブジェクト'],
  ['bnVsbA.e30.', 'オブジェクト'], ['e30.e30.AB', '末尾ビット'],
  ['x'.repeat(MAX_BYTES + 1), '256KiB'],
])('不正入力を区別する', (value, error) => { expect(() => decodeJwt(value)).toThrow(error); });
it('NumericDateの境界・小数・状態を評価する', () => {
  const evaluate = (name: string, value: unknown, now = 100) => analyzeClaims({ [name]: value }, now).find(c => c.name === name)!.detail;
  expect(evaluate('exp', 100)).toContain('期限切れ');
  expect(evaluate('exp', 100.5)).toContain('期限内');
  expect(evaluate('nbf', 100)).toContain('到達');
  expect(evaluate('nbf', 100.5)).toContain('利用開始前');
  expect(evaluate('iat', 101)).toContain('単独では無効と判定しません');
  expect(evaluate('iat', -0.5)).toContain('1969-12-31T23:59:59.500Z');
  for (const value of [null, '100', Infinity, NaN, [], true]) expect(evaluate('exp', value)).toContain('有限の数値');
  for (const value of [1e100, 8640000000000, -8640000000001]) expect(evaluate('exp', value)).toContain('範囲外');
  expect(evaluate('exp', -8640000000000)).toContain('UTC:');
  expect(evaluate('aud', ['a', 'b'])).toBe('["a","b"]');
  expect(evaluate('aud', ['a', 1])).toContain('警告');
  expect(evaluate('iss', 1)).toContain('警告');
  expect(analyzeClaims({}).every(c => c.detail === '未指定')).toBe(true);
});
