export type IpVersion = 'IPv4' | 'IPv6';

type IpApiErrorKind = 'http' | 'network' | 'json' | 'missing-ip' | 'invalid-ip' | 'timeout';

export class IpApiError extends Error {
  readonly kind: IpApiErrorKind;

  constructor(
    kind: IpApiErrorKind,
    message: string,
  ) {
    super(message);
    this.kind = kind;
    this.name = 'IpApiError';
  }
}

const endpoints: Record<IpVersion, string> = {
  IPv4: 'https://api.ipify.org?format=json',
  IPv6: 'https://api6.ipify.org?format=json',
};

export function isValidIPv4(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return false;
    return Number(part) <= 255;
  });
}

export function isValidIPv6(value: string): boolean {
  if (!value || value.includes('%')) return false;

  const halves = value.split('::');
  if (halves.length > 2) return false;
  const compressed = halves.length === 2;
  if (!compressed && (value.startsWith(':') || value.endsWith(':'))) return false;
  const groups = value.split(':');
  let count = 0;

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    if (!group) continue;
    if (group.includes('.')) {
      // An IPv4 tail occupies the final two 16-bit groups.
      if (index !== groups.length - 1 || !isValidIPv4(group)) return false;
      count += 2;
    } else {
      if (!/^[\da-fA-F]{1,4}$/.test(group)) return false;
      count += 1;
    }
  }

  // Without compression all eight groups must be present. With `::`, it
  // must replace at least one group.
  return compressed ? count < 8 : count === 8;
}

function isValidIp(version: IpVersion, value: string): boolean {
  return version === 'IPv4' ? isValidIPv4(value) : isValidIPv6(value);
}

export async function fetchPublicIp(version: IpVersion, signal?: AbortSignal): Promise<string> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = (): void => controller.abort();
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  if (signal?.aborted) controller.abort();

  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 10_000);

  try {
    let response: Response;
    try {
      response = await fetch(endpoints[version], { signal: controller.signal });
    } catch (error) {
      if (timedOut) throw new IpApiError('timeout', '応答がタイムアウトしました。');
      if (signal?.aborted) throw error;
      throw new IpApiError('network', 'ネットワークに接続できませんでした。');
    }

    if (!response.ok) {
      throw new IpApiError('http', `APIからエラー応答を受け取りました（HTTP ${response.status}）。`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      if (timedOut) throw new IpApiError('timeout', '応答がタイムアウトしました。');
      if (signal?.aborted) throw error;
      throw new IpApiError('json', 'APIの応答を読み取れませんでした。');
    }

    if (typeof body !== 'object' || body === null || !('ip' in body)) {
      throw new IpApiError('missing-ip', 'APIの応答にIPアドレスがありません。');
    }
    const ip = body.ip;
    if (typeof ip !== 'string' || !isValidIp(version, ip)) {
      throw new IpApiError('invalid-ip', `${version}アドレスの形式が正しくありません。`);
    }
    return ip;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}
