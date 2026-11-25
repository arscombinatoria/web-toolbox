import { Check, CircleAlert, CircleStop, Download, Play, Trash2, X } from 'lucide';
import { createIcon, setIconMessage } from '../../components/icon';
import { findTool } from '../../registry';
import { createRunner } from './runner';
import { createMatchRunner } from './match-runner';
import { renderMatchError, renderMatchResults } from './match-view';
import { DEBOUNCE_MS, FLAGS, type DiagramResult } from './protocol';
import './style.css';

export function mount(container: HTMLElement): () => void {
  const view = document.createElement('div');
  view.className = 'regex-tool';
  // 固定HTMLのみ。パターン・エラー・SVG文字列はHTMLへ挿入しない。
  view.innerHTML = `
    <h1 tabindex="-1"></h1><p class="tool-description"></p>
    <section class="regex-input-section">
      <label for="regex-pattern">正規表現のパターン</label>
      <p id="regex-help">/ の区切り文字は不要です。前後の空白も文字として保持します。入力後に自動更新します。</p>
      <textarea id="regex-pattern" rows="3" spellcheck="false" autocapitalize="off" autocomplete="off" aria-describedby="regex-help regex-error"></textarea>
      <button type="button" data-clear>入力をクリア</button>
      <p id="regex-error" role="alert" aria-atomic="true"></p>
    </section>
    <section class="regex-options">
      <fieldset><legend>フラグ</legend><div class="regex-flags"></div>
        <p>u と v は同時指定できません。一方を選ぶと他方を解除します。</p>
      </fieldset>
    </section>
    <section class="regex-diagram-section">
      <div class="regex-diagram-heading"><h2>Railroad Diagram</h2><div class="regex-diagram-actions">
        <button type="button" data-cancel disabled>解析を中止</button>
        <button type="button" data-download disabled>SVGをダウンロード</button>
      </div></div>
      <p role="status" aria-atomic="true"></p>
      <aside class="regex-warnings" aria-label="意味上の注意" hidden><h2>意味上の注意</h2><ul></ul></aside>
      <p id="regex-legend">左から右に構造を読みます。破線は0文字の条件、点線は後方参照です。広い図は枠内でスクロールできます。</p>
      <div class="regex-canvas" tabindex="0" role="region" aria-label="正規表現の構造図（横にスクロールできます）" aria-describedby="regex-legend"><img alt="正規表現のRailroad Diagram" hidden></div>
      <details class="regex-reading-guide"><summary>図の読み方</summary>
        <p>上の右向き経路は省略、下の左向き経路は繰り返しです。合計回数と貪欲マッチ・非貪欲マッチの優先順位は要素の上下のラベルで指定します。貪欲マッチは繰り返し回数の多い方から、非貪欲マッチは少ない方から試します。集合の内部は原文表記です。</p>
      </details>
    </section>
    <section class="regex-match-section" aria-labelledby="regex-match-heading">
      <div class="regex-match-heading"><h2 id="regex-match-heading">マッチ確認</h2><div class="regex-match-actions">
        <button type="button" data-match-run>マッチを確認</button>
        <button type="button" data-match-stop disabled>マッチングを中止</button>
        <button type="button" data-match-clear>テスト文字列をクリア</button>
      </div></div>
      <label for="regex-test-text">テスト文字列</label>
      <p id="regex-test-help">初期状態は空です。実行すると、選択中のパターンとフラグで検索します。</p>
      <textarea id="regex-test-text" rows="5" spellcheck="false" autocapitalize="off" autocomplete="off" aria-describedby="regex-test-help"></textarea>
      <p class="regex-match-status" role="status" aria-atomic="true"></p>
      <div class="regex-match-error" role="alert" aria-atomic="true"></div>
      <div class="regex-match-results"></div>
    </section>
    <p>入力・結果はブラウザ内だけで処理し、送信・URL・履歴・ログ・Cookie・ストレージへ保存しません。</p>
    <details><summary>対応範囲と制約</summary>
      <p>ECMAScript 2025の文字列・文字クラス・範囲・選択・量指定子・グループ・後方参照・アサーション・Unicodeプロパティ・Unicode集合演算に対応します。
        条件の内部構造は主経路とは独立して表示します。後読みの内部はソース順で表示し、評価方向は右から左です。
        Unicode集合は展開・列挙せず、&&（共通部分）、--（差集合）、入れ子、\\q{…}を原文で示します。</p>
      <p>i は大文字小文字の区別、m は行境界、s は改行を含むドット、u/v はUnicodeの解釈に影響します。
        d/g/y は検索時の動作フラグで、構造の分岐は増やしません。i の文字展開や検索開始位置、バックトラッキングの実行順は再現しません。
        図は意味解析の完全な検証ではなく、到達不能な分岐や空になるUnicode集合をすべて検出するものではありません。</p>
      <p>図の安全上限はパターン4,096 UTF-16コード単位、800 ASTノード、深さ48、図の各辺16,000px・面積1,200万px、SVG100万文字、処理4秒です。
        超過時は切り詰めず理由を表示します。図は選択中のテーマで表示し、同じ配色で保存します。</p>
      <p>マッチ確認はブラウザ標準のネイティブRegExpを独立した遅延Web Workerで新規コンパイルして実行します。regexppの図解析と結果・エラーは独立しており、一方の構文対応が他方の実行可否を保証しません。検索は明示的な実行操作だけで始まり、g なしは最初の一致、g ありは左から検索します。y は各実行位置からだけ検索し、空一致後は u/v に応じてコードポイント単位、その他はUTF-16コード単位で進めます。d は捕捉範囲を表示します。位置はUTF-16の0始まり・終端を含まない形式です。</p>
      <p>マッチ確認の上限はパターン4,096、テスト文字列32,768 UTF-16コード単位、1,000件、捕捉値4,096件、返却する文字列の合計262,144コード単位、起動を含む実行2,000msです。上限時はそれまでの完全な結果だけを表示し、未確認の残りを明記します。入力超過・時間切れは部分結果を返しません。重複する名前付き・番号付き捕捉も別項目として数えます。Workerから入力全文を返さず、画面上の元文字列を使います。ゼロ幅一致はコピーに含まれない視覚マーカーで示します。</p>
    </details>`;
  const tool = findTool('regex-visualizer')!;
  view.querySelector('h1')!.textContent = tool.name;
  view.querySelector('.tool-description')!.textContent = tool.description;
  const input = view.querySelector<HTMLTextAreaElement>('#regex-pattern')!;
  const error = view.querySelector<HTMLElement>('.regex-input-section [role="alert"]')!;
  const status = view.querySelector<HTMLElement>('.regex-diagram-section [role="status"]')!;
  const matchText = view.querySelector<HTMLTextAreaElement>('#regex-test-text')!;
  const matchStatus = view.querySelector<HTMLElement>('.regex-match-status')!;
  const matchError = view.querySelector<HTMLElement>('.regex-match-error')!;
  const matchResults = view.querySelector<HTMLElement>('.regex-match-results')!;
  const matchRunButton = view.querySelector<HTMLButtonElement>('[data-match-run]')!;
  const matchStopButton = view.querySelector<HTMLButtonElement>('[data-match-stop]')!;
  const matchClearButton = view.querySelector<HTMLButtonElement>('[data-match-clear]')!;
  const warnings = view.querySelector<HTMLElement>('.regex-warnings')!;
  const image = view.querySelector<HTMLImageElement>('img')!;
  const cancelButton = view.querySelector<HTMLButtonElement>('[data-cancel]')!;
  const download = view.querySelector<HTMLButtonElement>('[data-download]')!;
  view.querySelector('[data-clear]')!.prepend(createIcon(Trash2));
  cancelButton.prepend(createIcon(X));
  download.prepend(createIcon(Download));
  matchRunButton.prepend(createIcon(Play));
  matchStopButton.prepend(createIcon(CircleStop));
  matchClearButton.prepend(createIcon(Trash2));
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
  let baseSvg: string | undefined;
  const root = document.documentElement;
  const currentTheme = () => root.dataset.theme === 'dark' ? 'dark' : 'light';
  let renderedTheme = currentTheme();
  let disposed = false;
  let revision = 0;
  let composing = false;
  let matchComposing = false;
  let resultListeners: AbortController | undefined;
  const downloads = new Map<string, ReturnType<typeof setTimeout>>();
  const clearImage = () => {
    image.onload = null; image.onerror = null;
    image.hidden = true; image.removeAttribute('src');
    download.disabled = true;
    if (url) URL.revokeObjectURL(url);
    url = undefined; svgBlob = undefined;
  };
  const showError = (text: string) => { setIconMessage(error, CircleAlert, text); status.textContent = ''; };
  const renderImage = () => {
    if (disposed || !baseSvg) return;
    const current = revision;
    const previousUrl = url;
    renderedTheme = currentTheme();
    download.disabled = true;
    // テーマ更新中も画像の領域を保持し、旧配色の描画だけを隠す。
    image.style.visibility = 'hidden';
    try {
      // 生成器の固定ルートだけに固定属性を追加する。入力やDOMの属性値は挿入しない。
      const svg = baseSvg.replace(/^<svg\b/, `<svg data-theme="${renderedTheme}"`);
      svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const nextUrl = URL.createObjectURL(svgBlob);
      url = nextUrl;
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      image.onload = () => {
        if (disposed || current !== revision || url !== nextUrl) return;
        image.style.setProperty('--diagram-min-width', `${image.naturalWidth * 0.8}px`);
        image.style.visibility = '';
        setIconMessage(status, Check, '図を更新しました。'); download.disabled = false;
      };
      image.onerror = () => {
        if (disposed || current !== revision || url !== nextUrl) return;
        clearImage(); showError('描画エラー：SVGを表示できませんでした。');
      };
      image.src = nextUrl; image.hidden = false;
      status.textContent = 'SVGを読み込んでいます。';
    } catch {
      clearImage(); showError('描画エラー：SVGの表示用URLを作成できませんでした。');
    }
  };
  const themeObserver = new MutationObserver(() => {
    if (currentTheme() !== renderedTheme) renderImage();
  });
  themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  const receive = (result: DiagramResult) => {
    if (disposed) return;
    cancelButton.disabled = true;
    if (!result.ok) {
      const category = { syntax: '構文エラー', limit: '安全上限', render: '描画エラー' }[result.kind];
      showError(`${category}：${result.message}${result.position === undefined ? '' : `（位置 ${result.position + 1}、UTF-16・1始まり）`}`);
      input.setAttribute('aria-invalid', String(result.kind === 'syntax'));
      return;
    }
    baseSvg = result.svg;
    renderImage();
    const list = warnings.querySelector('ul')!;
    for (const warning of result.warnings) {
      const item = document.createElement('li'); item.textContent = warning; list.append(item);
    }
    warnings.hidden = !result.warnings.length;
  };
  const runner = createRunner(receive);
  const clearMatchOutput = () => { resultListeners?.abort(); resultListeners = undefined; matchResults.replaceChildren(); matchError.replaceChildren(); };
  const matchRunner = createMatchRunner(result => {
    if (disposed) return;
    matchStopButton.disabled = true;
    if (!result.ok) { renderMatchError(matchError, result); matchStatus.textContent = ''; return; }
    matchError.replaceChildren();
    resultListeners = new AbortController();
    renderMatchResults(matchResults, matchText.value, result, resultListeners.signal);
    const reason = { matches: 'マッチ件数', captures: '捕捉値数', output: '返却文字列量' }[result.reason ?? 'matches'];
    matchStatus.textContent = result.incomplete ? `安全上限（${reason}）。ここまで${result.matches.length.toLocaleString('ja-JP')}件を表示し、残りは未確認です。` : result.matches.length ? `${result.matches.length.toLocaleString('ja-JP')}件を確認しました。` : 'マッチはありません。';
  });
  const invalidateMatch = (message = '') => {
    matchRunner.cancel(); matchStopButton.disabled = true; clearMatchOutput(); matchStatus.textContent = message;
  };
  const invalidate = () => {
    revision++; runner.cancel();
    clearTimeout(timer); timer = undefined;
    baseSvg = undefined;
    clearImage();
    error.textContent = ''; status.textContent = '';
    input.setAttribute('aria-invalid', 'false');
    warnings.hidden = true; warnings.querySelector('ul')!.replaceChildren();
    cancelButton.disabled = true;
  };
  const update = () => {
    invalidateMatch('パターンまたはフラグが変わりました。マッチ確認を再実行してください。');
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
  matchText.addEventListener('input', () => invalidateMatch('テスト文字列が変わりました。マッチ確認を再実行してください。'), options);
  matchText.addEventListener('compositionstart', () => { matchComposing = true; matchRunButton.disabled = true; invalidateMatch('日本語入力の変換中です。'); }, options);
  matchText.addEventListener('compositionend', () => { matchComposing = false; matchRunButton.disabled = composing; invalidateMatch('未実行'); }, options);
  input.addEventListener('compositionstart', () => { composing = true; matchRunButton.disabled = true; invalidateMatch('日本語入力の変換中です。'); invalidate(); }, options);
  input.addEventListener('compositionend', () => { composing = false; matchRunButton.disabled = matchComposing; update(); }, options);
  view.querySelector('fieldset')!.addEventListener('change', event => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.checked && (target.value === 'u' || target.value === 'v')) {
      flagInputs.get(target.value === 'u' ? 'v' : 'u')!.checked = false;
    }
    update();
  }, options);
  view.querySelector('[data-clear]')!.addEventListener('click', () => { input.value = ''; update(); input.focus(); }, options);
  matchRunButton.addEventListener('click', () => {
    if (composing || matchComposing || disposed) { invalidateMatch('日本語入力の変換中は実行できません。'); return; }
    clearMatchOutput(); matchStatus.textContent = 'マッチ確認を実行しています。'; matchStopButton.disabled = false;
    const flags = FLAGS.filter(flag => flagInputs.get(flag)!.checked).join('');
    matchRunner.start(input.value, flags, matchText.value);
  }, options);
  matchStopButton.addEventListener('click', () => invalidateMatch('マッチ確認を停止しました。'), options);
  matchClearButton.addEventListener('click', () => { matchText.value = ''; invalidateMatch('テスト文字列をクリアしました。'); matchText.focus(); }, options);
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
  invalidateMatch('未実行');
  return () => {
    if (disposed) return;
    disposed = true; themeObserver.disconnect(); invalidate(); runner.dispose(); invalidateMatch(); matchRunner.dispose(); listeners.abort();
    for (const [downloadUrl, release] of downloads) { clearTimeout(release); URL.revokeObjectURL(downloadUrl); }
    downloads.clear(); view.remove();
  };
}
