// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { convert, formatDateTime, hourTable, parseDate, toInstant, type Zone } from './logic';

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
  it('ISO、Unix秒・ミリ秒と入力ゾーンの時差', () => {
    expect(convert(toInstant('2026-10-17', '09:30:45', 'JST'))).toEqual({
      jst: '2026-10-17 09:30:45', utc: '2026-10-17 00:30:45', iso: '2026-10-17T00:30:45Z', seconds: '1792197045', milliseconds: '1792197045000',
    });
    expect(toInstant('2026-10-17', '09:30:45', 'UTC') - toInstant('2026-10-17', '09:30:45', 'JST')).toBe(32400000);
  });
  it.each([
    ['1969-12-31', '23:59:59', '1970-01-01 08:59:59', -1],
    ['1970-01-01', '00:00:00', '1970-01-01 09:00:00', 0],
    ['1970-01-01', '00:00:01', '1970-01-01 09:00:01', 1],
  ])('epoch前後: %s %s UTC ↔ JST %s（Unix秒 %i）', (date, time, jst, seconds) => {
    const expected = {
      jst, utc: `${date} ${time}`, iso: `${date}T${time}Z`,
      seconds: String(seconds), milliseconds: String(seconds * 1000),
    };
    const utcInstant = toInstant(date, time, 'UTC');
    const jstInstant = toInstant(jst.slice(0, 10), jst.slice(11), 'JST');
    expect(utcInstant).toBe(seconds * 1000);
    expect(jstInstant).toBe(utcInstant);
    expect(convert(utcInstant)).toEqual(expected);
  });
  it.each(['0000-01-01', '10000-01-01', '2026-02-29', '1900-02-29', '2024-02-30', '2026-13-01', '2026-00-10', '2026-01-00', '2026-1-01', '', 'invalid'])('不正日付 %s を拒否', value => expect(() => parseDate(value)).toThrow());
  it.each(['25:00:00', '24:00', '12:60:00', '23:59:60', '1:00', '', '00:00:00.001'])('不正時刻 %s を拒否', value => expect(() => toInstant('2026-01-01', value, 'JST')).toThrow());
  it('うるう年と0〜99年', () => {
    expect(convert(toInstant('2000-02-29', '00:00', 'UTC')).utc).toBe('2000-02-29 00:00:00');
    expect(convert(toInstant('0004-02-29', '00:00', 'UTC')).utc).toBe('0004-02-29 00:00:00');
  });
  it.each([
    ['0001-01-01 00:00:00', '0001-01-01 09:00:00'],
    ['0099-12-31 23:59:59', '0100-01-01 08:59:59'],
    ['1900-02-28 23:59:59', '1900-03-01 08:59:59'],
    ['2000-02-29 23:59:59', '2000-03-01 08:59:59'],
    ['2026-04-30 23:59:59', '2026-05-01 08:59:59'],
    ['2026-12-31 23:59:59', '2027-01-01 08:59:59'],
    ['9999-12-31 14:59:59', '9999-12-31 23:59:59'],
  ])('UTC %s ↔ JST %sを同じ瞬間として往復', (utc, jst) => {
    const instant = toInstant(utc.slice(0, 10), utc.slice(11), 'UTC');
    expect(toInstant(jst.slice(0, 10), jst.slice(11), 'JST')).toBe(instant);
    for (const [zone, expected] of [['UTC', utc], ['JST', jst]] as const) {
      const formatted = formatDateTime(instant, zone);
      expect(formatted).toBe(expected);
      expect(toInstant(formatted.slice(0, 10), formatted.slice(11), zone)).toBe(instant);
    }
  });
  it.each([
    ['0001-01-01', '00:00:00', 'JST', '0000-12-31 15:00:00', '0000-12-31T15:00:00Z'],
    ['9999-12-31', '23:59:59', 'UTC', '10000-01-01 08:59:59', '9999-12-31T23:59:59Z'],
  ] as const)('入力範囲端の出力 %s %s %sは再入力範囲外にもなる', (date, time, zone, opposite, iso) => {
    const instant = toInstant(date, time, zone);
    const oppositeZone: Zone = zone === 'JST' ? 'UTC' : 'JST';
    expect(formatDateTime(instant, oppositeZone)).toBe(opposite);
    expect(convert(instant).iso).toBe(iso);
    expect(() => toInstant(opposite.split(' ')[0]!, opposite.split(' ')[1]!, oppositeZone)).toThrow('0001〜9999');
  });
});

describe('ローカルタイムゾーンへの非依存性', () => {
  // テスト実行中にTZを変更せず、別Nodeプロセスを各TZで起動する。
  // 米国のDST欠落・重複時間でもUTC/JSTの解釈と24時間表は一定。
  it.each([
    ['UTC', 0], ['Asia/Tokyo', -540], ['America/Los_Angeles', 480], ['Pacific/Kiritimati', -840],
  ])('%s環境で同じ日時・Unix time・24時間表を生成', (timezone, offset) => {
    const samples = [
      { date: '2026-03-08', utcTime: '02:30:45', jstTime: '11:30:45' },
      { date: '2026-11-01', utcTime: '01:30:45', jstTime: '10:30:45' },
    ];
    const script = `
      import { convert, hourTable, parseDate, toInstant } from ${JSON.stringify(pathToFileURL(resolve('src/tools/datetime/logic.ts')).href)};
      console.log(JSON.stringify({
        offset: new Date('2026-01-01T00:00:00Z').getTimezoneOffset(),
        samples: ${JSON.stringify(samples)}.map(({ date, utcTime, jstTime }) => ({
          date: parseDate(date),
          values: convert(toInstant(date, utcTime, 'UTC')),
          jstInstant: toInstant(date, jstTime, 'JST'),
          hours: hourTable(date),
        })),
      }));
    `;
    const result: unknown = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      env: { ...process.env, TZ: timezone }, encoding: 'utf8', timeout: 10000,
    }));
    expect(result).toEqual({
      offset,
      samples: samples.map(({ date, utcTime, jstTime }) => {
        const instant = Date.parse(`${date}T${utcTime}Z`);
        const midnightJst = Date.parse(`${date}T00:00:00+09:00`);
        return {
          date: Date.parse(`${date}T00:00:00Z`),
          values: {
            jst: `${date} ${jstTime}`, utc: `${date} ${utcTime}`, iso: `${date}T${utcTime}Z`,
            seconds: String(instant / 1000), milliseconds: String(instant),
          },
          jstInstant: instant,
          hours: Array.from({ length: 24 }, (_, hour) => ({
            hour, instant: midnightJst + hour * 3600000,
            jst: `${String(hour).padStart(2, '0')}:00`,
            utc: `${String((hour + 15) % 24).padStart(2, '0')}:00`, relation: hour < 9 ? '前日' : '同日',
          })),
        };
      }),
    });
  });
});
