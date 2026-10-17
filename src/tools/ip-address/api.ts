export type IpErrorKind = 'network' | 'http' | 'timeout' | 'format' | 'aborted';

function failure(kind: IpErrorKind) {
  return Object.assign(new Error(kind), { kind });
}

export function isIpv4(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) =>
    /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255 && String(Number(part)) === part);
}

export function isIpv6(value: string): boolean {
  if (!value.includes(':') || /[^0-9a-fA-F:.]/.test(value)) return false;
  // IPv4埋め込み表記は末尾の32ビット（2グループ）として数える。
  let address = value;
  if (address.includes('.')) {
    const lastColon = address.lastIndexOf(':');
    if (!isIpv4(address.slice(lastColon + 1))) return false;
    address = `${address.slice(0, lastColon)}:0:0`;
  }
  const halves = address.split('::');
  if (halves.length > 2) return false;
  const groups = halves.flatMap((half) => half === '' ? [] : half.split(':'));
  if (!groups.every((group) => /^[0-9a-fA-F]{1,4}$/.test(group))) return false;
  return halves.length === 2 ? groups.length < 8 : groups.length === 8;
}

export function fetchIpv4(signal: AbortSignal): Promise<string> {
  return fetchIp('https://api.ipify.org?format=json', isIpv4, signal);
}

export function fetchIpv6(signal: AbortSignal): Promise<string> {
  return fetchIp('https://api6.ipify.org?format=json', isIpv6, signal);
}

async function fetchIp(endpoint: string, validate: (value: string) => boolean, signal: AbortSignal): Promise<string> {
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
    } catch (error) {
      if (error instanceof SyntaxError) throw failure('format');
      throw error;
    }
    controller.signal.throwIfAborted();
    if (typeof data !== 'object' || data === null || !('ip' in data)
      || typeof data.ip !== 'string' || !validate(data.ip)) throw failure('format');
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
