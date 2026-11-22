// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { evaluationLimit, isEvaluable, isFiniteScore } from './rules';
import { loadScorer, scoreImages } from './wasm';

afterEach(() => vi.unstubAllGlobals());

it('Browser JPEGのみ採点し、各辺8 px・1,048,576画素の境界を適用する', () => {
  expect([isEvaluable('original'), isEvaluable('image/png'), isEvaluable('image/jpeg')]).toEqual([false, false, true]);
  for (const [width, height] of [[8, 8], [1024, 1024], [2048, 512]] as const) {
    expect(evaluationLimit(width, height)).toBeUndefined();
  }
  for (const [width, height] of [[7, 8], [8, 7], [1024, 1025], [8.5, 8], [8, Infinity]] as const) {
    expect(evaluationLimit(width, height)).toBeTruthy();
  }
  expect([NaN, Infinity, -Infinity, '100', undefined].every(value => !isFiniteScore(value))).toBe(true);
  expect([-12, 0, 100, 101].every(isFiniteScore)).toBe(true);
});

it('固定WasmのSHA-256を照合し、HTTPエラー後に同じ配布物をロードできる', async () => {
  const file = await readFile(new URL('./ssimulacra2-0.1.0.wasm', import.meta.url));
  expect(createHash('sha256').update(file).digest('hex')).toBe('56ae71e4b0e1d72d3afbcf2821ec913e0d775806f3c745960ea3a0504f402648');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response(Uint8Array.from(file))));
  await expect(loadScorer()).rejects.toThrow('503');
  const scorer = await loadScorer();
  expect(scorer.memory).toBeInstanceOf(WebAssembly.Memory);
});

function pixels(width = 8, height = 8) {
  const data = new Uint8ClampedArray(width * height * 4);
  data.set([29, 44, 88, 255, 55, 12, 2, 255]);
  return { width, height, data, colorSpace: 'srgb' } satisfies ImageData;
}

it('両方の確保後にRGBを詰め、採点でメモリが再拡張しても確保を解放する', () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const length = 8 * 8 * 3;
  const base = 65536;
  const alloc = vi.fn().mockReturnValueOnce(1).mockImplementationOnce(() => {
    memory.grow(1);
    return base;
  });
  const dealloc = vi.fn();
  const score = vi.fn(() => {
    expect([...new Uint8Array(memory.buffer, 1, 6)]).toEqual([29, 44, 88, 55, 12, 2]);
    expect([...new Uint8Array(memory.buffer, base, 6)]).toEqual([29, 44, 88, 55, 12, 2]);
    memory.grow(1);
    return 101;
  });
  expect(scoreImages({ memory, alloc, dealloc, score }, pixels(), pixels())).toBe(101);
  expect(score).toHaveBeenCalledWith(1, base, 8, 8);
  expect(dealloc.mock.calls).toEqual([[base, length], [1, length]]);
});

it('境界外・重複・不正寸法・非有限値を拒否し、確保済みの領域を解放する', () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const alloc = vi.fn();
  const dealloc = vi.fn();
  const score = vi.fn(() => NaN);
  const abi = { memory, alloc, dealloc, score };
  expect(() => scoreImages(abi, pixels(), pixels(9, 8))).toThrow('寸法');
  expect(alloc).not.toHaveBeenCalled();
  for (const second of [0, 65535, 18]) {
    alloc.mockReturnValueOnce(1).mockReturnValueOnce(second);
    expect(() => scoreImages(abi, pixels(), pixels())).toThrow('入力メモリ');
  }
  expect(dealloc.mock.calls).toEqual([[1, 192], [1, 192], [1, 192]]);
  expect(score).not.toHaveBeenCalled();
  alloc.mockReturnValueOnce(1).mockReturnValueOnce(193);
  expect(() => scoreImages(abi, pixels(), pixels())).toThrow('有限');
  expect(dealloc.mock.calls.slice(-2)).toEqual([[193, 192], [1, 192]]);
});
