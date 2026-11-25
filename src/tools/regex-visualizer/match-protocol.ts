export const MAX_TEST_LENGTH = 32_768;
export const MAX_MATCHES = 1_000;
export const MAX_CAPTURE_ENTRIES = 4_096;
export const MAX_RESULT_CODE_UNITS = 262_144;
export const MATCH_TIMEOUT_MS = 2_000;

export interface MatchRequest { id: number; pattern: string; flags: string; input: string }
export interface CaptureValue { number?: number; name?: string; value: string | null; start: number | null; end: number | null }
export interface MatchItem { index: number; end: number; value: string; captures: CaptureValue[] }
export type MatchResult =
  | { ok: true; matches: MatchItem[]; incomplete: boolean; reason?: 'matches' | 'captures' | 'output' }
  | { ok: false; kind: 'syntax' | 'limit' | 'timeout' | 'worker'; message: string };
export type MatchResponse = MatchResult & { id: number };
