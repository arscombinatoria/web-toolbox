const endpoint = 'https://api.ipify.org?format=json';
export type IpErrorKind = 'network' | 'http' | 'timeout' | 'format' | 'aborted';

function failure(kind: IpErrorKind) {
  return Object.assign(new Error(kind), { kind });
}

export function isIpv4(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) =>
    /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255);
}

export async function fetchIpv4(signal: AbortSignal): Promise<string> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 10_000);
  try {
    controller.signal.throwIfAborted();
    const response = await fetch(endpoint, {
      signal: controller.signal, cache: 'no-store',
      credentials: 'omit', referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw failure('http');
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw failure('format');
    }
    controller.signal.throwIfAborted();
    if (typeof data !== 'object' || data === null || !('ip' in data)
      || typeof data.ip !== 'string' || !isIpv4(data.ip)) throw failure('format');
    return data.ip;
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
