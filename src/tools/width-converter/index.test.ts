import { afterEach, expect, it, vi } from 'vitest';
import { mount } from './index';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.restoreAllMocks(); });

it.each(['resolve', 'reject'])('コピー%sが破棄後のDOMを変更せず、イベントも解除する', async (mode) => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const writeText = vi.fn(() => new Promise<void>((res, rej) => { resolve = res; reject = rej; }));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  dispose = mount(document.body);
  const view = document.querySelector<HTMLElement>('.width-tool')!;
  const input = view.querySelector<HTMLTextAreaElement>('#width-input')!;
  const output = view.querySelector<HTMLTextAreaElement>('#width-output')!;
  const copy = view.querySelector<HTMLButtonElement>('[data-copy]')!;
  input.value = 'Ａ';
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  copy.click();
  expect(writeText).toHaveBeenCalledWith('A');
  dispose();
  const markup = view.innerHTML;
  if (mode === 'resolve') resolve();
  else reject(new Error('denied'));
  await Promise.resolve();
  expect(view.innerHTML).toBe(markup);
  expect(copy.disabled).toBe(true);
  input.value = 'Ｂ';
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  expect(output.value).toBe('A');
  copy.dispatchEvent(new Event('click'));
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(document.body.childElementCount).toBe(0);
});
