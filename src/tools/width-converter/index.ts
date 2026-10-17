import { findTool } from '../../registry';
import { convertWidth, type Categories } from './logic';
import './style.css';

export function mount(container: HTMLElement): () => void {
  const view = document.createElement('div');
  view.className = 'width-tool';
  // 固定HTMLのみ。入力文字列はtextarea.valueで扱う。
  view.innerHTML = `
    <h1 tabindex="-1"></h1>
    <p class="tool-description"></p>
    <fieldset>
      <legend>変換方向</legend>
      <div class="width-options">
        <label><input type="radio" name="width-direction" value="to-half" checked> 全角 → 半角</label>
        <label><input type="radio" name="width-direction" value="to-full"> 半角 → 全角</label>
      </div>
    </fieldset>
    <fieldset>
      <legend>変換対象</legend>
      <div class="width-options">
        <label><input type="checkbox" name="alphanumeric" checked> 英数字</label>
        <label><input type="checkbox" name="symbols" checked> 記号</label>
        <label><input type="checkbox" name="katakana"> カタカナ</label>
        <label><input type="checkbox" name="spaces" checked> スペース</label>
      </div>
    </fieldset>
    <div class="width-editors">
      <div><label for="width-input">入力</label>
        <textarea id="width-input" rows="8" spellcheck="false" aria-describedby="width-privacy"></textarea>
        <button type="button" data-clear>入力をクリア</button>
      </div>
      <div><label for="width-output">変換結果</label>
        <textarea id="width-output" rows="8" readonly spellcheck="false" aria-describedby="width-copy-help"></textarea>
        <button type="button" data-copy>結果をコピー</button>
        <p id="width-copy-help">結果は選択して手動でもコピーできます。</p>
      </div>
    </div>
    <p class="width-status" role="status" aria-atomic="true"></p>
    <p id="width-privacy">入力・結果は外部送信せず、保存もしません。すべての変換対象をOFFにすると入力をそのまま表示します。</p>
    <details><summary>対応する文字・変換の制約</summary>
      <p>英数字と記号はASCII U+0021–U+007Eと全角U+FF01–U+FF5Eの対応のみです。
      ~（U+007E）と～（U+FF5E）、\\（U+005C）と＼（U+FF3C）は相互変換します。
      波ダッシュ〜（U+301C）や円記号¥（U+00A5）は変更しません。</p>
      <p>カタカナは半角U+FF61–U+FF9Fに対応するカナ・長音・中黒・句読点（。「」、）・濁点を扱います。
      合成済みカナと結合濁点・半濁点に対応します。単独の半角濁点・半濁点は全角方向で結合文字U+3099・U+309Aになります。
      ゛・゜も半角方向でﾞ・ﾟになるため、完全な往復一致は保証しません。ヵ・ヶ・ヮなど半角対応がないカナは保持します。</p>
      <p>スペースはU+0020とU+3000のみ。タブ・改行・その他の空白、丸数字・ローマ数字、ひらがなや対応外のUnicode文字は変更しません。</p>
    </details>`;
  const tool = findTool('width-converter')!;
  view.querySelector('h1')!.textContent = tool.name;
  view.querySelector('.tool-description')!.textContent = tool.description;
  const input = view.querySelector<HTMLTextAreaElement>('#width-input')!;
  const output = view.querySelector<HTMLTextAreaElement>('#width-output')!;
  const copy = view.querySelector<HTMLButtonElement>('[data-copy]')!;
  const clear = view.querySelector<HTMLButtonElement>('[data-clear]')!;
  const status = view.querySelector<HTMLElement>('[role="status"]')!;
  const listeners = new AbortController();
  const eventOptions = { signal: listeners.signal };
  let disposed = false;
  let composing = false;
  let revision = 0;
  let copying = false;
  const update = () => {
    if (disposed || composing) return;
    const categories: Categories = {
      alphanumeric: false, symbols: false, katakana: false, spaces: false,
    };
    for (const category of Object.keys(categories) as (keyof Categories)[]) {
      categories[category] = view.querySelector<HTMLInputElement>(`[name="${category}"]`)!.checked;
    }
    const toHalf = view.querySelector<HTMLInputElement>('[value="to-half"]')!.checked;
    output.value = convertWidth(input.value, toHalf ? 'to-half' : 'to-full', categories);
    revision++;
    status.textContent = '';
  };
  input.addEventListener('compositionstart', () => { composing = true; revision++; status.textContent = ''; }, eventOptions);
  input.addEventListener('compositionend', () => { composing = false; update(); }, eventOptions);
  input.addEventListener('input', (event) => {
    // 確定直前のinputと、compositionend後の最終inputのどちらの順序にも対応する。
    if (!(event instanceof InputEvent && event.isComposing)) update();
  }, eventOptions);
  view.addEventListener('change', update, eventOptions);
  clear.addEventListener('click', () => {
    input.value = '';
    composing = false;
    update();
    input.focus();
  }, eventOptions);
  copy.addEventListener('click', async () => {
    if (disposed || copying) return;
    const current = revision;
    copying = true;
    copy.disabled = true;
    status.textContent = '';
    try {
      await navigator.clipboard.writeText(output.value);
      if (!disposed && current === revision) status.textContent = 'コピーしました。';
    } catch {
      if (!disposed && current === revision) {
        status.textContent = 'コピーできませんでした。変換結果を選択して手動でコピーしてください。';
      }
    } finally {
      copying = false;
      if (!disposed) copy.disabled = false;
    }
  }, eventOptions);
  container.append(view);
  update();
  return () => {
    disposed = true;
    listeners.abort();
    view.remove();
  };
}
