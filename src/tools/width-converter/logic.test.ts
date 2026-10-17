import { describe, expect, it } from 'vitest';
import { convertWidth, defaultCategories, type Categories, type Direction } from './logic';

const none: Categories = { alphanumeric: false, symbols: false, katakana: false, spaces: false };
const all: Categories = { alphanumeric: true, symbols: true, katakana: true, spaces: true };
const only = (category: keyof Categories): Categories => ({ ...none, [category]: true });

describe('convertWidth', () => {
  it('指定の初期設定', () => {
    expect(defaultCategories).toEqual({ alphanumeric: true, symbols: true, katakana: false, spaces: true });
    expect(convertWidth('ＡＢＣ１２３！＠＃　ガギグ')).toBe('ABC123!@# ガギグ');
  });
  it.each<[keyof Categories, string, string]>([
    ['alphanumeric', 'ＡＺａｚ０９！　ガ', 'AZaz09！　ガ'],
    ['symbols', '！＠＃＄％！？（）［］Ａ　。「」・', '!@#$%!?()[]Ａ　。「」・'],
    ['katakana', 'ガパヴァッー・。「」、Ａ！　', 'ｶﾞﾊﾟｳﾞｧｯｰ･｡｢｣､Ａ！　'],
    ['spaces', '　Ａ！ガ\t\n\u00a0\u2003', ' Ａ！ガ\t\n\u00a0\u2003'],
  ])('%sだけを双方向変換する', (category, full, half) => {
    expect(convertWidth(full, 'to-half', only(category))).toBe(half);
    expect(convertWidth(half, 'to-full', only(category))).toBe(full);
  });
  it('全カテゴリOFFでは入力をそのまま返す', () => {
    const text = 'ＡA！! ガｶﾞ カ\u3099①Ⅳ\t\n😀';
    for (const direction of ['to-half', 'to-full'] as const) expect(convertWidth(text, direction, none)).toBe(text);
  });
  it('複数カテゴリを同時に変換する', () => {
    expect(convertWidth('ＡＢガ　！', 'to-half', { ...only('alphanumeric'), katakana: true })).toBe('ABｶﾞ　！');
    expect(convertWidth('Aｶﾞ !', 'to-full', all)).toBe('Ａガ　！');
  });
  it.each(['to-half', 'to-full'] as Direction[])('対象外文字・タブ・改行を保持する: %s', (direction) => {
    const text = '①⑳ⅠⅣ㍑㌔Å℉ﬀ漢字ひらがな😀𠮷〜¥￥ヵヶヮヰヱヿ\t\r\n\u00a0\u2003';
    expect(convertWidth(text, direction, all)).toBe(text);
  });
  it('ASCIIの全94文字を分類し相互変換する', () => {
    for (let code = 0x21; code <= 0x7e; code++) {
      const ascii = String.fromCharCode(code);
      const full = String.fromCharCode(code + 0xfee0);
      const category = /[A-Za-z0-9]/u.test(ascii) ? 'alphanumeric' : 'symbols';
      expect(convertWidth(full, 'to-half', only(category))).toBe(ascii);
      expect(convertWidth(ascii, 'to-full', only(category))).toBe(full);
      expect(convertWidth(full, 'to-half', only(category === 'symbols' ? 'alphanumeric' : 'symbols'))).toBe(full);
    }
  });
  it('チルダ・バックスラッシュのUnicode対応だけを変換する', () => {
    expect(convertWidth('～＼〜¥￥', 'to-half', only('symbols'))).toBe('~\\〜¥￥');
    expect(convertWidth('~\\〜¥￥', 'to-full', only('symbols'))).toBe('～＼〜¥￥');
  });
  it('合成済み・結合文字の濁点と半濁点を分離・結合する', () => {
    const full = 'ガギグゲゴパピプペポヴヷヺ';
    const half = 'ｶﾞｷﾞｸﾞｹﾞｺﾞﾊﾟﾋﾟﾌﾟﾍﾟﾎﾟｳﾞﾜﾞｦﾞ';
    expect(convertWidth(full, 'to-half', only('katakana'))).toBe(half);
    expect(convertWidth(full.normalize('NFD'), 'to-half', only('katakana'))).toBe(half);
    expect(convertWidth(half, 'to-full', only('katakana'))).toBe(full);
    expect(convertWidth('ｶ\u3099ﾊ\u309a', 'to-full', only('katakana'))).toBe('ガパ');
  });
  it('単独濁点・結合不能な組を失わない', () => {
    expect(convertWidth('゛゜\u3099\u309a', 'to-half', only('katakana'))).toBe('ﾞﾟﾞﾟ');
    expect(convertWidth('ﾞﾟｱﾞｶﾟ', 'to-full', only('katakana'))).toBe('\u3099\u309aア\u3099カ\u309a');
    expect(convertWidth('がぱ', 'to-half', only('katakana'))).toBe('がぱ');
  });
  it.each(['か\u3099', 'は\u309a', 'う\u3099', 'あ\u309a', 'か\u3099\u309a', '𛀁\u3099'])(
    'ひらがなに付いた結合濁点・半濁点を保持する: %s', (input) => {
      expect(convertWidth(input, 'to-half', only('katakana'))).toBe(input);
    },
  );
  it('ひらがな・カタカナ・単独濁点の混在を区別する', () => {
    const input = '\u3099\u309a か\u3099は\u309a カ\u3099ハ\u309a ガパヴ ゛゜ ①Ⅳ';
    const expected = 'ﾞﾟ か\u3099は\u309a ｶﾞﾊﾟ ｶﾞﾊﾟｳﾞ ﾞﾟ ①Ⅳ';
    expect(convertWidth(input, 'to-half', only('katakana'))).toBe(expected);
    expect(convertWidth(input, 'to-half', none)).toBe(input);
  });
  it('半角の全範囲に対応し単独カナを往復できる', () => {
    for (let code = 0xff61; code <= 0xff9f; code++) {
      const half = String.fromCharCode(code);
      const full = convertWidth(half, 'to-full', only('katakana'));
      expect(full).toBe(half.normalize('NFKC'));
      expect(convertWidth(full, 'to-half', only('katakana'))).toBe(half);
    }
  });
  it('小書き・長音・中黒・句読点は記号設定に依存しない', () => {
    const full = 'ァィゥェォャュョッー・。「」、';
    const half = 'ｧｨｩｪｫｬｭｮｯｰ･｡｢｣､';
    for (const symbols of [false, true]) {
      expect(convertWidth(full, 'to-half', { ...only('katakana'), symbols })).toBe(half);
      expect(convertWidth(half, 'to-full', { ...only('katakana'), symbols })).toBe(full);
    }
    expect(convertWidth(full + half, 'to-half', only('symbols'))).toBe(full + half);
    expect(convertWidth(full + half, 'to-full', only('symbols'))).toBe(full + half);
  });
  it('空入力と大きな文字列', () => {
    expect(convertWidth('')).toBe('');
    expect(convertWidth('Ａガ①\n'.repeat(25000))).toBe('Aガ①\n'.repeat(25000));
  });
});
