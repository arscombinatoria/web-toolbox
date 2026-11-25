import type { MatchItem, MatchResult } from './match-protocol';

const appendText = (parent: ParentNode, value: string) => parent.append(document.createTextNode(value));

export function renderMatchResults(container: HTMLElement, input: string, result: Extract<MatchResult, { ok: true }>, signal: AbortSignal): void {
  container.replaceChildren();
  const highlight = document.createElement('p'); highlight.className = 'regex-match-highlight';
  highlight.setAttribute('aria-label', 'テスト文字列。マッチ箇所は視覚的に強調表示されています。');
  let cursor = 0;
  for (const match of result.matches) {
    appendText(highlight, input.slice(cursor, match.index));
    if (match.index === match.end) {
      const marker = document.createElement('span'); marker.className = 'regex-zero-width-marker'; marker.setAttribute('aria-hidden', 'true'); marker.title = `0文字一致: ${match.index}–${match.end}`; highlight.append(marker);
    } else {
      const mark = document.createElement('mark'); mark.className = 'regex-match-mark'; mark.textContent = input.slice(match.index, match.end); highlight.append(mark);
    }
    cursor = match.end;
  }
  appendText(highlight, input.slice(cursor));
  container.append(highlight);
  const list = document.createElement('ol'); list.className = 'regex-match-list';
  result.matches.forEach((match, index) => list.append(buildMatch(match, index, signal)));
  container.append(list);
}

function buildMatch(match: MatchItem, index: number, signal: AbortSignal): HTMLLIElement {
  const item = document.createElement('li'); item.className = 'regex-match-item';
  const heading = document.createElement('h3'); heading.textContent = `マッチ ${index + 1}`;
  const summary = document.createElement('p'); summary.textContent = `UTF-16位置 ${match.index}–${match.end}（0始まり、終端を含まない）: ${JSON.stringify(match.value)}`;
  item.append(heading, summary);
  const numbered = match.captures.filter(capture => capture.number !== undefined);
  const named = match.captures.filter(capture => capture.name);
  if (numbered.length) item.append(buildCaptureDetails('番号付き捕捉', numbered, signal));
  if (named.length) item.append(buildCaptureDetails('名前付き捕捉', named, signal));
  return item;
}

function buildCaptureDetails(title: string, captures: MatchItem['captures'], signal: AbortSignal): HTMLDetailsElement {
  const details = document.createElement('details'); details.className = 'regex-match-captures';
  const summary = document.createElement('summary'); summary.textContent = `${title}（${captures.length}）`; details.append(summary);
  let rendered = false;
  details.addEventListener('toggle', () => {
    if (!details.open || rendered) return;
    rendered = true;
    const list = document.createElement('ul');
    for (const capture of captures) {
      const row = document.createElement('li');
      const label = capture.name === undefined ? `捕捉 ${capture.number}` : `名前付き捕捉 ${capture.name}`;
      row.textContent = `${label}: ${capture.value === null ? 'undefined' : JSON.stringify(capture.value)}${capture.start === null ? '' : ` — UTF-16位置 ${capture.start}–${capture.end}（0始まり、終端を含まない）`}`;
      list.append(row);
    }
    details.append(list);
  }, { signal });
  return details;
}

export function renderMatchError(container: HTMLElement, result: Exclude<MatchResult, { ok: true }>): void {
  container.replaceChildren();
  const p = document.createElement('p');
  p.textContent = `${({ syntax: 'ネイティブRegExpコンパイルエラー', limit: '安全上限', timeout: '時間上限', worker: 'Workerエラー' } as const)[result.kind]}: ${result.message}`;
  container.append(p);
}
