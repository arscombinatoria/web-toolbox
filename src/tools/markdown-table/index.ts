import { findTool } from '../../registry';

export function mount(container: HTMLElement): () => void {
  const tool = findTool('markdown-table')!;
  const view = document.createElement('div');
  const title = document.createElement('h1');
  title.tabIndex = -1;
  title.textContent = tool.name;
  const description = document.createElement('p');
  description.className = 'tool-description';
  description.textContent = tool.description;
  const status = document.createElement('p');
  status.className = 'placeholder';
  status.textContent = 'このツールは準備中です';
  view.append(title, description, status);
  container.append(view);
  return () => view.remove();
}
