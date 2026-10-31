// JSON.parseで検証済みの文字列専用。構文の再解析ではなく、文字列外の空白だけを整形する。
export function formatJson(source: string) {
  const tokens: string[] = [];
  for (let i = 0; i < source.length;) {
    const start = i;
    const char = source[i++]!;
    if (' \t\r\n'.includes(char)) continue;
    if (char === '"') {
      while (i < source.length) {
        const next = source[i++];
        if (next === '\\') i++;
        else if (next === '"') break;
      }
    } else if (!'{}[],:'.includes(char)) {
      while (i < source.length && !' \t\r\n{}[],:'.includes(source[i]!)) i++;
    }
    tokens.push(source.slice(start, i));
  }
  const output: string[] = [];
  const numbers = new Map<string, string>();
  let depth = 0;
  // 深いJSONでもインデントによる出力サイズの二次増大を避ける。
  const newline = () => output.push('\n', '  '.repeat(Math.min(depth, 32)));
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token === ':' && depth === 1) {
      const key = JSON.parse(tokens[i - 1]!) as string;
      const value = tokens[i + 1]!;
      numbers.delete(key); // 重複キーはJSON.parseと同じく最後の値を採用する。
      if (value[0] === '-' || (value[0]! >= '0' && value[0]! <= '9')) numbers.set(key, value);
    }
    if (token === '{' || token === '[') {
      output.push(token); depth++;
      if (tokens[i + 1] !== '}' && tokens[i + 1] !== ']') newline();
    } else if (token === '}' || token === ']') {
      depth--;
      if (tokens[i - 1] !== '{' && tokens[i - 1] !== '[') newline();
      output.push(token);
    } else if (token === ',') { output.push(token); newline(); }
    else if (token === ':') output.push(': ');
    else output.push(token);
  }
  return { formatted: output.join(''), numbers };
}

// 十進の係数と桁位置を比較する。巨大な10の累乗やBigIntを生成しない。
// 通常の0.1等はNumberの最短十進表記との一致を許容する。
function decimal(token: string): string | undefined {
  const [mantissa = '', exponent = '0'] = token.toLowerCase().split('e');
  const negative = mantissa.startsWith('-');
  const digits = mantissa.replace('-', '').replace('.', '');
  const significant = digits.replace(/^0+/, '').replace(/0+$/, '');
  if (!significant) return '0';
  const power = Number(exponent);
  if (!Number.isSafeInteger(power) || Math.abs(power) > 1000000) return undefined;
  const fraction = mantissa.includes('.') ? mantissa.length - mantissa.indexOf('.') - 1 : 0;
  const trailing = digits.length - digits.replace(/0+$/, '').length;
  return `${negative ? '-' : ''}${significant}e${power - fraction + trailing}`;
}
export function losesNumericPrecision(token: string, value: number): boolean {
  const original = decimal(token);
  return !Number.isFinite(value) || original === undefined || original !== decimal(String(value));
}
