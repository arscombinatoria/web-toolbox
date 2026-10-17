export type Direction = 'to-half' | 'to-full';
export interface Categories {
  alphanumeric: boolean;
  symbols: boolean;
  katakana: boolean;
  spaces: boolean;
}
export const defaultCategories: Readonly<Categories> = {
  alphanumeric: true, symbols: true, katakana: false, spaces: true,
};

// 正規化するのは既知の半角カナ1文字、または濁点との組のみ。
const fullToHalf = new Map<string, string>();
for (let code = 0xff61; code <= 0xff9f; code++) {
  const half = String.fromCharCode(code);
  const full = half.normalize('NFKC');
  fullToHalf.set(full, half);
  if (code <= 0xff9d) {
    for (const mark of ['ﾞ', 'ﾟ']) {
      const composed = (half + mark).normalize('NFKC');
      if ([...composed].length === 1) fullToHalf.set(composed, half + mark);
    }
  }
}
// 単独の結合濁点と、見た目に幅のある濁点を同じ半角表現へ寄せる。
fullToHalf.set('゛', 'ﾞ');
fullToHalf.set('゜', 'ﾟ');

export function convertWidth(
  input: string,
  direction: Direction = 'to-half',
  categories: Readonly<Categories> = defaultCategories,
): string {
  let text = input;
  if (categories.katakana) {
    // ひらがなと結合濁点の並びを先にまとめて拾い、濁点だけの変換を防ぐ。
    text = direction === 'to-half'
      ? text.replace(/\p{Script=Hiragana}[\u3099\u309a]+|[\u3001\u3002\u300c\u300d\u3099-\u309c\u30a0-\u30ff]/gu,
          (character) => fullToHalf.get(character) ?? character)
      : text.replace(/[\uff61-\uff9d][\uff9e\uff9f\u3099\u309a]?|[\uff9e\uff9f]/gu,
          (sequence) => sequence.normalize('NFKC'));
  }
  return text.replace(direction === 'to-half' ? /[\uff01-\uff5e\u3000]/gu : /[\u0020-\u007e]/gu,
    (character) => {
      const code = character.charCodeAt(0);
      if (code === 0x20 || code === 0x3000) {
        return categories.spaces ? (direction === 'to-half' ? ' ' : '　') : character;
      }
      const ascii = direction === 'to-half' ? code - 0xfee0 : code;
      const isAlphanumeric = (ascii >= 0x30 && ascii <= 0x39)
        || (ascii >= 0x41 && ascii <= 0x5a) || (ascii >= 0x61 && ascii <= 0x7a);
      if (!(isAlphanumeric ? categories.alphanumeric : categories.symbols)) return character;
      return String.fromCharCode(direction === 'to-half' ? ascii : ascii + 0xfee0);
    });
}
