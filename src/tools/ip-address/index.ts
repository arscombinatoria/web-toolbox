import { findTool } from '../../registry';
import { fetchPublicIp, IpApiError, type IpVersion } from './api';

interface AddressView {
  readonly address: HTMLOutputElement;
  readonly status: HTMLElement;
  readonly copyButton: HTMLButtonElement;
  value: string;
}

function messageForError(error: unknown): string {
  if (error instanceof IpApiError) return error.message;
  return 'IPアドレスを取得できませんでした。ネットワークや外部APIの状態を確認してください。';
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function mount(container: HTMLElement): () => void {
  const tool = findTool('ip-address')!;
  const view = document.createElement('div');
  const title = document.createElement('h1');
  title.tabIndex = -1;
  title.textContent = tool.name;
  const description = document.createElement('p');
  description.className = 'tool-description';
  description.textContent = tool.description;

  const grid = document.createElement('div');
  grid.className = 'ip-address-grid';
  const addresses = new Map<IpVersion, AddressView>();

  for (const version of ['IPv4', 'IPv6'] as const) {
    const card = document.createElement('section');
    card.className = 'ip-address-card';
    const heading = document.createElement('h2');
    heading.textContent = version;
    const address = document.createElement('output');
    address.className = 'ip-address-value';
    address.setAttribute('aria-label', `${version}アドレス`);
    address.textContent = '—';
    const status = document.createElement('p');
    status.className = 'ip-address-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = '取得待ち';
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = 'コピー';
    copyButton.disabled = true;
    copyButton.addEventListener('click', async () => {
      const current = addresses.get(version);
      if (!current?.value) return;
      try {
        await navigator.clipboard.writeText(current.value);
        current.status.textContent = `${version}アドレスをコピーしました。`;
      } catch {
        current.status.textContent = 'コピーできませんでした。アドレスを選択してコピーしてください。';
      }
    });
    card.append(heading, address, status, copyButton);
    grid.append(card);
    addresses.set(version, { address, status, copyButton, value: '' });
  }

  const refreshButton = document.createElement('button');
  refreshButton.type = 'button';
  refreshButton.className = 'ip-address-refresh';
  refreshButton.textContent = '再取得';
  const privacyNote = document.createElement('p');
  privacyNote.className = 'footer-note';
  privacyNote.textContent = '取得にはipify APIを使用します。接続元IPアドレスがAPI提供元に伝わります。';
  view.append(title, description, grid, refreshButton, privacyNote);
  container.append(view);

  let controller: AbortController | undefined;
  let generation = 0;
  const refresh = (): void => {
    controller?.abort();
    controller = new AbortController();
    const currentController = controller;
    const currentGeneration = ++generation;
    let pending = addresses.size;
    refreshButton.disabled = true;
    for (const [version, item] of addresses) {
      item.value = '';
      item.address.textContent = '—';
      item.copyButton.disabled = true;
      item.status.textContent = '取得中…';
      void fetchPublicIp(version, currentController.signal).then((ip) => {
        if (currentGeneration !== generation) return;
        item.value = ip;
        item.address.textContent = ip;
        item.copyButton.disabled = false;
        item.status.textContent = '取得しました';
      }).catch((error: unknown) => {
        if (currentGeneration !== generation || isAbortError(error)) return;
        item.status.textContent = messageForError(error);
      }).finally(() => {
        pending -= 1;
        if (currentGeneration === generation && pending === 0) refreshButton.disabled = false;
      });
    }
  };
  refreshButton.addEventListener('click', refresh);
  refresh();

  return () => {
    generation += 1;
    controller?.abort();
    view.remove();
  };
}
