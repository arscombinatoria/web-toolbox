import { Check, CircleAlert, Copy, Download, Globe, Search, Trash2 } from 'lucide';
import { createIcon, setIconMessage } from '../../components/icon';
import { fetchIpv4, fetchIpv6 } from '../ip-address/api';
import { findTool } from '../../registry';
import { fetchRdap, type RdapErrorKind } from './api';
import { createRdapDisplay, httpsUrl, isIp, rdapSummary, rdapUrl, type RdapDisplayData } from './logic';
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
  view.innerHTML = `
    <h1 tabindex="-1"></h1><p class="tool-description"></p>
    <p class="rdap-note">検索対象IPと接続元IPが外部のRDAPサービス（RDAP.orgと転送先）へ伝わります。入力・結果はURLや永続ストレージに保存しません。</p>
    <p class="rdap-note">自分のIP確認では、選択したipifyサービスへ接続元IPを送信します。この確認はボタンを押したときだけ行います。</p>
    <form novalidate><label for="rdap-ip">IPアドレス（IPv4・IPv6）</label>
      <div class="rdap-actions"><input id="rdap-ip" type="text" placeholder="例：8.8.8.8" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="rdap-error"><button type="submit" data-search>検索</button><button type="button" data-clear>クリア</button></div>
      <div class="rdap-actions"><button type="button" data-own-ip="4">自分のIPv4</button><button type="button" data-own-ip="6">自分のIPv6</button></div>
    </form>
    <p data-ip-status role="status" aria-atomic="true"></p>
    <p data-status role="status" aria-atomic="true"></p>
    <p id="rdap-error" role="alert"></p><p data-fallback hidden></p>
    <div class="rdap-actions rdap-result-actions" data-result-actions hidden>
      <button type="button" data-copy-result>結果をコピー</button><button type="button" data-copy-json>JSONをコピー</button><button type="button" data-save-json>JSONを保存</button>
      <p data-copy-status role="status" aria-atomic="true"></p>
    </div>
    <div data-result hidden></div>
    <details hidden><summary>元のRDAP JSON</summary><pre tabindex="0"></pre></details>`;
  const tool = findTool('rdap-lookup')!;
  view.querySelector('h1')!.textContent = tool.name;
  view.querySelector('.tool-description')!.textContent = tool.description;
  const form = view.querySelector('form')!;
  const input = view.querySelector<HTMLInputElement>('input')!;
  const status = view.querySelector<HTMLElement>('[data-status]')!;
  const ipStatus = view.querySelector<HTMLElement>('[data-ip-status]')!;
  const error = view.querySelector<HTMLElement>('[role=alert]')!;
  const fallback = view.querySelector<HTMLElement>('[data-fallback]')!;
  const result = view.querySelector<HTMLElement>('[data-result]')!;
  const resultActions = view.querySelector<HTMLElement>('[data-result-actions]')!;
  const details = view.querySelector('details')!;
  const pre = view.querySelector('pre')!;
  const copyResult = view.querySelector<HTMLButtonElement>('[data-copy-result]')!;
  const copyJson = view.querySelector<HTMLButtonElement>('[data-copy-json]')!;
  const saveJson = view.querySelector<HTMLButtonElement>('[data-save-json]')!;
  const copyStatus = view.querySelector<HTMLElement>('[data-copy-status]')!;
  const clearButton = view.querySelector<HTMLButtonElement>('[data-clear]')!;
  const searchButton = view.querySelector<HTMLButtonElement>('[data-search]')!;
  const ownButtons = [...view.querySelectorAll<HTMLButtonElement>('[data-own-ip]')];
  searchButton.prepend(createIcon(Search));
  clearButton.prepend(createIcon(Trash2));
  for (const button of ownButtons) button.prepend(createIcon(Globe));
  copyResult.prepend(createIcon(Copy));
  copyJson.prepend(createIcon(Copy));
  saveJson.prepend(createIcon(Download));
  const listeners = new AbortController();
  let request: AbortController | undefined;
  let ipRequest: AbortController | undefined;
  let disposed = false;
  let generation = 0;
  let ipGeneration = 0;
  let json = '';
  let summary = '';
  let searchedIp = '';
  let copyGeneration = 0;
  const downloads = new Map<string, ReturnType<typeof setTimeout>>();
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
  const section = (parent: HTMLElement, title: string, rows: [string, string][]) => {
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
    parent.append(element);
  };
  const render = (data: RdapDisplayData) => {
    for (const item of data.sections) {
      section(result, item.title, item.rows);
      if (item.notice) {
        const notice = document.createElement('p');
        notice.className = 'rdap-note';
        notice.textContent = item.notice;
        result.append(notice);
      }
    }
    if (data.servers.length) {
      const servers = document.createElement('p');
      servers.className = 'rdap-server-list';
      for (const address of data.servers) {
        const item = document.createElement('span');
        item.className = 'rdap-server';
        link(item, address, `RDAPサーバー：${address}`);
        servers.append(item);
      }
      result.append(servers);
    }
  };
  const cancelIpLookup = () => {
    ++ipGeneration;
    ipRequest?.abort();
    ipRequest = undefined;
  };
  const clearRdap = () => {
    ++generation;
    request?.abort();
    request = undefined;
    status.textContent = '';
    error.textContent = '';
    ipStatus.textContent = '';
    input.removeAttribute('aria-invalid');
    result.replaceChildren();
    result.hidden = true;
    result.removeAttribute('aria-busy');
    details.hidden = true;
    details.open = false;
    resultActions.hidden = true;
    fallback.hidden = true;
    fallback.replaceChildren();
    pre.textContent = '';
    json = '';
    summary = '';
    searchedIp = '';
    copyResult.disabled = false;
    copyJson.disabled = false;
    saveJson.disabled = false;
    copyStatus.textContent = '';
    ++copyGeneration;
  };
  const reset = () => {
    cancelIpLookup();
    clearRdap();
  };
  const fetchOwnIp = async (version: '4' | '6') => {
    cancelIpLookup();
    const controller = new AbortController();
    ipRequest = controller;
    const active = ipGeneration;
    ipStatus.textContent = `自分のIPv${version}を確認中…`;
    try {
      const address = await (version === '4' ? fetchIpv4(controller.signal) : fetchIpv6(controller.signal));
      if (disposed || active !== ipGeneration) return;
      input.value = address;
      clearRdap();
      input.removeAttribute('aria-invalid');
      ipStatus.textContent = `自分のIPv${version}を取得しました。検索ボタンを押すと登録情報を検索します。`;
    } catch (cause) {
      if (disposed || active !== ipGeneration) return;
      if (cause instanceof Error && 'kind' in cause && cause.kind === 'aborted') return;
      ipStatus.textContent = 'IPアドレスを確認できませんでした。ネットワークやサービスの状態を確認してください。';
    } finally {
      if (active === ipGeneration) ipRequest = undefined;
    }
  };
  const search = async () => {
    reset();
    const ip = input.value.trim(); input.value = ip;
    if (!isIp(ip)) {
      input.setAttribute('aria-invalid', 'true');
      setIconMessage(error, CircleAlert, errors.invalid);
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
      const display = createRdapDisplay(ip, response.info, response.url);
      render(display);
      json = JSON.stringify(response.data, null, 2);
      pre.textContent = json;
      summary = rdapSummary(display);
      searchedIp = ip;
      details.hidden = false;
      result.hidden = false;
      resultActions.hidden = false;
      setIconMessage(status, Check, '検索が完了しました。');
    } catch (cause) {
      if (disposed || active !== generation) return;
      const kind = cause instanceof Error && 'kind' in cause ? cause.kind : 'network';
      setIconMessage(error, CircleAlert, errors[kind as RdapErrorKind] ?? errors.network);
      status.textContent = '';
      link(fallback, rdapUrl(ip), 'RDAP.orgで外部確認する');
      fallback.hidden = false;
    } finally {
      if (!disposed && active === generation) result.removeAttribute('aria-busy');
    }
  };
  const copyText = async (button: HTMLButtonElement, text: string, success: string) => {
    if (button.disabled || !text) return;
    const active = generation;
    const copyActive = ++copyGeneration;
    button.disabled = true;
    try {
      await navigator.clipboard.writeText(text);
      if (!disposed && active === generation && copyActive === copyGeneration) {
        setIconMessage(copyStatus, Check, success);
      }
    } catch {
      if (!disposed && active === generation && copyActive === copyGeneration) {
        setIconMessage(copyStatus, CircleAlert, 'コピーできませんでした。表示内容を選択して手動でコピーしてください。');
      }
    } finally {
      if (!disposed && active === generation) button.disabled = false;
    }
  };
  form.addEventListener('submit', (event) => { event.preventDefault(); void search(); }, { signal: listeners.signal });
  input.addEventListener('input', reset, { signal: listeners.signal });
  clearButton.addEventListener('click', () => {
    reset();
    input.value = '';
    input.focus();
  }, { signal: listeners.signal });
  for (const button of ownButtons) {
    button.addEventListener('click', () => { void fetchOwnIp(button.dataset.ownIp as '4' | '6'); }, { signal: listeners.signal });
  }
  copyResult.addEventListener('click', () => {
    void copyText(copyResult, summary, '結果をコピーしました。');
  }, { signal: listeners.signal });
  copyJson.addEventListener('click', () => {
    void copyText(copyJson, json, 'JSONをコピーしました。');
  }, { signal: listeners.signal });
  saveJson.addEventListener('click', () => {
    if (saveJson.disabled || !json || disposed) return;
    const active = generation;
    const copyActive = ++copyGeneration;
    let objectUrl: string | undefined;
    let anchor: HTMLAnchorElement | undefined;
    try {
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      objectUrl = URL.createObjectURL(blob);
      const downloadUrl = objectUrl;
      anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = `rdap-${searchedIp.replaceAll(':', '-')}.json`;
      anchor.hidden = true;
      view.append(anchor);
      anchor.click();
      anchor.remove();
      const timer = setTimeout(() => { URL.revokeObjectURL(downloadUrl); downloads.delete(downloadUrl); }, 1000);
      downloads.set(downloadUrl, timer);
      if (!disposed && active === generation && copyActive === copyGeneration) {
        setIconMessage(copyStatus, Check, 'ダウンロードを開始しました。');
      }
    } catch {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (!disposed && active === generation && copyActive === copyGeneration) {
        setIconMessage(copyStatus, CircleAlert, 'JSONファイルを生成できませんでした。');
      }
    } finally {
      anchor?.remove();
    }
  }, { signal: listeners.signal });
  container.append(view);
  if (initialIp !== undefined) {
    input.value = initialIp;
    void search();
  }
  return () => {
    disposed = true;
    ++generation;
    cancelIpLookup();
    request?.abort();
    listeners.abort();
    for (const [objectUrl, timer] of downloads) {
      clearTimeout(timer);
      URL.revokeObjectURL(objectUrl);
    }
    downloads.clear();
    view.remove();
  };
}
