import { setNavigationInput, toolUrl } from '../../router';
import { findTool } from '../../registry';
import { fetchIpv4, fetchIpv6 } from './api';
import type { IpErrorKind } from './api';
import './style.css';

const errors: Record<Exclude<IpErrorKind, 'aborted'>, string> = {
  network: '通信エラー：接続を確認して、再取得してください。',
  http: 'HTTPエラー：外部サービスが正常に応答しませんでした。時間をおいて再取得してください。',
  timeout: 'タイムアウト：10秒以内に取得できませんでした。再取得してください。',
  format: 'レスポンス形式エラー：有効なIPアドレスを取得できませんでした。時間をおいて再取得してください。',
};

export function mount(container: HTMLElement): () => void {
  const view = document.createElement('div');
  view.className = 'ip-tool';
  // 固定の画面構造のみ。APIの値はvalue/textContentへ設定する。
  view.innerHTML = `
    <h1 tabindex="-1"></h1>
    <p class="tool-description"></p>
    ${(['IPv4', 'IPv6'] as const).map((version) => `
      <section data-version="${version}" aria-labelledby="${version}-label">
        <label id="${version}-label" class="ip-label" for="${version}-result">グローバル${version}アドレス</label>
        ${version === 'IPv4'
          ? `<input id="${version}-result" class="ip-result" readonly placeholder="未取得" spellcheck="false">`
          : `<textarea id="${version}-result" class="ip-result" readonly rows="1" placeholder="未取得" spellcheck="false"></textarea>`}
        <div class="ip-actions">
          <button type="button" data-copy aria-label="${version}をコピーする" disabled>コピーする</button>
          <a data-rdap data-tool-id="rdap-lookup" hidden>登録情報を検索</a>
        </div>
        <p class="ip-status" role="status" aria-atomic="true"></p>
        <p class="ip-copy-status" role="status" aria-atomic="true"></p>
      </section>`).join('')}
    <div class="ip-actions"><button type="button" data-refresh>再取得</button></div>
    <p class="ip-privacy">IPアドレスの取得には外部サービス（ipify）を使用します。取得時には接続元のIPアドレスがサービス提供元に伝わります。</p>
    <p class="ip-privacy">取得結果は各接続環境、DNS、外部サービスの稼働状況・CORS設定に依存します。IPv6の取得失敗だけではIPv6非対応とは判断できません。取得したIPアドレスは保存しません。</p>`;
  const tool = findTool('ip-address')!;
  view.querySelector('h1')!.textContent = tool.name;
  view.querySelector('.tool-description')!.textContent = tool.description;
  const refresh = view.querySelector<HTMLButtonElement>('[data-refresh]')!;
  const ipv6Output = view.querySelector<HTMLTextAreaElement>('#IPv6-result')!;
  const resizeIpv6 = () => {
    // Firefoxを含めfield-sizing未対応のブラウザでも、折り返しに合わせて伸縮する。
    ipv6Output.style.height = 'auto';
    const style = getComputedStyle(ipv6Output);
    const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    ipv6Output.style.height = `${ipv6Output.scrollHeight + border}px`;
  };
  let disposed = false;
  let loading = false;
  let request: AbortController | undefined;
  const panels = ([['IPv4', fetchIpv4], ['IPv6', fetchIpv6]] as const).map(([version, fetchAddress]) => {
    const section = view.querySelector<HTMLElement>(`[data-version="${version}"]`)!;
    const output = section.querySelector<HTMLInputElement | HTMLTextAreaElement>('.ip-result')!;
    const copy = section.querySelector<HTMLButtonElement>('[data-copy]')!;
    const status = section.querySelector<HTMLElement>('.ip-status')!;
    const copyStatus = section.querySelector<HTMLElement>('.ip-copy-status')!;
    const rdap = section.querySelector<HTMLAnchorElement>('[data-rdap]')!;
    rdap.href = toolUrl('rdap-lookup').href;
    rdap.setAttribute('aria-label', `${version}の登録情報を検索`);
    let copying = false;
    const retrieve = async (current: AbortController) => {
      output.value = '';
      rdap.hidden = true;
      setNavigationInput(rdap, undefined);
      if (version === 'IPv6') resizeIpv6();
      output.setAttribute('aria-busy', 'true');
      copy.disabled = true;
      copyStatus.textContent = '';
      status.textContent = '取得中…';
      try {
        const ip = await fetchAddress(current.signal);
        if (disposed || request !== current) return;
        output.value = ip;
        setNavigationInput(rdap, ip);
        rdap.hidden = false;
        if (version === 'IPv6') resizeIpv6();
        copy.disabled = copying;
        status.textContent = '取得成功';
      } catch (error) {
        if (disposed || request !== current || current.signal.aborted) return;
        const kind = error instanceof Error && 'kind' in error ? error.kind : 'network';
        status.textContent = errors[kind as keyof typeof errors] ?? errors.network;
      } finally {
        if (!disposed && request === current) output.removeAttribute('aria-busy');
      }
    };
    const copyIp = async () => {
      if (disposed || copying || !output.value) return;
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
        if (!disposed) copy.disabled = !output.value;
      }
    };
    copy.addEventListener('click', copyIp);
    return { retrieve, dispose: () => {
      copy.removeEventListener('click', copyIp);
      setNavigationInput(rdap, undefined);
    } };
  });
  const retrieve = async () => {
    if (disposed || loading) return;
    request?.abort();
    const current = new AbortController();
    request = current;
    loading = true;
    refresh.disabled = true;
    // 各パネルが個別に成功・失敗を反映し、両方の完了後に再取得を有効にする。
    await Promise.all(panels.map((panel) => panel.retrieve(current)));
    if (!disposed && request === current) {
      loading = false;
      refresh.disabled = false;
    }
  };
  refresh.addEventListener('click', retrieve);
  container.append(view);
  window.addEventListener('resize', resizeIpv6);
  void retrieve();
  return () => {
    disposed = true;
    request?.abort();
    refresh.removeEventListener('click', retrieve);
    window.removeEventListener('resize', resizeIpv6);
    panels.forEach((panel) => panel.dispose());
    view.remove();
  };
}
