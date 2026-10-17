import { tools } from '../registry';
import { toolUrl } from '../router';

export function mountHome(container: HTMLElement): () => void {
  const view = document.createElement('div');
  view.className = 'home';
  view.innerHTML = `
    <h1 tabindex="-1">Web Toolbox</h1>
    <p class="home-tagline">日々の作業を、少し手軽に。</p>
    <p class="tool-description">ブラウザで使える、小さな便利ツール集です。</p>
    <ul class="home-tools" aria-label="ツール一覧"></ul>`;
  const list = view.querySelector('ul')!;
  for (const tool of tools) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'tool-card';
    link.href = toolUrl(tool.id).href;
    link.dataset.toolId = tool.id;
    const title = document.createElement('h2');
    title.textContent = tool.name;
    const description = document.createElement('p');
    description.textContent = tool.description;
    link.append(title, description);
    item.append(link);
    list.append(item);
  }
  container.append(view);
  return () => view.remove();
}
