import { isIpv4, isIpv6 } from '../ip-address/api';

export const isIp = (value: string): boolean => isIpv4(value) || isIpv6(value);
export function rdapUrl(ip: string): string {
  if (!isIp(ip)) throw new Error('invalid IP');
  return `https://rdap.org/ip/${encodeURIComponent(ip)}`;
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
export function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch { /* 不正・相対URLはリンクにしない。 */ }
}
export interface Contact {
  roles: string[];
  name: string;
  organizations: string[];
  emails: string[];
  phones: string[];
  addresses: string[];
  handle: string;
}
export interface RdapInfo {
  network: [string, string][];
  organizations: string[];
  abuseEmails: string[];
  contacts: Contact[];
  events: [string, string][];
  links: string[];
}

export function parseRdap(data: unknown): RdapInfo {
  if (!record(data) || data.objectClassName !== 'ip network') throw new Error('RDAP IP Network required');
  const network: [string, string][] = [];
  for (const [key, label] of [
    ['name', 'ネットワーク名'], ['handle', 'ハンドル'], ['startAddress', '開始IP'],
    ['endAddress', '終了IP'], ['country', '国コード'], ['type', 'ネットワーク種別'],
  ] as const) {
    const value = text(data[key]);
    if (value) network.push([label, value]);
  }
  const cidrs = Array.isArray(data.cidr0_cidrs) ? data.cidr0_cidrs.flatMap((entry: unknown) => {
    if (!record(entry)) return [];
    const prefix = text(entry.v4prefix) || text(entry.v6prefix);
    const max = isIpv4(prefix) ? 32 : isIpv6(prefix) ? 128 : -1;
    return typeof entry.length === 'number' && Number.isInteger(entry.length) && entry.length >= 0 && entry.length <= max
      ? [`${prefix}/${entry.length}`] : [];
  }) : [];
  if (cidrs.length) network.push(['CIDR', cidrs.join(', ')]);
  const status = strings(data.status);
  if (status.length) network.push(['ステータス', status.join(', ')]);
  const contacts: Contact[] = [];
  // 反復処理で深いentityにも対応し、外部データでコールスタックを消費しない。
  const pending: unknown[] = Array.isArray(data.entities) ? [...data.entities].reverse() : [];
  const seen = new Set<unknown>();
  while (pending.length) {
    const entity = pending.pop();
    if (!record(entity) || seen.has(entity)) continue;
    seen.add(entity);
    const contact: Contact = {
      roles: strings(entity.roles), name: '', organizations: [], emails: [], phones: [], addresses: [], handle: text(entity.handle),
    };
    const card = entity.vcardArray;
    if (Array.isArray(card) && card[0] === 'vcard' && Array.isArray(card[1])) {
      for (const field of card[1] as unknown[]) {
        if (!Array.isArray(field) || field.length < 4) continue;
        // jCardの電話番号にはuri形式もあるが、リンクには変換しない。
        if (field[0] === 'tel' && field[2] === 'uri' && typeof field[3] === 'string') contact.phones.push(field[3]);
        if (field[2] !== 'text') continue;
        const value = text(field[3]);
        if (field[0] === 'fn') contact.name = value;
        if (field[0] === 'org') {
          // ORGの先頭成分が組織名。後続の部署・部門を組織名として扱わない。
          const organization = Array.isArray(field[3]) ? text(field[3][0]) : value;
          if (organization) contact.organizations.push(organization);
        }
        if (field[0] === 'email' && value) contact.emails.push(value);
        if (field[0] === 'tel' && value) contact.phones.push(value);
        if (field[0] === 'adr') {
          const address = Array.isArray(field[3]) ? field[3].flatMap((v: unknown) => Array.isArray(v) ? strings(v) : text(v) ? [text(v)] : []).join(', ') : value;
          const label = record(field[1]) ? text(field[1].label) : '';
          if (label || address) contact.addresses.push(label || address);
        }
      }
    }
    if (contact.name || contact.handle || contact.organizations.length || contact.emails.length || contact.phones.length || contact.addresses.length) contacts.push(contact);
    if (Array.isArray(entity.entities)) pending.push(...[...entity.entities].reverse());
  }
  // 管理組織は明示的なregistrantのみ。他の役割との兼任は許可する。
  const organizations = [...new Set(contacts.filter((c) => c.roles.includes('registrant'))
    .flatMap((c) => c.organizations.length ? c.organizations : c.name ? [c.name] : []))];
  const abuseEmails = [...new Set(contacts.filter((c) => c.roles.includes('abuse')).flatMap((c) => c.emails))];
  const events: [string, string][] = [];
  if (Array.isArray(data.events)) for (const event of data.events as unknown[]) {
    if (!record(event)) continue;
    const label = event.eventAction === 'registration' ? '登録日時' : event.eventAction === 'last changed' ? '最終更新日時' : '';
    if (label && text(event.eventDate)) events.push([label, text(event.eventDate)]);
  }
  const links = Array.isArray(data.links) ? data.links.flatMap((link: unknown) => {
    const url = record(link) && link.rel === 'self' ? httpsUrl(link.href) : undefined;
    return url ? [url] : [];
  }) : [];
  return { network, organizations, abuseEmails, contacts, events, links: [...new Set(links)] };
}
