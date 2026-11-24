import { afterEach, expect, it, vi } from 'vitest';
import { mount } from './index';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.restoreAllMocks(); });

it('変換方向に応じて入力プレースホルダーを切り替え、入力・結果には混ぜない', () => {
  dispose = mount(document.body);
  const view = document.querySelector<HTMLElement>('.width-tool')!;
  const input = view.querySelector<HTMLTextAreaElement>('#width-input')!;
  const output = view.querySelector<HTMLTextAreaElement>('#width-output')!;

  expect(input.placeholder).toBe('例：ＡＢＣ　１２３');
  expect(input.value).toBe('');
  expect(output.value).toBe('');
  expect(output.placeholder).toBe('');

  input.value = 'ABC 123';
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  view.querySelector<HTMLInputElement>('[value="to-full"]')!.checked = true;
  view.querySelector<HTMLInputElement>('[value="to-full"]')!.dispatchEvent(new Event('change', { bubbles: true }));
  expect(input.placeholder).toBe('例：ABC 123');
  expect(input.value).toBe('ABC 123');
  expect(output.value).toBe('ＡＢＣ　１２３');

  view.querySelector<HTMLInputElement>('[value="to-half"]')!.checked = true;
  view.querySelector<HTMLInputElement>('[value="to-half"]')!.dispatchEvent(new Event('change', { bubbles: true }));
  expect(input.placeholder).toBe('例：ＡＢＣ　１２３');
  expect(input.value).toBe('ABC 123');
  expect(output.value).toBe('ABC 123');

  view.querySelector<HTMLInputElement>('[name="symbols"]')!.checked = true;
  view.querySelector<HTMLInputElement>('[name="symbols"]')!.dispatchEvent(new Event('change', { bubbles: true }));
  expect(input.placeholder).toBe('例：ＡＢＣ　１２３');
  expect(input.value).toBe('ABC 123');

  view.querySelector<HTMLButtonElement>('[data-clear]')!.click();
  expect(input.value).toBe('');
  expect(input.placeholder).toBe('例：ＡＢＣ　１２３');
  expect(output.value).toBe('');
});

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
