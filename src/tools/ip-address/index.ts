import { findTool } from '../../registry';
import { fetchIpv4 } from './api';
import type { IpErrorKind } from './api';
import './style.css';

const errors: Record<Exclude<IpErrorKind, 'aborted'>, string> = {
  network: '通信エラー：接続を確認して、再取得してください。',
  http: 'HTTPエラー：外部サービスが正常に応答しませんでした。時間をおいて再取得してください。',
  timeout: 'タイムアウト：10秒以内に取得できませんでした。再取得してください。',
  format: 'レスポンス形式エラー：有効なIPv4アドレスを取得できませんでした。時間をおいて再取得してください。',
};

export function mount(container: HTMLElement): () => void {
  const view = document.createElement('div');
  view.className = 'ip-tool';
  // 固定の画面構造のみ。APIの値はvalue/textContentへ設定する。
  view.innerHTML = `
    <h1 tabindex="-1"></h1>
    <p class="tool-description"></p>
    <label class="ip-label" for="ip-result">グローバルIPv4アドレス</label>
    <input id="ip-result" class="ip-result" readonly placeholder="未取得" spellcheck="false">
    <div class="ip-actions">
      <button type="button" data-copy disabled>コピーする</button>
      <button type="button" data-refresh>再取得</button>
    </div>
    <p class="ip-status" role="status" aria-atomic="true"></p>
    <p class="ip-copy-status" role="status" aria-atomic="true"></p>
    <p class="ip-privacy">IPアドレスの取得には外部サービス（ipify）を使用します。取得時には接続元のIPアドレスがサービス提供元に伝わります。</p>
    <p class="ip-privacy">IPv4接続と外部サービスの稼働状況・CORS設定に依存します。取得したIPアドレスは保存しません。</p>`;
  const tool = findTool('ip-address')!;
  view.querySelector('h1')!.textContent = tool.name;
  view.querySelector('.tool-description')!.textContent = tool.description;
  const output = view.querySelector<HTMLInputElement>('input')!;
  const copy = view.querySelector<HTMLButtonElement>('[data-copy]')!;
  const refresh = view.querySelector<HTMLButtonElement>('[data-refresh]')!;
  const status = view.querySelector<HTMLElement>('.ip-status')!;
  const copyStatus = view.querySelector<HTMLElement>('.ip-copy-status')!;
  let disposed = false;
  let loading = false;
  let copying = false;
  let request: AbortController | undefined;

  const retrieve = async () => {
    if (disposed || loading) return;
    request?.abort();
    const current = new AbortController();
    request = current;
    loading = true;
    output.value = '';
    output.setAttribute('aria-busy', 'true');
    copy.disabled = true;
    refresh.disabled = true;
    copyStatus.textContent = '';
    status.textContent = '取得中…';
    try {
      const ip = await fetchIpv4(current.signal);
      if (disposed || request !== current) return;
      output.value = ip;
      copy.disabled = copying;
      status.textContent = '取得成功';
    } catch (error) {
      if (disposed || request !== current || current.signal.aborted) return;
      const kind = error instanceof Error && 'kind' in error ? error.kind : 'network';
      status.textContent = errors[kind as keyof typeof errors] ?? errors.network;
    } finally {
      if (!disposed && request === current) {
        loading = false;
        refresh.disabled = false;
        output.removeAttribute('aria-busy');
      }
    }
  };
  const copyIp = async () => {
    if (disposed || loading || copying || !output.value) return;
    const current = request;
    copying = true;
    copy.disabled = true;
    copyStatus.textContent = '';
    try {
      await navigator.clipboard.writeText(output.value);
      if (!disposed && request === current) copyStatus.textContent = 'コピーしました。';
    } catch {
      if (!disposed && request === current) {
        copyStatus.textContent = 'コピーできませんでした。IPアドレスを選択して手動でコピーしてください。';
      }
    } finally {
      copying = false;
      if (!disposed) copy.disabled = loading || !output.value;
    }
  };
  refresh.addEventListener('click', retrieve);
  copy.addEventListener('click', copyIp);
  container.append(view);
  void retrieve();
  return () => {
    disposed = true;
    request?.abort();
    refresh.removeEventListener('click', retrieve);
    copy.removeEventListener('click', copyIp);
    view.remove();
  };
}
