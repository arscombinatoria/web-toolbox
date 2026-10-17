import { categories, tools } from '../registry';
import { homeUrl, toolUrl } from '../router';

export function createLayout(root: HTMLElement) {
  root.innerHTML = `
    <a class="skip-link" href="#main-content">本文へスキップ</a>
    <header class="header">
      <div class="header-brand">
        <button class="menu-button" type="button" aria-label="ツールメニューを開く" aria-expanded="false" aria-controls="mobile-menu">☰</button>
        <a class="brand-link" data-home>
          <span class="brand-mark" aria-hidden="true">W</span>
          <span class="brand">Web Toolbox</span>
        </a>
      </div>
      <label class="theme-control">テーマ
        <select aria-label="テーマ"><option value="system">システム</option><option value="light">ライト</option><option value="dark">ダーク</option></select>
      </label>
    </header>
    <div class="layout">
      <div class="sidebar-slot"></div>
      <main id="main-content" tabindex="-1">
        <div class="content-heading"><span class="eyebrow">日々の作業を、少し手軽に。</span></div>
        <section class="tool-content" aria-label="メイン画面"></section>
        <p class="footer-note">Web Toolbox · ブラウザで使える小さな便利ツール集</p>
      </main>
    </div>
    <dialog id="mobile-menu" aria-labelledby="sidebar-title"></dialog>`;

  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';
  sidebar.innerHTML = '<h2 id="sidebar-title">ツール一覧</h2><nav aria-label="ツール"></nav>';
  const nav = sidebar.querySelector('nav')!;
  const brand = root.querySelector<HTMLAnchorElement>('.brand-link')!;
  const home = document.createElement('a');
  home.dataset.home = '';
  home.textContent = 'ホーム';
  nav.append(home);
  for (const category of categories) {
    const group = document.createElement('section');
    const title = document.createElement('h3');
    title.textContent = category.name;
    const list = document.createElement('ul');
    for (const tool of tools.filter((entry) => entry.category === category.id)) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = toolUrl(tool.id).href;
      link.dataset.toolId = tool.id;
      link.textContent = tool.name;
      item.append(link);
      list.append(item);
    }
    group.append(title, list);
    nav.append(group);
  }
  const slot = root.querySelector<HTMLElement>('.sidebar-slot')!;
  const dialog = root.querySelector<HTMLDialogElement>('dialog')!;
  const menuButton = root.querySelector<HTMLButtonElement>('.menu-button')!;
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'close-menu';
  closeButton.textContent = '閉じる';
  closeButton.addEventListener('click', () => dialog.close());
  sidebar.prepend(closeButton);
  const mobile = window.matchMedia('(max-width: 759px)');

  const sync = () => {
    if (dialog.open) dialog.close();
    sidebar.hidden = mobile.matches;
    slot.append(sidebar);
    menuButton.setAttribute('aria-expanded', 'false');
  };
  menuButton.addEventListener('click', () => {
    sidebar.hidden = false;
    dialog.append(sidebar);
    dialog.showModal();
    menuButton.setAttribute('aria-expanded', 'true');
    (sidebar.querySelector<HTMLAnchorElement>('[aria-current="page"]') ?? closeButton).focus();
  });
  dialog.addEventListener('close', sync);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const lastLink = [...nav.querySelectorAll<HTMLAnchorElement>('a')].at(-1) ?? closeButton;
    if (event.shiftKey && document.activeElement === closeButton) {
      event.preventDefault();
      lastLink.focus();
    } else if (!event.shiftKey && document.activeElement === lastLink) {
      event.preventDefault();
      closeButton.focus();
    }
  });
  mobile.addEventListener('change', sync);
  sync();

  return {
    content: root.querySelector<HTMLElement>('.tool-content')!,
    themeSelect: root.querySelector<HTMLSelectElement>('.theme-control select')!,
    select(id: string | null) {
      brand.href = homeUrl().href;
      root.querySelector<HTMLElement>('.content-heading')!.hidden = id === null;
      for (const link of nav.querySelectorAll<HTMLAnchorElement>('a')) {
        if (link.hasAttribute('data-home') ? id === null : link.dataset.toolId === id) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
        // URLの無関係なクエリは現在の値を引き継ぐ。
        link.href = (link.hasAttribute('data-home') ? homeUrl() : toolUrl(link.dataset.toolId!)).href;
      }
      if (dialog.open) dialog.close();
    },
    destroy() {
      mobile.removeEventListener('change', sync);
      dialog.removeEventListener('close', sync);
      if (dialog.open) dialog.close();
      root.replaceChildren();
    },
  };
}
