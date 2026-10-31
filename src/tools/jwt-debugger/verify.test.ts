// @vitest-environment node
import { expect, it } from 'vitest';
import { SignJWT, generateKeyPair, exportSPKI } from 'jose';
import { verifySignature } from './verify';
const secret = 'test-only-secret-0123456789abcdef';
const bytes = new TextEncoder().encode(secret);
it('HS256の実署名、Base64 Secret、改ざん、誤Secret', async () => {
  const token = await new SignJWT({ exp: 0 }).setProtectedHeader({ alg: 'HS256' }).sign(bytes);
  expect((await verifySignature(token, 'HS256', secret, 'utf8')).state).toBe('match');
  expect((await verifySignature(token, 'HS256', Buffer.from(secret).toString('base64'), 'base64')).state).toBe('match');
  expect((await verifySignature(token, 'HS256', 'wrong', 'utf8')).state).toBe('mismatch');
  const parts = token.split('.'); parts[1] = Buffer.from('{"exp":1}').toString('base64url');
  expect((await verifySignature(parts.join('.'), 'HS256', secret, 'utf8')).state).toBe('mismatch');
  for (const key of ['', '!!!', 'YQ=', 'YR==']) expect((await verifySignature(token, 'HS256', key, 'base64')).state).toBe('unavailable');
  expect((await verifySignature(token, 'RS256', secret, 'utf8')).state).toBe('unavailable');
});
it.each(['RS256', 'ES256'])('%sの実署名・誤公開鍵・PEM不正・キー種別不一致', async alg => {
  const pair = await generateKeyPair(alg);
  const wrong = await generateKeyPair(alg);
  const other = await generateKeyPair(alg === 'RS256' ? 'ES256' : 'RS256');
  const token = await new SignJWT({ sub: 'test' }).setProtectedHeader({ alg }).sign(pair.privateKey);
  expect((await verifySignature(token, alg, await exportSPKI(pair.publicKey), 'utf8')).state).toBe('match');
  expect((await verifySignature(token, alg, await exportSPKI(wrong.publicKey), 'utf8')).state).toBe('mismatch');
  expect((await verifySignature(token, alg, await exportSPKI(other.publicKey), 'utf8')).state).toBe('unavailable');
  expect((await verifySignature(token, alg, 'invalid PEM', 'utf8')).state).toBe('unavailable');
});
it.each(['none', 'HS512', 'unknown'])('%sは成功にしない', async alg => {
  const token = `${Buffer.from(JSON.stringify({ alg })).toString('base64url')}.e30.`;
  expect((await verifySignature(token, alg, secret, 'utf8')).state).toBe('unavailable');
});
