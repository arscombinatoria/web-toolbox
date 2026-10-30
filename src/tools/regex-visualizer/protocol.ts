export const FLAGS = ['d', 'g', 'i', 'm', 's', 'u', 'v', 'y'] as const;
export const MAX_PATTERN_LENGTH = 4096;
export const DEBOUNCE_MS = 200;
export const WORKER_TIMEOUT_MS = 4000;

export interface DiagramRequest { id: number; pattern: string; flags: string }
export type DiagramResult =
  | { ok: true; svg: string; warnings: string[] }
  | { ok: false; kind: 'syntax' | 'limit' | 'render'; message: string; position?: number };
export type DiagramResponse = DiagramResult & { id: number };
