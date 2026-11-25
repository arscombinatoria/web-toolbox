import { Check, CircleAlert, Copy } from 'lucide';
import { createIcon, setIconMessage } from '../../components/icon';
import { findTool } from '../../registry';
import { convert, formatDateTime, hourTable, toInstant, type Zone } from './logic';
import './style.css';

export function mount(container: HTMLElement): () => void {
  const view = document.createElement('div');
  view.className = 'datetime-tool';
  // 固定テンプレートのみ。入力値と変換結果はvalue/textContentで設定する。
  view.innerHTML = `
    <h1 tabindex="-1"></h1><p class="tool-description"></p>
    <section aria-labelledby="datetime-now-title"><h2 id="datetime-now-title">現在の日時</h2>
      <div class="datetime-clocks"><p>JST <time data-now-jst></time></p><p>UTC <time data-now-utc></time></p></div>
      <p class="datetime-help">約1分ごとに更新します。JSTはUTCより9時間進んでいます。</p></section>
    <section aria-labelledby="datetime-detail-title"><h2 id="datetime-detail-title" tabindex="-1">日時の詳細変換</h2>
      <p id="datetime-help" class="datetime-help">日付はYYYY-MM-DD（0001〜9999年）、時刻はHH:mm:ss（24時間制）で入力してください。時刻はHH:mmも受け付け、秒を00として扱います。JSTはUTC+09:00固定です。うるう秒は非対応です。</p>
      <div class="datetime-controls">
        <label for="datetime-zone">入力タイムゾーン<select id="datetime-zone"><option>JST</option><option>UTC</option></select></label>
        <label for="datetime-date">詳細の日付<input id="datetime-date" type="text" placeholder="YYYY-MM-DD" autocomplete="off" spellcheck="false" aria-describedby="datetime-help datetime-error"></label>
        <label for="datetime-time">詳細の時刻<input id="datetime-time" type="text" placeholder="HH:mm:ss" autocomplete="off" spellcheck="false" aria-describedby="datetime-help datetime-error"></label>
      </div><button type="button" data-now>現在時刻を入力</button>
      <p id="datetime-error" role="alert"></p><div class="datetime-results"></div>
      <p role="status" aria-atomic="true"></p>
      <p class="datetime-help">ISO 8601・Unix timeは出力専用です。結果は選択して手動コピーできます。入力・結果は外部送信・保存しません。</p>
    </section>`;
  const tableSection = document.createElement('section');
  tableSection.setAttribute('aria-labelledby', 'datetime-table-title');
  tableSection.innerHTML = `
    <h2 id="datetime-table-title">JST ↔ UTC 24時間対応表</h2>
    <div class="datetime-controls"><label for="datetime-table-date">対応表の日付（JST）<input id="datetime-table-date" type="text" placeholder="YYYY-MM-DD" autocomplete="off" spellcheck="false" aria-describedby="datetime-table-help datetime-table-error"></label><button type="button" data-today>今日へ戻る</button></div>
    <p id="datetime-table-help" class="datetime-help">日付はYYYY-MM-DDで入力してください。時刻を選ぶと上の詳細変換欄に反映します。</p>
    <p id="datetime-table-error" role="alert"></p>
    <div class="datetime-tables">
      <table><caption>JST 00:00〜11:00</caption><thead><tr><th scope="col">JST</th><th scope="col">UTC</th><th scope="col">日付</th></tr></thead><tbody></tbody></table>
      <table><caption>JST 12:00〜23:00</caption><thead><tr><th scope="col">JST</th><th scope="col">UTC</th><th scope="col">日付</th></tr></thead><tbody></tbody></table>
    </div>
    <button type="button" data-back-to-detail>詳細変換欄へ戻る</button>`;
  view.append(tableSection);
  const get = <T extends Element = HTMLElement>(selector: string) => view.querySelector<T>(selector)!;
  const tool = findTool('datetime')!;
  get('h1').textContent = tool.name;
  get('.tool-description').textContent = tool.description;
  const tableDate = get<HTMLInputElement>('#datetime-table-date');
  const date = get<HTMLInputElement>('#datetime-date');
  const time = get<HTMLInputElement>('#datetime-time');
  const zone = get<HTMLSelectElement>('#datetime-zone');
  const status = get('[role="status"]');
  const error = get('#datetime-error');
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  let disposed = false;
  let revision = 0;
  let selected: number | null = null;
  const outputs = (['jst', 'utc', 'iso', 'seconds', 'milliseconds'] as const).map((key, i) => {
    const labelText = ['JST日時', 'UTC日時', 'ISO 8601', 'Unix time（秒）', 'Unix time（ミリ秒）'][i]!;
    const row = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = labelText; label.htmlFor = `datetime-${key}`;
    const output = document.createElement('input');
    output.id = label.htmlFor; output.readOnly = true;
    const copy = document.createElement('button');
    copy.type = 'button'; copy.textContent = 'コピー'; copy.setAttribute('aria-label', `${labelText}をコピー`);
    copy.prepend(createIcon(Copy));
    copy.addEventListener('click', async () => {
      const current = revision;
      status.textContent = ''; copy.disabled = true;
      try {
        await navigator.clipboard.writeText(output.value);
        if (!disposed && current === revision) setIconMessage(status, Check, `${labelText}をコピーしました。`);
      } catch {
        if (!disposed && current === revision) setIconMessage(status, CircleAlert, 'コピーできませんでした。結果を選択して手動でコピーしてください。');
      } finally { if (!disposed) copy.disabled = !output.value; }
    }, options);
    row.append(label, output, copy); get('.datetime-results').append(row);
    return { key, output, copy };
  });
  const highlight = () => {
    const now = formatDateTime(Date.now(), 'JST');
    for (const row of view.querySelectorAll<HTMLTableRowElement>('.datetime-tables tbody tr')) {
      const current = tableDate.value === now.slice(0, 10) && Number(row.dataset.hour) === Number(now.slice(11, 13));
      row.classList.toggle('is-current', current);
      row.classList.toggle('is-selected', Number(row.dataset.instant) === selected);
      row.querySelector('button')!.setAttribute('aria-pressed', String(Number(row.dataset.instant) === selected));
      row.querySelector('[data-marker]')!.textContent = [current ? '現在' : '', Number(row.dataset.instant) === selected ? '選択中' : ''].filter(Boolean).join('・');
    }
  };
  const updateDetail = () => {
    revision++; status.textContent = ''; error.textContent = ''; selected = null;
    let result: ReturnType<typeof convert> | undefined;
    try { selected = toInstant(date.value, time.value, zone.value as Zone); result = convert(selected); }
    catch (cause) { setIconMessage(error, CircleAlert, (cause as Error).message); }
    date.setAttribute('aria-invalid', String(!result)); time.setAttribute('aria-invalid', String(!result));
    for (const { key, output, copy } of outputs) { output.value = result?.[key] ?? ''; copy.disabled = !result; }
    highlight();
  };
  const renderTable = () => {
    const bodies = [...view.querySelectorAll<HTMLTableSectionElement>('.datetime-tables tbody')];
    for (const body of bodies) body.replaceChildren();
    const tableError = get('#datetime-table-error'); tableError.textContent = '';
    try {
      for (const item of hourTable(tableDate.value)) {
        const body = bodies[item.hour < 12 ? 0 : 1]!;
        const row = document.createElement('tr'); row.dataset.hour = String(item.hour); row.dataset.instant = String(item.instant);
        const cell = document.createElement('td');
        const button = document.createElement('button'); button.type = 'button'; button.textContent = item.jst;
        button.setAttribute('aria-label', `JST ${item.jst}を選択`);
        const marker = document.createElement('small'); marker.dataset.marker = '';
        cell.append(button, marker);
        const utc = document.createElement('td'); utc.textContent = item.utc;
        const relation = document.createElement('td'); relation.textContent = item.relation;
        row.append(cell, utc, relation); body.append(row);
      }
    } catch (cause) { setIconMessage(tableError, CircleAlert, (cause as Error).message); }
    tableDate.setAttribute('aria-invalid', String(Boolean(tableError.textContent)));
    highlight();
  };
  get('.datetime-tables').addEventListener('click', event => {
    const button = (event.target as Element).closest('button');
    if (!button) return;
    zone.value = 'JST'; date.value = tableDate.value; time.value = `${button.textContent}:00`; updateDetail();
  }, options);
  get('[data-back-to-detail]').addEventListener('click', () => {
    const heading = get<HTMLElement>('#datetime-detail-title');
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, options);
  const clock = () => {
    for (const z of ['JST', 'UTC'] as const) get(`[data-now-${z.toLowerCase()}]`).textContent = formatDateTime(Date.now(), z).slice(0, -3);
    highlight();
  };
  const fillNow = () => {
    const now = formatDateTime(Date.now(), zone.value as Zone);
    date.value = now.slice(0, 10); time.value = now.slice(11); updateDetail();
  };
  const today = () => { tableDate.value = formatDateTime(Date.now(), 'JST').slice(0, 10); renderTable(); };
  tableDate.addEventListener('input', renderTable, options);
  for (const input of [date, time, zone]) input.addEventListener('input', updateDetail, options);
  get('[data-today]').addEventListener('click', today, options);
  get('[data-now]').addEventListener('click', fillNow, options);
  const visible = () => { if (document.visibilityState === 'visible') clock(); };
  document.addEventListener('visibilitychange', visible, options);
  container.append(view); today(); fillNow(); clock();
  const timer = setInterval(clock, 60000);
  return () => { disposed = true; clearInterval(timer); listeners.abort(); view.remove(); };
}
