import { afterEach, expect, it, vi } from 'vitest';
import { decode, encode } from './encoder';
import { mount } from './index';

vi.mock('./encoder', async importOriginal => ({
  ...await importOriginal<typeof import('./encoder')>(), decode: vi.fn(), encode: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const bitmap = (width = 64, height = 32) => ({ width, height, close: vi.fn() }) as unknown as ImageBitmap;
const jpeg = new Blob(['1234'], { type: 'image/jpeg' });
const png = new Blob(['1'], { type: 'image/png' });
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  vi.useRealTimers();
});

function setup(active = bitmap()) {
  vi.useFakeTimers();
  vi.mocked(decode).mockResolvedValue(active);
  vi.mocked(encode).mockImplementation(async (_, type) => type === 'image/jpeg' ? jpeg : png);
  let urlNumber = 0;
  const createUrl = vi.fn((_blob: Blob) => 'blob:result-' + ++urlNumber);
  const revokeUrl = vi.fn();
  vi.stubGlobal('URL', class extends URL {
    static override createObjectURL = createUrl;
    static override revokeObjectURL = revokeUrl;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {} } as unknown as CanvasRenderingContext2D);
  const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const unmount = mount(document.body);
  dispose = unmount;
  const input = document.querySelector<HTMLInputElement>('[type=file]')!;
  const choose = (name = 'input.png', target?: HTMLElement) => {
    const files = [new File(['12'], name, { type: 'image/png' })];
    if (target) {
      const event = new Event('drop', { cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { files } });
      target.dispatchEvent(event);
    } else {
      Object.defineProperty(input, 'files', { configurable: true, value: files });
      input.dispatchEvent(new Event('change'));
    }
    return files[0]!;
  };
  const get = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
  function side(id: string) {
    const panel = get(`.image-panel[data-side="${id}"]`);
    const format = panel.querySelector('select')!;
    const slider = panel.querySelector<HTMLInputElement>('.image-quality input')!;
    const preview = get<HTMLImageElement>(`img[data-side="${id}"]`);
    const decodePreview = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    preview.decode = decodePreview;
    return {
      format, slider, preview, decodePreview,
      output: panel.querySelector('.image-result')!,
      error: panel.querySelector('.image-error')!,
      score: panel.querySelector('.image-score')!,
      save: panel.querySelector<HTMLButtonElement>('.image-save')!,
      qualityLabel: panel.querySelector<HTMLElement>('.image-quality')!,
      select(value: string) {
        format.value = value;
        format.dispatchEvent(new Event('change'));
      },
      quality(value: string) {
        slider.value = value;
        slider.dispatchEvent(new Event('input'));
      },
    };
  }
  return {
    active, createUrl, revokeUrl, download, choose, drop: get<HTMLElement>('.image-drop'),
    left: side('left'), right: side('right'),
    info: get('.image-info'),
    auto: get<HTMLInputElement>('.image-evaluation-toggle input'),
    evaluate: get<HTMLButtonElement>('.image-evaluate'),
    cancel: get<HTMLButtonElement>('.image-evaluation-cancel'),
    evaluationStatus: get('.image-evaluation-status'),
    limit: get('.image-evaluation-limit'),
    canvas: get<HTMLCanvasElement>('canvas'),
    unmount() { unmount(); dispose = undefined; },
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

it('SSIMULACRA2の目安表は閉じた状態で表示され、代表値と公式出典を案内する', () => {
  setup();
  const guide = document.querySelector<HTMLDetailsElement>('.image-score-guide')!;
  expect(guide.open).toBe(false);
  expect(guide.querySelector('summary')?.textContent).toBe('スコアの目安を見る');
  expect([...guide.querySelectorAll('tbody tr')].map(row => [...row.querySelectorAll('th, td')].map(cell => cell.textContent))).toEqual([
    ['100', '数学的にロスレス'],
    ['90', '視覚的にロスレス'],
    ['85', '極めて高画質'],
    ['80', '非常に高画質'],
    ['70', '高画質'],
    ['50', '中程度'],
    ['30', '低画質'],
    ['10', '非常に低画質'],
    ['0未満', '極端な画質劣化'],
  ]);
  expect(guide.querySelector('thead th')?.textContent).toBe('スコア');
  expect(guide.textContent).toContain('厳密な区間ではなく代表的な目安');
  expect(guide.textContent).toContain('高いほど元画像に近い');
  expect(guide.textContent).toContain('100点満点の採点方式ではありません');
  expect(guide.querySelector('a')?.getAttribute('href')).toBe('https://github.com/cloudinary/ssimulacra2#usage');
});

it('初期状態は左Original・右JPEG 0.75で、両側の元画像を再エンコードせず保存できる', async () => {
  const { choose, active, left, right, canvas, createUrl, download } = setup();
  const file = choose('input.alpha.png');
  await flush();
  expect(left.format.value).toBe('original');
  expect(right.format.value).toBe('image/jpeg');
  expect(right.slider.value).toBe('0.75');
  expect(decode).toHaveBeenCalledOnce();
  expect(encode).toHaveBeenCalledExactlyOnceWith(active, 'image/jpeg', 0.75);
  expect(left.output.textContent).toContain('2 B（元ファイル比 0%）');
  expect(right.output.textContent).toContain('4 B（元ファイル比 +100%）');

  right.select('original');
  expect(left.qualityLabel.hidden).toBe(true);
  expect(right.qualityLabel.hidden).toBe(true);
  expect(canvas.classList.contains('image-original-left')).toBe(true);
  expect(canvas.classList.contains('image-original-right')).toBe(true);
  expect(right.output.textContent).toContain('2 B（元ファイル比 0%）');
  expect(encode).toHaveBeenCalledOnce();
  expect(createUrl).toHaveBeenLastCalledWith(file);
  left.save.click();
  right.save.click();
  const anchors = download.mock.contexts as HTMLAnchorElement[];
  expect(anchors.map(anchor => anchor.download)).toEqual([file.name, file.name]);
  expect(anchors.map(anchor => anchor.href)).toEqual(['blob:result-1', 'blob:result-3']);
});

it('品質を独立して保持し、変更した側だけを変換する', async () => {
  const { choose, active, left, right, download } = setup();
  choose();
  await flush();

  left.select('image/jpeg');
  await flush();
  expect(encode).toHaveBeenCalledOnce();
  const rightUrl = right.preview.src;
  left.quality('0.10');
  left.quality('0.25');
  expect(left.save.disabled).toBe(true);
  expect(right.save.disabled).toBe(false);
  expect(right.preview.src).toBe(rightUrl);
  expect(left.output.textContent).toBe('変換しています…');
  expect(right.output.textContent).toBe('出力サイズ 4 B（元ファイル比 +100%）');
  left.save.click();
  right.save.click();
  expect(download).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(179);
  expect(encode).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(encode).toHaveBeenLastCalledWith(active, 'image/jpeg', 0.25);
  expect(encode).toHaveBeenCalledTimes(2);
  expect(left.save.disabled).toBe(false);

  right.quality('1');
  await vi.advanceTimersByTimeAsync(180);
  expect(encode).toHaveBeenLastCalledWith(active, 'image/jpeg', 1);
  expect(left.slider.valueAsNumber).toBe(0.25);
  left.select('image/png');
  right.select('original');
  expect(left.qualityLabel.hidden).toBe(true);
  expect(right.qualityLabel.hidden).toBe(true);
  left.select('image/jpeg');
  right.select('image/jpeg');
  await flush();
  expect(left.slider.valueAsNumber).toBe(0.25);
  expect(right.slider.valueAsNumber).toBe(1);
  expect(encode).toHaveBeenLastCalledWith(active, 'image/jpeg', 1);
  expect(left.save.disabled).toBe(false);
  expect(right.save.disabled).toBe(false);
});

it('同じ設定の変換を共有し、成功結果のURLは左右で独立して解放する', async () => {
  const { choose, left, right, createUrl, revokeUrl } = setup();
  choose();
  await flush();
  const encoding = deferred<Blob>();
  vi.mocked(encode).mockReturnValueOnce(encoding.promise);
  left.select('image/png');
  right.select('image/png');
  expect(encode).toHaveBeenCalledTimes(2);
  encoding.resolve(png);
  await flush();
  expect(createUrl.mock.calls.slice(-2)).toEqual([[png], [png]]);
  expect(left.output.textContent).toContain('1 B（元ファイル比 -50%）');
  expect(right.output.textContent).toBe(left.output.textContent);
  const leftUrl = left.preview.src;
  const rightUrl = right.preview.src;
  left.select('original');
  expect(revokeUrl).toHaveBeenCalledWith(leftUrl);
  expect(revokeUrl).not.toHaveBeenCalledWith(rightUrl);
  expect(right.preview.src).toBe(rightUrl);
  expect(left.output.textContent).toBe('出力サイズ 2 B（元ファイル比 0%）');
  expect(right.output.textContent).toBe('出力サイズ 1 B（元ファイル比 -50%）');
});

it('左右の設定変更が重なっても古いエンコードとプレビュー結果を破棄する', async () => {
  const { choose, left, right, createUrl, revokeUrl } = setup();
  choose();
  await flush();
  const staleEncode = deferred<Blob>();
  const stalePreview = deferred<void>();
  vi.mocked(encode).mockReturnValueOnce(staleEncode.promise);
  right.quality('0.50');
  await vi.advanceTimersByTimeAsync(180);
  left.decodePreview.mockReturnValueOnce(stalePreview.promise);
  left.select('image/png');
  await flush();
  const staleUrl = left.preview.src;
  right.quality('0.51');
  right.quality('0.52');
  left.select('image/jpeg');
  await vi.advanceTimersByTimeAsync(180);
  const leftUrl = left.preview.src;
  const rightUrl = right.preview.src;
  const urlsCreated = createUrl.mock.calls.length;
  staleEncode.resolve(jpeg);
  stalePreview.reject(new DOMException('superseded'));
  await flush();
  expect(revokeUrl).toHaveBeenCalledWith(staleUrl);
  expect(revokeUrl).not.toHaveBeenCalledWith(leftUrl);
  expect(revokeUrl).not.toHaveBeenCalledWith(rightUrl);
  expect(createUrl).toHaveBeenCalledTimes(urlsCreated);
  expect(left.preview.src).toBe(leftUrl);
  expect(right.preview.src).toBe(rightUrl);
  expect(left.error.textContent).toBe('');
  expect(right.error.textContent).toBe('');
  expect(left.save.disabled).toBe(false);
  expect(right.save.disabled).toBe(false);
  expect(left.output.textContent).toBe('出力サイズ 4 B（元ファイル比 +100%）');
  expect(right.output.textContent).toBe(left.output.textContent);
});

it('連続入力・ドロップ・ツール破棄で古いデコードと変換を無効化する', async () => {
  const { choose, drop, active, left, right, canvas, info, createUrl, revokeUrl, unmount } = setup();
  const staleDecode = deferred<ImageBitmap>();
  const staleEncode = deferred<Blob>();
  const pendingOnUnmount = deferred<Blob>();
  const old = bitmap();
  const replacement = bitmap();
  vi.mocked(decode).mockReturnValueOnce(staleDecode.promise).mockResolvedValueOnce(active).mockResolvedValueOnce(replacement);
  vi.mocked(encode).mockReturnValueOnce(staleEncode.promise).mockReturnValueOnce(pendingOnUnmount.promise);

  choose('old.png');
  const oldSignal = vi.mocked(decode).mock.calls[0]![1];
  choose('middle.png');
  expect(oldSignal.aborted).toBe(true);
  await flush();
  expect(info.textContent).toContain('middle.png');
  staleDecode.resolve(old);
  await flush();
  expect(old.close).toHaveBeenCalledOnce();

  choose('new.png', drop);
  expect(active.close).toHaveBeenCalledOnce();
  expect(revokeUrl).toHaveBeenCalledWith('blob:result-1');
  await flush();
  expect(info.textContent).toContain('new.png');
  staleEncode.resolve(jpeg);
  await flush();
  expect(createUrl).toHaveBeenCalledTimes(2);
  expect(right.save.disabled).toBe(true);

  left.select('image/jpeg');
  left.quality('0.24');
  unmount();
  left.select('image/png');
  right.quality('0.56');
  choose('ignored.png', drop);
  pendingOnUnmount.resolve(jpeg);
  await vi.runAllTimersAsync();
  expect(revokeUrl.mock.calls).toEqual([['blob:result-1'], ['blob:result-2']]);
  expect(replacement.close).toHaveBeenCalledOnce();
  expect(canvas.width).toBe(0);
  expect(decode).toHaveBeenCalledTimes(3);
  expect(encode).toHaveBeenCalledTimes(2);
  expect(document.body.childElementCount).toBe(0);
});

function mockScoring() {
  class ScoringWorker {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    terminate = vi.fn();
    postMessage = vi.fn();
    constructor() { workers.push(this); }
    reply(data: unknown) { this.onmessage?.(new MessageEvent('message', { data })); }
  }
  const workers: ScoringWorker[] = [];
  const copy = vi.fn(async () => bitmap());
  vi.stubGlobal('Worker', ScoringWorker);
  vi.stubGlobal('createImageBitmap', copy);
  return { workers, copy };
}

it('OriginalとPNGを説明し、JPEG出力が準備できるまで評価できない', async () => {
  const { choose, evaluate, left, right } = setup();
  const { workers } = mockScoring();
  const preparing = deferred<Blob>();
  vi.mocked(encode).mockReturnValueOnce(preparing.promise);
  choose();
  await flush();
  expect(left.score.textContent).toBe('基準画像');
  await vi.advanceTimersByTimeAsync(799);
  expect(workers).toHaveLength(0);
  preparing.resolve(jpeg);
  await flush();
  expect(evaluate.disabled).toBe(false);
  right.select('image/png');
  await vi.advanceTimersByTimeAsync(800);
  expect(right.score.textContent).toBe('画質評価は未対応');
  expect(evaluate.disabled).toBe(true);
  expect(right.save.disabled).toBe(false);
  expect(workers).toHaveLength(0);
});

it('片側のJPEG変換が失敗しても、出力済みの反対側を採点できる', async () => {
  const { choose, evaluate, left, right } = setup();
  const { workers } = mockScoring();
  choose();
  await flush();
  left.select('image/jpeg');
  await flush();
  const encoding = deferred<Blob>();
  vi.mocked(encode).mockReturnValueOnce(encoding.promise);
  left.quality('0.35');
  await vi.advanceTimersByTimeAsync(180);
  evaluate.click();
  await flush();
  expect(workers).toHaveLength(0);
  encoding.reject(new Error('変換に失敗しました。'));
  await flush();
  expect(left.error.textContent).toContain('変換に失敗');
  expect(right.save.disabled).toBe(false);
  expect(evaluate.disabled).toBe(true);
  expect(workers[0]!.postMessage.mock.calls[0]![0].jpegs).toEqual([jpeg]);
});

it.each([[7, 8, '各辺8 px'], [2048, 2049, '4,194,304画素']])(
  '採点の寸法制限 %i×%i でも通常変換と保存が使える', async (width, height, reason) => {
    const { choose, evaluate, limit, right, download } = setup(bitmap(width, height));
    const { copy, workers } = mockScoring();
    choose();
    await flush();
    expect(limit.textContent).toContain(reason);
    expect(evaluate.disabled).toBe(true);
    evaluate.click();
    await vi.advanceTimersByTimeAsync(800);
    expect(copy).not.toHaveBeenCalled();
    expect(workers).toHaveLength(0);
    right.save.click();
    expect(download).toHaveBeenCalledOnce();
  },
);

it('左右で同じJPEG Blobを採点するのは一度で、別のBlobに変わった側だけ無効にする', async () => {
  const { active, choose, evaluate, left, right, evaluationStatus } = setup();
  const { workers, copy } = mockScoring();
  choose();
  await flush();
  left.select('image/jpeg');
  await flush();
  evaluate.click();
  await flush();
  const [worker] = workers;
  expect(copy).toHaveBeenCalledWith(active);
  const duplicate = await copy.mock.results[0]!.value;
  expect(worker!.postMessage).toHaveBeenCalledWith({ reference: duplicate, jpegs: [jpeg] }, [duplicate]);
  worker!.reply({ index: 0, score: 101.234 });
  await flush();
  expect(left.score.textContent).toBe('SSIMULACRA2: 101.2');
  expect(right.score.textContent).toBe(left.score.textContent);
  expect(worker!.terminate).toHaveBeenCalledOnce();
  expect(evaluationStatus.textContent).toContain('完了');
  expect(evaluate.disabled).toBe(true);

  const changed = new Blob(['changed'], { type: 'image/jpeg' });
  vi.mocked(encode).mockResolvedValueOnce(changed);
  left.quality('0.25');
  expect(left.score.textContent).not.toContain('101.2');
  expect(right.score.textContent).toBe('SSIMULACRA2: 101.2');
  await vi.advanceTimersByTimeAsync(180);
  expect(workers).toHaveLength(1);
  evaluate.click();
  await flush();
  expect(workers[1]!.postMessage.mock.calls[0]![0].jpegs).toEqual([changed]);
  workers[1]!.reply({ index: 0, score: 75 });
  await flush();
  left.quality('0.75');
  await vi.advanceTimersByTimeAsync(800);
  expect(left.score.textContent).toBe(right.score.textContent);
  expect(evaluate.disabled).toBe(true);
  expect(workers).toHaveLength(2);

  choose('new-reference.png');
  await vi.advanceTimersByTimeAsync(800);
  expect(workers[2]!.postMessage.mock.calls[0]![0].jpegs).toEqual([jpeg]);
});

it('中止後に再実行でき、画像切り替えとツール破棄は実行中のWorkerを終了する', async () => {
  const { choose, evaluate, cancel, evaluationStatus, right, unmount } = setup();
  const { workers } = mockScoring();
  choose('first.png');
  await vi.advanceTimersByTimeAsync(800);
  const stale = workers[0]!.onmessage!;
  cancel.click();
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  expect(evaluationStatus.textContent).toContain('中止');
  expect(evaluate.disabled).toBe(false);
  await vi.advanceTimersByTimeAsync(1600);
  expect(workers).toHaveLength(1);

  evaluate.click();
  await flush();
  const oldImage = workers[1]!.onmessage!;
  choose('second.png');
  expect(workers[1]!.terminate).toHaveBeenCalledOnce();
  await flush();
  evaluate.click();
  await flush();
  for (const reply of [stale, oldImage]) reply(new MessageEvent('message', { data: { index: 0, score: 99 } }));
  expect(right.score.textContent).not.toContain('99');
  expect(evaluationStatus.textContent).toContain('評価しています');
  unmount();
  expect(workers[2]!.terminate).toHaveBeenCalledOnce();
});

it('画像の複製待ちに設定が変更されたときは、遅れて届いた複製を解放する', async () => {
  const { choose, evaluate, right } = setup();
  const { workers, copy } = mockScoring();
  const pending = deferred<ImageBitmap>();
  const duplicate = bitmap();
  copy.mockReturnValueOnce(pending.promise);
  choose();
  await flush();
  evaluate.click();
  right.quality('0.32');
  pending.resolve(duplicate);
  await flush();
  expect(duplicate.close).toHaveBeenCalledOnce();
  expect(workers).toHaveLength(0);
});

it('Wasmロード失敗と非有限の結果から復帰し、変換・保存は利用できる', async () => {
  const { choose, evaluate, evaluationStatus, right, download } = setup();
  const { workers } = mockScoring();
  choose();
  await vi.advanceTimersByTimeAsync(800);
  for (const data of [{ error: true }, { index: 0, score: Infinity }]) {
    const worker = workers.at(-1)!;
    worker.reply(data);
    const count = workers.length;
    await vi.advanceTimersByTimeAsync(1600);
    expect(workers).toHaveLength(count);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(evaluationStatus.textContent).toContain('評価できませんでした');
    expect(right.error.textContent).toBe('');
    expect(right.save.disabled).toBe(false);
    evaluate.click();
    await flush();
  }
  right.save.click();
  expect(download).toHaveBeenCalledOnce();
  workers[2]!.reply({ index: 0, score: -14.3 });
  await flush();
  expect(right.score.textContent).toBe('SSIMULACRA2: -14.3');
  expect(evaluationStatus.textContent).toContain('完了');
});

it('初回の画像選択から800msで自動評価を開始する', async () => {
  const { auto, choose, right, evaluationStatus } = setup(bitmap(2048, 2048));
  const { workers } = mockScoring();
  const reading = deferred<ImageBitmap>();
  vi.mocked(decode).mockReturnValueOnce(reading.promise);
  expect(auto.checked).toBe(true);
  choose();
  await vi.advanceTimersByTimeAsync(300);
  reading.resolve(bitmap(2048, 2048));
  await flush();
  expect(right.save.disabled).toBe(false);
  expect(evaluationStatus.textContent).toContain('待機');
  await vi.advanceTimersByTimeAsync(499);
  expect(workers).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(workers).toHaveLength(1);
  expect(evaluationStatus.textContent).toContain('評価しています');
  workers[0]!.reply({ index: 0, score: 82 });
  await flush();
  expect(right.score.textContent).toBe('SSIMULACRA2: 82.0');
});

it('採点中の変更で古いWorkerを止め、連続操作の最後の品質だけを自動評価する', async () => {
  const { choose, left, right, evaluationStatus } = setup();
  const { workers } = mockScoring();
  choose();
  await vi.advanceTimersByTimeAsync(800);
  workers[0]!.reply({ index: 0, score: 85 });
  await flush();

  const first = new Blob(['first']);
  const last = new Blob(['last']);
  vi.mocked(encode).mockResolvedValueOnce(first).mockResolvedValueOnce(last);
  left.select('image/jpeg');
  await flush();
  expect(left.score.textContent).toBe('SSIMULACRA2: 85.0');
  left.quality('0.35');
  expect(left.score.textContent).toBe('');
  await vi.advanceTimersByTimeAsync(800);
  const oldWorker = workers[1]!;
  expect(oldWorker.postMessage.mock.calls[0]![0].jpegs).toEqual([first]);
  const lateReply = oldWorker.onmessage!;

  left.quality('0.45');
  expect(oldWorker.terminate).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(150);
  left.quality('0.55');
  await vi.advanceTimersByTimeAsync(150);
  left.quality('0.65');
  await vi.advanceTimersByTimeAsync(799);
  expect(encode).toHaveBeenCalledTimes(3);
  expect(vi.mocked(encode).mock.lastCall?.[2]).toBe(0.65);
  expect(workers).toHaveLength(2);
  expect(evaluationStatus.textContent).toContain('待機');
  expect(left.score.textContent).toBe('画質は未評価');
  expect(right.score.textContent).toBe('SSIMULACRA2: 85.0');

  await vi.advanceTimersByTimeAsync(1);
  expect(workers[2]!.postMessage.mock.calls[0]![0].jpegs).toEqual([last]);
  lateReply(new MessageEvent('message', { data: { index: 0, score: 42 } }));
  expect(left.score.textContent).toBe('画質は未評価');
  workers[2]!.reply({ index: 0, score: 83 });
  await flush();
  expect(left.score.textContent).toBe('SSIMULACRA2: 83.0');
  expect(right.score.textContent).toBe('SSIMULACRA2: 85.0');
});

it.each(['auto', 'manual'])('JPEGとプレビューの完了を待ってから%s評価する', async mode => {
  const { choose, evaluate, right, evaluationStatus } = setup();
  const { workers } = mockScoring();
  const encoding = deferred<Blob>();
  const preview = deferred<void>();
  vi.mocked(encode).mockReturnValueOnce(encoding.promise);
  right.decodePreview.mockReturnValueOnce(preview.promise);
  choose();
  await flush();
  if (mode === 'manual') evaluate.click();
  await vi.advanceTimersByTimeAsync(mode === 'auto' ? 1000 : 100);
  expect(workers).toHaveLength(0);
  encoding.resolve(jpeg);
  await flush();
  expect(workers).toHaveLength(0);
  expect(evaluationStatus.textContent).toContain('待機');
  preview.resolve(undefined);
  await flush();
  expect(workers).toHaveLength(1);
  expect(workers[0]!.postMessage.mock.calls[0]![0].jpegs).toEqual([jpeg]);
});

it('自動評価をオフにすると待機と実行を止め、手動評価は継続できる', async () => {
  const { auto, choose, evaluate, right, evaluationStatus } = setup();
  const { workers } = mockScoring();
  choose();
  await flush();
  auto.click();
  await vi.advanceTimersByTimeAsync(800);
  expect(workers).toHaveLength(0);
  right.quality('0.25');
  await vi.advanceTimersByTimeAsync(800);
  expect(workers).toHaveLength(0);

  auto.click();
  await vi.advanceTimersByTimeAsync(800);
  expect(workers).toHaveLength(1);
  auto.click();
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(800);
  expect(workers).toHaveLength(1);
  expect(evaluationStatus.textContent).toContain('中止');

  evaluate.click();
  await flush();
  auto.click();
  auto.click();
  expect(workers).toHaveLength(2);
  expect(workers[1]!.terminate).not.toHaveBeenCalled();
  workers[1]!.reply({ index: 0, score: 65 });
  await flush();
  expect(right.score.textContent).toBe('SSIMULACRA2: 65.0');
});

it('待機中の中止は同じ設定で再開せず、入力変更とツール破棄は古い待機を消す', async () => {
  const { choose, cancel, right, evaluationStatus, unmount } = setup();
  const { workers } = mockScoring();
  choose();
  await flush();
  cancel.click();
  await vi.advanceTimersByTimeAsync(800);
  expect(evaluationStatus.textContent).toContain('中止');
  expect(workers).toHaveLength(0);

  right.quality('0.25');
  await vi.advanceTimersByTimeAsync(400);
  choose('replacement.png');
  await vi.advanceTimersByTimeAsync(799);
  expect(workers).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(workers).toHaveLength(1);
  right.quality('0.55');
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  unmount();
  await vi.runAllTimersAsync();
  expect(workers).toHaveLength(1);
});

it('前のWorkerの終了を待って起動し、待機中の中止で古い要求を破棄する', async () => {
  const { choose, right, cancel, evaluationStatus } = setup();
  const { workers, copy } = mockScoring();
  const retiring = deferred<void>();
  const request = vi.fn<(
    name: string, options: { signal: AbortSignal }, callback: () => void,
  ) => Promise<void>>().mockResolvedValue(undefined).mockReturnValueOnce(Promise.resolve()).mockReturnValueOnce(retiring.promise);
  vi.stubGlobal('navigator', { locks: { request } });
  choose();
  await vi.advanceTimersByTimeAsync(800);
  const [name] = request.mock.calls[0]!;
  expect(workers[0]!.postMessage.mock.calls[0]![0].lockName).toBe(name);

  right.quality('0.35');
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(800);
  const [nextName, waiting] = request.mock.calls[1]!;
  expect(nextName).toBe(name);
  expect(evaluationStatus.textContent).toContain('待機');
  expect(workers).toHaveLength(1);
  expect(copy).toHaveBeenCalledOnce();
  cancel.click();
  expect(waiting.signal.aborted).toBe(true);
  retiring.resolve(undefined);
  await vi.advanceTimersByTimeAsync(800);
  expect(workers).toHaveLength(1);
  expect(evaluationStatus.textContent).toContain('中止');

  right.quality('0.25');
  await vi.advanceTimersByTimeAsync(800);
  expect(workers).toHaveLength(2);
});
