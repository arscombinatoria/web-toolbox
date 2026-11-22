import wasmUrl from './ssimulacra2-0.1.0.wasm?url&no-inline';
import { evaluationLimit, isFiniteScore } from './rules';

interface ScorerExports {
  memory: WebAssembly.Memory;
  alloc: (length: number) => number;
  dealloc: (pointer: number, length: number) => void;
  score: (reference: number, distorted: number, width: number, height: number) => number;
}

// bytecut 0.1.0 links these wasm-bindgen stubs. Scoring must not call them.
const imports = [
  '__wbindgen_externref_xform__.__wbindgen_externref_table_set_null',
  '__wbindgen_externref_xform__.__wbindgen_externref_table_grow',
  '__wbindgen_placeholder__.__wbindgen_describe',
];

export async function loadScorer(): Promise<ScorerExports> {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`Wasm HTTP ${response.status}`);
  const module = await WebAssembly.compile(await response.arrayBuffer());
  const hooks: WebAssembly.Imports = {};
  for (const { module: namespace, name, kind } of WebAssembly.Module.imports(module)) {
    const key = `${namespace}.${name}`;
    if (kind !== 'function' || !imports.includes(key)) throw new Error(`Unexpected Wasm import: ${key}`);
    hooks[namespace] ??= {};
    hooks[namespace][name] = () => { throw new Error(`Unexpected Wasm call: ${key}`); };
  }
  const { exports: { memory, alloc, dealloc, score } } = await WebAssembly.instantiate(module, hooks);
  if (!(memory instanceof WebAssembly.Memory) ||
      typeof alloc !== 'function' || typeof dealloc !== 'function' || typeof score !== 'function') {
    throw new Error('Unexpected Wasm exports');
  }
  return { memory, alloc, dealloc, score } as ScorerExports;
}

function packRgb(source: Uint8ClampedArray, target: Uint8Array): void {
  for (let rgba = 0, rgb = 0; rgba < source.length; rgba += 4, rgb += 3) {
    target[rgb] = source[rgba]!;
    target[rgb + 1] = source[rgba + 1]!;
    target[rgb + 2] = source[rgba + 2]!;
  }
}

export function scoreImages(abi: ScorerExports, reference: ImageData, distorted: ImageData): number {
  const { width, height } = reference;
  const limit = evaluationLimit(width, height);
  if (limit) throw new RangeError(limit);
  const pixels = width * height;
  if (distorted.width !== width || distorted.height !== height ||
      reference.data.length !== pixels * 4 || distorted.data.length !== pixels * 4) {
    throw new RangeError('比較画像の寸法または画素バッファが一致しません。');
  }
  const length = pixels * 3;
  const allocate = () => {
    const pointer = abi.alloc(length) >>> 0;
    if (!pointer || pointer + length > abi.memory.buffer.byteLength) {
      throw new Error('Wasmの入力メモリを確保できませんでした。');
    }
    return pointer;
  };
  let a = 0;
  let b = 0;
  try {
    a = allocate();
    const second = allocate();
    if (a < second + length && second < a + length) throw new Error('Wasmの入力メモリが重複しています。');
    b = second;
    // alloc and score can grow the memory and detach old views.
    const buffer = abi.memory.buffer;
    packRgb(reference.data, new Uint8Array(buffer, a, length));
    packRgb(distorted.data, new Uint8Array(buffer, b, length));
    const score = abi.score(a, b, width, height);
    if (!isFiniteScore(score)) throw new Error('有限のスコアを計算できませんでした。');
    return score;
  } finally {
    try {
      if (b) abi.dealloc(b, length);
    } finally {
      if (a) abi.dealloc(a, length);
    }
  }
}
