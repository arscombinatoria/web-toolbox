export type TokenKind = 'header' | 'payload' | 'signature' | 'key' | 'string' | 'number' | 'literal';
export interface HighlightToken { text: string; kind?: TokenKind }
// Bound DOM work independently of the decoder's 256KiB input limit.
export const MAX_HIGHLIGHT_TOKENS = 2048;
const MAX_HIGHLIGHT_LENGTH = 256 * 1024;
const plain = (source: string): HighlightToken[] => [{ text: source }];

export function highlightJwt(source: string): HighlightToken[] {
  if (source.length > MAX_HIGHLIGHT_LENGTH) return plain(source);
  const match = /^(\s*)([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)(\s*)$/.exec(source);
  if (!match) return plain(source);
  return [{ text: match[1]! }, { text: match[2]!, kind: 'header' }, { text: '.' },
    { text: match[3]!, kind: 'payload' }, { text: '.' }, { text: match[4]!, kind: 'signature' }, { text: match[5]! }];
}

// Scan the displayed source, never reserialize numeric or string literals. The UI
// supplies validated JSON; malformed lexical tokens also fall back to plain text.
export function highlightJson(source: string): HighlightToken[] {
  if (source.length > MAX_HIGHLIGHT_LENGTH) return plain(source);
  const tokens: HighlightToken[] = [];
  const number = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  const literal = /true|false|null/y;
  for (let i = 0; i < source.length;) {
    if (tokens.length >= MAX_HIGHLIGHT_TOKENS) return plain(source);
    const start = i;
    const char = source[i++]!;
    let kind: TokenKind | undefined;
    if (char === '"') {
      let closed = false;
      while (i < source.length) {
        const next = source[i++]!;
        if (next === '"') { closed = true; break; }
        if (next.charCodeAt(0) < 32) return plain(source);
        if (next === '\\') {
          const escape = source[i++];
          if (escape === 'u') {
            for (let end = i + 4; i < end; i++) if (!/[0-9a-fA-F]/.test(source[i] ?? '')) return plain(source);
          } else if (!escape || !'"\\/bfnrt'.includes(escape)) return plain(source);
        }
      }
      if (!closed) return plain(source);
      let next = i;
      while (next < source.length && ' \t\r\n'.includes(source[next]!)) next++;
      kind = source[next] === ':' ? 'key' : 'string';
    } else if (' \t\r\n{}[],:'.includes(char)) {
      while (i < source.length && ' \t\r\n{}[],:'.includes(source[i]!)) i++;
    } else {
      const pattern = char === '-' || (char >= '0' && char <= '9') ? number : literal;
      pattern.lastIndex = start;
      const match = pattern.exec(source);
      if (!match) return plain(source);
      i = pattern.lastIndex;
      if (i < source.length && !' \t\r\n{}[],:'.includes(source[i]!)) return plain(source);
      kind = pattern === number ? 'number' : 'literal';
    }
    tokens.push({ text: source.slice(start, i), kind });
  }
  return tokens;
}

export function renderHighlight(layer: HTMLElement, tokens: readonly HighlightToken[]): boolean {
  const fragment = document.createDocumentFragment();
  let colored = false;
  for (const token of tokens) {
    if (token.kind && token.text) {
      const span = document.createElement('span');
      span.className = `jwt-token-${token.kind}`;
      span.textContent = token.text;
      fragment.append(span);
      colored = true;
    } else fragment.append(document.createTextNode(token.text));
  }
  layer.replaceChildren(fragment);
  return colored;
}
