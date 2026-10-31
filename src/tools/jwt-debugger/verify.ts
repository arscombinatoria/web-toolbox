import { checkSize, decodeBase64, decodeJwt } from './logic';
export const algorithms = ['HS256', 'RS256', 'ES256'] as const;
export type Algorithm = typeof algorithms[number];
export type Verification = { state: 'match' | 'mismatch' | 'unavailable'; message: string };
export async function verifySignature(token: string, algorithm: string, keyText: string, encoding: string): Promise<Verification> {
  const unavailable = (message: string): Verification => ({ state: 'unavailable', message: `検証不可: ${message}` });
  try {
    checkSize(keyText);
    const decoded = decodeJwt(token);
    if (!algorithms.includes(algorithm as Algorithm) || decoded.header.alg !== algorithm) return unavailable('非対応アルゴリズム、または選択したアルゴリズムとHeaderのalgが不一致です。');
    // JWTはJSON payloadを持つ通常のCompact JWSのみ。拡張ヘッダーは解釈しない。
    if (decoded.header.b64 === false || decoded.header.crit !== undefined) return unavailable('b64 / crit拡張は非対応です。');
    if (!keyText) return unavailable('検証キーを入力してください。');
    const { compactVerify, importSPKI, errors } = await import('jose');
    let key: Uint8Array | CryptoKey;
    try {
      key = algorithm === 'HS256'
        ? (encoding === 'utf8' ? new TextEncoder().encode(keyText) : encoding === 'base64' ? decodeBase64(keyText, false) : (() => { throw new Error(); })())
        : await importSPKI(keyText, algorithm);
    } catch { return unavailable('キー形式が不正です。Secretの形式、またはSPKI PEMとキー種別を確認してください。'); }
    try {
      await compactVerify(token.trim(), key, { algorithms: [algorithm] });
      return { state: 'match', message: '署名一致' };
    } catch (error) {
      if (error instanceof errors.JWSSignatureVerificationFailed) return { state: 'mismatch', message: '署名不一致' };
      return unavailable('キー種別・サイズ、またはJWS形式が不正です。');
    }
  } catch { return unavailable('入力形式またはサイズが不正です。'); }
}
