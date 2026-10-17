import './styles/main.css';
import { createLayout } from './components/layout';
import { setupTheme } from './components/theme';
import { findTool } from './registry';
import { startRouter } from './router';
import { createToolHost } from './tool-host';

const layout = createLayout(document.querySelector<HTMLElement>('#app')!);
const stopTheme = setupTheme(layout.themeSelect);
const host = createToolHost(layout.content);
let selectedId: string | null | undefined;
const stopRouter = startRouter((id, focus) => {
  layout.select(id);
  if (id === selectedId) {
    if (focus) layout.content.querySelector('h1')?.focus();
    return;
  }
  selectedId = id;
  const tool = id === null ? null : findTool(id);
  document.title = id === null ? 'Web Toolbox' : `${tool?.name ?? 'ツールが見つかりません'} | Web Toolbox`;
  void host.show(tool).then((current) => {
    if (current && focus) layout.content.querySelector('h1')?.focus();
  });
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopRouter();
    stopTheme();
    host.destroy();
    layout.destroy();
  });
}
