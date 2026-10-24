import { findTool } from '../../registry';
import { fetchRdap, type RdapErrorKind } from './api';
import { httpsUrl, isIp, rdapUrl, type RdapInfo } from './logic';
import './style.css';

const errors: Record<RdapErrorKind, string> = {
  invalid: '有効なIPv4またはIPv6アドレスを入力してください。',
  'not-found': 'HTTP 404：登録情報が見つかりませんでした。',
  'rate-limit': 'HTTP 429：問い合わせ制限に達しました。時間をおいて検索してください。',
  http: 'HTTPエラー：RDAPサービスが正常に応答しませんでした。',
  network: '通信エラー：ネットワークやサービスの稼働状況・CORS設定などにより取得できませんでした。',
  timeout: 'タイムアウト：10秒以内に取得できませんでした。',
  json: 'レスポンス形式エラー：有効なJSONではありません。',
  format: 'レスポンス形式エラー：RDAPのIP Network情報ではありません。',
  aborted: '検索を中止しました。',
};

export function mount(container: HTMLElement, initialIp?: string): () => void {
  const view = document.createElement('div');
  view.className = 'rdap-tool';
  // 固定構造だけをHTMLで定義し、入力と外部データは安全なDOM APIで設定する。
  view.innerHTML = `
    <h1 tabindex="-1"></h1><p class="tool-description"></p>
    <p class="rdap-note">検索対象IPと接続元IPが外部のRDAPサービス（RDAP.orgと転送先）へ伝わります。入力・結果はURLや永続ストレージに保存しません。</p>
    <form novalidate><label for="rdap-ip">IPアドレス（IPv4・IPv6）</label>
      <div class="rdap-actions"><input id="rdap-ip" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="rdap-error"><button type="submit">検索</button></div>
    </form>
    <p data-status role="status" aria-atomic="true"></p>
    <p id="rdap-error" role="alert"></p><p data-fallback hidden></p>
    <div data-result hidden></div>
    <details hidden><summary>元のRDAP JSON</summary><button type="button" data-copy>JSONをコピー</button>
      <p data-copy-status role="status" aria-atomic="true"></p><pre tabindex="0"></pre>
    </details>`;
  const tool = findTool('rdap-lookup')!;
  view.querySelector('h1')!.textContent = tool.name;
  view.querySelector('.tool-description')!.textContent = tool.description;
  const form = view.querySelector('form')!;
  const input = view.querySelector('input')!;
  const status = view.querySelector<HTMLElement>('[data-status]')!;
  const error = view.querySelector<HTMLElement>('[role=alert]')!;
  const fallback = view.querySelector<HTMLElement>('[data-fallback]')!;
  const result = view.querySelector<HTMLElement>('[data-result]')!;
  const details = view.querySelector('details')!;
  const pre = view.querySelector('pre')!;
  const copy = view.querySelector<HTMLButtonElement>('[data-copy]')!;
  const copyStatus = view.querySelector<HTMLElement>('[data-copy-status]')!;
  const listeners = new AbortController();
  let request: AbortController | undefined;
  let disposed = false;
  let generation = 0;
  let json = '';
  const link = (parent: HTMLElement, url: string, label: string) => {
    const safe = httpsUrl(url);
    if (!safe) return;
    const a = document.createElement('a');
    a.href = safe;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.referrerPolicy = 'no-referrer';
    a.textContent = label;
    parent.append(a);
  };
  const section = (title: string, rows: [string, string][]) => {
    const element = document.createElement('section');
    const h2 = document.createElement('h2');
    h2.textContent = title;
    const dl = document.createElement('dl');
    for (const [label, value] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      dl.append(dt, dd);
    }
    element.append(h2, dl);
    result.append(element);
  };
  const render = (ip: string, info: RdapInfo, url: string) => {
    section('ネットワーク情報', [['検索したIPアドレス', ip], ...info.network]);
    const note = document.createElement('p');
    note.className = 'rdap-note';
    note.textContent = '登録国は実際の所在地とは限りません。欠損項目は省略しています。';
    result.append(note);
    section('組織・連絡先', [
      ['管理組織名', info.organizations.join('\n') || '情報なし'],
      ['Abuse窓口のメールアドレス', info.abuseEmails.join('\n') || '情報なし'],
    ]);
    for (const contact of info.contacts) {
      section(`公開連絡先（${contact.roles.join(', ') || '役割情報なし'}）`, [
        ['名称', contact.name], ['組織', contact.organizations.join('\n')], ['ハンドル', contact.handle],
        ['メール', contact.emails.join('\n')], ['電話', contact.phones.join('\n')], ['住所', contact.addresses.join('\n')],
      ].filter((row): row is [string, string] => !!row[1]));
    }
    section('登録情報', info.events.length ? info.events : [['登録・更新日時', '情報なし']]);
    const links = document.createElement('p');
    for (const address of new Set([url, ...info.links])) {
      const item = document.createElement('span');
      item.className = 'rdap-server';
      link(item, address, `RDAPサーバー：${address}`);
      links.append(item);
    }
    result.append(links);
  };
  const reset = () => {
    ++generation;
    request?.abort();
    request = undefined;
    status.textContent = '';
    error.textContent = '';
    input.removeAttribute('aria-invalid');
    result.replaceChildren();
    result.hidden = true;
    result.removeAttribute('aria-busy');
    details.hidden = true;
    details.open = false;
    fallback.hidden = true;
    fallback.replaceChildren();
    pre.textContent = '';
    json = '';
    copy.disabled = false;
    copyStatus.textContent = '';
  };
  const search = async () => {
    reset();
    const ip = input.value.trim();
    input.value = ip;
    if (!isIp(ip)) {
      input.setAttribute('aria-invalid', 'true');
      error.textContent = errors.invalid;
      input.focus();
      return;
    }
    const current = new AbortController();
    request = current;
    const active = generation;
    status.textContent = '検索中…';
    result.setAttribute('aria-busy', 'true');
    try {
      const response = await fetchRdap(ip, current.signal);
      if (disposed || active !== generation) return;
      render(ip, response.info, response.url);
      json = JSON.stringify(response.data, null, 2);
      pre.textContent = json;
      details.hidden = false;
      result.hidden = false;
      status.textContent = '検索が完了しました。';
    } catch (cause) {
      if (disposed || active !== generation) return;
      const kind = cause instanceof Error && 'kind' in cause ? cause.kind : 'network';
      error.textContent = errors[kind as RdapErrorKind] ?? errors.network;
      status.textContent = '';
      link(fallback, rdapUrl(ip), 'RDAP.orgで外部確認する');
      fallback.hidden = false;
    } finally {
      if (!disposed && active === generation) result.removeAttribute('aria-busy');
    }
  };
  form.addEventListener('submit', (event) => { event.preventDefault(); void search(); }, { signal: listeners.signal });
  input.addEventListener('input', reset, { signal: listeners.signal });
  copy.addEventListener('click', async () => {
    if (copy.disabled || !json) return;
    const active = generation;
    copy.disabled = true;
    try {
      await navigator.clipboard.writeText(json);
      if (!disposed && active === generation) copyStatus.textContent = 'コピーしました。';
    } catch {
      if (!disposed && active === generation) copyStatus.textContent = 'コピーできませんでした。JSONを選択して手動でコピーしてください。';
    } finally {
      if (!disposed && active === generation) copy.disabled = false;
    }
  }, { signal: listeners.signal });
  container.append(view);
  // 通常表示・履歴復帰では検索せず、明示的なSPA内操作の一時入力だけ検索する。
  if (initialIp !== undefined) {
    input.value = initialIp;
    void search();
  }
  return () => {
    disposed = true;
    ++generation;
    request?.abort();
    listeners.abort();
    view.remove();
  };
}
