import { findTool } from '../../registry';
import { parseMarkdown, parseTsv, toMarkdown, toTsv, type TableData } from './logic';
import './style.css';

const INITIAL_SAMPLE = '| 品名 | 数量 | 備考 |\n| --- | --- | --- |\n| りんご | 3 | 青森県産 |\n| みかん | 5 | 愛媛県産 |';

export function mount(container: HTMLElement): () => void {
  const view = document.createElement('div');
  view.className = 'table-tool';
  // 固定HTMLのみ。入力と結果はvalueで扱い、HTMLとして描画しない。
  view.innerHTML = `
    <h1 tabindex="-1"></h1><p class="tool-description"></p>
    <fieldset><legend>変換方向</legend><div class="table-options">
      <label><input type="radio" name="table-direction" value="excel" checked> Markdown → Excel</label>
      <label><input type="radio" name="table-direction" value="markdown"> Excel → Markdown</label>
    </div></fieldset>
    <div class="table-editors">
      <div><label for="table-input">入力</label>
        <p id="table-input-help"></p>
        <textarea id="table-input" rows="8" spellcheck="false" aria-describedby="table-input-help table-error"></textarea>
        <button type="button" data-clear>入力をクリア</button>
      </div>
      <div><label for="table-output">変換結果</label>
        <p id="table-output-help"></p>
        <textarea id="table-output" rows="8" readonly spellcheck="false" aria-describedby="table-output-help"></textarea>
        <button type="button" data-copy>結果をコピー</button>
        <button type="button" data-download>Excelをダウンロード</button>
      </div>
    </div>
    <p id="table-error" role="alert" aria-atomic="true"></p>
    <p class="table-status" role="status" aria-atomic="true"></p>
    <p>入力・結果は外部送信せず、保存もしません。結果は選択して手動でもコピーできます。</p>
    <p>TSVの貼り付けではExcelの自動型判定（数値・日付・数式）を完全には制御できません。
    00123や長い数字、数式風の文字列を確実に文字列として保持するには、Excelをダウンロードしてください。</p>
    <details><summary>対応範囲と制約</summary>
      <p>単一の表を扱い、先頭行をヘッダーとします。Markdownは2行目に --- などの区切り行が必要です。
      外側のパイプは省略可能です。セル内のパイプはコードスパン内でもバックスラッシュでエスケープしてください。
      セル両端のASCIIスペース1文字は構文の余白として除去し、それ以上の空白は保持します。</p>
      <p>&lt;br&gt;、&lt;br/&gt;、&lt;br /&gt;（大小文字不問）はセル内改行に変換します。
      同じ数のバッククォートで閉じたコードスパン内と、バックスラッシュでエスケープしたタグは文字列として保持します。
      その他の装飾・HTML・エンティティは解釈しません。配置情報は保持しません。</p>
      <p>Excelからは引用符付きTSVの貼り付けに対応します。セル内のタブ・改行・引用符を保持し、改行はMarkdownで &lt;br&gt; に統一します。
      XLSXのアップロード、複数表、結合セルには対応しません。列数の不一致と不正な引用符はエラーになります。</p>
    </details>`;
  const tool = findTool('markdown-table')!;
  view.querySelector('h1')!.textContent = tool.name;
  view.querySelector('.tool-description')!.textContent = tool.description;
  const input = view.querySelector<HTMLTextAreaElement>('#table-input')!;
  const output = view.querySelector<HTMLTextAreaElement>('#table-output')!;
  const copy = view.querySelector<HTMLButtonElement>('[data-copy]')!;
  const download = view.querySelector<HTMLButtonElement>('[data-download]')!;
  const status = view.querySelector<HTMLElement>('[role="status"]')!;
  const error = view.querySelector<HTMLElement>('[role="alert"]')!;
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  const urls = new Map<string, ReturnType<typeof setTimeout>>();
  let disposed = false;
  let revision = 0;
  let copying = false;
  let downloading = false;
  let table: TableData = { rows: [] };
  const toExcel = () => view.querySelector<HTMLInputElement>('[value="excel"]')!.checked;
  const buttons = () => {
    copy.disabled = copying || !table.rows.length;
    download.disabled = downloading || !table.rows.length;
    download.hidden = !toExcel();
  };
  const updateInput = () => {
    revision++;
    status.textContent = '';
    error.textContent = '';
    view.querySelector('#table-input-help')!.textContent = toExcel() ? 'Markdown表を貼り付けてください。' : 'Excelでコピーしたセル範囲を貼り付けてください。';
    view.querySelector('#table-output-help')!.textContent = toExcel() ? 'Excel貼り付け用TSV' : 'Markdown表';
    table = { rows: [] };
    output.value = '';
    try {
      table = toExcel() ? parseMarkdown(input.value) : parseTsv(input.value);
      output.value = toExcel() ? toTsv(table) : toMarkdown(table);
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : '変換できませんでした。';
    }
    input.setAttribute('aria-invalid', String(Boolean(error.textContent)));
    buttons();
  };
  const updateDirection = () => {
    // 直前の変換に成功した場合のみ、その結果を次の入力として渡す。
    // 失敗時は入力を残し、新しい方向で再検証してエラー表示を更新する。
    if (!error.textContent) input.value = output.value;
    updateInput();
  };
  input.value = INITIAL_SAMPLE;
  input.addEventListener('input', updateInput, options);
  view.querySelectorAll<HTMLInputElement>('input[name="table-direction"]').forEach(radio => {
    radio.addEventListener('change', updateDirection, options);
  });
  view.querySelector('[data-clear]')!.addEventListener('click', () => {
    input.value = ''; updateInput(); input.focus();
  }, options);
  copy.addEventListener('click', async () => {
    if (copying || !table.rows.length) return;
    const current = revision;
    copying = true; buttons();
    try {
      // textareaはCRLFをLFへ正規化するため、共通データからコピー用に生成する。
      await navigator.clipboard.writeText(toExcel() ? toTsv(table) : toMarkdown(table));
      if (!disposed && current === revision) status.textContent = 'コピーしました。';
    } catch {
      if (!disposed && current === revision) status.textContent = 'コピーできませんでした。変換結果を選択して手動でコピーしてください。';
    } finally {
      copying = false;
      if (!disposed) buttons();
    }
  }, options);
  download.addEventListener('click', async () => {
    if (downloading || !table.rows.length || !toExcel()) return;
    const current = revision;
    const snapshot = table;
    downloading = true; buttons(); status.textContent = 'Excelファイルを生成しています。';
    try {
      const { generateXlsx } = await import('./xlsx');
      if (disposed || current !== revision) return;
      const bytes = await generateXlsx(snapshot);
      if (disposed || current !== revision) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'table.xlsx';
      view.append(anchor);
      try { anchor.click(); } finally {
        anchor.remove();
        // ブラウザがダウンロードを開始してから解放。破棄時も必ず解放する。
        urls.set(url, setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 1000));
      }
      status.textContent = 'Excelファイルをダウンロードしました。';
    } catch (cause) {
      if (!disposed && current === revision) status.textContent = `Excelを生成できませんでした。${cause instanceof Error ? cause.message : ''}`;
    } finally {
      downloading = false;
      if (!disposed) buttons();
    }
  }, options);
  container.append(view);
  updateInput();
  return () => {
    disposed = true;
    listeners.abort();
    for (const [url, timer] of urls) { clearTimeout(timer); URL.revokeObjectURL(url); }
    urls.clear(); view.remove();
  };
}
