import { Check, CircleAlert, Download, ImagePlus, Minus, Plus, ScanEye, X } from 'lucide';
import { createIcon, setIconMessage } from '../../components/icon';
import { findTool } from '../../registry';
import { decode, encode, encoders, formatFileSize, sizeChange, type EncoderId } from './encoder';
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
const sampleImages = [
  { id: 'red-panda', label: 'レッサーパンダ・写真', dimensions: '1280 × 853 px', filename: 'red-panda.jpg', type: 'image/jpeg', size: '314.62 KB' },
  { id: 'outline', label: '輪郭イラスト', dimensions: '1200 × 900 px', filename: 'outline.png', type: 'image/png', size: '70.22 KB' },
  { id: 'mobile-screen', label: '架空のスマートフォン画面', dimensions: '900 × 1600 px', filename: 'mobile-screen.png', type: 'image/png', size: '80.82 KB' },
  { id: 'geometry', label: '透明な幾何学', dimensions: '1200 × 900 px', filename: 'geometry.png', type: 'image/png', size: '542.94 KB' },
] as const;

type EvaluationMode = 'auto' | 'manual';
type Selection = { generation: number; controller: AbortController; changedAt: number };

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
    <input type="file" aria-label="入力画像" accept="image/jpeg,image/png,image/webp" hidden>
    <p class="image-input-status" role="status" aria-atomic="true"></p>
    <p class="image-input-error" role="alert"></p>
    <div class="image-evaluation-options">
      <label class="image-evaluation-toggle">
        <input type="checkbox" aria-describedby="image-evaluation-cost" checked>画質の自動評価
      </label>
      <p id="image-evaluation-cost" class="image-note">大きい画像の評価には数秒かかり、多くのメモリを使います。</p>
    </div>
    <button type="button" class="image-drop"><strong>画像を選択</strong><span>または、ここへドロップ（JPEG・PNG・WebP）</span></button>
    <section class="image-samples" aria-label="サンプル画像">
      <h2>サンプルで試す</h2>
      <div class="image-sample-list"></div>
    </section>
    <section hidden aria-label="画像の比較と変換設定">
      <div class="image-comparison-area">
        <div class="image-replace"><span>画像をドロップして変更</span><button type="button" class="image-change">画像を変更</button></div>
        <p class="image-info"></p>
        <div class="image-view-tools" role="group" aria-label="表示倍率">
          <button type="button" class="image-zoom-out" aria-label="縮小"></button>
          <button type="button" class="image-zoom-reset" aria-label="表示倍率を100%に戻す（現在 100%）">100%</button>
          <button type="button" class="image-zoom-in" aria-label="拡大"></button>
        </div>
        <div class="image-captions">${sideDefinitions.map(({ id }) => `<strong data-side="${id}"></strong>`).join('')}</div>
        <div class="image-stage" tabindex="0" role="group" aria-label="画像プレビュー。ドラッグまたは矢印キーで移動できます">
          <div class="image-layer image-original-layer"><canvas role="img" aria-label="元画像のプレビュー" hidden></canvas></div>
          ${sideDefinitions.map(({ id, label }) => `<div class="image-layer" data-side="${id}"><img data-side="${id}" alt="${label}側のプレビュー" hidden></div>`).join('')}
          <span class="image-divider" role="slider" tabindex="0" aria-label="比較位置" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" aria-valuetext="左側 50%"><span class="image-divider-handle" aria-hidden="true"></span></span>
        </div>
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
        <details class="image-score-guide">
          <summary>スコアの目安を見る</summary>
          <table>
            <caption>代表値の目安（厳密な区間ではありません）</caption>
            <thead><tr><th scope="col">スコア</th><th scope="col">評価</th></tr></thead>
            <tbody>
              <tr><th scope="row">100</th><td>数学的にロスレス</td></tr>
              <tr><th scope="row">90</th><td>視覚的にロスレス</td></tr>
              <tr><th scope="row">85</th><td>極めて高画質</td></tr>
              <tr><th scope="row">80</th><td>非常に高画質</td></tr>
              <tr><th scope="row">70</th><td>高画質</td></tr>
              <tr><th scope="row">50</th><td>中程度</td></tr>
              <tr><th scope="row">30</th><td>低画質</td></tr>
              <tr><th scope="row">10</th><td>非常に低画質</td></tr>
              <tr><th scope="row">0未満</th><td>極端な画質劣化</td></tr>
            </tbody>
          </table>
          <p>これらは厳密な区間ではなく代表的な目安です。高いほど元画像に近いことを示します。100点満点の採点方式ではありません。</p>
          <p>詳しくは<a href="https://github.com/cloudinary/ssimulacra2#usage">SSIMULACRA2公式の使用方法</a>を参照してください。</p>
        </details>
        <p class="image-evaluation-limit"></p>
        <p class="image-evaluation-status" role="status" aria-atomic="true"></p>
      </div>
    </section>
    <p class="image-note">画像はブラウザ内で処理します。JPEGでは透明部分が白になります。EXIFなどのメタデータは保持されない場合があります。</p>`;
  const get = <T extends Element>(selector: string) => view.querySelector<T>(selector)!;
  const tool = findTool('image-converter')!;
  get('h1').textContent = tool.name;
  get('.tool-description').textContent = tool.description;
  const input = get<HTMLInputElement>('[type=file]');
  const drop = get<HTMLButtonElement>('.image-drop');
  const change = get<HTMLButtonElement>('.image-change');
  change.prepend(createIcon(ImagePlus));
  const section = get<HTMLElement>('.image-tool > section[aria-label="画像の比較と変換設定"]');
  const info = get('.image-info');
  const stage = get<HTMLElement>('.image-stage');
  let original = get<HTMLCanvasElement>('canvas');
  const divider = get<HTMLElement>('.image-divider');
  const zoomOut = get<HTMLButtonElement>('.image-zoom-out');
  const zoomReset = get<HTMLButtonElement>('.image-zoom-reset');
  const zoomIn = get<HTMLButtonElement>('.image-zoom-in');
  zoomOut.append(createIcon(Minus));
  zoomIn.append(createIcon(Plus));
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let imageWidth = 0;
  let imageHeight = 0;
  let pointer: { id: number; x: number; y: number } | undefined;
  let dividerPointerId: number | undefined;
  let position = 50;
  const inputStatus = get('.image-input-status');
  const inputError = get('.image-input-error');
  const sampleList = get('.image-sample-list');
  for (const sample of sampleImages) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'image-sample';
    button.dataset.sample = sample.id;
    button.setAttribute('aria-label', `${sample.label}、${sample.dimensions}、${sample.type === 'image/jpeg' ? 'JPEG' : 'PNG'}、${sample.size}`);
    const thumbnail = document.createElement('img');
    thumbnail.src = `${import.meta.env.BASE_URL}samples/${sample.id}-thumb.${sample.id === 'red-panda' ? 'jpg' : 'png'}`;
    thumbnail.alt = '';
    thumbnail.loading = 'lazy';
    thumbnail.decoding = 'async';
    const title = document.createElement('strong');
    title.textContent = sample.label;
    const detail = document.createElement('span');
    detail.textContent = `${sample.dimensions} · ${sample.type === 'image/jpeg' ? 'JPEG' : 'PNG'} · ${sample.size}`;
    button.append(thumbnail, title, detail);
    sampleList.append(button);
  }
  const autoEvaluation = get<HTMLInputElement>('.image-evaluation-toggle input');
  const evaluate = get<HTMLButtonElement>('.image-evaluate');
  evaluate.prepend(createIcon(ScanEye));
  const cancelEvaluation = get<HTMLButtonElement>('.image-evaluation-cancel');
  cancelEvaluation.prepend(createIcon(X));
  const limitNotice = get('.image-evaluation-limit');
  const evaluationStatus = get('.image-evaluation-status');
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  let inputGeneration = 0;
  let selectionGeneration = 0;
  let reading: Selection | undefined;
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
  for (const side of sides) side.save.prepend(createIcon(Download));

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
    if (evaluationStatus.textContent !== evaluationWaiting) evaluationStatus.textContent = evaluationWaiting;
    updateEvaluation();
    try {
      await evaluateJpegs(
        bitmap, jpegs, controller.signal,
        () => {
          if (isCurrent()) evaluationStatus.textContent = '画質を評価しています…';
        },
        (jpeg, score) => {
          if (!isCurrent() || !sides.some(side => evaluationBlob(side) === jpeg)) return;
          scores.set(jpeg, score);
          updateEvaluation();
        },
      );
      if (isCurrent()) setIconMessage(evaluationStatus, Check, '画質評価が完了しました。');
    } catch (cause) {
      if (isCurrent()) {
        if (cause instanceof DOMException && cause.name === 'AbortError') {
          evaluationStatus.textContent = '画質評価を中止しました。';
        } else {
          setIconMessage(evaluationStatus, CircleAlert, '画質を評価できませんでした。もう一度お試しください。');
        }
      }
    } finally {
      if (isCurrent()) {
        evaluation = undefined;
        updateEvaluation();
      }
    }
  }

  function showOriginal(side: Side, visible: boolean) {
    const layer = get<HTMLElement>('.image-original-layer');
    layer.classList.toggle('image-original-' + side.id, visible);
    const shown = layer.classList.contains('image-original-left') || layer.classList.contains('image-original-right');
    layer.hidden = !shown;
    original.hidden = !shown;
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
    sides.forEach(invalidate);
    source?.bitmap.close();
    source = undefined;
    original.width = original.height = 0;
    updateEvaluation();
  }

  function updatePosition(next: number) {
    position = Math.round(Math.max(0, Math.min(100, next)) * 100) / 100;
    stage.style.setProperty('--split', position + '%');
    divider.setAttribute('aria-valuenow', String(position));
    divider.setAttribute('aria-valuetext', '左側 ' + Number(position.toFixed(1)) + '%');
  }

  function stopDividerDrag(pointerId?: number, releaseCapture = true) {
    if (dividerPointerId === undefined || (pointerId !== undefined && dividerPointerId !== pointerId)) return;
    const activePointerId = dividerPointerId;
    dividerPointerId = undefined;
    divider.classList.remove('is-dragging');
    if (releaseCapture && divider.hasPointerCapture(activePointerId)) divider.releasePointerCapture(activePointerId);
  }

  function moveDivider(clientX: number) {
    const bounds = stage.getBoundingClientRect();
    if (bounds.width > 0) updatePosition((clientX - bounds.left) / bounds.width * 100);
  }

  function clampPan() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    const maxX = Math.max(0, (imageWidth * zoom - width) / 2);
    const maxY = Math.max(0, (imageHeight * zoom - height) / 2);
    panX = Math.max(-maxX, Math.min(maxX, panX));
    panY = Math.max(-maxY, Math.min(maxY, panY));
    stage.style.setProperty('--zoom', String(zoom));
    stage.style.setProperty('--pan-x', panX + 'px');
    stage.style.setProperty('--pan-y', panY + 'px');
    stage.style.touchAction = maxX > 0 && maxY > 0 ? 'none' : maxX > 0 ? 'pan-y' : maxY > 0 ? 'pan-x' : 'auto';
    stage.classList.toggle('can-pan', maxX > 0 || maxY > 0);
  }

  function updateZoomControls() {
    zoomOut.disabled = zoom <= 0.25;
    zoomIn.disabled = zoom >= 4;
    zoomReset.textContent = Math.round(zoom * 100) + '%';
    zoomReset.setAttribute('aria-label', '表示倍率を100%に戻す（現在 ' + Math.round(zoom * 100) + '%）');
  }

  function setZoom(next: number) {
    const bounded = Math.max(0.25, Math.min(4, next));
    const ratio = bounded / zoom;
    panX *= ratio;
    panY *= ratio;
    zoom = bounded;
    clampPan();
    updateZoomControls();
  }

  function resetView() {
    zoom = 1;
    panX = panY = 0;
    updatePosition(50);
    clampPan();
    updateZoomControls();
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
      side.output.textContent = '出力サイズ ' + formatFileSize(blob.size) + '（元ファイル比 ' + sizeChange(file.size, blob.size) + '）';
      side.save.disabled = false;
      updateEvaluation();
    } catch (cause) {
      if (!isCurrent()) return;
      invalidate(side);
      side.result = { status: 'failed' };
      const message = cause instanceof Error && !(cause instanceof DOMException) ? cause.message : '変換結果を表示できませんでした。';
      setIconMessage(side.error, CircleAlert, side.label + '側：' + message);
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

  function beginSelection(): Selection {
    stopDividerDrag();
    reading?.controller.abort();
    const selection = { generation: ++selectionGeneration, controller: new AbortController(), changedAt: performance.now() };
    reading = selection;
    inputError.textContent = '';
    inputStatus.textContent = '画像を読み込んでいます…';
    return selection;
  }

  function selectionIsCurrent(selection: Selection): boolean {
    return reading === selection && selection.generation === selectionGeneration;
  }

  async function selectFiles(files: readonly File[] | null, selection: Selection = beginSelection()) {
    if (!selectionIsCurrent(selection)) return;
    if (!files?.length) {
      reading = undefined;
      inputStatus.textContent = '';
      return;
    }
    inputError.textContent = '';
    if (files.length !== 1) {
      reading = undefined;
      inputStatus.textContent = '';
      setIconMessage(inputError, CircleAlert, '画像は1枚ずつ選択してください。');
      return;
    }
    const file = files[0]!;
    if (file.type && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      reading = undefined;
      inputStatus.textContent = '';
      setIconMessage(inputError, CircleAlert, 'JPEG・PNG・WebPの画像を選択してください。');
      return;
    }
    const changedAt = selection.changedAt;
    const { controller } = selection;

    let bitmap: ImageBitmap | undefined;
    let preview: HTMLCanvasElement | undefined;
    try {
      bitmap = await decode(file, controller.signal);
      if (!selectionIsCurrent(selection)) {
        bitmap.close();
        return;
      }
      // 描画できることを確認してから、表示中のCanvasと処理を切り替える。
      preview = original.cloneNode(false) as HTMLCanvasElement;
      preview.hidden = true;
      preview.width = bitmap.width;
      preview.height = bitmap.height;
      const context = preview.getContext('2d');
      if (!context) throw new Error('プレビューを表示できませんでした。');
      context.drawImage(bitmap, 0, 0);
    } catch (cause) {
      bitmap?.close();
      if (preview) preview.width = preview.height = 0;
      if (!selectionIsCurrent(selection)) return;
      reading = undefined;
      inputStatus.textContent = '';
      setIconMessage(inputError, CircleAlert, cause instanceof Error && !(cause instanceof DOMException) ? cause.message : '画像を読み込めませんでした。');
      return;
    }

    if (!selectionIsCurrent(selection)) {
      bitmap.close();
      if (preview) preview.width = preview.height = 0;
      return;
    }
    reading = undefined;
    ++inputGeneration;
    clearSource();
    source = { file, bitmap };
    original.replaceWith(preview);
    original = preview;
    stage.style.aspectRatio = bitmap.width + ' / ' + bitmap.height;
    imageWidth = bitmap.width;
    imageHeight = bitmap.height;
    stage.style.setProperty('--image-width', bitmap.width + 'px');
    stage.style.setProperty('--image-height', bitmap.height + 'px');
    stopDividerDrag();
    if (pointer && stage.hasPointerCapture(pointer.id)) stage.releasePointerCapture(pointer.id);
    pointer = undefined;
    resetView();
    info.textContent = file.name + ' · ' + bitmap.width + ' × ' + bitmap.height + ' px · 元ファイル ' + formatFileSize(file.size);
    inputStatus.textContent = inputError.textContent = '';
    const moveFocus = document.activeElement === drop;
    resetInitialDrag();
    drop.hidden = true;
    section.hidden = false;
    if (moveFocus) change.focus({ preventScroll: true });
    for (const side of sides) convertSide(side);
    if (autoEvaluation.checked) requestEvaluation('auto', changedAt);
  }

  async function loadSample(sampleId: string) {
    const sample = sampleImages.find(candidate => candidate.id === sampleId);
    if (!sample) return;
    const selection = beginSelection();
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}samples/${sample.filename}`, { signal: selection.controller.signal });
      if (!selectionIsCurrent(selection)) return;
      if (!response.ok) throw new Error(`サンプル画像を取得できませんでした（${response.status}）。`);
      const blob = await response.blob();
      if (!selectionIsCurrent(selection)) return;
      const file = new File([blob], sample.filename, { type: sample.type });
      await selectFiles([file], selection);
    } catch (cause) {
      if (!selectionIsCurrent(selection)) return;
      reading = undefined;
      inputStatus.textContent = '';
      setIconMessage(inputError, CircleAlert, cause instanceof Error && !(cause instanceof DOMException) ? cause.message : 'サンプル画像を読み込めませんでした。');
    }
  }

  function hasFiles(event: DragEvent) {
    return event.dataTransfer?.types.includes('Files') ?? false;
  }

  function addDropHandlers(target: HTMLElement) {
    let depth = 0;
    const reset = () => {
      depth = 0;
      target.classList.remove('is-over');
    };
    target.addEventListener('dragenter', event => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth++;
      target.classList.add('is-over');
    }, options);
    target.addEventListener('dragover', event => {
      if (!event.dataTransfer || !hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      // After the initial zone switches to the comparison, dragover can arrive first.
      if (!depth) {
        depth = 1;
        target.classList.add('is-over');
      }
    }, options);
    target.addEventListener('dragleave', () => {
      if (depth && --depth === 0) reset();
    }, options);
    target.addEventListener('drop', event => {
      if (!hasFiles(event) && !event.dataTransfer?.files.length) return;
      event.preventDefault();
      reset();
      void selectFiles(event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : null);
    }, options);
    return reset;
  }

  const resetInitialDrag = addDropHandlers(drop);
  addDropHandlers(get<HTMLElement>('.image-comparison-area'));
  drop.addEventListener('click', () => input.click(), options);
  change.addEventListener('click', () => input.click(), options);
  input.addEventListener('change', () => { void selectFiles(input.files ? Array.from(input.files) : null); input.value = ''; }, options);
  sampleList.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('.image-sample');
    if (button) void loadSample(button.dataset.sample ?? '');
  }, options);
  zoomOut.addEventListener('click', () => setZoom(zoom - 0.25), options);
  zoomIn.addEventListener('click', () => setZoom(zoom + 0.25), options);
  zoomReset.addEventListener('click', () => setZoom(1), options);
  stage.addEventListener('pointerdown', event => {
    if (!source || pointer || event.target === divider || divider.contains(event.target as Node) || !event.isPrimary || event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    stage.setPointerCapture(event.pointerId);
    stage.focus({ preventScroll: true });
  }, options);
  stage.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    panX += event.clientX - pointer.x;
    panY += event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    clampPan();
  }, options);
  const stopPan = (event: PointerEvent) => {
    if (pointer?.id === event.pointerId) pointer = undefined;
  };
  stage.addEventListener('pointerup', stopPan, options);
  stage.addEventListener('pointercancel', stopPan, options);
  stage.addEventListener('lostpointercapture', stopPan, options);
  stage.addEventListener('keydown', event => {
    const step = event.shiftKey ? 50 : 10;
    if (event.key === 'ArrowLeft') panX -= step;
    else if (event.key === 'ArrowRight') panX += step;
    else if (event.key === 'ArrowUp') panY -= step;
    else if (event.key === 'ArrowDown') panY += step;
    else return;
    event.preventDefault();
    clampPan();
  }, options);
  divider.addEventListener('pointerdown', event => {
    if (!source || dividerPointerId !== undefined || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    dividerPointerId = event.pointerId;
    divider.setPointerCapture(event.pointerId);
    divider.classList.add('is-dragging');
    divider.focus({ preventScroll: true });
    moveDivider(event.clientX);
  }, options);
  divider.addEventListener('pointermove', event => {
    if (dividerPointerId !== event.pointerId) return;
    moveDivider(event.clientX);
  }, options);
  divider.addEventListener('pointerup', event => stopDividerDrag(event.pointerId), options);
  divider.addEventListener('pointercancel', event => stopDividerDrag(event.pointerId), options);
  divider.addEventListener('lostpointercapture', event => stopDividerDrag(event.pointerId, false), options);
  divider.addEventListener('keydown', event => {
    const step = event.shiftKey ? 10 : 1;
    if (event.key === 'ArrowLeft') updatePosition(position - step);
    else if (event.key === 'ArrowRight') updatePosition(position + step);
    else if (event.key === 'Home') updatePosition(0);
    else if (event.key === 'End') updatePosition(100);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }, options);
  const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(clampPan);
  resizeObserver?.observe(stage);
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
    resizeObserver?.disconnect();
    stopDividerDrag();
    if (pointer && stage.hasPointerCapture(pointer.id)) stage.releasePointerCapture(pointer.id);
    pointer = undefined;
    reading?.controller.abort();
    reading = undefined;
    ++inputGeneration;
    clearSource();
    view.remove();
  };
}
