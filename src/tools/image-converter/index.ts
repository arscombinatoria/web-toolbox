import { findTool } from '../../registry';
import { decode, encode, sizeChange, type OutputType } from './encoder';
import './style.css';

export function mount(container: HTMLElement): () => void {
  const view = document.createElement('div');
  view.className = 'image-tool';
  view.innerHTML = `
    <h1 tabindex="-1"></h1>
    <p class="tool-description"></p>
    <button type="button" class="image-drop"><strong>画像を選択</strong><span>または、ここへドロップ（JPEG・PNG・WebP）</span></button>
    <input type="file" aria-label="入力画像" accept="image/jpeg,image/png,image/webp" hidden>
    <section hidden aria-label="画像の比較と変換設定">
      <p class="image-info"></p>
      <div class="image-captions"><strong>元画像</strong><strong>変換後</strong></div>
      <div class="image-stage">
        <canvas role="img" aria-label="元画像のプレビュー"></canvas>
        <img alt="変換後のプレビュー" hidden>
        <span class="image-divider" aria-hidden="true"></span>
        <input type="range" class="image-position" min="0" max="100" value="50" aria-label="比較位置">
      </div>
      <div class="image-controls">
        <label>出力形式 <select><option value="image/jpeg">Browser JPEG</option><option value="image/png">Browser PNG</option></select></label>
        <label class="image-quality">JPEG品質 <input type="range" aria-label="JPEG品質" min="0.01" max="1" step="0.01" value="0.75"><span>0.75</span></label>
      </div>
      <p class="image-result"></p>
      <button type="button" class="image-save" disabled>ダウンロード</button>
    </section>
    <p role="status" aria-atomic="true"></p><p role="alert"></p>
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
  const preview = get<HTMLImageElement>('img');
  const position = get<HTMLInputElement>('.image-position');
  const format = get<HTMLSelectElement>('select');
  const qualityLabel = get<HTMLLabelElement>('.image-quality');
  const quality = get<HTMLInputElement>('.image-quality input');
  const result = get('.image-result');
  const save = get<HTMLButtonElement>('.image-save');
  const status = get('[role=status]');
  const alert = get('[role=alert]');
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  let revision = 0;
  let reading: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let source: { file: File; bitmap: ImageBitmap } | undefined;
  let resultUrl: string | undefined;

  function invalidate() {
    ++revision;
    clearTimeout(timer);
    save.disabled = true;
    preview.hidden = true;
    preview.removeAttribute('src');
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = undefined;
    result.textContent = alert.textContent = '';
    return revision;
  }

  function clearSource() {
    reading?.abort();
    reading = undefined;
    source?.bitmap.close();
    source = undefined;
    original.width = original.height = 0;
    section.hidden = true;
  }

  function updatePosition() {
    stage.style.setProperty('--split', position.value + '%');
    position.setAttribute('aria-valuetext', '元画像 ' + position.value + '%');
  }

  async function convert(current: number) {
    if (!source || current !== revision) return;
    const { file, bitmap } = source;
    try {
      const blob = await encode(bitmap, format.value as OutputType, quality.valueAsNumber);
      if (current !== revision) return;
      resultUrl = URL.createObjectURL(blob);
      preview.src = resultUrl;
      await preview.decode();
      if (current !== revision) return;
      preview.hidden = false;
      result.textContent = '変換後 ' + blob.size.toLocaleString('ja-JP') + ' B（' + sizeChange(file.size, blob.size) + '）';
      save.disabled = false;
      status.textContent = '変換しました。';
    } catch (cause) {
      if (current !== revision) return;
      invalidate();
      status.textContent = '';
      alert.textContent = cause instanceof Error && !(cause instanceof DOMException) ? cause.message : '変換結果を表示できませんでした。';
    }
  }

  function updateSettings(delay: number) {
    const current = invalidate();
    qualityLabel.hidden = format.value !== 'image/jpeg';
    get('.image-quality span').textContent = quality.valueAsNumber.toFixed(2);
    status.textContent = '変換しています…';
    timer = setTimeout(() => void convert(current), delay);
  }

  async function selectFiles(files: FileList | null) {
    if (!files?.length) return;
    const current = invalidate();
    clearSource();
    status.textContent = '';
    if (files.length !== 1) {
      alert.textContent = '画像は1枚ずつ選択してください。';
      return;
    }
    const file = files[0]!;
    status.textContent = '画像を読み込んでいます…';
    try {
      reading = new AbortController();
      const bitmap = await decode(file, reading.signal);
      if (current !== revision) { bitmap.close(); return; }
      source = { file, bitmap };
      original.width = bitmap.width;
      original.height = bitmap.height;
      const context = original.getContext('2d');
      if (!context) throw new Error('プレビューを表示できませんでした。');
      context.drawImage(bitmap, 0, 0);
      stage.style.aspectRatio = bitmap.width + ' / ' + bitmap.height;
      position.value = '50';
      updatePosition();
      info.textContent = file.name + ' · ' + bitmap.width + ' × ' + bitmap.height + ' px · 元画像 ' + file.size.toLocaleString('ja-JP') + ' B';
      section.hidden = false;
      updateSettings(0);
    } catch (cause) {
      if (current !== revision) return;
      clearSource();
      status.textContent = '';
      alert.textContent = cause instanceof Error && !(cause instanceof DOMException) ? cause.message : '画像を読み込めませんでした。';
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
  quality.addEventListener('input', () => updateSettings(180), options);
  format.addEventListener('change', () => updateSettings(0), options);
  save.addEventListener('click', () => {
    if (save.disabled || !source || !resultUrl) return;
    const anchor = document.createElement('a');
    anchor.href = resultUrl;
    anchor.download = (source.file.name.replace(/\.[^.]*$/, '') || 'image') + (format.value === 'image/jpeg' ? '.jpg' : '.png');
    view.append(anchor);
    anchor.click();
    anchor.remove();
  }, options);
  container.append(view);
  return () => {
    listeners.abort();
    invalidate();
    clearSource();
    view.remove();
  };
}
