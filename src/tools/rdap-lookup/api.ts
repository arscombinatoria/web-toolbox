import { parseRdap, rdapUrl, type RdapInfo } from './logic';
export type RdapErrorKind = 'invalid' | 'not-found' | 'rate-limit' | 'http' | 'network' | 'timeout' | 'json' | 'format' | 'aborted';
const failure = (kind: RdapErrorKind) => Object.assign(new Error(kind), { kind });
export interface RdapResult { data: unknown; info: RdapInfo; url: string }
export async function fetchRdap(ip: string, signal: AbortSignal): Promise<RdapResult> {
  let endpoint: string;
  try { endpoint = rdapUrl(ip); } catch { throw failure('invalid'); }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 10_000);
  try {
    controller.signal.throwIfAborted();
    const response = await fetch(endpoint, {
      signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
    });
    if (!response.ok) throw failure(response.status === 404 ? 'not-found' : response.status === 429 ? 'rate-limit' : 'http');
    let data: unknown;
    try { data = await response.json(); } catch (error) {
      if (error instanceof SyntaxError) throw failure('json');
      throw error;
    }
    controller.signal.throwIfAborted();
    let info: RdapInfo;
    try { info = parseRdap(data); } catch { throw failure('format'); }
    return { data, info, url: response.url || endpoint };
  } catch (error) {
    if (signal.aborted) throw failure('aborted');
    if (timedOut) throw failure('timeout');
    if (error instanceof Error && 'kind' in error) throw error;
    throw failure('network');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
