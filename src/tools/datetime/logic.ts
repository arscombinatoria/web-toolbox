export type Zone = 'JST' | 'UTC';
const OFFSET = 9 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, '0');

export function parseDate(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('日付は0001〜9999年の有効な年月日を指定してください。');
  const [, y, m, d] = match.map(Number);
  // setUTCFullYearはDate.UTCの0〜99年を1900年代とする特殊処理を避ける。
  const date = new Date(0);
  date.setUTCFullYear(y!, m! - 1, d!);
  if (y! < 1 || date.getUTCFullYear() !== y || date.getUTCMonth() !== m! - 1 || date.getUTCDate() !== d) {
    throw new Error('日付は0001〜9999年の有効な年月日を指定してください。');
  }
  return date.getTime();
}

export function toInstant(date: string, time: string, zone: Zone): number {
  const day = parseDate(date);
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!match) throw new Error('時刻は00:00:00〜23:59:59で指定してください。');
  const hour = Number(match[1]), minute = Number(match[2]), second = Number(match[3] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) throw new Error('時刻は00:00:00〜23:59:59で指定してください。');
  return day + ((hour * 60 + minute) * 60 + second) * 1000 - (zone === 'JST' ? OFFSET : 0);
}

export function formatDateTime(instant: number, zone: Zone): string {
  const date = new Date(instant + (zone === 'JST' ? OFFSET : 0));
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

export function convert(instant: number) {
  return {
    jst: formatDateTime(instant, 'JST'), utc: formatDateTime(instant, 'UTC'),
    iso: new Date(instant).toISOString().replace('.000Z', 'Z'),
    seconds: String(Math.floor(instant / 1000)), milliseconds: String(instant),
  };
}

export function hourTable(date: string) {
  const midnight = toInstant(date, '00:00:00', 'JST');
  return Array.from({ length: 24 }, (_, hour) => {
    const instant = midnight + hour * 3600000;
    return { hour, instant, jst: `${pad(hour)}:00`, utc: formatDateTime(instant, 'UTC').slice(-8, -3), relation: hour < 9 ? '前日' : '同日' };
  });
}
