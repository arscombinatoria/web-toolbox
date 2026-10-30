import { findTool } from '../../registry';
import { createRunner } from './runner';
import { DEBOUNCE_MS, FLAGS, type DiagramResult } from './protocol';
import './style.css';

export function mount(container: HTMLElement): () => void {
  const view = document.createElement('div');
  view.className = 'regex-tool';
  // 固定HTMLのみ。パターン・エラー・SVG文字列はHTMLへ挿入しない。
  view.innerHTML = `
    <h1 tabindex="-1"></h1><p class="tool-description"></p>
    <label for="regex-pattern">正規表現のパターン</label>
    <p id="regex-help">/ の区切り文字は不要です。前後の空白も文字として保持します。入力後に自動更新します。</p>
    <textarea id="regex-pattern" rows="3" spellcheck="false" autocapitalize="off" autocomplete="off" aria-describedby="regex-help regex-error"></textarea>
    <fieldset><legend>フラグ</legend><div class="regex-flags"></div>
      <p>u と v は同時指定できません。一方を選ぶと他方を解除します。</p>
    </fieldset>
    <div class="regex-actions"><button type="button" data-clear>入力をクリア</button>
      <button type="button" data-cancel disabled>解析を中止</button>
      <button type="button" data-download disabled>SVGをダウンロード</button></div>
    <p id="regex-error" role="alert" aria-atomic="true"></p>
    <p role="status" aria-atomic="true"></p>
    <aside class="regex-warnings" aria-label="意味上の注意" hidden><h2>意味上の注意</h2><ul></ul></aside>
    <h2>Railroad Diagram</h2>
    <p id="regex-legend">左から右に構造を読みます。破線の条件は0文字、点線は捕捉文字列への後方参照です。
      上の右向き経路は省略、下の左向き経路は繰り返しです。合計回数と貪欲・非貪欲の優先順位は要素の上下のラベルで指定します。集合の内部は原文表記です。広い図はこの枠内でスクロールできます。</p>
    <div class="regex-canvas" tabindex="0" role="region" aria-label="正規表現の構造図（横にスクロールできます）" aria-describedby="regex-legend"><img alt="正規表現のRailroad Diagram" hidden></div>
    <p>入力・結果はブラウザ内だけで処理し、送信・保存しません。マッチングは実行しません。</p>
    <details><summary>対応範囲と制約</summary>
      <p>ECMAScript 2025の文字列・文字クラス・範囲・選択・量指定子・グループ・後方参照・アサーション・Unicodeプロパティ・Unicode集合演算に対応します。
        条件の内部構造は主経路とは独立して表示します。後読みの内部はソース順で表示し、評価方向は右から左です。
        Unicode集合は展開・列挙せず、&&（共通部分）、--（差集合）、入れ子、\\q{…}を原文で示します。</p>
      <p>i は大文字小文字の区別、m は行境界、s は改行を含むドット、u/v はUnicodeの解釈に影響します。
        d/g/y は検索時の動作フラグで、構造の分岐は増やしません。i の文字展開や検索開始位置、バックトラッキングの実行順は再現しません。
        図は意味解析の完全な検証ではなく、到達不能な分岐や空になるUnicode集合をすべて検出するものではありません。</p>
      <p>安全上限は入力4,096 UTF-16コード単位、800 ASTノード、深さ48、図の各辺16,000px・面積1,200万px、SVG100万文字、処理4秒です。
        超過時は切り詰めず理由を表示します。図は両テーマで読める白いキャンバスで表示・保存します。</p>
    </details>`;
  const tool = findTool('regex-visualizer')!;
  view.querySelector('h1')!.textContent = tool.name;
  view.querySelector('.tool-description')!.textContent = tool.description;
  const input = view.querySelector<HTMLTextAreaElement>('#regex-pattern')!;
  const error = view.querySelector<HTMLElement>('[role="alert"]')!;
  const status = view.querySelector<HTMLElement>('[role="status"]')!;
  const warnings = view.querySelector<HTMLElement>('.regex-warnings')!;
  const image = view.querySelector<HTMLImageElement>('img')!;
  const cancelButton = view.querySelector<HTMLButtonElement>('[data-cancel]')!;
  const download = view.querySelector<HTMLButtonElement>('[data-download]')!;
  const flagInputs = new Map<string, HTMLInputElement>();
  const meanings = ['一致位置の情報', '全体検索', '大文字小文字を区別しない', '複数行', 'ドットに改行を含む', 'Unicode', 'Unicode集合', '指定位置から検索'];
  FLAGS.forEach((flag, i) => {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.value = flag;
    checkbox.setAttribute('aria-label', `${flag}：${meanings[i]}`);
    label.append(checkbox, ` ${flag}`);
    view.querySelector('.regex-flags')!.append(label);
    flagInputs.set(flag, checkbox);
  });
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let url: string | undefined;
  let svgBlob: Blob | undefined;
  let disposed = false;
  let revision = 0;
  let composing = false;
  const downloads = new Map<string, ReturnType<typeof setTimeout>>();
  const clearImage = () => {
    image.onload = null; image.onerror = null;
    image.hidden = true; image.removeAttribute('src');
    download.disabled = true;
    if (url) URL.revokeObjectURL(url);
    url = undefined; svgBlob = undefined;
  };
  const showError = (text: string) => { error.textContent = text; status.textContent = ''; };
  const receive = (result: DiagramResult) => {
    if (disposed) return;
    cancelButton.disabled = true;
    if (!result.ok) {
      const category = { syntax: '構文エラー', limit: '安全上限', render: '描画エラー' }[result.kind];
      showError(`${category}：${result.message}${result.position === undefined ? '' : `（位置 ${result.position + 1}、UTF-16・1始まり）`}`);
      input.setAttribute('aria-invalid', String(result.kind === 'syntax'));
      return;
    }
    const current = revision;
    try {
      svgBlob = new Blob([result.svg], { type: 'image/svg+xml;charset=utf-8' });
      url = URL.createObjectURL(svgBlob);
      image.onload = () => {
        if (disposed || current !== revision) return;
        image.style.setProperty('--diagram-min-width', `${image.naturalWidth * 0.8}px`);
        status.textContent = '図を更新しました。'; download.disabled = false;
      };
      image.onerror = () => {
        if (disposed || current !== revision) return;
        clearImage(); showError('描画エラー：SVGを表示できませんでした。');
      };
      image.src = url; image.hidden = false;
      const list = warnings.querySelector('ul')!;
      for (const warning of result.warnings) {
        const item = document.createElement('li'); item.textContent = warning; list.append(item);
      }
      warnings.hidden = !result.warnings.length;
      status.textContent = 'SVGを読み込んでいます。';
    } catch {
      clearImage(); showError('描画エラー：SVGの表示用URLを作成できませんでした。');
    }
  };
  const runner = createRunner(receive);
  const invalidate = () => {
    revision++; runner.cancel();
    clearTimeout(timer); timer = undefined;
    clearImage();
    error.textContent = ''; status.textContent = '';
    input.setAttribute('aria-invalid', 'false');
    warnings.hidden = true; warnings.querySelector('ul')!.replaceChildren();
    cancelButton.disabled = true;
  };
  const update = () => {
    invalidate();
    if (composing || disposed) return;
    cancelButton.disabled = false; status.textContent = '解析を待っています。';
    timer = setTimeout(() => {
      timer = undefined;
      status.textContent = '解析・描画しています。';
      const flags = FLAGS.filter(flag => flagInputs.get(flag)!.checked).join('');
      runner.start(input.value, flags);
    }, DEBOUNCE_MS);
  };
  input.addEventListener('input', update, options);
  input.addEventListener('compositionstart', () => { composing = true; invalidate(); }, options);
  input.addEventListener('compositionend', () => { composing = false; update(); }, options);
  view.querySelector('fieldset')!.addEventListener('change', event => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.checked && (target.value === 'u' || target.value === 'v')) {
      flagInputs.get(target.value === 'u' ? 'v' : 'u')!.checked = false;
    }
    update();
  }, options);
  view.querySelector('[data-clear]')!.addEventListener('click', () => { input.value = ''; update(); input.focus(); }, options);
  cancelButton.addEventListener('click', () => { invalidate(); status.textContent = '解析を中止しました。入力を変更すると再開します。'; }, options);
  download.addEventListener('click', () => {
    if (!svgBlob || download.disabled) return;
    try {
      const downloadUrl = URL.createObjectURL(svgBlob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl; anchor.download = 'regex-diagram.svg';
      view.append(anchor);
      try { anchor.click(); } finally {
        anchor.remove();
        downloads.set(downloadUrl, setTimeout(() => { URL.revokeObjectURL(downloadUrl); downloads.delete(downloadUrl); }, 1000));
      }
    } catch { status.textContent = 'SVGをダウンロードできませんでした。もう一度お試しください。'; }
  }, options);
  container.append(view);
  input.value = '^([A-Za-z]+)(?:-[0-9]{2,4})?$';
  update();
  return () => {
    if (disposed) return;
    disposed = true; invalidate(); runner.dispose(); listeners.abort();
    for (const [downloadUrl, release] of downloads) { clearTimeout(release); URL.revokeObjectURL(downloadUrl); }
    downloads.clear(); view.remove();
  };
}
