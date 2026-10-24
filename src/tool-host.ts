import { mountHome } from './components/home';
import type { ToolDefinition } from './registry';
import { defaultToolId } from './registry';
import { toolUrl } from './router';

export function createToolHost(container: HTMLElement) {
  let generation = 0;
  let dispose: (() => void) | undefined;

  const clear = () => {
    dispose?.();
    dispose = undefined;
    container.replaceChildren();
  };
  const message = (heading: string, text: string, recovery = false) => {
    const title = document.createElement('h1');
    title.tabIndex = -1;
    title.textContent = heading;
    const description = document.createElement('p');
    description.textContent = text;
    container.replaceChildren(title, description);
    if (recovery) {
      const link = document.createElement('a');
      link.href = toolUrl(defaultToolId).href;
      link.dataset.toolId = defaultToolId;
      link.textContent = '既定のツールを開く';
      container.append(link);
    }
  };

  return {
    async show(tool: ToolDefinition | null | undefined, input?: string): Promise<boolean> {
      const current = ++generation;
      clear();
      container.removeAttribute('aria-busy');
      if (tool === null) {
        dispose = mountHome(container);
        return true;
      }
      if (!tool) {
        message('ツールが見つかりません', 'サイドバーから利用できるツールを選択してください。', true);
        return true;
      }
      container.setAttribute('aria-busy', 'true');
      message(tool.name, '読み込み中です…');
      try {
        const module = await tool.load();
        if (current !== generation) return false;
        container.replaceChildren();
        dispose = input === undefined ? module.mount(container) : module.mount(container, input);
      } catch {
        if (current !== generation) return false;
        message('ツールを読み込めませんでした', 'ページを再読み込みするか、別のツールを選択してください。', true);
      } finally {
        if (current === generation) container.removeAttribute('aria-busy');
      }
      return true;
    },
    destroy() {
      ++generation;
      clear();
      container.removeAttribute('aria-busy');
    },
  };
}
