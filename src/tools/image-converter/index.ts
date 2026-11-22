import { findTool } from '../../registry';
import { decode, encode, encoders, sizeChange, type EncoderId } from './encoder';
import { evaluateJpegs } from './quality/client';
import { evaluationLimit, isEvaluable } from './quality/rules';
import './style.css';

const sideDefinitions = [
  { id: 'left', label: '左', initialEncoder: 'original' },
  { id: 'right', label: '右', initialEncoder: 'image/jpeg' },
] as const;
const initialQuality = 0.75;
const autoEvaluationDelay = 800;
const evaluationWaiting = '画質評価を待機しています…';

type EvaluationMode = 'auto' | 'manual';

type SideResult =
  | { status: 'idle' | 'failed' }
  | { status: 'pending'; encoding?: Promise<Blob> }
  | { status: 'ready'; blob: Blob; filename: string };

export function mount(container: HTMLElement): () => void {
  const view = document.createElement('div');
  view.className = 'image-tool';
  view.innerHTML = `
    <h1 tabindex="-1"></h1>
    <p class="tool-description"></p>
    <button type="button" class="image-drop"><strong>画像を選択</strong><span>または、ここへドロップ（JPEG・PNG・WebP）</span></button>
    <input type="file" aria-label="入力画像" accept="image/jpeg,image/png,image/webp" hidden>
    <div class="image-evaluation-options">
      <label class="image-evaluation-toggle">
        <input type="checkbox" aria-describedby="image-evaluation-cost" checked>画質の自動評価
      </label>
      <p id="image-evaluation-cost" class="image-note">大きい画像の評価には数秒かかり、多くのメモリを使います。</p>
    </div>
    <section hidden aria-label="画像の比較と変換設定">
      <p class="image-info"></p>
      <div class="image-captions">${sideDefinitions.map(({ id }) => `<strong data-side="${id}"></strong>`).join('')}</div>
      <div class="image-stage">
        <canvas role="img" aria-label="元画像のプレビュー" hidden></canvas>
        ${sideDefinitions.map(({ id, label }) => `<img data-side="${id}" alt="${label}側のプレビュー" hidden>`).join('')}
        <span class="image-divider" aria-hidden="true"></span>
        <input type="range" class="image-position" min="0" max="100" value="50" aria-label="比較位置">
      </div>
      <div class="image-controls">
        ${sideDefinitions.map(({ id, label, initialEncoder }) => `
          <fieldset class="image-panel" data-side="${id}">
            <legend>${label}の設定</legend>
            <label>${label}の形式 <select>
              ${Object.entries(encoders).map(([key, { label }]) => `<option value="${key}"${key === initialEncoder ? ' selected' : ''}>${label}</option>`).join('')}
            </select></label>
            <label class="image-quality" ${encoders[initialEncoder].hasQuality ? '' : 'hidden'}>
              JPEG品質 <input type="range" aria-label="${label}のJPEG品質" min="0.01" max="1" step="0.01" value="${initialQuality}">
              <span>${initialQuality.toFixed(2)}</span>
            </label>
            <p class="image-result" role="status" aria-atomic="true"></p>
            <p class="image-score" aria-live="polite" aria-atomic="true"></p>
            <p class="image-error" role="alert"></p>
            <button type="button" class="image-save" disabled>${label}をダウンロード</button>
          </fieldset>
        `).join('')}
      </div>
      <div class="image-evaluation">
        <div class="image-evaluation-actions">
          <button type="button" class="image-evaluate" disabled>画質を評価</button>
          <button type="button" class="image-evaluation-cancel" disabled>評価を中止</button>
        </div>
        <p class="image-note">SSIMULACRA2は、元画像との見た目の近さを示す参考スコアです。透明部分は白背景で比較します。</p>
        <p class="image-evaluation-limit"></p>
        <p class="image-evaluation-status" role="status" aria-atomic="true"></p>
      </div>
    </section>
    <p class="image-input-status" role="status" aria-atomic="true"></p>
    <p class="image-input-error" role="alert"></p>
    <p class="image-note">画像はブラウザ内で処理します。JPEGでは透明部分が白になります。EXIFなどのメタデータは保持されない場合があります。</p>`;
  const get = <T extends Element>(selector: string) => view.querySelector<T>(selector)!;
  const tool = findTool('image-converter')!;
  get('h1').textContent = tool.name;
  get('.tool-description').textContent = tool.description;
  const input = get<HTMLInputElement>('[type=file]');
  const drop = get<HTMLButtonElement>('.image-drop');
  const section = get<HTMLElement>('section');
  const info = get('.image-info');
  const stage = get<HTMLElement>('.image-stage');
  const original = get<HTMLCanvasElement>('canvas');
  const position = get<HTMLInputElement>('.image-position');
  const inputStatus = get('.image-input-status');
  const inputError = get('.image-input-error');
  const autoEvaluation = get<HTMLInputElement>('.image-evaluation-toggle input');
  const evaluate = get<HTMLButtonElement>('.image-evaluate');
  const cancelEvaluation = get<HTMLButtonElement>('.image-evaluation-cancel');
  const limitNotice = get('.image-evaluation-limit');
  const evaluationStatus = get('.image-evaluation-status');
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  let inputGeneration = 0;
  let reading: AbortController | undefined;
  let source: { file: File; bitmap: ImageBitmap } | undefined;
  let evaluation: { controller: AbortController; mode: EvaluationMode } | undefined;
  let requestedEvaluation: { mode: EvaluationMode; readyAt: number } | undefined;
  let evaluationTimer: ReturnType<typeof setTimeout> | undefined;
  let scores = new WeakMap<Blob, number>();

  function createSide({ id, label, initialEncoder }: typeof sideDefinitions[number]) {
    const panel = get<HTMLFieldSetElement>(`.image-panel[data-side="${id}"]`);
    return {
      id,
      label,
      encoder: initialEncoder as EncoderId,
      quality: initialQuality,
      generation: 0,
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
      result: { status: 'idle' } as SideResult,
      url: undefined as string | undefined,
      caption: get(`.image-captions [data-side="${id}"]`),
      preview: get<HTMLImageElement>(`img[data-side="${id}"]`),
      format: panel.querySelector<HTMLSelectElement>('select')!,
      qualityLabel: panel.querySelector<HTMLLabelElement>('.image-quality')!,
      qualityInput: panel.querySelector<HTMLInputElement>('.image-quality input')!,
      qualityValue: panel.querySelector('.image-quality span')!,
      output: panel.querySelector('.image-result')!,
      error: panel.querySelector('.image-error')!,
      score: panel.querySelector('.image-score')!,
      save: panel.querySelector<HTMLButtonElement>('.image-save')!,
    };
  }

  type Side = ReturnType<typeof createSide>;
  const [left, right] = [createSide(sideDefinitions[0]), createSide(sideDefinitions[1])];
  const sides = [left, right];

  function evaluationBlob(side: Side): Blob | undefined {
    if (isEvaluable(side.encoder) && side.result.status === 'ready') return side.result.blob;
  }

  function unevaluatedJpegs(): Blob[] {
    const blobs = new Set<Blob>();
    for (const side of sides) {
      const blob = evaluationBlob(side);
      if (blob && !scores.has(blob)) blobs.add(blob);
    }
    return [...blobs];
  }

  function updateEvaluation() {
    const currentSource = source;
    const limit = currentSource && evaluationLimit(currentSource.bitmap.width, currentSource.bitmap.height);
    limitNotice.textContent = limit ?? '';
    const converting = sides.some(side => isEvaluable(side.encoder) && side.result.status === 'pending');
    const jpegs = unevaluatedJpegs();
    const canEvaluate = currentSource && !limit && (converting || jpegs.length > 0);
    if (!canEvaluate && requestedEvaluation) {
      clearEvaluationRequest();
      if (evaluationStatus.textContent === evaluationWaiting) evaluationStatus.textContent = '';
    }
    evaluate.disabled = !canEvaluate || !!evaluation || requestedEvaluation?.mode === 'manual';
    cancelEvaluation.disabled = !evaluation && !requestedEvaluation;
    for (const side of sides) {
      const blob = evaluationBlob(side);
      const score = blob ? scores.get(blob) : undefined;
      const message = side.encoder === 'original' ? '基準画像' :
        !isEvaluable(side.encoder) ? '画質評価は未対応' :
        score !== undefined ? 'SSIMULACRA2: ' + score.toFixed(1) :
        blob && !limit ? '画質は未評価' : '';
      if (side.score.textContent !== message) side.score.textContent = message;
    }

    if (evaluation || !requestedEvaluation || !currentSource) return;
    const remaining = requestedEvaluation.readyAt - performance.now();
    if (!converting && remaining <= 0) {
      const { mode } = requestedEvaluation;
      clearEvaluationRequest();
      void startEvaluation(mode, currentSource.bitmap, jpegs, inputGeneration);
      return;
    }
    if (evaluationStatus.textContent !== evaluationWaiting) evaluationStatus.textContent = evaluationWaiting;
    // JPEG変換が済んでから、自動評価に必要な残りの待機時間だけを計る。
    if (!converting && evaluationTimer === undefined) {
      evaluationTimer = setTimeout(() => {
        evaluationTimer = undefined;
        updateEvaluation();
      }, Math.ceil(remaining));
    }
  }

  function clearEvaluationRequest() {
    clearTimeout(evaluationTimer);
    evaluationTimer = undefined;
    requestedEvaluation = undefined;
  }

  function requestEvaluation(mode: EvaluationMode, changedAt = performance.now()) {
    clearEvaluationRequest();
    requestedEvaluation = { mode, readyAt: changedAt + (mode === 'auto' ? autoEvaluationDelay : 0) };
    updateEvaluation();
  }

  function stopEvaluation(message = '') {
    clearEvaluationRequest();
    const running = evaluation;
    evaluation = undefined;
    running?.controller.abort();
    evaluationStatus.textContent = message;
  }

  async function startEvaluation(mode: EvaluationMode, bitmap: ImageBitmap, jpegs: Blob[], generation: number) {
    const controller = new AbortController();
    const job = { controller, mode };
    const isCurrent = () => evaluation === job && generation === inputGeneration;
    evaluation = job;
    evaluationStatus.textContent = '画質を評価しています…';
    updateEvaluation();
    try {
      await evaluateJpegs(bitmap, jpegs, controller.signal, (jpeg, score) => {
        if (!isCurrent() || !sides.some(side => evaluationBlob(side) === jpeg)) return;
        scores.set(jpeg, score);
        updateEvaluation();
      });
      if (isCurrent()) evaluationStatus.textContent = '画質評価が完了しました。';
    } catch (cause) {
      if (isCurrent()) {
        evaluationStatus.textContent = cause instanceof DOMException && cause.name === 'AbortError' ?
          '画質評価を中止しました。' : '画質を評価できませんでした。もう一度お試しください。';
      }
    } finally {
      if (isCurrent()) {
        evaluation = undefined;
        updateEvaluation();
      }
    }
  }

  function showOriginal(side: Side, visible: boolean) {
    original.classList.toggle('image-original-' + side.id, visible);
    original.hidden = original.classList.length === 0;
  }

  function invalidate(side: Side) {
    ++side.generation;
    clearTimeout(side.timer);
    side.timer = undefined;
    side.result = { status: 'idle' };
    side.save.disabled = true;
    side.preview.hidden = true;
    side.preview.removeAttribute('src');
    showOriginal(side, false);
    if (side.url) URL.revokeObjectURL(side.url);
    side.url = undefined;
    side.output.textContent = side.error.textContent = '';
  }

  function clearSource() {
    stopEvaluation();
    scores = new WeakMap();
    reading?.abort();
    reading = undefined;
    sides.forEach(invalidate);
    source?.bitmap.close();
    source = undefined;
    original.width = original.height = 0;
    section.hidden = true;
    updateEvaluation();
  }

  function updatePosition() {
    stage.style.setProperty('--split', position.value + '%');
    position.setAttribute('aria-valuetext', '左側 ' + position.value + '%');
  }

  function showSettings(side: Side) {
    const encoder = encoders[side.encoder];
    side.caption.textContent = side.label + ' · ' + encoder.label;
    side.qualityLabel.hidden = !encoder.hasQuality;
    side.qualityValue.textContent = side.quality.toFixed(2);
  }

  async function convert(side: Side, currentInput: number, currentSide: number) {
    const isCurrent = () => currentInput === inputGeneration && currentSide === side.generation;
    if (!source || !isCurrent()) return;
    const { file, bitmap } = source;
    const { type, extension, hasQuality } = encoders[side.encoder];
    const other = side === left ? right : left;
    try {
      let blob: Blob = file;
      let filename = file.name;
      if (type) {
        let encoding: Promise<Blob> | undefined;
        // 設定が一致する間は、もう片側の変換処理か成功済みのBlobを共有する。
        if (side.encoder === other.encoder && (!hasQuality || side.quality === other.quality)) {
          if (other.result.status === 'ready') encoding = Promise.resolve(other.result.blob);
          if (other.result.status === 'pending') encoding = other.result.encoding;
        }
        encoding ??= encode(bitmap, type, side.quality);
        side.result = { status: 'pending', encoding };
        const stem = file.name.replace(/\.[^.]*$/, '') || 'image';
        const qualitySuffix = hasQuality ? '-q' + side.quality.toFixed(2) : '';
        filename = stem + '-' + side.id + qualitySuffix + extension;
        blob = await encoding;
        if (!isCurrent()) return;
      }
      side.url = URL.createObjectURL(blob);
      if (type) {
        side.preview.src = side.url;
        await side.preview.decode();
        if (!isCurrent()) return;
        side.preview.hidden = false;
      } else {
        showOriginal(side, true);
      }
      side.result = { status: 'ready', blob, filename };
      side.output.textContent = '出力サイズ ' + blob.size.toLocaleString('ja-JP') + ' B（元ファイル比 ' + sizeChange(file.size, blob.size) + '）';
      side.save.disabled = false;
      updateEvaluation();
    } catch (cause) {
      if (!isCurrent()) return;
      invalidate(side);
      side.result = { status: 'failed' };
      const message = cause instanceof Error && !(cause instanceof DOMException) ? cause.message : '変換結果を表示できませんでした。';
      side.error.textContent = side.label + '側：' + message;
      updateEvaluation();
    }
  }

  function convertSide(side: Side, delay = 0) {
    invalidate(side);
    showSettings(side);
    if (!source) return;
    const currentInput = inputGeneration;
    const currentSide = side.generation;
    side.result = { status: 'pending' };
    side.output.textContent = '変換しています…';
    updateEvaluation();
    if (delay === 0) {
      void convert(side, currentInput, currentSide);
    } else {
      side.timer = setTimeout(() => {
        side.timer = undefined;
        void convert(side, currentInput, currentSide);
      }, delay);
    }
  }

  function updateSettings(side: Side, delay = 0) {
    const changedAt = performance.now();
    stopEvaluation(evaluation ? '設定が変わったため画質評価を中止しました。' : '');
    convertSide(side, delay);
    if (source && autoEvaluation.checked) requestEvaluation('auto', changedAt);
  }

  async function selectFiles(files: FileList | null) {
    if (!files?.length) return;
    const changedAt = performance.now();
    const currentInput = ++inputGeneration;
    clearSource();
    inputStatus.textContent = inputError.textContent = '';
    if (files.length !== 1) {
      inputError.textContent = '画像は1枚ずつ選択してください。';
      return;
    }
    const file = files[0]!;
    inputStatus.textContent = '画像を読み込んでいます…';
    try {
      reading = new AbortController();
      const bitmap = await decode(file, reading.signal);
      if (currentInput !== inputGeneration) { bitmap.close(); return; }
      reading = undefined;
      source = { file, bitmap };
      original.width = bitmap.width;
      original.height = bitmap.height;
      const context = original.getContext('2d');
      if (!context) throw new Error('プレビューを表示できませんでした。');
      context.drawImage(bitmap, 0, 0);
      stage.style.aspectRatio = bitmap.width + ' / ' + bitmap.height;
      position.value = '50';
      updatePosition();
      info.textContent = file.name + ' · ' + bitmap.width + ' × ' + bitmap.height + ' px · 元ファイル ' + file.size.toLocaleString('ja-JP') + ' B';
      inputStatus.textContent = '';
      section.hidden = false;
      for (const side of sides) convertSide(side);
      if (autoEvaluation.checked) requestEvaluation('auto', changedAt);
    } catch (cause) {
      if (currentInput !== inputGeneration) return;
      clearSource();
      inputStatus.textContent = '';
      inputError.textContent = cause instanceof Error && !(cause instanceof DOMException) ? cause.message : '画像を読み込めませんでした。';
    }
  }

  drop.addEventListener('click', () => input.click(), options);
  input.addEventListener('change', () => { void selectFiles(input.files); input.value = ''; }, options);
  drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('is-over'); }, options);
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'), options);
  drop.addEventListener('drop', event => {
    event.preventDefault();
    drop.classList.remove('is-over');
    void selectFiles(event.dataTransfer?.files ?? null);
  }, options);
  position.addEventListener('input', updatePosition, options);
  autoEvaluation.addEventListener('change', () => {
    if (autoEvaluation.checked) {
      if (!evaluation && !requestedEvaluation) requestEvaluation('auto');
    } else if (evaluation?.mode === 'auto' || requestedEvaluation?.mode === 'auto') {
      stopEvaluation('画質評価を中止しました。');
      updateEvaluation();
    }
  }, options);
  evaluate.addEventListener('click', () => { requestEvaluation('manual'); }, options);
  cancelEvaluation.addEventListener('click', () => {
    stopEvaluation('画質評価を中止しました。');
    updateEvaluation();
  }, options);
  for (const side of sides) {
    showSettings(side);
    side.format.addEventListener('change', () => {
      const encoder = side.format.value as EncoderId;
      if (encoder === side.encoder) return;
      side.encoder = encoder;
      updateSettings(side);
    }, options);
    side.qualityInput.addEventListener('input', () => {
      if (!encoders[side.encoder].hasQuality || side.quality === side.qualityInput.valueAsNumber) return;
      side.quality = side.qualityInput.valueAsNumber;
      updateSettings(side, 180);
    }, options);
    side.save.addEventListener('click', () => {
      if (side.result.status !== 'ready' || !side.url) return;
      const anchor = document.createElement('a');
      anchor.href = side.url;
      anchor.download = side.result.filename;
      view.append(anchor);
      anchor.click();
      anchor.remove();
    }, options);
  }
  container.append(view);
  return () => {
    listeners.abort();
    ++inputGeneration;
    clearSource();
    view.remove();
  };
}
