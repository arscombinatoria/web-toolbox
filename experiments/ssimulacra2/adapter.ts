import wasmUrl from './assets/ssimulacra2.wasm?url';

interface ScorerExports {
  memory: WebAssembly.Memory;
  alloc: (length: number) => number;
  dealloc: (pointer: number, length: number) => void;
  score: (reference: number, distorted: number, width: number, height: number) => number;
}

// These imports belong to the pinned binary. The score path must never invoke them.
const imports = [
  '__wbindgen_externref_xform__.__wbindgen_externref_table_set_null',
  '__wbindgen_externref_xform__.__wbindgen_externref_table_grow',
  '__wbindgen_placeholder__.__wbindgen_describe',
];

export function checkDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
      width < 8 || height < 8 || width > 8192 || height > 8192 || width * height > 16_000_000) {
    throw new RangeError('各辺8〜8,192px、1,600万画素以下の画像を指定してください。');
  }
}

export async function loadScorer() {
  const start = performance.now();
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`Wasm HTTP ${response.status}`);
  const binary = await response.arrayBuffer();
  const fetched = performance.now();
  const module = await WebAssembly.compile(binary);
  const compiled = performance.now();
  const hooks: WebAssembly.Imports = {};
  for (const { module: namespace, name, kind } of WebAssembly.Module.imports(module)) {
    const key = `${namespace}.${name}`;
    if (kind !== 'function' || !imports.includes(key)) throw new Error(`Unexpected Wasm import: ${key}`);
    hooks[namespace] ??= {};
    hooks[namespace][name] = () => { throw new Error(`Unexpected Wasm call: ${key}`); };
  }
  const { exports } = await WebAssembly.instantiate(module, hooks);
  const { memory, alloc, dealloc, score } = exports;
  if (!(memory instanceof WebAssembly.Memory) ||
      typeof alloc !== 'function' || typeof dealloc !== 'function' || typeof score !== 'function') {
    throw new Error('Unexpected Wasm exports');
  }

  const abi = { memory, alloc, dealloc, score } as ScorerExports;
  return {
    abi,
    load: {
      wasmBytes: binary.byteLength,
      fetchMs: fetched - start,
      compileMs: compiled - fetched,
      instantiateMs: performance.now() - compiled,
      initialWasmBytes: memory.buffer.byteLength,
    },
  };
}

function packRgb(source: Uint8ClampedArray, target: Uint8Array) {
  for (let rgba = 0, rgb = 0; rgba < source.length; rgba += 4, rgb += 3) {
    target[rgb] = source[rgba]!;
    target[rgb + 1] = source[rgba + 1]!;
    target[rgb + 2] = source[rgba + 2]!;
  }
}

function toPpm(rgb: Uint8Array, width: number, height: number) {
  const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`);
  const ppm = new Uint8Array(header.length + rgb.length);
  ppm.set(header);
  ppm.set(rgb, header.length);
  return ppm.buffer;
}

export function scoreImages(abi: ScorerExports, reference: ImageData, distorted: ImageData, exportRgb: boolean) {
  const { width, height } = reference;
  checkDimensions(width, height);
  if (distorted.width !== width || distorted.height !== height ||
      reference.data.length !== width * height * 4 || distorted.data.length !== width * height * 4) {
    throw new RangeError('比較画像の寸法または画素バッファが一致しません。');
  }
  const length = width * height * 3;
  const wasmBeforeBytes = abi.memory.buffer.byteLength;
  const start = performance.now();
  let a = 0;
  let b = 0;
  let score: number;
  let packed: number;
  let scored: number;
  let wasmAfterInputBytes: number;
  let ppm: ArrayBuffer[] | undefined;
  try {
    a = abi.alloc(length) >>> 0;
    if (!a) throw new Error('参照用のWasmメモリ確保に失敗しました。');
    b = abi.alloc(length) >>> 0;
    if (!b) throw new Error('比較用のWasmメモリ確保に失敗しました。');
    // Allocation and scoring can each grow memory and detach existing views.
    const buffer = abi.memory.buffer;
    wasmAfterInputBytes = buffer.byteLength;
    if (a + length > buffer.byteLength || b + length > buffer.byteLength ||
        (a < b + length && b < a + length)) throw new Error('Wasmの画素バッファが範囲外です。');
    const referenceRgb = new Uint8Array(buffer, a, length);
    const distortedRgb = new Uint8Array(buffer, b, length);
    packRgb(reference.data, referenceRgb);
    packRgb(distorted.data, distortedRgb);
    if (exportRgb) ppm = [toPpm(referenceRgb, width, height), toPpm(distortedRgb, width, height)];
    packed = performance.now();
    score = abi.score(a, b, width, height);
    scored = performance.now();
    if (!Number.isFinite(score)) throw new Error('有限のスコアを計算できませんでした。');
  } finally {
    if (b) abi.dealloc(b, length);
    if (a) abi.dealloc(a, length);
  }
  return {
    score, ppm,
    packMs: packed - start,
    scoreMs: scored - packed,
    freeMs: performance.now() - scored,
    wasmBeforeBytes, wasmAfterInputBytes,
    wasmAfterFreeBytes: abi.memory.buffer.byteLength,
    rgbaBytes: reference.data.byteLength + (reference === distorted ? 0 : distorted.data.byteLength),
    wasmInputBytes: length * 2,
  };
}
