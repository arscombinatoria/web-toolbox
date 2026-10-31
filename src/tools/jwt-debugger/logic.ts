import { formatJson, losesNumericPrecision } from './json';
export const MAX_BYTES = 256 * 1024;
export function checkSize(value: string): void {
  if (value.length > MAX_BYTES || new TextEncoder().encode(value).length > MAX_BYTES) throw new Error('入力上限は256KiBです。');
}
export function decodeBase64(value: string, url = true): Uint8Array {
  const pattern = url ? /^[A-Za-z0-9_-]*$/ : /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  if (!pattern.test(value) || value.length % 4 === 1) throw new Error('Base64URL / Base64形式が不正です。');
  const normalized = url ? value.replace(/-/g, '+').replace(/_/g, '/') : value;
  let binary: string;
  try { binary = atob(normalized); } catch { throw new Error('Base64URL / Base64形式が不正です。'); }
  if (btoa(binary).replace(/=+$/, '') !== normalized.replace(/=+$/, '')) throw new Error('Base64URL / Base64の末尾ビットが不正です。');
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
function object(segment: string) {
  const bytes = decodeBase64(segment);
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw new Error('UTF-8が不正です。'); }
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('JSONが不正です。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSONのトップレベルはオブジェクトが必要です。');
  return { value: value as Record<string, unknown>, source: text, ...formatJson(text) };
}
export function decodeJwt(token: string) {
  checkSize(token);
  const segments = token.trim().split('.');
  if (segments.length !== 3) throw new Error('3セグメントのCompact JWSが必要です。5セグメントのJWEは非対応です。');
  const [header, payload, signature] = segments as [string, string, string];
  const h = object(header);
  const p = object(payload);
  const impreciseClaims = ['exp', 'nbf', 'iat'].filter(name => {
    const raw = p.numbers.get(name);
    return raw !== undefined && losesNumericPrecision(raw, p.value[name] as number);
  });
  return { header: h.value, payload: p.value, headerSource: h.source, payloadSource: p.source,
    headerJson: h.formatted, payloadJson: p.formatted, impreciseClaims,
    signature, signatureBytes: decodeBase64(signature).length };
}
const definitions = [
  ['iss', 'Issuer（発行者）'], ['sub', 'Subject（主体）'], ['aud', 'Audience（対象者）'],
  ['exp', 'Expiration Time（有効期限）'], ['nbf', 'Not Before（利用開始）'],
  ['iat', 'Issued At（発行日時）'], ['jti', 'JWT ID（識別子）'],
] as const;
export function analyzeClaims(payload: Record<string, unknown>, now = Date.now() / 1000, impreciseClaims: readonly string[] = []) {
  return definitions.map(([name, description]) => {
    const value = payload[name];
    let detail = '未指定';
    if (Object.hasOwn(payload, name)) {
      if (name === 'exp' || name === 'nbf' || name === 'iat') {
        if (impreciseClaims.includes(name)) detail = '警告: Numberの数値精度では元のNumericDateを保持できないため、日時・期限を判定しません。';
        else if (typeof value !== 'number' || !Number.isFinite(value)) detail = '警告: NumericDateは有限の数値（秒）が必要です。';
        else if (Math.abs(value * 1000) > 8.64e15 || Math.abs(value * 1000 + 9 * 3600000) > 8.64e15) detail = '警告: 日時表現可能範囲外です。';
        else {
          const state = name === 'exp' ? (now >= value ? '期限切れ' : '期限内') : name === 'nbf' ? (now >= value ? '利用可能時刻に到達' : '利用開始前') : (value > now ? '警告: 発行日時が未来です（単独では無効と判定しません）' : '発行済み');
          detail = `${state}\nUnix time: ${value} 秒\nUTC: ${new Date(value * 1000).toISOString()}\nJST: ${new Date(value * 1000 + 9 * 3600000).toISOString().replace('Z', '+09:00')}`;
        }
      } else if (typeof value === 'string' || (name === 'aud' && Array.isArray(value) && value.every(v => typeof v === 'string'))) detail = JSON.stringify(value);
      else detail = `警告: ${name === 'aud' ? '文字列または文字列配列' : '文字列'}が必要です。`;
    }
    return { name, description, detail };
  });
}
