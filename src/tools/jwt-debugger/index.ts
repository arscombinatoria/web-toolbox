import { findTool } from '../../registry';
import { analyzeClaims, decodeJwt, MAX_BYTES } from './logic';
import { algorithms, type Algorithm, verifySignature } from './verify';
import './style.css';

export function mount(container: HTMLElement): () => void {
  const view = document.createElement('div');
  view.className = 'jwt-tool';
  // 固定テンプレートのみ。入力・解析結果はvalue/textContentに限定する。
  view.innerHTML = `
    <h1 tabindex="-1"></h1><p class="tool-description"></p>
    <p id="jwt-privacy">入力内容はブラウザ内で処理し、外部送信・保存しません。デコード成功は署名の正当性を意味しません。</p>
    <p>3セグメントのCompact JWS専用です。JWE（5セグメント）は非対応です。各入力の上限は256KiBです。</p>
    <label for="jwt-input">JWT入力</label><textarea id="jwt-input" rows="5" spellcheck="false" autocomplete="off" aria-describedby="jwt-privacy"></textarea>
    <button type="button" data-clear>入力をクリア</button><p role="alert" data-error></p>
    <div class="jwt-editors">
      <div><label for="jwt-header">Header</label><textarea id="jwt-header" rows="10" readonly spellcheck="false"></textarea><button type="button" data-copy="header">Headerをコピー</button></div>
      <div><label for="jwt-payload">Payload</label><textarea id="jwt-payload" rows="10" readonly spellcheck="false"></textarea><button type="button" data-copy="payload">Payloadをコピー</button></div>
    </div>
    <p>結果は選択して手動でもコピーできます。</p><p data-meta></p>
    <label for="jwt-signature">Signature（Base64URL）</label><textarea id="jwt-signature" rows="2" readonly></textarea><p data-bytes></p>
    <h2>Claims・日時評価（署名とは独立）</h2><p>現在の端末時計で評価します。期限内でもJWT全体の有効性・安全性は保証されません。</p><dl data-claims></dl>
    <h2>署名検証</h2><p data-alg-help></p><p data-warning role="status"></p><label for="jwt-alg">検証アルゴリズム・キー種別</label>
    <select id="jwt-alg"><option>HS256</option><option>RS256</option><option>ES256</option></select>
    <div data-secret-fields><label for="jwt-secret">共有Secret</label><input id="jwt-secret" type="password" autocomplete="off" spellcheck="false">
    <button type="button" data-reveal aria-pressed="false">Secretを表示</button>
    <label for="jwt-encoding">Secret形式</label><select id="jwt-encoding"><option value="utf8">UTF-8</option><option value="base64">Base64をデコード</option></select></div>
    <div data-public-fields hidden><label for="jwt-public">公開鍵（SPKI PEM）</label><textarea id="jwt-public" rows="6" autocomplete="off" spellcheck="false"></textarea></div>
    <button type="button" data-verify>検証</button><p role="status" data-verification>未検証</p>
    <p>署名一致は、指定キーに対する署名のみの確認です。発行者・Audience・有効期間などを含むJWT全体の信頼性は保証しません。alg: noneはデコードのみ。jku・x5u・kidからの取得、JWKS取得は行いません。</p>
    <p role="status" data-copy-status></p>`;
  const query = <T extends HTMLElement>(selector: string) => view.querySelector<T>(selector)!;
  const tool = findTool('jwt-debugger')!;
  query('h1').textContent = tool.name;
  query('.tool-description').textContent = tool.description;
  const input = query<HTMLTextAreaElement>('#jwt-input');
  const header = query<HTMLTextAreaElement>('#jwt-header');
  const payload = query<HTMLTextAreaElement>('#jwt-payload');
  const signature = query<HTMLTextAreaElement>('#jwt-signature');
  const secret = query<HTMLInputElement>('#jwt-secret');
  const publicKey = query<HTMLTextAreaElement>('#jwt-public');
  const alg = query<HTMLSelectElement>('#jwt-alg');
  const encoding = query<HTMLSelectElement>('#jwt-encoding');
  const verify = query<HTMLButtonElement>('[data-verify]');
  const result = query('[data-verification]');
  const copyStatus = query('[data-copy-status]');
  const copies = [...view.querySelectorAll<HTMLButtonElement>('[data-copy]')];
  for (const field of [input, secret, publicKey]) field.maxLength = MAX_BYTES;
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  let disposed = false;
  let revision = 0;
  const invalidate = () => {
    query('[data-warning]').textContent = '';
    let help = '';
    if (header.value) {
      const declared: unknown = (JSON.parse(header.value) as Record<string, unknown>).alg;
      help = typeof declared !== 'string' || !algorithms.includes(declared as Algorithm)
        ? 'Headerのalgは未指定・不正または非対応です。署名検証はできません。'
        : declared !== alg.value ? `検証アルゴリズムで${declared}を選択してください。` : '';
    } else if (input.value.trim()) help = 'JWTの形式を確認してください。';
    query('[data-alg-help]').textContent = help;
    revision++; result.textContent = '未検証'; copyStatus.textContent = ''; verify.disabled = !header.value; };
  const updateClaims = () => {
    const list = query('[data-claims]');
    list.replaceChildren();
    if (!payload.value) return;
    for (const claim of analyzeClaims(JSON.parse(payload.value) as Record<string, unknown>)) {
      const term = document.createElement('dt'); term.textContent = `${claim.name}: ${claim.description}`;
      const detail = document.createElement('dd'); detail.textContent = claim.detail;
      list.append(term, detail);
    }
  };
  const decode = () => {
    header.value = payload.value = signature.value = '';
    query('[data-error]').textContent = query('[data-meta]').textContent = query('[data-bytes]').textContent = '';
    try {
      if (input.value.trim()) {
        const decoded = decodeJwt(input.value);
        header.value = JSON.stringify(decoded.header, null, 2);
        payload.value = JSON.stringify(decoded.payload, null, 2);
        signature.value = decoded.signature;
        query('[data-meta]').textContent = `alg: ${JSON.stringify(decoded.header.alg) ?? '未指定'} / typ: ${JSON.stringify(decoded.header.typ) ?? '未指定'}`;
        query('[data-bytes]').textContent = `Signature: ${decoded.signatureBytes} バイト`;
      }
    } catch (error) { query('[data-error]').textContent = error instanceof Error ? error.message : '解析できません。'; }
    copies.forEach(button => { button.disabled = !header.value; });
    updateClaims(); invalidate();
  };
  input.addEventListener('input', decode, options);
  for (const field of [secret, publicKey]) field.addEventListener('input', invalidate, options);
  encoding.addEventListener('change', invalidate, options);
  alg.addEventListener('change', () => {
    secret.value = publicKey.value = '';
    query('[data-secret-fields]').hidden = alg.value !== 'HS256';
    query('[data-public-fields]').hidden = alg.value === 'HS256';
    invalidate();
  }, options);
  query('[data-reveal]').addEventListener('click', () => {
    secret.type = secret.type === 'password' ? 'text' : 'password';
    query('[data-reveal]').textContent = secret.type === 'text' ? 'Secretを隠す' : 'Secretを表示';
    query('[data-reveal]').setAttribute('aria-pressed', String(secret.type === 'text'));
  }, options);
  query('[data-clear]').addEventListener('click', () => {
    input.value = secret.value = publicKey.value = ''; secret.type = 'password';
    query('[data-reveal]').textContent = 'Secretを表示'; query('[data-reveal]').setAttribute('aria-pressed', 'false');
    decode(); input.focus();
  }, options);
  verify.addEventListener('click', async () => {
    const current = ++revision;
    verify.disabled = true; result.textContent = '検証中…';
    const outcome = await verifySignature(input.value, alg.value, alg.value === 'HS256' ? secret.value : publicKey.value, encoding.value);
    if (disposed || current !== revision) return;
    result.textContent = outcome.message; query('[data-warning]').textContent = outcome.warning ?? ''; verify.disabled = false;
  }, options);
  for (const button of copies) button.addEventListener('click', async () => {
    const current = revision;
    try {
      await navigator.clipboard.writeText(button.dataset.copy === 'header' ? header.value : payload.value);
      if (!disposed && current === revision) copyStatus.textContent = 'コピーしました。';
    } catch {
      if (!disposed && current === revision) copyStatus.textContent = 'コピーできませんでした。結果を選択して手動でコピーしてください。';
    }
  }, options);
  const timer = window.setInterval(updateClaims, 1000);
  container.append(view); decode();
  return () => {
    disposed = true; revision++; listeners.abort(); window.clearInterval(timer);
    for (const field of [input, header, payload, signature, secret, publicKey]) field.value = '';
    view.replaceChildren(); view.remove();
  };
}
