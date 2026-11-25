import { MAX_CAPTURE_ENTRIES, MAX_MATCHES, MAX_RESULT_CODE_UNITS, MAX_TEST_LENGTH, type CaptureValue, type MatchRequest, type MatchResponse } from './match-protocol';
import { MAX_PATTERN_LENGTH } from './protocol';

const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<MatchRequest>) => void) | null; postMessage: (message: MatchResponse) => void };
scope.onmessage = ({ data }) => {
  const respond = (result: MatchResponse) => scope.postMessage(result);
  if (data.pattern.length > MAX_PATTERN_LENGTH || data.input.length > MAX_TEST_LENGTH) {
    respond({ id: data.id, ok: false, kind: 'limit', message: `パターンは4,096、テスト文字列は${MAX_TEST_LENGTH.toLocaleString('en-US')} UTF-16コード単位以内にしてください。` }); return;
  }
  let regex: RegExp;
  try { regex = new RegExp(data.pattern, data.flags); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    respond({ id: data.id, ok: false, kind: 'syntax', message: `ブラウザのネイティブRegExpでコンパイルできません（構文またはこのブラウザの構文・フラグ対応）。${message}` }); return;
  }
  const global = data.flags.includes('g');
  const unicode = data.flags.includes('u') || data.flags.includes('v');
  regex.lastIndex = 0;
  const stored: import('./match-protocol').MatchItem[] = [];
  let capturesUsed = 0;
  let outputUsed = 0;
  let incomplete = false;
  let reason: 'matches' | 'captures' | 'output' | undefined;
  try {
    scan: for (;;) {
      const match = regex.exec(data.input);
      if (!match) break;
      const entries: CaptureValue[] = [];
      let candidateCaptures = 0;
      let candidateOutput = match[0]!.length;
      if (outputUsed + candidateOutput > MAX_RESULT_CODE_UNITS) { incomplete = true; reason = 'output'; break; }
      const ranges = match.indices;
      const matchStart = match.index;
      const matchEnd = match.index + match[0]!.length;
      for (let index = 1; index < match.length; index++) {
        const value = match[index]; const range = ranges?.[index];
        candidateCaptures++;
        if (value !== undefined) candidateOutput += value.length;
        if (capturesUsed + candidateCaptures > MAX_CAPTURE_ENTRIES) { incomplete = true; reason = 'captures'; break scan; }
        if (outputUsed + candidateOutput > MAX_RESULT_CODE_UNITS) { incomplete = true; reason = 'output'; break scan; }
        entries.push({ number: index, value: value ?? null, start: range?.[0] ?? null, end: range?.[1] ?? null });
      }
      const groups = match.groups;
      if (groups) for (const name of Object.keys(groups)) {
        const value = groups[name]; const range = ranges?.groups?.[name];
        candidateCaptures++; candidateOutput += name.length;
        if (value !== undefined) candidateOutput += value.length;
        if (capturesUsed + candidateCaptures > MAX_CAPTURE_ENTRIES) { incomplete = true; reason = 'captures'; break scan; }
        if (outputUsed + candidateOutput > MAX_RESULT_CODE_UNITS) { incomplete = true; reason = 'output'; break scan; }
        entries.push({ name, value: value ?? null, start: range?.[0] ?? null, end: range?.[1] ?? null });
      }
      stored.push({ index: matchStart, end: matchEnd, value: match[0]!, captures: entries });
      capturesUsed += candidateCaptures; outputUsed += candidateOutput;
      if (!global) break;
      const terminalEmptyMatch = match[0]!.length === 0 && regex.lastIndex >= data.input.length;
      if (terminalEmptyMatch) break;
      if (capturesUsed === MAX_CAPTURE_ENTRIES) { incomplete = true; reason = 'captures'; break; }
      if (outputUsed === MAX_RESULT_CODE_UNITS) { incomplete = true; reason = 'output'; break; }
      if (stored.length === MAX_MATCHES) { incomplete = true; reason = 'matches'; break; }
      if (match[0]!.length === 0) {
        const position = regex.lastIndex;
        if (position >= data.input.length) { regex.lastIndex = data.input.length + 1; }
        else {
          const code = data.input.charCodeAt(position);
          if (unicode && code >= 0xd800 && code <= 0xdbff && position + 1 < data.input.length) {
            const next = data.input.charCodeAt(position + 1);
            regex.lastIndex = next >= 0xdc00 && next <= 0xdfff ? position + 2 : position + 1;
          } else regex.lastIndex = position + 1;
        }
      }
    }
  } catch (error) {
    respond({ id: data.id, ok: false, kind: 'worker', message: error instanceof Error ? error.message : 'ネイティブRegExpの実行に失敗しました。' }); return;
  }
  respond({ id: data.id, ok: true, matches: stored, incomplete, ...(reason ? { reason } : {}) });
};
