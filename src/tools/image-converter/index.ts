import { Check, CircleAlert, Download, Image, ImageOff, ImagePlus, Minus, Plus, ScanEye, X } from 'lucide';
import { createIcon, setIconMessage } from '../../components/icon';
import { findTool } from '../../registry';
import { decode, encode, encoders, formatFileSize, inputMimeTypes, sizeChange, supportedInputMessage, type EncoderId } from './encoder';
import { encodeOxipng } from './oxipng/client';
import { defaultOxipngOptions, oxipngKey, validateOxipngOptions, type OxipngOptions } from './oxipng/options';
import { encodeAvif } from './avif/client';
import { avifFilename, avifKey, defaultAvifOptions, effectiveAvifOptions, isAvifLossless, validateAvifOptions, type AvifOptions } from './avif/options';
import { encodeMozjpeg } from './mozjpeg/client';
import { defaultMozjpegOptions, effectiveMozjpegOptions, mozjpegFilename, mozjpegKey, validateMozjpegOptions, type MozjpegOptions } from './mozjpeg/options';
import { encodeJpegli } from './jpegli/client';
import { defaultJpegliOptions, effectiveJpegliOptions, jpegliFilename, jpegliKey, validateJpegliOptions, type JpegliOptions } from './jpegli/options';
import { encodeWebp } from './webp/client';
import { defaultWebpOptions, effectiveWebpOptions, validateWebpOptions, webpFilename, webpKey, type WebpOptions } from './webp/options';
import { encodeJxl } from './jxl/client';
import { defaultJxlOptions, effectiveJxlOptions, jxlFilename, jxlKey, validateJxlOptions, type JxlOptions } from './jxl/options';
import { encodeJp2, type Jp2Result } from './jp2/client';
import { defaultJp2Options, effectiveJp2Options, jp2Filename, jp2Key, validateJp2Options, type Jp2Options } from './jp2/options';
import { detectJxlSupport } from './jxl/support';
import { evaluateImages } from './quality/client';
import { evaluationLimit, isEvaluable, MIN_EVALUATION_SIDE } from './quality/rules';
import './style.css';

const sideDefinitions = [
  { id: 'left', label: '左', initialEncoder: 'original' },
  { id: 'right', label: '右', initialEncoder: 'image/jpeg' },
] as const;
const orderedEncoders = Object.entries(encoders).sort(([aId, a], [bId, b]) => {
  if (aId === bId) return 0;
  if (aId === 'original') return -1;
  if (bId === 'original') return 1;
  return a.label.localeCompare(b.label, 'en');
});
const initialQuality = 0.75;
const initialAvifOptions = defaultAvifOptions;
const autoEvaluationDelay = 800;
const evaluationWaiting = '画質評価を待機しています…';
const jxlEvaluationUnavailable = 'このブラウザではJPEG XLの画質評価を利用できません。';
const sampleImages = [
  { id: 'red-panda', label: 'レッサーパンダ・写真', dimensions: '3840 × 2560 px', filename: 'red-panda.jpg', type: 'image/jpeg', size: '3.87 MB' },
  { id: 'outline', label: '輪郭イラスト', dimensions: '1200 × 900 px', filename: 'outline.png', type: 'image/png', size: '70.22 KB' },
  { id: 'mobile-screen', label: '架空のスマートフォン画面', dimensions: '900 × 1600 px', filename: 'mobile-screen.png', type: 'image/png', size: '80.82 KB' },
  { id: 'geometry', label: '透明な幾何学', dimensions: '1200 × 900 px', filename: 'geometry.png', type: 'image/png', size: '542.94 KB' },
] as const;

type EvaluationMode = 'auto' | 'manual';
type Selection = { generation: number; controller: AbortController; changedAt: number };

type SideResult =
  | { status: 'idle' | 'failed' | 'cancelled' }
  | { status: 'pending'; encoding?: Promise<Blob> }
  | { status: 'ready'; blob: Blob; filename: string; bitmap?: ImageBitmap };

export function mount(container: HTMLElement): () => void {
  const view = document.createElement('div');
  view.className = 'image-tool';
  view.innerHTML = `
    <h1 tabindex="-1"></h1>
    <p class="tool-description"></p>
    <input type="file" aria-label="入力画像" accept="${[...inputMimeTypes, '.jxl', '.jp2', '.j2k', '.j2c'].join(',')}" hidden>
    <section class="image-samples" aria-label="サンプル画像">
      <h2>サンプルで試す</h2>
      <div class="image-sample-list"></div>
    </section>
    <p class="image-input-status" role="status" aria-atomic="true"></p>
    <p class="image-input-error" role="alert"></p>
    <button type="button" class="image-drop"><strong>画像を選択</strong><span>または、ここへドロップ（JPEG・PNG・WebP・AVIF・JPEG XL・JPEG 2000）</span></button>
    <p class="image-note image-jxl-compatibility" role="status" hidden></p>
    <section hidden aria-label="画像の比較と変換設定">
      <div class="image-comparison-area">
        <div class="image-replace">
          <p class="image-info"><strong class="image-filename"></strong><span class="image-file-details"></span></p>
          <button type="button" class="image-change" aria-describedby="image-drop-hint">画像を変更</button>
          <span id="image-drop-hint" class="image-drop-hint">比較エリアへのドロップでも変更できます</span>
        </div>
        <div class="image-stage" tabindex="0" role="group" aria-label="画像プレビュー。ドラッグまたは矢印キーで移動できます">
          <div class="image-layer image-original-layer"><canvas role="img" aria-label="元画像のプレビュー" hidden></canvas></div>
          ${sideDefinitions.map(({ id, label }) => `<div class="image-layer" data-side="${id}"><img data-side="${id}" alt="${label}側のプレビュー" hidden></div>`).join('')}
          <div class="image-captions">${sideDefinitions.map(({ id }) => `<strong data-side="${id}"></strong>`).join('')}</div>
          <span class="image-divider" role="slider" tabindex="0" aria-label="比較位置" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" aria-valuetext="左側 50%"><span class="image-divider-handle" aria-hidden="true"></span></span>
        </div>
        <div class="image-view-tools" role="group" aria-label="表示倍率">
          <button type="button" class="image-zoom-out" aria-label="縮小"></button>
          <button type="button" class="image-zoom-reset" aria-label="表示倍率を100%に戻す（現在 100%）">100%</button>
          <button type="button" class="image-zoom-in" aria-label="拡大"></button>
        </div>
      </div>
      <div class="image-controls">
        ${sideDefinitions.map(({ id, label, initialEncoder }) => `
          <fieldset class="image-panel" data-side="${id}">
            <legend>${label}の設定</legend>
            <div class="image-panel-content">
              <label>出力形式 <select aria-label="${label}の出力形式">
                ${orderedEncoders.map(([key, { label }]) => `<option value="${key}"${key === initialEncoder ? ' selected' : ''}${key === 'image/jxl' ? ' disabled' : ''}>${label}</option>`).join('')}
              </select></label>
              <label class="image-quality" ${encoders[initialEncoder].hasQuality ? '' : 'hidden'}>
                JPEG品質 <input type="range" aria-label="${label}のJPEG品質" min="0.01" max="1" step="0.01" value="${initialQuality}">
                <span>${initialQuality.toFixed(2)}</span>
              </label>
              <div class="image-avif-settings" hidden>
                <label>AVIF品質 <input type="range" class="image-avif-quality" aria-label="${label}のAVIF品質" min="0" max="100" step="1" value="${initialAvifOptions.quality}"><span>${initialAvifOptions.quality}</span></label>
                <label>アルファ品質 <input type="range" class="image-avif-alpha" aria-label="${label}のAVIFアルファ品質" min="0" max="100" step="1" value="${initialAvifOptions.qualityAlpha}"><span>${initialAvifOptions.qualityAlpha}</span></label>
                <label>速度 <input type="range" class="image-avif-speed" aria-label="${label}のAVIF速度" min="0" max="10" step="1" value="${initialAvifOptions.speed}"><span>${initialAvifOptions.speed}</span></label>
                <label>色差サンプリング <select class="image-avif-subsample" aria-label="${label}のAVIF色差サンプリング">
                  <option value="1" selected>4:2:0</option><option value="2">4:2:2</option><option value="3">4:4:4</option>
                </select></label>
                <label><input type="checkbox" class="image-avif-lossless" aria-label="${label}側のAVIFを可逆圧縮にする"> 可逆圧縮</label>
                <p class="image-note">可逆時は品質100・アルファ品質100・4:4:4で符号化します。設定を100・100・4:4:4にした場合も可逆です。8-bit sRGBに正規化したRGBA画素を保持します。再表示時はブラウザの色管理やアルファ処理で変わる場合があります。速度の値を下げると処理が遅くなり、大きな画像ほど時間とメモリを使います。</p>
                <p class="image-avif-status" role="status" aria-atomic="true"></p>
                <div class="image-avif-actions">
                  <button type="button" class="image-avif-cancel" hidden aria-label="${label}側のAVIF変換を中止">AVIF変換を中止</button>
                  <button type="button" class="image-avif-retry" hidden aria-label="${label}側のAVIF変換を再試行">AVIF変換を再試行</button>
                </div>
              </div>
              <div class="image-mozjpeg-settings" hidden>
                <label>MozJPEG品質 <input type="range" class="image-mozjpeg-quality" aria-label="${label}のMozJPEG品質" min="1" max="100" step="1"><span></span></label>
                <label>色差サンプリング <select class="image-mozjpeg-subsample" aria-label="${label}のMozJPEG色差サンプリング">
                  <option value="420">4:2:0</option><option value="422">4:2:2</option><option value="444">4:4:4</option>
                </select></label>
                <label><input type="checkbox" class="image-mozjpeg-progressive" aria-label="${label}のMozJPEGプログレッシブJPEG"> プログレッシブJPEG</label>
                <label><input type="checkbox" class="image-mozjpeg-optimize" aria-label="${label}のMozJPEGハフマン符号化最適化"> ハフマン符号化最適化</label>
                <p class="image-note">非可逆圧縮です。透明部分は白になります。大きな画像や設定によって変換に時間がかかります。</p>
                <p class="image-mozjpeg-status" role="status" aria-atomic="true"></p>
                <div class="image-mozjpeg-actions">
                  <button type="button" class="image-mozjpeg-cancel" hidden aria-label="${label}側のMozJPEG変換を中止">MozJPEG変換を中止</button>
                  <button type="button" class="image-mozjpeg-retry" hidden aria-label="${label}側のMozJPEG変換を再試行">MozJPEG変換を再試行</button>
                </div>
              </div>
              <div class="image-jpegli-settings" hidden>
                <label>画質の指定方法 <select class="image-jpegli-mode" aria-label="${label}のJpegli画質の指定方法">
                  <option value="quality">Quality</option><option value="distance">Distance</option>
                </select></label>
                <label>Quality <input type="range" class="image-jpegli-quality" aria-label="${label}のJpegli Quality" min="1" max="100" step="1" aria-describedby="image-jpegli-note-${id}"><span></span></label>
                <label hidden>Distance <input type="range" class="image-jpegli-distance" aria-label="${label}のJpegli Distance" min="0.1" max="25" step="0.1" aria-describedby="image-jpegli-note-${id}"><span></span></label>
                <label>色差サンプリング <select class="image-jpegli-subsample" aria-label="${label}のJpegli色差サンプリング">
                  <option value="444">4:4:4</option><option value="440">4:4:0</option><option value="422">4:2:2</option><option value="420">4:2:0</option>
                </select></label>
                <label>Progressive Level <select class="image-jpegli-progressive" aria-label="${label}のJpegli Progressive Level">
                  <option value="0">0</option><option value="1">1</option><option value="2">2</option>
                </select></label>
                <label><input type="checkbox" class="image-jpegli-adaptive" aria-label="${label}のJpegli適応量子化"> 適応量子化</label>
                <label><input type="checkbox" class="image-jpegli-optimize" aria-label="${label}のJpegliハフマン符号化最適化"> ハフマン符号化最適化</label>
                <p class="image-note" id="image-jpegli-note-${id}">Distanceは小さいほど高画質です。Qualityの数値と実際の画質の関係はエンコーダーごとに異なります。非可逆圧縮で、透明部分は白になります。</p>
                <p class="image-jpegli-status" role="status" aria-atomic="true"></p>
                <div class="image-jpegli-actions">
                  <button type="button" class="image-jpegli-cancel" hidden aria-label="${label}側のJpegli変換を中止">Jpegli変換を中止</button>
                  <button type="button" class="image-jpegli-retry" hidden aria-label="${label}側のJpegli変換を再試行">Jpegli変換を再試行</button>
                </div>
              </div>
              <div class="image-webp-settings" hidden>
                <label><span class="image-webp-quality-label">WebP品質</span> <input type="range" class="image-webp-quality" aria-label="${label}のWebP品質" min="0" max="100" step="1"><span class="image-webp-quality-value"></span></label>
                <label>アルファ品質 <input type="range" class="image-webp-alpha" aria-label="${label}のWebPアルファ品質" min="0" max="100" step="1"><span></span></label>
                <label>圧縮メソッド <input type="range" class="image-webp-method" aria-label="${label}のWebP圧縮メソッド" min="0" max="6" step="1"><span></span></label>
                <label><input type="checkbox" class="image-webp-lossless" aria-label="${label}側のWebPを可逆圧縮にする"> 可逆圧縮</label>
                <label><input type="checkbox" class="image-webp-sharp" aria-label="${label}側のWebPでSharp YUVを有効にする"> Sharp YUV</label>
                <p class="image-note">可逆圧縮は8-bit sRGBに正規化したRGBA画素を保持します。可逆時の圧縮効率は圧縮処理にかける労力を調整します。メソッドは0が高速側、6が圧縮効率重視側です。高い値で出力が小さくなるとは限りません。Sharp YUVは非可逆時に色変換の精度を高めます。画像や設定によって処理時間とメモリ使用量が増えることがあります。</p>
                <p class="image-webp-status" role="status" aria-atomic="true"></p>
                <div class="image-webp-actions">
                  <button type="button" class="image-webp-cancel" hidden aria-label="${label}側のWebP変換を中止">WebP変換を中止</button>
                  <button type="button" class="image-webp-retry" hidden aria-label="${label}側のWebP変換を再試行">WebP変換を再試行</button>
                </div>
              </div>
              <div class="image-jp2-settings" hidden>
                <label>画質の指定方法 <select class="image-jp2-mode" aria-label="${label}のJPEG 2000画質の指定方法">
                  <option value="psnr">PSNR</option><option value="ratio">圧縮率</option>
                </select></label>
                <label>PSNR <input type="range" class="image-jp2-psnr" aria-label="${label}のJPEG 2000 PSNR" min="20" max="60" step="1" aria-describedby="image-jp2-note-${id}"><span></span></label>
                <label hidden>圧縮率 <input type="range" class="image-jp2-ratio" aria-label="${label}のJPEG 2000圧縮率" min="2" max="100" step="1" aria-describedby="image-jp2-note-${id}"><span></span></label>
                <label><input type="checkbox" class="image-jp2-lossless" aria-label="${label}側のJPEG 2000を可逆圧縮にする"> 可逆圧縮</label>
                <p class="image-note" id="image-jp2-note-${id}">PSNRは大きいほど高画質です。圧縮率は非圧縮の画素データを基準とし、大きいほど強く圧縮します。どちらも目標値で、実測値は画像によって変わります。非可逆圧縮では透明度も変わる場合があります。可逆圧縮は正規化された8-bit sRGB RGBA画素を保持します。ブラウザでの読み込み・再表示時はアルファ処理で画素値が変わる場合があります。</p>
                <p class="image-jp2-status" role="status" aria-atomic="true"></p>
                <div class="image-jp2-actions">
                  <button type="button" class="image-jp2-cancel" hidden aria-label="${label}側のJPEG 2000変換を中止">JPEG 2000変換を中止</button>
                  <button type="button" class="image-jp2-retry" hidden aria-label="${label}側のJPEG 2000変換を再試行">JPEG 2000変換を再試行</button>
                </div>
              </div>
              <div class="image-jxl-settings" hidden>
                <label>Distance <input type="range" class="image-jxl-distance" aria-label="${label}のJPEG XL Distance" min="0.1" max="15" step="0.1" aria-describedby="image-jxl-distance-${id}"><span></span></label>
                <p class="image-note" id="image-jxl-distance-${id}">Distanceは小さいほど高画質になります。</p>
                <label>Effort <input type="range" class="image-jxl-effort" aria-label="${label}のJPEG XL Effort" min="1" max="10" step="1" aria-describedby="image-jxl-effort-${id}"><span></span></label>
                <p class="image-note" id="image-jxl-effort-${id}">Effortは大きいほど圧縮に労力をかけます。出力サイズが小さくなるかは画像によります。高いEffortや大きな画像では処理時間とメモリ消費量が増えます。</p>
                <label><input type="checkbox" class="image-jxl-lossless" aria-label="${label}側のJPEG XLを可逆圧縮にする"> 可逆圧縮</label>
                <p class="image-note">アルファは常に可逆圧縮します。可逆圧縮をオンにすると、8-bit sRGBに正規化したRGBA画素をすべて保持します。</p>
                <p class="image-jxl-status" role="status" aria-atomic="true"></p>
                <div class="image-jxl-actions">
                  <button type="button" class="image-jxl-cancel" hidden aria-label="${label}側のJPEG XL変換を中止">JPEG XL変換を中止</button>
                  <button type="button" class="image-jxl-retry" hidden aria-label="${label}側のJPEG XL変換を再試行">JPEG XL変換を再試行</button>
                </div>
              </div>
              <div class="image-oxipng-settings" hidden>
                <label>Oxipngレベル <select aria-label="${label}のOxipngレベル">
                  ${[1, 2, 3, 4, 5, 6].map(level => `<option value="${level}"${level === 2 ? ' selected' : ''}>${level}</option>`).join('')}
                </select></label>
                <label><input type="checkbox" class="image-oxipng-interlace" aria-label="${label}のインターレースを有効にする"> インターレースを有効にする</label>
                <label><input type="checkbox" class="image-oxipng-alpha" aria-label="${label}の完全透明画素のRGB最適化を有効にする"> 完全透明画素のRGB最適化を有効にする</label>
                <p class="image-note">レベル5・6は処理に時間がかかる場合があります。高いレベルが常に小さくなるとは限りません。有効にすると、完全透明な画素のRGB値が変わる場合があります。</p>
                <p class="image-oxipng-status" role="status" aria-atomic="true"></p>
                <div class="image-oxipng-actions">
                  <button type="button" class="image-oxipng-cancel" hidden aria-label="${label}側のOxipngを中止">Oxipngを中止</button>
                  <button type="button" class="image-oxipng-retry" hidden aria-label="${label}側のOxipngを再試行">Oxipngを再試行</button>
                </div>
              </div>
              <div class="image-metrics" role="group" aria-label="${label}側の変換結果">
                <div class="image-metric">
                  <p id="image-size-label-${id}" class="image-metric-label">容量増減</p>
                  <p class="image-result" role="status" aria-labelledby="image-size-label-${id}" aria-atomic="true"><strong class="image-size-change"></strong><span class="image-output-size"></span></p>
                </div>
                <div class="image-metric" aria-live="polite" aria-atomic="true">
                  <p class="image-metric-label">SSIMULACRA2</p>
                  <p class="image-score"></p>
                </div>
              </div>
              <p class="image-error" role="alert"></p>
              <button type="button" class="image-save" disabled>${label}をダウンロード</button>
            </div>
          </fieldset>
        `).join('')}
      </div>
    </section>
    <section class="image-evaluation" aria-labelledby="image-evaluation-heading">
      <h2 id="image-evaluation-heading">画質評価</h2>
      <div class="image-evaluation-controls">
        <label class="image-evaluation-toggle">
          <input type="checkbox" aria-describedby="image-evaluation-cost" checked>画質の自動評価
        </label>
        <div class="image-evaluation-actions" hidden>
          <button type="button" class="image-evaluate" disabled>画質を評価</button>
          <button type="button" class="image-evaluation-cancel" disabled>評価を中止</button>
        </div>
      </div>
      <p class="image-evaluation-status" role="status" aria-atomic="true"></p>
      <p class="image-evaluation-limit" role="status" aria-atomic="true"></p>
      <p id="image-evaluation-cost" class="image-note">大きい画像の評価には時間がかかり、多くのメモリを使います。</p>
      <div class="image-evaluation-details" hidden>
        <p class="image-note">SSIMULACRA2は元画像との見た目の近さを示す参考スコアです。透明部分は白背景で比較し、半透明やアルファの見え方の忠実性を完全評価するものではありません。</p>
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
      </div>
    </section>
    <p class="image-note">画像はブラウザ内で処理します。JPEGでは透明部分が白になります。AVIFとJPEG XLは8-bit sRGBの静止画として変換します。EXIFなどのメタデータは保持されない場合があります。</p>`;
  const get = <T extends Element>(selector: string) => view.querySelector<T>(selector)!;
  const tool = findTool('image-converter')!;
  get('h1').textContent = tool.name;
  get('.tool-description').textContent = tool.description;
  const input = get<HTMLInputElement>('[type=file]');
  const drop = get<HTMLButtonElement>('.image-drop');
  const change = get<HTMLButtonElement>('.image-change');
  change.prepend(createIcon(ImagePlus));
  const section = get<HTMLElement>('.image-tool > section[aria-label="画像の比較と変換設定"]');
  const filenameLabel = get('.image-filename');
  const fileDetails = get('.image-file-details');
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
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  const jxlSupport = detectJxlSupport();
  let jxlEvaluationUnsupported = false;
  for (const sample of sampleImages) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'image-sample';
    button.dataset.sample = sample.id;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', `${sample.label}、${sample.dimensions}、${sample.type === 'image/jpeg' ? 'JPEG' : 'PNG'}、${sample.size}`);
    const thumbnailFrame = document.createElement('span');
    thumbnailFrame.className = 'image-sample-thumbnail';
    thumbnailFrame.dataset.state = 'loading';
    thumbnailFrame.append(createIcon(Image), createIcon(ImageOff));
    const thumbnail = document.createElement('img');
    thumbnail.alt = '';
    thumbnail.loading = 'lazy';
    thumbnail.decoding = 'async';
    thumbnail.addEventListener('load', () => { thumbnailFrame.dataset.state = 'ready'; }, options);
    thumbnail.addEventListener('error', () => { thumbnailFrame.dataset.state = 'error'; }, options);
    thumbnailFrame.append(thumbnail);
    thumbnail.src = `${import.meta.env.BASE_URL}samples/${sample.id}-thumb.${sample.id === 'red-panda' ? 'jpg' : 'png'}`;
    if (thumbnail.complete && thumbnail.currentSrc) {
      thumbnailFrame.dataset.state = thumbnail.naturalWidth > 0 ? 'ready' : 'error';
    }
    const title = document.createElement('strong');
    title.textContent = sample.label;
    const detail = document.createElement('span');
    detail.textContent = `${sample.dimensions} · ${sample.type === 'image/jpeg' ? 'JPEG' : 'PNG'} · ${sample.size}`;
    button.append(thumbnailFrame, title, detail);
    sampleList.append(button);
  }
  const autoEvaluation = get<HTMLInputElement>('.image-evaluation-toggle input');
  const evaluationActions = get<HTMLElement>('.image-evaluation-actions');
  const evaluationDetails = get<HTMLElement>('.image-evaluation-details');
  const evaluate = get<HTMLButtonElement>('.image-evaluate');
  evaluate.prepend(createIcon(ScanEye));
  const cancelEvaluation = get<HTMLButtonElement>('.image-evaluation-cancel');
  cancelEvaluation.prepend(createIcon(X));
  const limitNotice = get('.image-evaluation-limit');
  const evaluationStatus = get('.image-evaluation-status');
  let inputGeneration = 0;
  let selectionGeneration = 0;
  let reading: Selection | undefined;
  let source: { file: File; bitmap: ImageBitmap } | undefined;
  let evaluation: { controller: AbortController; mode: EvaluationMode; images: Blob[]; started: boolean } | undefined;
  let requestedEvaluation: { mode: EvaluationMode; readyAt: number } | undefined;
  let evaluationTimer: ReturnType<typeof setTimeout> | undefined;
  let scores = new WeakMap<Blob, number>();
  let failedEvaluations = new WeakSet<Blob>();

  function createSide({ id, label, initialEncoder }: typeof sideDefinitions[number]) {
    const panel = get<HTMLFieldSetElement>(`.image-panel[data-side="${id}"]`);
    return {
      id,
      label,
      encoder: initialEncoder as EncoderId,
      quality: initialQuality,
      avifOptions: { ...initialAvifOptions } as AvifOptions,
      avifKey: undefined as string | undefined,
      mozjpegOptions: { ...defaultMozjpegOptions },
      mozjpegKey: undefined as string | undefined,
      jpegliOptions: { ...defaultJpegliOptions },
      jpegliKey: undefined as string | undefined,
      webpOptions: { ...defaultWebpOptions },
      webpKey: undefined as string | undefined,
      jp2Options: { ...defaultJp2Options },
      jp2Key: undefined as string | undefined,
      jxlOptions: { ...defaultJxlOptions },
      jxlKey: undefined as string | undefined,
      oxipngOptions: { ...defaultOxipngOptions } as OxipngOptions,
      oxipngKey: undefined as string | undefined,
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
      avifSettings: panel.querySelector<HTMLElement>('.image-avif-settings')!,
      avifQuality: panel.querySelector<HTMLInputElement>('.image-avif-quality')!,
      avifQualityValue: panel.querySelector('.image-avif-quality + span')!,
      avifAlpha: panel.querySelector<HTMLInputElement>('.image-avif-alpha')!,
      avifAlphaValue: panel.querySelector('.image-avif-alpha + span')!,
      avifSpeed: panel.querySelector<HTMLInputElement>('.image-avif-speed')!,
      avifSpeedValue: panel.querySelector('.image-avif-speed + span')!,
      avifSubsample: panel.querySelector<HTMLSelectElement>('.image-avif-subsample')!,
      avifLossless: panel.querySelector<HTMLInputElement>('.image-avif-lossless')!,
      avifStatus: panel.querySelector<HTMLElement>('.image-avif-status')!,
      avifCancel: panel.querySelector<HTMLButtonElement>('.image-avif-cancel')!,
      avifRetry: panel.querySelector<HTMLButtonElement>('.image-avif-retry')!,
      mozjpegSettings: panel.querySelector<HTMLElement>('.image-mozjpeg-settings')!,
      mozjpegQuality: panel.querySelector<HTMLInputElement>('.image-mozjpeg-quality')!,
      mozjpegQualityValue: panel.querySelector('.image-mozjpeg-quality + span')!,
      mozjpegSubsample: panel.querySelector<HTMLSelectElement>('.image-mozjpeg-subsample')!,
      mozjpegProgressive: panel.querySelector<HTMLInputElement>('.image-mozjpeg-progressive')!,
      mozjpegOptimize: panel.querySelector<HTMLInputElement>('.image-mozjpeg-optimize')!,
      mozjpegStatus: panel.querySelector<HTMLElement>('.image-mozjpeg-status')!,
      mozjpegCancel: panel.querySelector<HTMLButtonElement>('.image-mozjpeg-cancel')!,
      mozjpegRetry: panel.querySelector<HTMLButtonElement>('.image-mozjpeg-retry')!,
      jpegliSettings: panel.querySelector<HTMLElement>('.image-jpegli-settings')!,
      jpegliMode: panel.querySelector<HTMLSelectElement>('.image-jpegli-mode')!,
      jpegliQuality: panel.querySelector<HTMLInputElement>('.image-jpegli-quality')!,
      jpegliQualityValue: panel.querySelector('.image-jpegli-quality + span')!,
      jpegliDistance: panel.querySelector<HTMLInputElement>('.image-jpegli-distance')!,
      jpegliDistanceValue: panel.querySelector('.image-jpegli-distance + span')!,
      jpegliSubsample: panel.querySelector<HTMLSelectElement>('.image-jpegli-subsample')!,
      jpegliAdaptive: panel.querySelector<HTMLInputElement>('.image-jpegli-adaptive')!,
      jpegliProgressive: panel.querySelector<HTMLSelectElement>('.image-jpegli-progressive')!,
      jpegliOptimize: panel.querySelector<HTMLInputElement>('.image-jpegli-optimize')!,
      jpegliStatus: panel.querySelector<HTMLElement>('.image-jpegli-status')!,
      jpegliCancel: panel.querySelector<HTMLButtonElement>('.image-jpegli-cancel')!,
      jpegliRetry: panel.querySelector<HTMLButtonElement>('.image-jpegli-retry')!,
      webpSettings: panel.querySelector<HTMLElement>('.image-webp-settings')!,
      webpQualityLabel: panel.querySelector('.image-webp-quality-label')!,
      webpQuality: panel.querySelector<HTMLInputElement>('.image-webp-quality')!,
      webpQualityValue: panel.querySelector('.image-webp-quality-value')!,
      webpAlpha: panel.querySelector<HTMLInputElement>('.image-webp-alpha')!,
      webpAlphaValue: panel.querySelector('.image-webp-alpha + span')!,
      webpMethod: panel.querySelector<HTMLInputElement>('.image-webp-method')!,
      webpMethodValue: panel.querySelector('.image-webp-method + span')!,
      webpLossless: panel.querySelector<HTMLInputElement>('.image-webp-lossless')!,
      webpSharp: panel.querySelector<HTMLInputElement>('.image-webp-sharp')!,
      webpStatus: panel.querySelector<HTMLElement>('.image-webp-status')!,
      webpCancel: panel.querySelector<HTMLButtonElement>('.image-webp-cancel')!,
      webpRetry: panel.querySelector<HTMLButtonElement>('.image-webp-retry')!,
      jp2Preview: undefined as HTMLCanvasElement | undefined,
      jp2Settings: panel.querySelector<HTMLElement>('.image-jp2-settings')!,
      jp2Mode: panel.querySelector<HTMLSelectElement>('.image-jp2-mode')!,
      jp2Psnr: panel.querySelector<HTMLInputElement>('.image-jp2-psnr')!,
      jp2PsnrValue: panel.querySelector('.image-jp2-psnr + span')!,
      jp2Ratio: panel.querySelector<HTMLInputElement>('.image-jp2-ratio')!,
      jp2RatioValue: panel.querySelector('.image-jp2-ratio + span')!,
      jp2Lossless: panel.querySelector<HTMLInputElement>('.image-jp2-lossless')!,
      jp2Status: panel.querySelector<HTMLElement>('.image-jp2-status')!,
      jp2Cancel: panel.querySelector<HTMLButtonElement>('.image-jp2-cancel')!,
      jp2Retry: panel.querySelector<HTMLButtonElement>('.image-jp2-retry')!,
      jxlSettings: panel.querySelector<HTMLElement>('.image-jxl-settings')!,
      jxlDistance: panel.querySelector<HTMLInputElement>('.image-jxl-distance')!,
      jxlDistanceValue: panel.querySelector('.image-jxl-distance + span')!,
      jxlEffort: panel.querySelector<HTMLInputElement>('.image-jxl-effort')!,
      jxlEffortValue: panel.querySelector('.image-jxl-effort + span')!,
      jxlLossless: panel.querySelector<HTMLInputElement>('.image-jxl-lossless')!,
      jxlStatus: panel.querySelector<HTMLElement>('.image-jxl-status')!,
      jxlCancel: panel.querySelector<HTMLButtonElement>('.image-jxl-cancel')!,
      jxlRetry: panel.querySelector<HTMLButtonElement>('.image-jxl-retry')!,
      oxipngSettings: panel.querySelector<HTMLElement>('.image-oxipng-settings')!,
      oxipngLevel: panel.querySelector<HTMLSelectElement>('.image-oxipng-settings select')!,
      oxipngInterlace: panel.querySelector<HTMLInputElement>('.image-oxipng-interlace')!,
      oxipngAlpha: panel.querySelector<HTMLInputElement>('.image-oxipng-alpha')!,
      oxipngStatus: panel.querySelector<HTMLElement>('.image-oxipng-status')!,
      oxipngCancel: panel.querySelector<HTMLButtonElement>('.image-oxipng-cancel')!,
      oxipngRetry: panel.querySelector<HTMLButtonElement>('.image-oxipng-retry')!,
      output: panel.querySelector<HTMLParagraphElement>('.image-result')!,
      sizeChange: panel.querySelector('.image-size-change')!,
      outputSize: panel.querySelector('.image-output-size')!,
      error: panel.querySelector('.image-error')!,
      score: panel.querySelector('.image-score')!,
      save: panel.querySelector<HTMLButtonElement>('.image-save')!,
    };
  }

  type Side = ReturnType<typeof createSide>;
  const [left, right] = [createSide(sideDefinitions[0]), createSide(sideDefinitions[1])];
  const sides = [left, right];
  void jxlSupport.then(({ input, preview }) => {
    if (listeners.signal.aborted) return;
    const notice = get<HTMLElement>('.image-jxl-compatibility');
    for (const side of sides) {
      side.format.querySelector<HTMLOptionElement>('option[value="image/jxl"]')!.disabled = !preview;
    }
    if (!preview) {
      notice.textContent = 'このブラウザではJPEG XLの入力と出力を利用できません。';
      notice.hidden = false;
    } else if (!input) {
      notice.textContent = 'このブラウザではJPEG XLの入力を利用できません。JPEG XLへの変換と保存は利用できます。';
      notice.hidden = false;
    }
  });
  type Jp2Job = {
    controller: AbortController;
    consumers: Set<Side>;
    started: boolean;
    promise?: Promise<Jp2Result>;
    result?: Jp2Result;
  };
  // The job owns the decoded bitmap while any side uses the result.
  const jp2Jobs = new Map<string, Jp2Job>();
  const jxlJobs = new Map<string, { controller: AbortController; consumers: Set<Side>; promise?: Promise<Blob>; blob?: Blob; started: boolean }>();
  const mozjpegJobs = new Map<string, { controller: AbortController; consumers: Set<Side>; promise?: Promise<Blob>; blob?: Blob; started: boolean }>();
  const jpegliJobs = new Map<string, { controller: AbortController; consumers: Set<Side>; promise?: Promise<Blob>; blob?: Blob; started: boolean }>();
  const webpJobs = new Map<string, { controller: AbortController; consumers: Set<Side>; promise?: Promise<Blob>; blob?: Blob; started: boolean }>();
  const avifJobs = new Map<string, { controller: AbortController; consumers: Set<Side>; promise?: Promise<Blob>; blob?: Blob; started: boolean }>();
  const oxipngJobs = new Map<string, { controller: AbortController; consumers: Set<Side>; promise?: Promise<Blob>; blob?: Blob; started: boolean }>();

  function detachAvif(side: Side) {
    const key = side.avifKey;
    side.avifKey = undefined;
    if (!key) return;
    const job = avifJobs.get(key);
    if (!job) return;
    job.consumers.delete(side);
    if (!job.consumers.size) {
      if (!job.blob) job.controller.abort();
      avifJobs.delete(key);
    }
  }

  function requestAvif(side: Side, bitmap: ImageBitmap, generation: number): Promise<Blob> {
    const options = validateAvifOptions(side.avifOptions);
    const key = avifKey(generation, options);
    let job = avifJobs.get(key);
    if (!job) {
      const controller = new AbortController();
      job = { controller, consumers: new Set(), started: false };
      avifJobs.set(key, job);
      const current = job;
      current.promise = encodeAvif(bitmap, options, controller.signal, () => {
        if (avifJobs.get(key) !== current) return;
        current.started = true;
        for (const consumer of current.consumers) {
          if (consumer.avifKey === key) consumer.avifStatus.textContent = 'AVIFに変換しています…';
        }
      }).then(blob => {
        if (avifJobs.get(key) === current && current.consumers.size) current.blob = blob;
        return blob;
      }, cause => {
        if (avifJobs.get(key) === current) avifJobs.delete(key);
        throw cause;
      });
      for (const pending of sides) {
        if (pending.avifKey === key && pending.result.status === 'pending') current.consumers.add(pending);
      }
    }
    job.consumers.add(side);
    side.avifKey = key;
    side.avifStatus.textContent = job.started ? 'AVIFに変換しています…' : 'AVIF変換を待っています…';
    side.avifCancel.hidden = false;
    side.avifRetry.hidden = true;
    return job.blob ? Promise.resolve(job.blob) : job.promise!;
  }

  function detachOxipng(side: Side) {
    const key = side.oxipngKey;
    side.oxipngKey = undefined;
    if (!key) return;
    const job = oxipngJobs.get(key);
    if (!job) return;
    job.consumers.delete(side);
    if (!job.consumers.size) {
      if (!job.blob) job.controller.abort();
      oxipngJobs.delete(key);
    }
  }

  function requestOxipng(side: Side, bitmap: ImageBitmap, generation: number): Promise<Blob> {
    const options = validateOxipngOptions(side.oxipngOptions);
    const key = oxipngKey(generation, options);
    let job = oxipngJobs.get(key);
    if (!job) {
      const controller = new AbortController();
      job = { controller, consumers: new Set(), started: false };
      oxipngJobs.set(key, job);
      const current = job;
      current.promise = encodeOxipng(bitmap, options, controller.signal, () => {
        if (oxipngJobs.get(key) !== current) return;
        current.started = true;
        for (const consumer of current.consumers) {
          if (consumer.oxipngKey !== key) continue;
          consumer.oxipngStatus.textContent = 'Oxipngで変換しています…';
        }
      }).then(blob => {
        if (oxipngJobs.get(key) === current && current.consumers.size) current.blob = blob;
        return blob;
      }, cause => {
        if (oxipngJobs.get(key) === current) oxipngJobs.delete(key);
        throw cause;
      });
      for (const pending of sides) {
        if (pending.oxipngKey === key && pending.result.status === 'pending') current.consumers.add(pending);
      }
    }
    job.consumers.add(side);
    side.oxipngKey = key;
    side.oxipngStatus.textContent = job.started ? 'Oxipngで変換しています…' : 'Oxipngの変換を待っています…';
    side.oxipngCancel.hidden = false;
    side.oxipngRetry.hidden = true;
    return job.blob ? Promise.resolve(job.blob) : job.promise!;
  }

  function detachWebp(side: Side) {
    const key = side.webpKey;
    side.webpKey = undefined;
    if (!key) return;
    const job = webpJobs.get(key);
    if (!job) return;
    job.consumers.delete(side);
    if (!job.consumers.size) {
      if (!job.blob) job.controller.abort();
      webpJobs.delete(key);
    }
  }

  function requestWebp(side: Side, bitmap: ImageBitmap, generation: number): Promise<Blob> {
    const options = validateWebpOptions(side.webpOptions);
    const key = webpKey(generation, options);
    let job = webpJobs.get(key);
    if (!job) {
      const controller = new AbortController();
      job = { controller, consumers: new Set(), started: false };
      webpJobs.set(key, job);
      const current = job;
      current.promise = encodeWebp(bitmap, options, controller.signal, () => {
        if (webpJobs.get(key) !== current) return;
        current.started = true;
        for (const consumer of current.consumers) {
          if (consumer.webpKey === key) consumer.webpStatus.textContent = 'WebPに変換しています…';
        }
      }).then(blob => {
        if (webpJobs.get(key) === current && current.consumers.size) current.blob = blob;
        return blob;
      }, cause => {
        if (webpJobs.get(key) === current) webpJobs.delete(key);
        throw cause;
      });
      for (const pending of sides) {
        if (pending.webpKey === key && pending.result.status === 'pending') current.consumers.add(pending);
      }
    }
    job.consumers.add(side);
    side.webpKey = key;
    side.webpStatus.textContent = job.started ? 'WebPに変換しています…' : 'WebP変換を待っています…';
    side.webpCancel.hidden = false;
    side.webpRetry.hidden = true;
    return job.blob ? Promise.resolve(job.blob) : job.promise!;
  }

  function detachJp2(side: Side) {
    const key = side.jp2Key;
    side.jp2Key = undefined;
    if (!key) return;
    const job = jp2Jobs.get(key);
    if (job?.consumers.delete(side) && !job.consumers.size) {
      jp2Jobs.delete(key);
      if (job.result) job.result.bitmap.close();
      else job.controller.abort();
    }
  }

  function requestJp2(side: Side, bitmap: ImageBitmap): Promise<Jp2Result> {
    const key = side.jp2Key!;
    let job = jp2Jobs.get(key);
    if (!job) {
      const controller = new AbortController();
      const consumers = new Set(sides.filter(pending => pending.jp2Key === key && pending.result.status === 'pending'));
      const current: Jp2Job = { controller, consumers, started: false };
      jp2Jobs.set(key, current);
      current.promise = encodeJp2(bitmap, effectiveJp2Options(side.jp2Options), controller.signal, () => {
        if (jp2Jobs.get(key) !== current) return;
        current.started = true;
        for (const consumer of consumers) consumer.jp2Status.textContent = 'JPEG 2000に変換しています…';
      }).then(result => {
        if (jp2Jobs.get(key) === current) current.result = result;
        else result.bitmap.close();
        return result;
      }, cause => {
        if (jp2Jobs.get(key) === current) jp2Jobs.delete(key);
        throw cause;
      });
      job = current;
    }
    job.consumers.add(side);
    side.jp2Status.textContent = job.started ? 'JPEG 2000に変換しています…' : 'JPEG 2000変換を待っています…';
    return job.promise!;
  }

  function detachJxl(side: Side) {
    const key = side.jxlKey;
    side.jxlKey = undefined;
    if (!key) return;
    const job = jxlJobs.get(key);
    if (!job) return;
    job.consumers.delete(side);
    if (!job.consumers.size) {
      if (!job.blob) job.controller.abort();
      jxlJobs.delete(key);
    }
  }

  function requestJxl(side: Side, bitmap: ImageBitmap, generation: number): Promise<Blob> {
    const options = validateJxlOptions(side.jxlOptions);
    const key = jxlKey(generation, options);
    let job = jxlJobs.get(key);
    if (!job) {
      const controller = new AbortController();
      job = { controller, consumers: new Set(), started: false };
      jxlJobs.set(key, job);
      const current = job;
      current.promise = encodeJxl(bitmap, options, controller.signal, () => {
        if (jxlJobs.get(key) !== current) return;
        current.started = true;
        for (const consumer of current.consumers) {
          if (consumer.jxlKey === key) consumer.jxlStatus.textContent = 'JPEG XLに変換しています…';
        }
      }).then(blob => {
        if (jxlJobs.get(key) === current && current.consumers.size) current.blob = blob;
        return blob;
      }, cause => {
        if (jxlJobs.get(key) === current) jxlJobs.delete(key);
        throw cause;
      });
      for (const pending of sides) {
        if (pending.jxlKey === key && pending.result.status === 'pending') current.consumers.add(pending);
      }
    }
    job.consumers.add(side);
    side.jxlKey = key;
    side.jxlStatus.textContent = job.started ? 'JPEG XLに変換しています…' : 'JPEG XL変換を待っています…';
    side.jxlCancel.hidden = false;
    side.jxlRetry.hidden = true;
    return job.blob ? Promise.resolve(job.blob) : job.promise!;
  }

  function detachMozjpeg(side: Side) {
    const key = side.mozjpegKey;
    side.mozjpegKey = undefined;
    if (!key) return;
    const job = mozjpegJobs.get(key);
    if (!job) return;
    job.consumers.delete(side);
    if (!job.consumers.size) {
      if (!job.blob) job.controller.abort();
      mozjpegJobs.delete(key);
    }
  }

  function requestMozjpeg(side: Side, bitmap: ImageBitmap, generation: number): Promise<Blob> {
    const options = validateMozjpegOptions(side.mozjpegOptions);
    const key = mozjpegKey(generation, options);
    let job = mozjpegJobs.get(key);
    if (!job) {
      const controller = new AbortController();
      job = { controller, consumers: new Set(), started: false };
      mozjpegJobs.set(key, job);
      const current = job;
      current.promise = encodeMozjpeg(bitmap, options, controller.signal, () => {
        if (mozjpegJobs.get(key) !== current) return;
        current.started = true;
        for (const consumer of current.consumers) {
          if (consumer.mozjpegKey === key) consumer.mozjpegStatus.textContent = 'MozJPEGに変換しています…';
        }
      }).then(blob => {
        if (mozjpegJobs.get(key) === current && current.consumers.size) current.blob = blob;
        return blob;
      }, cause => {
        if (mozjpegJobs.get(key) === current) mozjpegJobs.delete(key);
        throw cause;
      });
      for (const pending of sides) {
        if (pending.mozjpegKey === key && pending.result.status === 'pending') current.consumers.add(pending);
      }
    }
    job.consumers.add(side);
    side.mozjpegKey = key;
    side.mozjpegStatus.textContent = job.started ? 'MozJPEGに変換しています…' : 'MozJPEG変換を待っています…';
    side.mozjpegCancel.hidden = false;
    side.mozjpegRetry.hidden = true;
    return job.blob ? Promise.resolve(job.blob) : job.promise!;
  }

  function detachJpegli(side: Side) {
    const key = side.jpegliKey;
    side.jpegliKey = undefined;
    if (!key) return;
    const job = jpegliJobs.get(key);
    if (!job) return;
    job.consumers.delete(side);
    if (!job.consumers.size) {
      if (!job.blob) job.controller.abort();
      jpegliJobs.delete(key);
    }
  }

  function requestJpegli(side: Side, bitmap: ImageBitmap, generation: number): Promise<Blob> {
    const options = validateJpegliOptions(side.jpegliOptions);
    const key = jpegliKey(generation, options);
    let job = jpegliJobs.get(key);
    if (!job) {
      const controller = new AbortController();
      job = { controller, consumers: new Set(), started: false };
      jpegliJobs.set(key, job);
      const current = job;
      current.promise = encodeJpegli(bitmap, options, controller.signal, () => {
        if (jpegliJobs.get(key) !== current) return;
        current.started = true;
        for (const consumer of current.consumers) {
          if (consumer.jpegliKey === key) consumer.jpegliStatus.textContent = 'Jpegliに変換しています…';
        }
      }).then(blob => {
        if (jpegliJobs.get(key) === current && current.consumers.size) current.blob = blob;
        return blob;
      }, cause => {
        if (jpegliJobs.get(key) === current) jpegliJobs.delete(key);
        throw cause;
      });
      for (const pending of sides) {
        if (pending.jpegliKey === key && pending.result.status === 'pending') current.consumers.add(pending);
      }
    }
    job.consumers.add(side);
    side.jpegliKey = key;
    side.jpegliStatus.textContent = job.started ? 'Jpegliに変換しています…' : 'Jpegli変換を待っています…';
    side.jpegliCancel.hidden = false;
    side.jpegliRetry.hidden = true;
    return job.blob ? Promise.resolve(job.blob) : job.promise!;
  }

  for (const side of sides) side.save.prepend(createIcon(Download));

  function isLossless(side: Side): boolean {
    return side.encoder === 'oxipng' ||
      (side.encoder === 'image/avif' && isAvifLossless(side.avifOptions)) ||
      (side.encoder === 'image/webp' && side.webpOptions.lossless) ||
      (side.encoder === 'image/jp2' && side.jp2Options.lossless) ||
      (side.encoder === 'image/jxl' && side.jxlOptions.lossless);
  }

  function canScore(side: Side): boolean {
    return !(side.encoder === 'image/jxl' && jxlEvaluationUnsupported) && isEvaluable(side.encoder, isLossless(side));
  }

  function evaluationBlob(side: Side): Blob | undefined {
    if (canScore(side) && side.result.status === 'ready') return side.result.blob;
  }

  function unevaluatedImages(): Blob[] {
    const blobs = new Set<Blob>();
    for (const side of sides) {
      const blob = evaluationBlob(side);
      if (blob && !scores.has(blob)) blobs.add(blob);
    }
    return [...blobs];
  }

  function evaluationMessage(side: Side, blob: Blob | undefined, limit: string | undefined) {
    if (side.encoder === 'original') return '基準画像';
    if (isLossless(side)) return '可逆圧縮（スコア評価対象外）';
    if (side.encoder === 'image/jxl' && jxlEvaluationUnsupported) return jxlEvaluationUnavailable;
    if (!isEvaluable(side.encoder)) return '画質評価は未対応';
    if (limit && source) {
      const { width, height } = source.bitmap;
      return Math.min(width, height) < MIN_EVALUATION_SIDE ? '画像が小さすぎます' : '評価上限超過';
    }
    if (side.result.status === 'failed') return '変換失敗';
    if (side.result.status === 'pending') return '変換待ち…';
    if (blob && evaluation?.images.includes(blob)) return evaluation.started ? '評価中…' : '評価待機中…';
    if (blob && requestedEvaluation) return '評価待機中…';
    if (blob && failedEvaluations.has(blob)) return '評価に失敗';
    return '画質は未評価';
  }

  function updateEvaluation() {
    const currentSource = source;
    const limit = currentSource && evaluationLimit(currentSource.bitmap.width, currentSource.bitmap.height);
    if (limitNotice.textContent !== (limit ?? '')) limitNotice.textContent = limit ?? '';
    const converting = sides.some(side => canScore(side) && side.result.status === 'pending');
    const images = unevaluatedImages();
    const canEvaluate = currentSource && !limit && (converting || images.length > 0);
    if (!canEvaluate && requestedEvaluation) {
      clearEvaluationRequest();
      if (evaluationStatus.textContent === evaluationWaiting) evaluationStatus.textContent = '';
    }
    evaluate.disabled = !canEvaluate || !!evaluation || requestedEvaluation?.mode === 'manual';
    cancelEvaluation.disabled = !evaluation && !requestedEvaluation;
    for (const side of sides) {
      const blob = evaluationBlob(side);
      const score = blob ? scores.get(blob) : undefined;
      const message = score === undefined ? evaluationMessage(side, blob, limit) : score.toFixed(1);
      side.score.classList.toggle('has-score', score !== undefined);
      if (side.score.textContent !== message) side.score.textContent = message;
    }

    if (evaluation || !requestedEvaluation || !currentSource) return;
    const remaining = requestedEvaluation.readyAt - performance.now();
    if (!converting && remaining <= 0) {
      const { mode } = requestedEvaluation;
      clearEvaluationRequest();
      void startEvaluation(mode, currentSource.bitmap, images, inputGeneration);
      return;
    }
    if (evaluationStatus.textContent !== evaluationWaiting) evaluationStatus.textContent = evaluationWaiting;
    // 変換が済んでから、自動評価に必要な残りの待機時間だけを計る。
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

  async function startEvaluation(mode: EvaluationMode, bitmap: ImageBitmap, images: Blob[], generation: number) {
    const controller = new AbortController();
    const job = { controller, mode, images, started: false };
    const isCurrent = () => evaluation === job && generation === inputGeneration;
    evaluation = job;
    const previews = new Map<Blob, ImageBitmap>();
    for (const side of sides) {
      if (side.result.status === 'ready' && side.result.bitmap && images.includes(side.result.blob)) {
        previews.set(side.result.blob, side.result.bitmap);
      }
    }
    let jxlSkipped = false;
    for (const image of images) failedEvaluations.delete(image);
    if (evaluationStatus.textContent !== evaluationWaiting) evaluationStatus.textContent = evaluationWaiting;
    updateEvaluation();
    try {
      await evaluateImages(
        bitmap, images, controller.signal,
        () => {
          if (!isCurrent()) return;
          job.started = true;
          evaluationStatus.textContent = '画質を評価しています…';
          updateEvaluation();
        },
        (image, score) => {
          if (!isCurrent() || !sides.some(side => evaluationBlob(side) === image)) return;
          scores.set(image, score);
          updateEvaluation();
        },
        () => {
          if (!isCurrent()) return;
          jxlSkipped = jxlEvaluationUnsupported = true;
          updateEvaluation();
        },
        previews,
      );
      if (isCurrent()) {
        if (jxlSkipped) setIconMessage(evaluationStatus, CircleAlert, jxlEvaluationUnavailable);
        else setIconMessage(evaluationStatus, Check, '画質評価が完了しました。');
      }
    } catch (cause) {
      if (isCurrent()) {
        if (cause instanceof DOMException && cause.name === 'AbortError') {
          evaluationStatus.textContent = '画質評価を中止しました。';
        } else {
          // Keep the scores already received before the Worker failed.
          for (const image of images) {
            if (!scores.has(image)) failedEvaluations.add(image);
          }
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
    detachAvif(side);
    detachMozjpeg(side);
    detachJpegli(side);
    detachWebp(side);
    detachJp2(side);
    detachJxl(side);
    detachOxipng(side);
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
    side.sizeChange.textContent = side.outputSize.textContent = side.error.textContent = '';
    side.oxipngStatus.textContent = '';
    side.avifStatus.textContent = '';
    side.mozjpegStatus.textContent = '';
    side.mozjpegCancel.hidden = side.mozjpegRetry.hidden = true;
    side.jpegliStatus.textContent = '';
    side.jpegliCancel.hidden = side.jpegliRetry.hidden = true;
    side.webpStatus.textContent = '';
    side.webpCancel.hidden = side.webpRetry.hidden = true;
    side.jp2Status.textContent = '';
    side.jp2Cancel.hidden = side.jp2Retry.hidden = true;
    if (side.jp2Preview) {
      side.jp2Preview.width = side.jp2Preview.height = 0;
      side.jp2Preview.remove();
      side.jp2Preview = undefined;
    }
    side.jxlStatus.textContent = '';
    side.jxlCancel.hidden = side.jxlRetry.hidden = true;
    side.avifCancel.hidden = side.avifRetry.hidden = true;
    side.oxipngCancel.hidden = side.oxipngRetry.hidden = true;
    delete side.output.dataset.change;
  }

  function clearSource() {
    stopEvaluation();
    scores = new WeakMap();
    failedEvaluations = new WeakSet();
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
    side.qualityLabel.hidden = side.encoder !== 'image/jpeg';
    side.qualityValue.textContent = side.quality.toFixed(2);
    side.avifSettings.hidden = side.encoder !== 'image/avif';
    const shownAvifOptions = effectiveAvifOptions(side.avifOptions);
    side.avifQuality.value = String(shownAvifOptions.quality);
    side.avifQualityValue.textContent = String(shownAvifOptions.quality);
    side.avifAlpha.value = String(shownAvifOptions.qualityAlpha);
    side.avifAlphaValue.textContent = String(shownAvifOptions.qualityAlpha);
    side.avifSpeed.value = String(shownAvifOptions.speed);
    side.avifSpeedValue.textContent = String(shownAvifOptions.speed);
    side.avifSubsample.value = String(shownAvifOptions.subsample);
    side.avifLossless.checked = side.avifOptions.lossless;
    side.avifQuality.disabled = side.avifLossless.checked;
    side.avifAlpha.disabled = side.avifLossless.checked;
    side.avifSubsample.disabled = side.avifLossless.checked;
    side.mozjpegSettings.hidden = side.encoder !== 'mozjpeg';
    const shownMozjpegOptions = effectiveMozjpegOptions(side.mozjpegOptions);
    side.mozjpegQuality.value = side.mozjpegQualityValue.textContent = String(shownMozjpegOptions.quality);
    side.mozjpegSubsample.value = shownMozjpegOptions.subsample;
    side.mozjpegProgressive.checked = shownMozjpegOptions.progressive;
    side.mozjpegOptimize.checked = shownMozjpegOptions.optimizeCoding;
    side.mozjpegOptimize.disabled = shownMozjpegOptions.progressive;
    side.jpegliSettings.hidden = side.encoder !== 'jpegli';
    const jpegli = effectiveJpegliOptions(side.jpegliOptions);
    side.jpegliMode.value = jpegli.mode;
    side.jpegliQuality.closest('label')!.hidden = jpegli.mode !== 'quality';
    side.jpegliDistance.closest('label')!.hidden = jpegli.mode !== 'distance';
    side.jpegliQuality.value = side.jpegliQualityValue.textContent = String(jpegli.quality);
    side.jpegliDistance.value = side.jpegliDistanceValue.textContent = jpegli.distance.toFixed(1);
    side.jpegliSubsample.value = jpegli.subsample;
    side.jpegliProgressive.value = String(jpegli.progressiveLevel);
    side.jpegliAdaptive.checked = jpegli.adaptiveQuantization;
    side.jpegliOptimize.checked = jpegli.optimizeCoding;
    side.jpegliOptimize.disabled = jpegli.progressiveLevel > 0;
    side.webpSettings.hidden = side.encoder !== 'image/webp';
    const shownWebpOptions = effectiveWebpOptions(side.webpOptions);
    const webpQualityLabel = side.webpOptions.lossless ? '圧縮効率' : 'WebP品質';
    side.webpQualityLabel.textContent = webpQualityLabel;
    side.webpQuality.setAttribute('aria-label', side.label + 'の' + webpQualityLabel);
    side.webpQuality.value = side.webpQualityValue.textContent = String(shownWebpOptions.quality);
    side.webpAlpha.value = side.webpAlphaValue.textContent = String(shownWebpOptions.alpha_quality);
    side.webpMethod.value = side.webpMethodValue.textContent = String(shownWebpOptions.method);
    side.webpLossless.checked = side.webpOptions.lossless;
    side.webpSharp.checked = Boolean(shownWebpOptions.use_sharp_yuv);
    side.webpAlpha.disabled = side.webpSharp.disabled = side.webpOptions.lossless;
    side.jp2Settings.hidden = side.encoder !== 'image/jp2';
    const jp2 = side.jp2Options;
    side.jp2Mode.value = jp2.mode;
    side.jp2Psnr.closest('label')!.hidden = jp2.mode !== 'psnr';
    side.jp2Ratio.closest('label')!.hidden = jp2.mode !== 'ratio';
    side.jp2Psnr.value = String(jp2.psnr);
    side.jp2PsnrValue.textContent = jp2.psnr + ' dB';
    side.jp2Ratio.value = side.jp2RatioValue.textContent = String(jp2.ratio);
    side.jp2Mode.disabled = side.jp2Psnr.disabled = side.jp2Ratio.disabled = side.jp2Lossless.checked = jp2.lossless;
    side.jxlSettings.hidden = side.encoder !== 'image/jxl';
    const jxl = effectiveJxlOptions(side.jxlOptions);
    side.jxlDistance.disabled = side.jxlLossless.checked = jxl.lossless;
    side.jxlDistance.min = jxl.lossless ? '0' : '0.1';
    const distance = jxl.distanceTenths / 10;
    side.jxlDistance.value = String(distance);
    side.jxlDistanceValue.textContent = jxl.lossless ? '0' : distance.toFixed(1);
    side.jxlEffort.value = side.jxlEffortValue.textContent = String(jxl.effort);
    side.oxipngSettings.hidden = side.encoder !== 'oxipng';
    side.oxipngLevel.value = String(side.oxipngOptions.level);
    side.oxipngInterlace.checked = side.oxipngOptions.interlace;
    side.oxipngAlpha.checked = side.oxipngOptions.optimiseAlpha;
  }

  async function convert(side: Side, currentInput: number, currentSide: number) {
    const isCurrent = () => currentInput === inputGeneration && currentSide === side.generation;
    if (!source || !isCurrent()) return;
    const { file, bitmap } = source;
    const { type, extension, hasQuality } = encoders[side.encoder];
    const other = side === left ? right : left;
    const stem = file.name.replace(/\.[^.]*$/, '') || 'image';
    try {
      let blob: Blob = file;
      let jp2Bitmap: ImageBitmap | undefined;
      let filename = file.name;
      if (side.encoder === 'oxipng') {
        blob = await requestOxipng(side, bitmap, currentInput);
        if (!isCurrent()) return;
        filename = `${stem}-${side.id}-oxipng-o${side.oxipngOptions.level}.png`;
      } else if (side.encoder === 'image/avif') {
        const encoding = requestAvif(side, bitmap, currentInput);
        side.result = { status: 'pending', encoding };
        blob = await encoding;
        if (!isCurrent()) return;
        filename = avifFilename(stem, side.id, side.avifOptions);
      } else if (side.encoder === 'mozjpeg') {
        blob = await requestMozjpeg(side, bitmap, currentInput);
        if (!isCurrent()) return;
        filename = mozjpegFilename(stem, side.id, side.mozjpegOptions);
      } else if (side.encoder === 'jpegli') {
        blob = await requestJpegli(side, bitmap, currentInput);
        if (!isCurrent()) return;
        filename = jpegliFilename(stem, side.id, side.jpegliOptions);
      } else if (side.encoder === 'image/webp') {
        blob = await requestWebp(side, bitmap, currentInput);
        if (!isCurrent()) return;
        filename = webpFilename(stem, side.id, side.webpOptions);
      } else if (side.encoder === 'image/jp2') {
        const result = await requestJp2(side, bitmap);
        if (!isCurrent()) return;
        blob = result.blob;
        jp2Bitmap = result.bitmap;
        filename = jp2Filename(stem, side.id, side.jp2Options);
      } else if (side.encoder === 'image/jxl') {
        blob = await requestJxl(side, bitmap, currentInput);
        if (!isCurrent()) return;
        filename = jxlFilename(stem, side.id, side.jxlOptions);
      } else if (side.encoder === 'image/jpeg' || side.encoder === 'image/png') {
        let encoding: Promise<Blob> | undefined;
        // 設定が一致する間は、もう片側の変換処理か成功済みのBlobを共有する。
        if (side.encoder === other.encoder && (!hasQuality || side.quality === other.quality)) {
          if (other.result.status === 'ready') encoding = Promise.resolve(other.result.blob);
          if (other.result.status === 'pending') encoding = other.result.encoding;
        }
        encoding ??= encode(bitmap, side.encoder, side.quality);
        side.result = { status: 'pending', encoding };
        const stem = file.name.replace(/\.[^.]*$/, '') || 'image';
        const qualitySuffix = hasQuality ? '-q' + side.quality.toFixed(2) : '';
        filename = stem + '-' + side.id + qualitySuffix + extension;
        blob = await encoding;
        if (!isCurrent()) return;
      }
      side.url = URL.createObjectURL(blob);
      if (jp2Bitmap) {
        const canvas = document.createElement('canvas');
        side.jp2Preview = canvas;
        canvas.dataset.jp2Side = side.id;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', side.preview.alt);
        canvas.width = jp2Bitmap.width;
        canvas.height = jp2Bitmap.height;
        const context = canvas.getContext('2d', { colorSpace: 'srgb' });
        if (!context) throw new Error('JPEG 2000のプレビューを表示できませんでした。');
        context.drawImage(jp2Bitmap, 0, 0);
        side.preview.after(canvas);
      } else if (type) {
        side.preview.src = side.url;
        await side.preview.decode();
        if (!isCurrent()) return;
        side.preview.hidden = false;
      } else {
        showOriginal(side, true);
      }
      side.result = { status: 'ready', blob, filename, bitmap: jp2Bitmap };
      const restoreOxipngFocus = side.encoder === 'oxipng' && document.activeElement === side.oxipngCancel;
      const restoreAvifFocus = side.encoder === 'image/avif' && document.activeElement === side.avifCancel;
      if (side.encoder === 'oxipng') {
        side.oxipngStatus.textContent = 'Oxipngの変換が完了しました。';
        side.oxipngCancel.hidden = side.oxipngRetry.hidden = true;
      }
      if (side.encoder === 'image/avif') {
        side.avifStatus.textContent = 'AVIF変換が完了しました。';
        side.avifCancel.hidden = side.avifRetry.hidden = true;
      }
      const restoreMozjpegFocus = side.encoder === 'mozjpeg' && document.activeElement === side.mozjpegCancel;
      if (side.encoder === 'mozjpeg') {
        side.mozjpegStatus.textContent = 'MozJPEG変換が完了しました。';
        side.mozjpegCancel.hidden = side.mozjpegRetry.hidden = true;
      }
      const restoreJpegliFocus = side.encoder === 'jpegli' && document.activeElement === side.jpegliCancel;
      if (side.encoder === 'jpegli') {
        side.jpegliStatus.textContent = 'Jpegli変換が完了しました。';
        side.jpegliCancel.hidden = side.jpegliRetry.hidden = true;
      }
      const restoreWebpFocus = side.encoder === 'image/webp' && document.activeElement === side.webpCancel;
      if (side.encoder === 'image/webp') {
        side.webpStatus.textContent = 'WebP変換が完了しました。';
        side.webpCancel.hidden = side.webpRetry.hidden = true;
      }
      const restoreJp2Focus = side.encoder === 'image/jp2' && document.activeElement === side.jp2Cancel;
      if (side.encoder === 'image/jp2') {
        side.jp2Status.textContent = 'JPEG 2000変換が完了しました。';
        side.jp2Cancel.hidden = side.jp2Retry.hidden = true;
      }
      const restoreJxlFocus = side.encoder === 'image/jxl' && document.activeElement === side.jxlCancel;
      if (side.encoder === 'image/jxl') {
        side.jxlStatus.textContent = 'JPEG XL変換が完了しました。';
        side.jxlCancel.hidden = side.jxlRetry.hidden = true;
      }
      side.output.dataset.change = blob.size < file.size ? 'reduction' : blob.size > file.size ? 'increase' : 'same';
      side.sizeChange.textContent = sizeChange(file.size, blob.size);
      const originalSize = document.createElement('span');
      originalSize.textContent = ' 元 ' + formatFileSize(file.size);
      const convertedSize = document.createElement('span');
      convertedSize.textContent = ' → 出力 ' + formatFileSize(blob.size);
      side.outputSize.replaceChildren(originalSize, convertedSize);
      side.save.disabled = false;
      if (restoreOxipngFocus || restoreAvifFocus || restoreWebpFocus || restoreMozjpegFocus || restoreJpegliFocus || restoreJxlFocus || restoreJp2Focus) side.save.focus({ preventScroll: true });
      updateEvaluation();
    } catch (cause) {
      if (!isCurrent()) return;
      const isOxipng = side.encoder === 'oxipng';
      const isAvif = side.encoder === 'image/avif';
      const restoreOxipngFocus = isOxipng && document.activeElement === side.oxipngCancel;
      const restoreAvifFocus = isAvif && document.activeElement === side.avifCancel;
      const isMozjpeg = side.encoder === 'mozjpeg';
      const restoreMozjpegFocus = isMozjpeg && document.activeElement === side.mozjpegCancel;
      const isJpegli = side.encoder === 'jpegli';
      const restoreJpegliFocus = isJpegli && document.activeElement === side.jpegliCancel;
      const isWebp = side.encoder === 'image/webp';
      const restoreWebpFocus = isWebp && document.activeElement === side.webpCancel;
      const isJp2 = side.encoder === 'image/jp2';
      const restoreJp2Focus = isJp2 && document.activeElement === side.jp2Cancel;
      const isJxl = side.encoder === 'image/jxl';
      const restoreJxlFocus = isJxl && document.activeElement === side.jxlCancel;
      invalidate(side);
      side.result = { status: 'failed' };
      const message = cause instanceof Error && !(cause instanceof DOMException) ? cause.message : '変換結果を表示できませんでした。';
      setIconMessage(side.error, CircleAlert, side.label + '側：' + message);
      if (isOxipng) {
        side.oxipngStatus.textContent = 'Oxipngの変換に失敗しました。もう一度お試しください。';
        side.oxipngRetry.hidden = false;
        if (restoreOxipngFocus) side.oxipngRetry.focus({ preventScroll: true });
      }
      if (isAvif) {
        side.avifStatus.textContent = 'AVIF変換に失敗しました。もう一度お試しください。';
        side.avifRetry.hidden = false;
        if (restoreAvifFocus) side.avifRetry.focus({ preventScroll: true });
      }
      if (isMozjpeg) {
        side.mozjpegStatus.textContent = 'MozJPEG変換に失敗しました。もう一度お試しください。';
        side.mozjpegRetry.hidden = false;
        if (restoreMozjpegFocus) side.mozjpegRetry.focus({ preventScroll: true });
      }
      if (isJpegli) {
        side.jpegliStatus.textContent = 'Jpegli変換に失敗しました。もう一度お試しください。';
        side.jpegliRetry.hidden = false;
        if (restoreJpegliFocus) side.jpegliRetry.focus({ preventScroll: true });
      }
      if (isWebp) {
        side.webpStatus.textContent = 'WebP変換に失敗しました。もう一度お試しください。';
        side.webpRetry.hidden = false;
        if (restoreWebpFocus) side.webpRetry.focus({ preventScroll: true });
      }
      if (isJp2) {
        side.jp2Status.textContent = 'JPEG 2000変換に失敗しました。もう一度お試しください。';
        side.jp2Retry.hidden = false;
        if (restoreJp2Focus) side.jp2Retry.focus({ preventScroll: true });
      }
      if (isJxl) {
        side.jxlStatus.textContent = 'JPEG XL変換に失敗しました。もう一度お試しください。';
        side.jxlRetry.hidden = false;
        if (restoreJxlFocus) side.jxlRetry.focus({ preventScroll: true });
      }
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
    side.sizeChange.textContent = '変換しています…';
    if (side.encoder === 'oxipng') {
      side.oxipngKey = oxipngKey(inputGeneration, side.oxipngOptions);
      const active = oxipngJobs.get(side.oxipngKey);
      if (active) active.consumers.add(side);
      side.oxipngStatus.textContent = 'Oxipngの変換を待っています…';
      side.oxipngCancel.hidden = false;
      side.oxipngRetry.hidden = true;
    }
    if (side.encoder === 'image/avif') {
      const options = validateAvifOptions(side.avifOptions);
      side.avifKey = avifKey(inputGeneration, options);
      const active = avifJobs.get(side.avifKey);
      if (active) active.consumers.add(side);
      side.avifStatus.textContent = 'AVIF変換を待っています…';
      side.avifCancel.hidden = false;
      side.avifRetry.hidden = true;
    }
    if (side.encoder === 'mozjpeg') {
      const key = mozjpegKey(currentInput, side.mozjpegOptions);
      side.mozjpegKey = key;
      const active = mozjpegJobs.get(key);
      if (active) active.consumers.add(side);
      side.mozjpegStatus.textContent = active?.started ? 'MozJPEGに変換しています…' : 'MozJPEG変換を待っています…';
      side.mozjpegCancel.hidden = false;
    }
    if (side.encoder === 'jpegli') {
      const key = jpegliKey(currentInput, side.jpegliOptions);
      side.jpegliKey = key;
      const active = jpegliJobs.get(key);
      if (active) active.consumers.add(side);
      side.jpegliStatus.textContent = active?.started ? 'Jpegliに変換しています…' : 'Jpegli変換を待っています…';
      side.jpegliCancel.hidden = false;
    }
    if (side.encoder === 'image/webp') {
      const key = webpKey(currentInput, side.webpOptions);
      side.webpKey = key;
      const active = webpJobs.get(key);
      if (active) active.consumers.add(side);
      side.webpStatus.textContent = active?.started ? 'WebPに変換しています…' : 'WebP変換を待っています…';
      side.webpCancel.hidden = false;
    }
    if (side.encoder === 'image/jp2') {
      const key = jp2Key(currentInput, side.jp2Options);
      side.jp2Key = key;
      const active = jp2Jobs.get(key);
      active?.consumers.add(side);
      side.jp2Status.textContent = active?.started ? 'JPEG 2000に変換しています…' : 'JPEG 2000変換を待っています…';
      side.jp2Cancel.hidden = false;
    }
    if (side.encoder === 'image/jxl') {
      const key = jxlKey(currentInput, side.jxlOptions);
      side.jxlKey = key;
      const active = jxlJobs.get(key);
      if (active) active.consumers.add(side);
      side.jxlStatus.textContent = active?.started ? 'JPEG XLに変換しています…' : 'JPEG XL変換を待っています…';
      side.jxlCancel.hidden = false;
    }
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

  async function selectFiles(files: readonly File[] | null, selection: Selection = beginSelection(), sampleId?: string): Promise<boolean> {
    if (!selectionIsCurrent(selection)) return false;
    if (!files?.length) {
      reading = undefined;
      inputStatus.textContent = '';
      return false;
    }
    inputError.textContent = '';
    if (files.length !== 1) {
      reading = undefined;
      inputStatus.textContent = '';
      setIconMessage(inputError, CircleAlert, '画像は1枚ずつ選択してください。');
      return false;
    }
    const file = files[0]!;
    if (file.type && file.type !== 'application/octet-stream' && !inputMimeTypes.includes(file.type)) {
      reading = undefined;
      inputStatus.textContent = '';
      setIconMessage(inputError, CircleAlert, supportedInputMessage);
      return false;
    }
    const changedAt = selection.changedAt;
    const { controller } = selection;

    let bitmap: ImageBitmap | undefined;
    let preview: HTMLCanvasElement | undefined;
    try {
      bitmap = await decode(file, controller.signal, jxlSupport);
      if (!selectionIsCurrent(selection)) {
        bitmap.close();
        return false;
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
      if (!selectionIsCurrent(selection)) return false;
      reading = undefined;
      inputStatus.textContent = '';
      setIconMessage(inputError, CircleAlert, cause instanceof Error && !(cause instanceof DOMException) ? cause.message : '画像を読み込めませんでした。');
      return false;
    }

    if (!selectionIsCurrent(selection)) {
      bitmap.close();
      if (preview) preview.width = preview.height = 0;
      return false;
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
    filenameLabel.textContent = file.name;
    fileDetails.textContent = ' ' + bitmap.width + ' × ' + bitmap.height + ' px · 元ファイル ' + formatFileSize(file.size);
    sampleList.querySelectorAll<HTMLButtonElement>('.image-sample').forEach(button => {
      const selected = button.dataset.sample === sampleId;
      button.setAttribute('aria-pressed', String(selected));
    });
    inputStatus.textContent = inputError.textContent = '';
    const moveFocus = document.activeElement === drop;
    resetInitialDrag();
    drop.hidden = true;
    section.hidden = false;
    evaluationActions.hidden = evaluationDetails.hidden = false;
    if (moveFocus) change.focus({ preventScroll: true });
    for (const side of sides) convertSide(side);
    if (autoEvaluation.checked) requestEvaluation('auto', changedAt);
    return true;
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
      if (await selectFiles([file], selection, sample.id)) {
        const bounds = stage.getBoundingClientRect();
        if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
          stage.scrollIntoView({ block: bounds.top < 0 ? 'start' : 'end', inline: 'nearest' });
        }
      }
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
      const selected = side.format.selectedOptions[0];
      if (!selected || selected.disabled) {
        side.format.value = side.encoder;
        return;
      }
      const encoder = selected.value as EncoderId;
      if (encoder === side.encoder) return;
      side.encoder = encoder;
      updateSettings(side);
    }, options);
    side.oxipngLevel.addEventListener('change', () => {
      const updated = validateOxipngOptions({ ...side.oxipngOptions, level: Number(side.oxipngLevel.value) });
      if (updated.level === side.oxipngOptions.level) return;
      side.oxipngOptions = updated;
      updateSettings(side, 180);
    }, options);
    side.oxipngInterlace.addEventListener('change', () => {
      side.oxipngOptions = { ...side.oxipngOptions, interlace: side.oxipngInterlace.checked };
      updateSettings(side, 180);
    }, options);
    side.oxipngAlpha.addEventListener('change', () => {
      side.oxipngOptions = { ...side.oxipngOptions, optimiseAlpha: side.oxipngAlpha.checked };
      updateSettings(side, 180);
    }, options);
    for (const [inputElement, outputElement, key] of [
      [side.avifQuality, side.avifQualityValue, 'quality'],
      [side.avifAlpha, side.avifAlphaValue, 'qualityAlpha'],
      [side.avifSpeed, side.avifSpeedValue, 'speed'],
    ] as const) {
      inputElement.addEventListener('input', () => {
        const value = inputElement.valueAsNumber;
        if (side.avifOptions[key] === value) return;
        side.avifOptions = validateAvifOptions({ ...side.avifOptions, [key]: value });
        outputElement.textContent = String(side.avifOptions[key]);
        updateSettings(side, 180);
      }, options);
    }
    side.avifSubsample.addEventListener('change', () => {
      const updated = validateAvifOptions({ ...side.avifOptions, subsample: Number(side.avifSubsample.value) });
      if (updated.subsample === side.avifOptions.subsample) return;
      side.avifOptions = updated;
      updateSettings(side, 180);
    }, options);
    side.avifLossless.addEventListener('change', () => {
      side.avifOptions = validateAvifOptions({ ...side.avifOptions, lossless: side.avifLossless.checked });
      updateSettings(side, 180);
    }, options);
    const updateMozjpegOptions = (change: Partial<MozjpegOptions>) => {
      const updated = validateMozjpegOptions({ ...side.mozjpegOptions, ...change });
      const previousKey = mozjpegKey(inputGeneration, side.mozjpegOptions);
      side.mozjpegOptions = updated;
      if (mozjpegKey(inputGeneration, updated) !== previousKey) updateSettings(side, 180);
    };
    side.mozjpegQuality.addEventListener('input', () => {
      updateMozjpegOptions({ quality: side.mozjpegQuality.valueAsNumber });
    }, options);
    side.mozjpegSubsample.addEventListener('change', () => {
      updateMozjpegOptions({ subsample: side.mozjpegSubsample.value as MozjpegOptions['subsample'] });
    }, options);
    side.mozjpegProgressive.addEventListener('change', () => {
      updateMozjpegOptions({ progressive: side.mozjpegProgressive.checked });
    }, options);
    side.mozjpegOptimize.addEventListener('change', () => {
      if (!side.mozjpegOptions.progressive) updateMozjpegOptions({ optimizeCoding: side.mozjpegOptimize.checked });
    }, options);
    const updateJpegliOptions = (change: Partial<JpegliOptions>) => {
      const updated = validateJpegliOptions({ ...side.jpegliOptions, ...change });
      const previousKey = jpegliKey(inputGeneration, side.jpegliOptions);
      side.jpegliOptions = updated;
      if (jpegliKey(inputGeneration, updated) !== previousKey) updateSettings(side, 180);
    };
    side.jpegliMode.addEventListener('change', () => {
      updateJpegliOptions({ mode: side.jpegliMode.value === 'distance' ? 'distance' : 'quality' });
    }, options);
    side.jpegliQuality.addEventListener('input', () => {
      if (side.jpegliOptions.mode === 'quality') updateJpegliOptions({ quality: side.jpegliQuality.valueAsNumber });
    }, options);
    side.jpegliDistance.addEventListener('input', () => {
      if (side.jpegliOptions.mode === 'distance') updateJpegliOptions({ distance: side.jpegliDistance.valueAsNumber });
    }, options);
    side.jpegliSubsample.addEventListener('change', () => {
      updateJpegliOptions({ subsample: side.jpegliSubsample.value as JpegliOptions['subsample'] });
    }, options);
    side.jpegliProgressive.addEventListener('change', () => {
      updateJpegliOptions({ progressiveLevel: Number(side.jpegliProgressive.value) as JpegliOptions['progressiveLevel'] });
    }, options);
    side.jpegliAdaptive.addEventListener('change', () => {
      updateJpegliOptions({ adaptiveQuantization: side.jpegliAdaptive.checked });
    }, options);
    side.jpegliOptimize.addEventListener('change', () => {
      if (side.jpegliOptions.progressiveLevel === 0) updateJpegliOptions({ optimizeCoding: side.jpegliOptimize.checked });
    }, options);
    const updateWebpOptions = (change: Partial<WebpOptions>) => {
      const updated = validateWebpOptions({ ...side.webpOptions, ...change });
      const previousKey = webpKey(inputGeneration, side.webpOptions);
      side.webpOptions = updated;
      if (webpKey(inputGeneration, updated) !== previousKey) updateSettings(side, 180);
    };
    side.webpQuality.addEventListener('input', () => {
      updateWebpOptions({ [side.webpOptions.lossless ? 'losslessQuality' : 'quality']: side.webpQuality.valueAsNumber });
    }, options);
    side.webpAlpha.addEventListener('input', () => {
      if (!side.webpOptions.lossless) updateWebpOptions({ alphaQuality: side.webpAlpha.valueAsNumber });
    }, options);
    side.webpMethod.addEventListener('input', () => updateWebpOptions({ method: side.webpMethod.valueAsNumber }), options);
    side.webpLossless.addEventListener('change', () => updateWebpOptions({ lossless: side.webpLossless.checked }), options);
    side.webpSharp.addEventListener('change', () => {
      if (!side.webpOptions.lossless) updateWebpOptions({ sharpYuv: side.webpSharp.checked });
    }, options);
    const updateJp2Options = (change: Partial<Jp2Options>) => {
      const updated = validateJp2Options({ ...side.jp2Options, ...change });
      const previousKey = jp2Key(inputGeneration, side.jp2Options);
      side.jp2Options = updated;
      if (jp2Key(inputGeneration, updated) !== previousKey) updateSettings(side, 180);
    };
    side.jp2Mode.addEventListener('change', () => {
      if (!side.jp2Options.lossless) updateJp2Options({ mode: side.jp2Mode.value === 'ratio' ? 'ratio' : 'psnr' });
    }, options);
    side.jp2Psnr.addEventListener('input', () => {
      if (!side.jp2Options.lossless && side.jp2Options.mode === 'psnr') updateJp2Options({ psnr: side.jp2Psnr.valueAsNumber });
    }, options);
    side.jp2Ratio.addEventListener('input', () => {
      if (!side.jp2Options.lossless && side.jp2Options.mode === 'ratio') updateJp2Options({ ratio: side.jp2Ratio.valueAsNumber });
    }, options);
    side.jp2Lossless.addEventListener('change', () => updateJp2Options({ lossless: side.jp2Lossless.checked }), options);
    const updateJxlOptions = (change: Partial<JxlOptions>) => {
      const updated = validateJxlOptions({ ...side.jxlOptions, ...change });
      const previousKey = jxlKey(inputGeneration, side.jxlOptions);
      side.jxlOptions = updated;
      if (jxlKey(inputGeneration, updated) !== previousKey) updateSettings(side, 180);
    };
    side.jxlDistance.addEventListener('input', () => {
      if (!side.jxlOptions.lossless) updateJxlOptions({ distance: side.jxlDistance.valueAsNumber });
    }, options);
    side.jxlEffort.addEventListener('input', () => {
      updateJxlOptions({ effort: side.jxlEffort.valueAsNumber });
    }, options);
    side.jxlLossless.addEventListener('change', () => updateJxlOptions({ lossless: side.jxlLossless.checked }), options);
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
    side.oxipngCancel.addEventListener('click', () => {
      if (side.encoder !== 'oxipng' || side.result.status !== 'pending') return;
      invalidate(side);
      side.result = { status: 'cancelled' };
      side.oxipngStatus.textContent = 'Oxipngの変換を中止しました。再試行できます。';
      side.oxipngRetry.hidden = false;
      side.oxipngRetry.focus({ preventScroll: true });
      updateEvaluation();
    }, options);
    side.oxipngRetry.addEventListener('click', () => {
      if (side.encoder === 'oxipng' && source) {
        convertSide(side);
        side.oxipngCancel.focus({ preventScroll: true });
      }
    }, options);
    side.avifCancel.addEventListener('click', () => {
      if (side.encoder !== 'image/avif' || side.result.status !== 'pending') return;
      invalidate(side);
      side.result = { status: 'cancelled' };
      side.avifStatus.textContent = 'AVIF変換を中止しました。再試行できます。';
      side.avifRetry.hidden = false;
      side.avifRetry.focus({ preventScroll: true });
      updateEvaluation();
    }, options);
    side.avifRetry.addEventListener('click', () => {
      if (side.encoder === 'image/avif' && source) {
        updateSettings(side);
        side.avifCancel.focus({ preventScroll: true });
      }
    }, options);
    side.mozjpegCancel.addEventListener('click', () => {
      if (side.encoder !== 'mozjpeg' || side.result.status !== 'pending') return;
      invalidate(side);
      side.result = { status: 'cancelled' };
      side.mozjpegStatus.textContent = 'MozJPEG変換を中止しました。再試行できます。';
      side.mozjpegRetry.hidden = false;
      side.mozjpegRetry.focus({ preventScroll: true });
      updateEvaluation();
    }, options);
    side.mozjpegRetry.addEventListener('click', () => {
      if (side.encoder === 'mozjpeg' && source) {
        updateSettings(side);
        side.mozjpegCancel.focus({ preventScroll: true });
      }
    }, options);
    side.jpegliCancel.addEventListener('click', () => {
      if (side.encoder !== 'jpegli' || side.result.status !== 'pending') return;
      invalidate(side);
      side.result = { status: 'cancelled' };
      side.jpegliStatus.textContent = 'Jpegli変換を中止しました。再試行できます。';
      side.jpegliRetry.hidden = false;
      side.jpegliRetry.focus({ preventScroll: true });
      updateEvaluation();
    }, options);
    side.jpegliRetry.addEventListener('click', () => {
      if (side.encoder === 'jpegli' && source) {
        updateSettings(side);
        side.jpegliCancel.focus({ preventScroll: true });
      }
    }, options);
    side.webpCancel.addEventListener('click', () => {
      if (side.encoder !== 'image/webp' || side.result.status !== 'pending') return;
      invalidate(side);
      side.result = { status: 'cancelled' };
      side.webpStatus.textContent = 'WebP変換を中止しました。再試行できます。';
      side.webpRetry.hidden = false;
      side.webpRetry.focus({ preventScroll: true });
      updateEvaluation();
    }, options);
    side.webpRetry.addEventListener('click', () => {
      if (side.encoder === 'image/webp' && source) {
        updateSettings(side);
        side.webpCancel.focus({ preventScroll: true });
      }
    }, options);
    side.jp2Cancel.addEventListener('click', () => {
      if (side.encoder !== 'image/jp2' || side.result.status !== 'pending') return;
      invalidate(side);
      side.result = { status: 'cancelled' };
      side.jp2Status.textContent = 'JPEG 2000変換を中止しました。再試行できます。';
      side.jp2Retry.hidden = false;
      side.jp2Retry.focus({ preventScroll: true });
      updateEvaluation();
    }, options);
    side.jp2Retry.addEventListener('click', () => {
      if (side.encoder === 'image/jp2' && source) {
        updateSettings(side);
        side.jp2Cancel.focus({ preventScroll: true });
      }
    }, options);
    side.jxlCancel.addEventListener('click', () => {
      if (side.encoder !== 'image/jxl' || side.result.status !== 'pending') return;
      invalidate(side);
      side.result = { status: 'cancelled' };
      side.jxlStatus.textContent = 'JPEG XL変換を中止しました。再試行できます。';
      side.jxlRetry.hidden = false;
      side.jxlRetry.focus({ preventScroll: true });
      updateEvaluation();
    }, options);
    side.jxlRetry.addEventListener('click', () => {
      if (side.encoder === 'image/jxl' && source) {
        updateSettings(side);
        side.jxlCancel.focus({ preventScroll: true });
      }
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
