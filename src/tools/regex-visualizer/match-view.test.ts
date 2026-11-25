import { describe, expect, it } from 'vitest';
import { renderMatchError, renderMatchResults } from './match-view';
import type { MatchResult } from './match-protocol';

describe('match presentation', () => {
  it('preserves original text with safe marks and textless visual markers', () => {
    const container = document.createElement('div');
    const source = '<img src=x>😀';
    const result: Extract<MatchResult, { ok: true }> = { ok: true, matches: [{ index: 0, end: 10, value: '<img src=x', captures: [] }, { index: 11, end: 11, value: '', captures: [] }], incomplete: false };
    const listeners = new AbortController(); renderMatchResults(container, source, result, listeners.signal);
    expect(container.querySelector('img')).toBeNull(); expect(container.querySelector('mark')?.textContent).toBe('<img src=x');
    expect(container.querySelector('.regex-zero-width-marker')?.textContent).toBe('');
    expect(container.querySelector('.regex-match-highlight')?.textContent).toBe(source);
    expect(container.querySelector('.regex-match-list')?.textContent).toContain('0–10');
    listeners.abort();
  });

  it('materializes named and numbered capture detail only when expanded and aborts stale listeners', () => {
    const container = document.createElement('div'); const listeners = new AbortController();
    const result: Extract<MatchResult, { ok: true }> = { ok: true, matches: [{ index: 1, end: 3, value: 'ab', captures: [{ number: 1, value: '', start: 1, end: 1 }, { number: 2, value: null, start: null, end: null }, { name: '<script>', value: 'ab', start: 1, end: 3 }] }], incomplete: false };
    renderMatchResults(container, 'zab', result, listeners.signal);
    const details = [...container.querySelectorAll<HTMLDetailsElement>('details')];
    expect(details).toHaveLength(2); expect(details[0]!.querySelector('ul')).toBeNull(); expect(container.querySelector('script')).toBeNull();
    details[0]!.open = true; details[0]!.dispatchEvent(new Event('toggle'));
    expect(details[0]!.textContent).toContain('捕捉 1: ""'); expect(details[0]!.textContent).toContain('捕捉 2: undefined');
    details[1]!.open = true; details[1]!.dispatchEvent(new Event('toggle'));
    expect(details[1]!.textContent).toContain('名前付き捕捉 <script>');
    const oldToggle = details[1]!.textContent; listeners.abort();
    const next = document.createElement('div'); renderMatchResults(next, '', result, new AbortController().signal);
    details[1]!.replaceChildren(); details[1]!.dispatchEvent(new Event('toggle'));
    expect(details[1]!.textContent).not.toBe(oldToggle);
  });

  it('writes compile errors as text', () => {
    const container = document.createElement('div'); renderMatchError(container, { ok: false, kind: 'syntax', message: '<img>' });
    expect(container.querySelector('img')).toBeNull(); expect(container.textContent).toContain('<img>');
  });
});
