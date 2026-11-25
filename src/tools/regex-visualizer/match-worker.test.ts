import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import './match-worker';
import type { MatchRequest, MatchResponse } from './match-protocol';

const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<MatchRequest>) => void) | null };
let replies: MatchResponse[];
let post: ReturnType<typeof vi.fn>;

beforeEach(() => { replies = []; post = vi.fn((result: MatchResponse) => replies.push(result)); vi.stubGlobal('postMessage', post); });
afterEach(() => vi.unstubAllGlobals());
function run(pattern: string, input: string, flags = ''): MatchResponse {
  scope.onmessage!(new MessageEvent('message', { data: { id: 7, pattern, input, flags } }));
  return replies.at(-1)!;
}

it('native RegExp flags, first-only and global search, multiline, dotAll, unicode, and sticky behavior', () => {
  expect((run('a', 'A a a', 'i') as Extract<MatchResponse, { ok: true }>).matches.map(x => x.index)).toEqual([0]);
  expect((run('a', 'A a a', 'g') as Extract<MatchResponse, { ok: true }>).matches.map(x => x.index)).toEqual([2, 4]);
  expect((run('^b', 'a\nb', 'm') as Extract<MatchResponse, { ok: true }>).matches[0]?.index).toBe(2);
  expect((run('.', '\n', 's') as Extract<MatchResponse, { ok: true }>).matches[0]?.value).toBe('\n');
  expect((run('.', '😀', 'u') as Extract<MatchResponse, { ok: true }>).matches[0]?.end).toBe(2);
  expect((run('[a&&a]', 'a', 'v') as Extract<MatchResponse, { ok: true }>).matches[0]?.value).toBe('a');
  expect((run('a', 'ba a', 'y') as Extract<MatchResponse, { ok: true }>).matches).toHaveLength(0);
  expect((run('a', 'a a', 'gy') as Extract<MatchResponse, { ok: true }>).matches.map(x => x.index)).toEqual([0]);
  expect((run('', '', '') as Extract<MatchResponse, { ok: true }>).matches.map(x => [x.index, x.end])).toEqual([[0, 0]]);
  expect((run('^\\s+$', ' \t\n  ') as Extract<MatchResponse, { ok: true }>).matches[0]?.value).toBe(' \t\n  ');
});

it('advances global empty matches by UTF-16 or Unicode code point and includes a terminal match once', () => {
  expect((run('(?=)', '😀', 'g') as Extract<MatchResponse, { ok: true }>).matches.map(x => x.index)).toEqual([0, 1, 2]);
  expect((run('(?=)', '😀', 'gu') as Extract<MatchResponse, { ok: true }>).matches.map(x => x.index)).toEqual([0, 2]);
  expect((run('(?=)', '😀', 'gv') as Extract<MatchResponse, { ok: true }>).matches.map(x => x.index)).toEqual([0, 2]);
  expect((run('$', 'a', 'g') as Extract<MatchResponse, { ok: true }>).matches.map(x => x.index)).toEqual([1]);
});

it('returns numbered and named captures, undefined versus empty, and d ranges', () => {
  const result = run('(?<word>a)?()(?<empty>)', 'x', 'd');
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.matches[0]).toMatchObject({ index: 0, end: 0, value: '' });
  expect(result.matches[0]!.captures).toEqual([
    { number: 1, value: null, start: null, end: null },
    { number: 2, value: '', start: 0, end: 0 },
    { number: 3, value: '', start: 0, end: 0 },
    { name: 'word', value: null, start: null, end: null },
    { name: 'empty', value: '', start: 0, end: 0 },
  ]);
});

it('reports compile errors, validates test length, and returns completed results with conservative cap notices', () => {
  expect(run('a'.repeat(4096), 'a'.repeat(4096)).ok).toBe(true);
  expect(run('a'.repeat(4097), 'a')).toMatchObject({ ok: false, kind: 'limit' });
  expect(run('.', 'x'.repeat(32_768)).ok).toBe(true);
  expect(run('.', 'x'.repeat(32_769), 'g')).toMatchObject({ ok: false, kind: 'limit' });
  expect(run('(', 'x').ok).toBe(false);
  const belowMatchCap = run('a', 'a'.repeat(999), 'g');
  expect(belowMatchCap).toMatchObject({ ok: true, incomplete: false, matches: expect.any(Array) });
  if (belowMatchCap.ok) expect(belowMatchCap.matches).toHaveLength(999);
  for (const count of [1_000, 1_001]) {
    const capped = run('a', 'a'.repeat(count), 'g');
    expect(capped).toMatchObject({ ok: true, incomplete: true, reason: 'matches' });
    if (capped.ok) expect(capped.matches).toHaveLength(1_000);
  }
  expect(run('a|$', 'a'.repeat(999), 'g')).toMatchObject({ ok: true, incomplete: false, matches: expect.any(Array) });
  const capturePattern = '()'.repeat(2048);
  const exactCaptures = run(capturePattern, 'x', 'g');
  expect(exactCaptures).toMatchObject({ ok: true, incomplete: false });
  if (exactCaptures.ok) expect(exactCaptures.matches.reduce((total, item) => total + item.captures.length, 0)).toBe(4096);
  const excessCaptures = run(capturePattern, 'xx', 'g');
  expect(excessCaptures).toMatchObject({ ok: true, incomplete: true, reason: 'captures' });
  if (excessCaptures.ok) expect(excessCaptures.matches).toHaveLength(2);
  expect(run('(?=(a+))'.repeat(8), 'a'.repeat(32_768))).toMatchObject({ ok: true, incomplete: false });
  expect(run('(?=(a+))'.repeat(8), 'a'.repeat(32_768), 'g')).toMatchObject({ ok: true, incomplete: true, reason: 'output', matches: expect.any(Array) });
  expect(run('(?=(a+))'.repeat(9), 'a'.repeat(32_768))).toMatchObject({ ok: true, incomplete: true, reason: 'output', matches: [] });
});
