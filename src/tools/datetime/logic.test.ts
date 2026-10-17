import { describe, expect, it } from 'vitest';
import { convert, formatDateTime, hourTable, parseDate, toInstant } from './logic';

describe('JST・UTC変換', () => {
  it.each([
    ['2026-10-17', '09:00:00', '2026-10-17 00:00:00'],
    ['2026-10-17', '00:00:00', '2026-10-16 15:00:00'],
    ['2026-10-17', '23:00:00', '2026-10-17 14:00:00'],
    ['2026-01-01', '00:00:00', '2025-12-31 15:00:00'],
    ['2024-03-01', '00:00:00', '2024-02-29 15:00:00'],
    ['2025-03-01', '00:00:00', '2025-02-28 15:00:00'],
    ['0001-01-01', '00:00:00', '0000-12-31 15:00:00'],
    ['0099-01-01', '09:00:00', '0099-01-01 00:00:00'],
  ])('%s %s JST', (date, time, expected) => {
    expect(convert(toInstant(date, time, 'JST')).utc).toBe(expected);
  });
  it('UTC入力・翌日・年末境界', () => {
    expect(convert(toInstant('2026-10-17', '00:00', 'UTC')).jst).toBe('2026-10-17 09:00:00');
    expect(convert(toInstant('2026-12-31', '23:59:59', 'UTC')).jst).toBe('2027-01-01 08:59:59');
    expect(convert(toInstant('9999-12-31', '23:59:59', 'UTC')).jst).toBe('10000-01-01 08:59:59');
  });
  it('全24行をJST日付基準で生成', () => {
    const rows = hourTable('2026-01-01');
    expect(rows).toHaveLength(24);
    rows.forEach((row, hour) => {
      expect(row.jst).toBe(`${String(hour).padStart(2, '0')}:00`);
      expect(row.utc).toBe(`${String((hour + 15) % 24).padStart(2, '0')}:00`);
      expect(row.relation).toBe(hour < 9 ? '前日' : '同日');
      expect(formatDateTime(row.instant, 'UTC').slice(0, 10)).toBe(hour < 9 ? '2025-12-31' : '2026-01-01');
    });
  });
  it('ISO、Unix秒・ミリ秒、負数、入力ゾーン', () => {
    expect(convert(toInstant('2026-10-17', '09:30:45', 'JST'))).toEqual({
      jst: '2026-10-17 09:30:45', utc: '2026-10-17 00:30:45', iso: '2026-10-17T00:30:45Z', seconds: '1792197045', milliseconds: '1792197045000',
    });
    expect(convert(toInstant('1969-12-31', '23:59:59', 'UTC')).seconds).toBe('-1');
    expect(convert(toInstant('1969-12-31', '23:59:59', 'UTC')).milliseconds).toBe('-1000');
    expect(toInstant('2026-10-17', '09:30:45', 'UTC') - toInstant('2026-10-17', '09:30:45', 'JST')).toBe(32400000);
  });
  it.each(['0000-01-01', '10000-01-01', '2026-02-29', '1900-02-29', '2024-02-30', '2026-13-01', '2026-00-10', '2026-01-00', '2026-1-01', '', 'invalid'])('不正日付 %s を拒否', value => expect(() => parseDate(value)).toThrow());
  it.each(['25:00:00', '24:00', '12:60:00', '23:59:60', '1:00', '', '00:00:00.001'])('不正時刻 %s を拒否', value => expect(() => toInstant('2026-01-01', value, 'JST')).toThrow());
  it('うるう年と0〜99年', () => {
    expect(convert(toInstant('2000-02-29', '00:00', 'UTC')).utc).toBe('2000-02-29 00:00:00');
    expect(convert(toInstant('0004-02-29', '00:00', 'UTC')).utc).toBe('0004-02-29 00:00:00');
  });
});
