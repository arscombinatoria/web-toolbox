import { RegExpParser, RegExpSyntaxError, visitRegExpAST, type AST } from '@eslint-community/regexpp';
import { FLAGS, MAX_PATTERN_LENGTH, type DiagramResult } from './protocol';

// 正規表現の実行はしない。regexppのASTを、小さな構造図へ変換するアダプター。
const MAX_NODES = 800;
const MAX_DEPTH = 48;
const MAX_DIMENSION = 16000;
const MAX_AREA = 12_000_000;
const MAX_SVG_LENGTH = 1_000_000;
class DiagramLimit extends Error {}
interface Rail { width: number; height: number; axis: number; svg: string }

// XML 1.0非対応文字、不可視文字、単独サロゲートは見える表記にする。
function visible(text: string, spaces = false): string {
  return Array.from(text, char => {
    const cp = char.codePointAt(0)!;
    if (char === ' ') return spaces ? '␣' : ' ';
    if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Zs}]/u.test(char)
      || (cp >= 0xd800 && cp <= 0xdfff) || cp === 0xfffe || cp === 0xffff) {
      return `\\u{${cp.toString(16).toUpperCase()}}`;
    }
    return char;
  }).join('');
}
function xml(text: string): string {
  return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
}
function checkSize(width: number, height: number): void {
  if (!Number.isFinite(width + height) || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_AREA) {
    throw new DiagramLimit('図の寸法が安全上限（各辺16,000px・面積1,200万px）を超えます。式を分割してください。');
  }
}
function path(d: string): string { return `<path d="${d}"/>`; }
function placed(rail: Rail, x: number, y: number): string { return `<g transform="translate(${x} ${y})">${rail.svg}</g>`; }
function label(text: string, x: number, y: number, width: number): string {
  return `<text x="${x}" y="${y}" text-anchor="middle" textLength="${width}" lengthAdjust="spacingAndGlyphs">${xml(text)}</text>`;
}
function units(char: string): number { return char.codePointAt(0)! > 255 ? 2 : 1; }
function box(text: string | string[], kind = 'literal'): Rail {
  const heading = kind === 'heading';
  const lines: string[] = [];
  for (const part of typeof text === 'string' ? [text] : text) {
    lines.push('');
    let length = 0;
    for (const char of visible(part)) {
      const size = units(char);
      if (length + size > (kind === 'condition' ? 22 : 66)) { lines.push(''); length = 0; }
      lines[lines.length - 1] += char; length += size;
    }
  }
  const widths = lines.map(line => Array.from(line).reduce((n, char) => n + units(char) * 6.5, 0));
  const width = Math.max(40, ...widths.map(w => w + (heading ? 8 : 20)));
  const height = lines.length * 18 + (heading ? 4 : 12);
  return { width, height, axis: height / 2, svg: `<g class="${kind}"><rect width="${width}" height="${height}" rx="6"/>${lines.map((line, i) => label(line, width / 2, (heading ? 15 : 20) + i * 18, widths[i]!)).join('')}</g>` };
}
function sequence(items: Rail[]): Rail {
  if (!items.length) return box('空（0文字）', 'condition');
  const axis = Math.max(...items.map(item => item.axis));
  const height = axis + Math.max(...items.map(item => item.height - item.axis));
  const width = items.reduce((sum, item) => sum + item.width, 0) + 16 * (items.length - 1);
  checkSize(width, height);
  let x = 0;
  const svg = items.map((item, i) => {
    const result = (i ? path(`M${x - 16} ${axis}h16`) : '') + placed(item, x, axis - item.axis);
    x += item.width + 16;
    return result;
  }).join('');
  return { width, height, axis, svg };
}
function choice(items: Rail[]): Rail {
  if (items.length === 1) return items[0]!;
  const width = Math.max(...items.map(item => item.width)) + 64;
  const height = items.reduce((sum, item) => sum + item.height, 0) + 24 * (items.length - 1);
  checkSize(width, height);
  const axis = items[0]!.axis;
  let y = 0;
  const svg = items.map(item => {
    const rowAxis = y + item.axis;
    const result = path(`M0 ${axis}H16V${rowAxis}H32M${width - 32} ${rowAxis}H${width - 16}V${axis}H${width}`)
      + placed(item, 32, y) + path(`M${32 + item.width} ${rowAxis}H${width - 32}`);
    y += item.height + 24;
    return result;
  }).join('');
  return { width, height, axis, svg };
}
function frame(body: Rail, title: string): Rail {
  const heading = box(title, 'heading');
  const width = Math.max(body.width + 24, heading.width + 16);
  const top = heading.height + 4;
  const height = body.height + top + 12;
  const axis = top + body.axis;
  const x = (width - body.width) / 2;
  checkSize(width, height);
  return { width, height, axis, svg: `<g class="group"><rect y="10" width="${width}" height="${height - 10}" rx="8"/></g>`
    + placed(heading, 8, 0) + placed(body, x, top)
    + path(`M0 ${axis}H${x}M${body.width + x} ${axis}H${width}`) };
}
function arrow(x: number, y: number, direction: 1 | -1): string {
  return path(`M${x - direction * 4} ${y - 4}l${direction * 4} 4 ${-direction * 4} 4`);
}
function repeat(body: Rail, min: number, max: number, greedy: boolean, source: string): Rail {
  // 大きな整数も丸めず、原文から合計回数を表示する。
  const quantifier = greedy ? source : source.slice(0, -1);
  const counts = quantifier === '?' ? '0〜1回' : quantifier === '*' ? '0回以上' : quantifier === '+' ? '1回以上'
    : quantifier.slice(1, -1).replace(/,(.+)/, '〜$1').replace(/,$/, '回以上') + (quantifier.endsWith(',}') ? '' : '回');
  const heading = box(`${source} · 合計${counts}`, 'heading');
  const priority = box(greedy ? '貪欲マッチ' : '非貪欲マッチ', 'heading');
  const width = Math.max(body.width + 48, heading.width + 16);
  const top = heading.height + (min === 0 ? 24 : 4);
  const axis = top + body.axis;
  const bottom = top + body.height;
  const height = bottom + (max > 1 ? 24 : 4) + priority.height;
  const x = (width - body.width) / 2;
  checkSize(width, height);
  let svg = placed(heading, (width - heading.width) / 2, 0) + placed(body, x, top)
    + path(`M0 ${axis}H${x}M${x + body.width} ${axis}H${width}`)
    + arrow(width - 3, axis, 1);
  if (min === 0) {
    const y = heading.height + 8;
    svg += `<g class="bypass">` + path(`M0 ${axis}Q12 ${axis} 12 ${axis - 12}V${y + 12}Q12 ${y} 24 ${y}H${width - 24}Q${width - 12} ${y} ${width - 12} ${y + 12}V${axis - 12}Q${width - 12} ${axis} ${width} ${axis}`)
      + arrow(width / 2, y, 1) + '</g>';
  }
  if (max > 1) {
    const y = bottom + 16;
    svg += `<g class="loopback">` + path(`M${width - 24} ${axis}Q${width - 12} ${axis} ${width - 12} ${axis + 12}V${y - 12}Q${width - 12} ${y} ${width - 24} ${y}H24Q12 ${y} 12 ${y - 12}V${axis + 12}Q12 ${axis} 24 ${axis}`)
      + arrow(width / 2, y, -1) + '</g>';
  }
  svg += placed(priority, (width - priority.width) / 2, height - priority.height);
  return { width, height, axis, svg: `<g class="repeat">${svg}</g>` };
}

export function createDiagram(pattern: string, flags: string): DiagramResult {
  if (pattern.length > MAX_PATTERN_LENGTH) return { ok: false, kind: 'limit', message: `入力は${MAX_PATTERN_LENGTH.toLocaleString('en-US')} UTF-16コード単位以内にしてください。` };
  try {
    if (Array.from(flags).some(flag => !FLAGS.includes(flag as typeof FLAGS[number])) || new Set(flags).size !== flags.length) {
      return { ok: false, kind: 'syntax', message: 'フラグは d g i m s u v y を重複せず指定してください。' };
    }
    if (flags.includes('u') && flags.includes('v')) return { ok: false, kind: 'syntax', message: 'u と v は同時に指定できません。' };
    const parser = new RegExpParser({ ecmaVersion: 2025 });
    const ast = parser.parsePattern(pattern, 0, pattern.length, { unicode: flags.includes('u'), unicodeSets: flags.includes('v') });
    const captures = new Map<AST.CapturingGroup, number>();
    let nodes = 0;
    let depth = 0;
    const enter = () => {
      if (++nodes > MAX_NODES || ++depth > MAX_DEPTH) throw new DiagramLimit('構造の安全上限（800ノード・深さ48）を超えます。式を分割してください。');
    };
    const leave = () => { depth--; };
    // regexppのVisitorは参照先・parentをたどらないため、循環するASTでも安全。
    visitRegExpAST(ast, {
      onPatternEnter: enter, onPatternLeave: leave,
      onAlternativeEnter: enter, onAlternativeLeave: leave,
      onGroupEnter: enter, onGroupLeave: leave,
      onModifiersEnter: enter, onModifiersLeave: leave,
      onModifierFlagsEnter: enter, onModifierFlagsLeave: leave,
      onCapturingGroupEnter(node) { enter(); captures.set(node, captures.size + 1); }, onCapturingGroupLeave: leave,
      onAssertionEnter: enter, onAssertionLeave: leave,
      onQuantifierEnter: enter, onQuantifierLeave: leave,
      onCharacterEnter: enter, onCharacterLeave: leave,
      onCharacterSetEnter: enter, onCharacterSetLeave: leave,
      onCharacterClassEnter: enter, onCharacterClassLeave: leave,
      onCharacterClassRangeEnter: enter, onCharacterClassRangeLeave: leave,
      onExpressionCharacterClassEnter: enter, onExpressionCharacterClassLeave: leave,
      onClassIntersectionEnter: enter, onClassIntersectionLeave: leave,
      onClassSubtractionEnter: enter, onClassSubtractionLeave: leave,
      onClassStringDisjunctionEnter: enter, onClassStringDisjunctionLeave: leave,
      onStringAlternativeEnter: enter, onStringAlternativeLeave: leave,
      onBackreferenceEnter: enter, onBackreferenceLeave: leave,
    });
    const warnings = new Set<string>();
    const conditions: { title: string; rail: Rail }[] = [];
    const alternatives = (alts: AST.Alternative[], activeFlags = flags): Rail => choice(alts.map(alt => {
      const items: Rail[] = [];
      let literal = '';
      const flush = () => { if (literal) { items.push(box(`文字列 “${literal}”`)); literal = ''; } };
      for (const element of alt.elements) {
        if (element.type === 'Character') literal += visible(String.fromCodePoint(element.value), true);
        else { flush(); items.push(map(element, activeFlags)); }
      }
      flush();
      return sequence(items);
    }));
    const map = (node: AST.Element, activeFlags: string): Rail => {
      switch (node.type) {
        case 'Character': return box(`文字 “${visible(String.fromCodePoint(node.value), true)}”`);
        case 'CharacterSet': return box(node.kind === 'any' ? `任意の1文字${activeFlags.includes('s') ? '（改行を含む）' : '（改行を除く）'}` : `文字集合 ${visible(node.raw, true)}`, 'set');
        case 'CharacterClass':
          if (!node.negate && !node.elements.length) warnings.add('空の文字クラス [] は何にも一致しません。');
          return box(`文字集合 ${visible(node.raw, true)}${!node.negate && !node.elements.length ? '（一致なし）' : ''}`, 'set');
        case 'ExpressionCharacterClass':
          return box(`Unicode集合 ${visible(node.raw, true)}（&& は共通部分、-- は差集合）`, 'set');
        case 'CapturingGroup': return frame(alternatives(node.alternatives, activeFlags), `捕捉 #${captures.get(node)}${node.name ? ` <${node.name}>` : ''}`);
        case 'Group': {
          let localFlags = activeFlags;
          if (node.modifiers) {
            for (const [key, flag] of [['ignoreCase', 'i'], ['multiline', 'm'], ['dotAll', 's']] as const) {
              if (node.modifiers.add[key] && !localFlags.includes(flag)) localFlags += flag;
              if (node.modifiers.remove?.[key]) localFlags = localFlags.replace(flag, '');
            }
          }
          return frame(alternatives(node.alternatives, localFlags), node.modifiers ? `局所フラグ ${node.modifiers.raw}（有効：${localFlags || 'なし'}）` : '非キャプチャグループ');
        }
        case 'Quantifier':
          // 0回の本体は変換せず、実行されない条件の内部図も登録しない。
          if (node.max === 0) return box('0回（本体を通らない・0文字）', 'condition');
          return repeat(map(node.element, activeFlags), node.min, node.max, node.greedy, node.raw.slice(node.element.raw.length));
        case 'Backreference': {
          warnings.add('後方参照は捕捉済みの文字列に一致します。未参加・前方のグループへの参照は空文字列に一致する場合があります。参照は別の実行経路ではありません。');
          const targets = Array.isArray(node.resolved) ? node.resolved : [node.resolved];
          return box(`後方参照 ${visible(node.raw, true)} → ${targets.map(target => `#${captures.get(target)}`).join(' / ')} の捕捉文字列`, 'reference');
        }
        case 'Assertion': {
          warnings.add('条件ノードは0文字のアサーションです。条件の内部図は主経路から独立し、内部の文字を主経路で消費しません。');
          if (node.kind === 'lookahead' || node.kind === 'lookbehind') {
            const number = conditions.length + 1;
            const name = `${node.negate ? '否定' : '肯定'}${node.kind === 'lookahead' ? '先読み' : '後読み'}`;
            const entry = { title: `条件${number}：${name}の内部構造${node.kind === 'lookbehind' ? '（ソース順表示・評価は右→左）' : ''}`, rail: box('') };
            conditions.push(entry);
            entry.rail = alternatives(node.alternatives, activeFlags);
            return box([`条件${number}（0文字）`, `${name} ${visible(node.raw, true)}`], 'condition');
          }
          const name = node.kind === 'word' ? (node.negate ? '非単語境界' : '単語境界')
            : `${node.kind === 'start' ? '先頭' : '末尾'}${activeFlags.includes('m') ? '（行境界も含む）' : '（入力境界）'}`;
          return box(['条件（0文字）', `${name} ${visible(node.raw, true)}`], 'condition');
        }
        default: {
          const unsupported: never = node;
          throw new Error(`描画未対応の構文です：${String(unsupported)}`);
        }
      }
    };
    const root = alternatives(ast.alternatives);
    const sections = [{ title: '主構造（左 → 右）', rail: root }, ...conditions];
    const metadata = box(`ECMAScript・フラグ：${flags || 'なし'}`, 'heading');
    const headings = sections.map(section => box(section.title, 'heading'));
    const width = Math.max(metadata.width + 32, ...sections.map((section, i) => Math.max(section.rail.width + 64, headings[i]!.width + 32)));
    let height = metadata.height + 24;
    const content: string[] = [];
    for (const [i, section] of sections.entries()) {
      const heading = headings[i]!;
      content.push(placed(heading, 16, height)); height += heading.height + 12;
      const x = (width - section.rail.width) / 2;
      const axis = height + section.rail.axis;
      content.push(placed(section.rail, x, height), path(`M${x - 16} ${axis}H${x}M${section.rail.width + x} ${axis}h16`), arrow(x - 3, axis, 1));
      content.push(`<circle cx="${x - 16}" cy="${axis}" r="4"/><circle cx="${section.rail.width + x + 16}" cy="${axis}" r="4"/>`);
      height += section.rail.height + 24;
      checkSize(width, height);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><title>ECMAScript 正規表現の構造図</title><desc>条件は0文字。回数と優先順位はラベルで指定。マッチングは実行しません。</desc><style>
/* main.cssの既存トークン。Blob画像と保存ファイルでも単体で解決できるよう内包する。 */
svg{--page:#f8fafc;--surface:#ffffff;--text:#172334;--muted:#526174;--border:#dce3ec;--accent:#245bc2;--accent-soft:#edf3ff;background:var(--page);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
svg[data-theme="dark"]{--page:#131922;--surface:#1b2430;--text:#edf2f9;--muted:#b3bfd0;--border:#364253;--accent:#99bcff;--accent-soft:#263a5a}
path{fill:none;stroke:var(--muted);stroke-width:2;stroke-linejoin:round}circle{fill:var(--accent)}
rect{fill:var(--accent-soft);stroke:var(--accent);stroke-width:1.5}text{fill:var(--text);font-size:13px;stroke:none}
.condition rect{fill:var(--surface);stroke:var(--muted);stroke-dasharray:5 3}.reference rect{fill:var(--surface);stroke:var(--accent);stroke-dasharray:2 2}
.set rect{fill:var(--accent-soft)}.group>rect{fill:none;stroke:var(--muted)}.heading rect{fill:var(--page);stroke:none}.heading text{fill:var(--muted)}
.canvas-background{fill:var(--page);stroke:none}
</style><rect class="canvas-background" width="${width}" height="${height}"/>${placed(metadata, 16, 12)}${content.join('')}</svg>`;
    if (svg.length > MAX_SVG_LENGTH) throw new DiagramLimit('SVGが安全上限（100万文字）を超えます。式を分割してください。');
    return { ok: true, svg, warnings: [...warnings] };
  } catch (error) {
    if (error instanceof RegExpSyntaxError) return { ok: false, kind: 'syntax', message: error.message, position: error.index };
    if (error instanceof DiagramLimit || error instanceof RangeError) return { ok: false, kind: 'limit', message: error instanceof DiagramLimit ? error.message : '構造が複雑すぎるため解析を中断しました。式を分割してください。' };
    return { ok: false, kind: 'render', message: error instanceof Error ? error.message : '図を生成できませんでした。' };
  }
}
