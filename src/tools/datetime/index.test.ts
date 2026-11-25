// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { mount } from './index';
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const rows = (view: Element) => [...view.querySelectorAll('.datetime-tables tbody tr')];
it('2表に各12行を時系列で重複なく表示し、両方から選択できる', () => {
  const dispose = mount(document.body);
  const view = document.querySelector('.datetime-tool')!;
  const bodies = [...view.querySelectorAll('.datetime-tables tbody')];
  expect(bodies.map(body => body.querySelectorAll('tr').length)).toEqual([12, 12]);
  expect(rows(view).map(row => row.querySelector('button')?.textContent)).toEqual(
    Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`),
  );
  for (const hour of ['03', '18']) {
    (view.querySelector(`[aria-label="JST ${hour}:00を選択"]`) as HTMLButtonElement).click();
    expect((view.querySelector('#datetime-date') as HTMLInputElement).value).toBe((view.querySelector('#datetime-table-date') as HTMLInputElement).value);
    expect((view.querySelector('#datetime-time') as HTMLInputElement).value).toBe(`${hour}:00:00`);
    expect(view.querySelector('.is-selected button')?.textContent).toBe(`${hour}:00`);
  }
  dispose();
});
it('時計が11時台から12時台へ移ると現在時刻の強調も表をまたいで移る', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-17T02:59:30Z'));
  const dispose = mount(document.body);
  const view = document.querySelector('.datetime-tool')!;
  expect(view.querySelector('.is-current button')?.textContent).toBe('11:00');
  vi.advanceTimersByTime(60000);
  expect(view.querySelectorAll('.is-current')).toHaveLength(1);
  expect(view.querySelector('.is-current button')?.textContent).toBe('12:00');
  expect(view.querySelector('.is-current')?.closest('tbody')).toBe(view.querySelectorAll('tbody')[1]);
  dispose();
});
it('表の日付の不正値で両表を空にし、修正時に復帰する', () => {
  const dispose = mount(document.body);
  const view = document.querySelector('.datetime-tool')!;
  const tableDate = view.querySelector<HTMLInputElement>('#datetime-table-date')!;
  tableDate.value = '2026-02-30'; tableDate.dispatchEvent(new Event('input'));
  expect(view.querySelector('#datetime-table-error')?.textContent).toContain('有効な年月日');
  expect(view.querySelectorAll('.datetime-tables tbody tr')).toHaveLength(0);
  tableDate.value = '2026-02-28'; tableDate.dispatchEvent(new Event('input'));
  expect(view.querySelector('#datetime-table-error')?.textContent).toBe('');
  expect(view.querySelectorAll('.datetime-tables tbody tr')).toHaveLength(24);
  dispose();
});
it('固定形式・省略秒・不正入力からの復帰を処理する', () => {
  const dispose = mount(document.body);
  const view = document.querySelector('.datetime-tool')!;
  const date = view.querySelector<HTMLInputElement>('#datetime-date')!;
  const time = view.querySelector<HTMLInputElement>('#datetime-time')!;
  date.value = '2026-10-17'; time.value = '09:30';
  time.dispatchEvent(new Event('input'));
  expect(view.querySelector<HTMLInputElement>('#datetime-iso')?.value).toBe('2026-10-17T00:30:00Z');
  time.value = '9:30'; time.dispatchEvent(new Event('input'));
  expect(view.querySelector('#datetime-error')?.textContent).toContain('時刻');
  expect(view.querySelector<HTMLInputElement>('#datetime-iso')?.value).toBe('');
  expect(view.querySelector<HTMLButtonElement>('.datetime-results button')?.disabled).toBe(true);
  time.value = '09:30:45'; time.dispatchEvent(new Event('input'));
  expect(view.querySelector('#datetime-error')?.textContent).toBe('');
  expect(view.querySelector<HTMLInputElement>('#datetime-iso')?.value).toBe('2026-10-17T00:30:45Z');
  expect(view.querySelector<HTMLButtonElement>('.datetime-results button')?.disabled).toBe(false);
  dispose();
});
it('時計・時間帯・日付境界を更新し、再表示で更新、破棄で解除', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-17T14:59:30Z'));
  const dispose = mount(document.body);
  const view = document.querySelector('.datetime-tool')!;
  expect(view.querySelector('[data-now-jst]')?.textContent).toBe('2026-10-17 23:59');
  expect(view.querySelector('.is-current')?.textContent).toContain('23:00');
  expect(view.querySelector('[data-now-jst]')?.closest('[aria-live], [role="status"]')).toBeNull();
  vi.advanceTimersByTime(60000);
  expect(view.querySelector('[data-now-jst]')?.textContent).toBe('2026-10-18 00:00');
  expect(view.querySelector('.is-current')).toBeNull();
  (view.querySelector('[data-today]') as HTMLButtonElement).click();
  expect(view.querySelector('.is-current')?.textContent).toContain('00:00');
  vi.setSystemTime(new Date('2026-10-17T16:20:00Z'));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(view.querySelector('.is-current')?.textContent).toContain('01:00');
  dispose(); expect(vi.getTimerCount()).toBe(0);
  vi.setSystemTime(new Date('2026-10-17T17:20:00Z'));
  document.dispatchEvent(new Event('visibilitychange'));
  expect(view.querySelector('[data-now-jst]')?.textContent).toBe('2026-10-18 01:20');
});
it('コピー待機中の変更・破棄後の通知を抑止', async () => {
  let finish!: () => void;
  vi.stubGlobal('navigator', { clipboard: { writeText: () => new Promise<void>(resolve => { finish = resolve; }) } });
  const dispose = mount(document.body);
  const view = document.querySelector('.datetime-tool')!;
  (view.querySelector('.datetime-results button') as HTMLButtonElement).click();
  const input = view.querySelector<HTMLInputElement>('#datetime-time')!;
  input.value = '12:00:01'; input.dispatchEvent(new Event('input'));
  finish(); await Promise.resolve();
  expect(view.querySelector('[role="status"]')?.textContent).toBe('');
  (view.querySelector('.datetime-results button') as HTMLButtonElement).click();
  dispose(); finish(); await Promise.resolve();
  expect(view.querySelector('[role="status"]')?.textContent).toBe('');
});
