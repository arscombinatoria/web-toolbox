import { afterEach, expect, it, vi } from 'vitest';
import { startRouter } from './router';

let stop: (() => void) | undefined;
afterEach(() => { stop?.(); document.body.replaceChildren(); });

it('修飾キー・別タブ・ダウンロード・右クリックのリンク操作を横取りしない', () => {
  const navigate = vi.fn();
  stop = startRouter(navigate);
  navigate.mockClear();
  const link = document.createElement('a');
  link.dataset.toolId = 'datetime';
  link.href = '?tool=datetime';
  document.body.append(link);
  const cases = [
    { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 },
  ];
  for (const options of cases) {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...options });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
  for (const [attribute, value] of [['target', '_blank'], ['download', 'file']] as const) {
    link.setAttribute(attribute, value);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    link.removeAttribute(attribute);
  }
  expect(navigate).not.toHaveBeenCalled();
});
