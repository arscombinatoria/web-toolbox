import { expect, it, vi } from 'vitest';
import { tools } from '../registry';
import { mountHome } from './home';

it('Registry順の名前・説明・URLでカードを生成し、ツールは読み込まない', () => {
  const loads = tools.map(tool => vi.spyOn(tool, 'load'));
  const container = document.createElement('div');
  const dispose = mountHome(container);
  const links = [...container.querySelectorAll<HTMLAnchorElement>('.tool-card')];
  expect(links).toHaveLength(tools.length);
  tools.forEach((tool, i) => {
    expect(links[i]?.querySelector('h2')?.textContent).toBe(tool.name);
    expect(links[i]?.querySelector('p')?.textContent).toBe(tool.description);
    expect(new URL(links[i]!.href).searchParams.get('tool')).toBe(tool.id);
    expect(loads[i]).not.toHaveBeenCalled();
  });
  expect(container.querySelector('h1')?.tabIndex).toBe(-1);
  dispose();
  expect(container.childElementCount).toBe(0);
  vi.restoreAllMocks();
});
