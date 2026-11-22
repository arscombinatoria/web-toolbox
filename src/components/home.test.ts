import { ArrowLeftRight, Clock, createElement, Globe, Image, Search, ShieldCheck, Table, Workflow } from 'lucide';
import { expect, it, vi } from 'vitest';
import { tools } from '../registry';
import { mountHome } from './home';

it('Registry順の名前・説明・URLと装飾アイコンでカードを生成し、ツールは読み込まない', () => {
  const icons = new Map([
    ['ip-address', Globe],
    ['rdap-lookup', Search],
    ['width-converter', ArrowLeftRight],
    ['markdown-table', Table],
    ['regex-visualizer', Workflow],
    ['jwt-debugger', ShieldCheck],
    ['datetime', Clock],
    ['image-converter', Image],
  ]);
  const loads = tools.map(tool => vi.spyOn(tool, 'load'));
  const container = document.createElement('div');
  const dispose = mountHome(container);
  const links = [...container.querySelectorAll<HTMLAnchorElement>('.tool-card')];
  expect(links).toHaveLength(tools.length);
  tools.forEach((tool, i) => {
    expect(links[i]?.querySelector('h2')?.textContent).toBe(tool.name);
    expect(links[i]?.querySelector('p')?.textContent).toBe(tool.description);
    const icon = links[i]?.querySelector('h2 > svg');
    expect(icon?.innerHTML).toBe(createElement(icons.get(tool.id)!).innerHTML);
    expect(icon?.getAttribute('stroke')).toBe('currentColor');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.getAttribute('focusable')).toBe('false');
    expect(new URL(links[i]!.href).searchParams.get('tool')).toBe(tool.id);
    expect(loads[i]).not.toHaveBeenCalled();
  });
  expect(container.querySelector('h1')?.tabIndex).toBe(-1);
  dispose();
  expect(container.childElementCount).toBe(0);
  vi.restoreAllMocks();
});
