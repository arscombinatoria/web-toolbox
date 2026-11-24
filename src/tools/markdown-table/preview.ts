import MarkdownIt from 'markdown-it';
import type { Token } from 'markdown-it';
import type { TableData } from './logic';

export const PREVIEW_LIMITS = {
  rows: 200,
  columns: 50,
  cells: 5_000,
  sourceLength: 200_000,
  tokens: 50_000,
} as const;

const markdown = new MarkdownIt({ html: true, linkify: false, typographer: false });

export type MarkdownPreview = { element?: HTMLDivElement; reason?: string };

function tokenCount(tokens: Token[]): number {
  let count = 0;
  const countTokens = (items: Token[]) => {
    for (const token of items) {
      count++;
      if (count > PREVIEW_LIMITS.tokens) return;
      if (token.children) countTokens(token.children);
      if (count > PREVIEW_LIMITS.tokens) return;
    }
  };
  countTokens(tokens);
  return count;
}

function mismatchReason(): string {
  return 'このMarkdownは既存の変換解析とプレビュー解析で表の形が一致しないため、プレビューできません。変換結果とコピーは利用できます。';
}

function appendInline(parent: HTMLElement, tokens: Token[]): void {
  const stack: HTMLElement[] = [parent];
  const wrapperTags: Record<string, keyof HTMLElementTagNameMap> = {
    strong_open: 'strong', em_open: 'em', s_open: 's',
  };
  for (const token of tokens) {
    const current = stack.at(-1)!;
    if (token.type === 'text') current.append(document.createTextNode(token.content));
    else if (token.type === 'code_inline') {
      const code = document.createElement('code');
      code.textContent = token.content;
      current.append(code);
    } else if (token.type === 'softbreak') current.append(document.createTextNode('\n'));
    else if (token.type === 'hardbreak') current.append(document.createElement('br'));
    else if (token.type === 'html_inline') {
      if (/^<br(?:>|\/>| \/>)$/i.test(token.content)) current.append(document.createElement('br'));
      else current.append(document.createTextNode(token.content));
    } else if (token.type === 'image') {
      const alt = document.createElement('span');
      alt.className = 'table-preview-image-alt';
      alt.textContent = token.content || token.children?.map(child => child.content).join('') || '';
      current.append(alt);
    } else if (token.type === 'link_open' || token.type === 'link_close') {
      // Keep link contents as text; no anchor, URL, title or destination is copied to the DOM.
      continue;
    } else if (token.type.endsWith('_open') && wrapperTags[token.type]) {
      const wrapper = document.createElement(wrapperTags[token.type]!);
      current.append(wrapper);
      stack.push(wrapper);
    } else if (token.type.endsWith('_close') && wrapperTags[token.type.replace('_close', '_open')]) {
      if (stack.length > 1) stack.pop();
    } else {
      // Unknown inline syntax is shown as source text instead of being interpreted.
      if (token.content) current.append(document.createTextNode(token.content));
    }
  }
}

export function buildMarkdownPreview(source: string, expected: TableData): MarkdownPreview {
  const columns = expected.rows[0]?.length ?? 0;
  const cellCount = expected.rows.length * columns;
  if (source.length > PREVIEW_LIMITS.sourceLength || expected.rows.length > PREVIEW_LIMITS.rows
    || columns > PREVIEW_LIMITS.columns || cellCount > PREVIEW_LIMITS.cells) {
    return { reason: `プレビューは${PREVIEW_LIMITS.rows}行、${PREVIEW_LIMITS.columns}列、${PREVIEW_LIMITS.cells.toLocaleString()}セル、Markdown ${PREVIEW_LIMITS.sourceLength.toLocaleString()} UTF-16文字までです。変換結果とコピーは利用できます。` };
  }

  // markdown-it 15 treats a pipe after any backslash as escaped; this converter uses
  // parity, so even runs of 2+ backslashes can produce different column counts.
  if (source.replace(/\r\n?/g, '\n').split('\n').some(line => /(?<!\\)(?:\\\\)+\|/.test(line))) {
    return { reason: mismatchReason() };
  }

  const tokens = markdown.parse(source, {});
  if (tokenCount(tokens) > PREVIEW_LIMITS.tokens) {
    return { reason: `プレビュー解析が安全上限（${PREVIEW_LIMITS.tokens.toLocaleString()}トークン）を超えました。変換結果とコピーは利用できます。` };
  }
  if (tokens.filter(token => token.type === 'table_open').length !== 1
    || tokens.some(token => ![
      'table_open', 'table_close', 'thead_open', 'thead_close', 'tbody_open', 'tbody_close',
      'tr_open', 'tr_close', 'th_open', 'th_close', 'td_open', 'td_close', 'inline',
    ].includes(token.type))) return { reason: mismatchReason() };

  const root = document.createElement('div');
  root.className = 'table-preview-scroll';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', '表のスクロール領域');
  root.tabIndex = 0;
  const element = document.createElement('table');
  element.className = 'table-preview';
  root.append(element);
  const stack: HTMLElement[] = [element];
  const rows: HTMLTableRowElement[] = [];
  for (const token of tokens) {
    if (token.type === 'table_open' || token.type === 'table_close') continue;
    if (token.type.endsWith('_close')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (token.type === 'inline') {
      const cell = stack.at(-1);
      if (!cell || !['TH', 'TD'].includes(cell.tagName)) return { reason: mismatchReason() };
      appendInline(cell, token.children ?? []);
      continue;
    }
    const tags: Record<string, keyof HTMLElementTagNameMap> = {
      table_open: 'table', thead_open: 'thead', tbody_open: 'tbody', tr_open: 'tr', th_open: 'th', td_open: 'td',
    };
    const tag = tags[token.type];
    if (!tag) return { reason: mismatchReason() };
    const node = tag === 'table' ? element : document.createElement(tag);
    if (tag === 'tr') rows.push(node as HTMLTableRowElement);
    if (tag === 'th' || tag === 'td') {
      const style = token.attrs?.find(([name]) => name === 'style')?.[1];
      const alignment = typeof style === 'string' && /^text-align:(left|center|right)$/.exec(style)?.[1];
      if (alignment) node.classList.add(`table-preview-align-${alignment}`);
    }
    stack.at(-1)!.append(node);
    if (tag !== 'table') stack.push(node);
  }
  if (rows.length !== expected.rows.length || rows.some(row => row.cells.length !== columns)) return { reason: mismatchReason() };
  return { element: root };
}
