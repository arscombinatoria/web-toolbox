import { expect, it } from 'vitest';
import { httpsUrl, isIp, parseRdap, rdapUrl } from './logic';

import { network } from './__tests__/fixture';
it('ネットワーク、CIDR、roles、jCard、ネストentity、イベントを抽出しAbuseのみのentityを管理組織にしない', () => {
  const info = parseRdap(network);
  expect(info.network).toContainEqual(['CIDR', '8.8.8.0/24, 2001:db8::/32']);
  expect(info.network).toContainEqual(['ステータス', 'active']);
  expect(info.organizations).toEqual(['Example Inc']);
  expect(info.contacts[0]!.organizations).toEqual(['Example Inc']);
  expect(info.abuseEmails).toEqual(['abuse@example.test']);
  expect(info.contacts[2]).toMatchObject({ roles: ['technical', 'administrative'], emails: ['tech@example.test'], phones: ['tel:+1-555-0100'], addresses: ['Public address'] });
  expect(info.events).toHaveLength(2);
  expect(info.links).toEqual(['https://rdap.example.test/ip/8.8.8.8']);
});
it('任意フィールド欠損・不正型を省略し情報を推測しない', () => {
  expect(parseRdap({ objectClassName: 'ip network', name: 123, entities: [null, { roles: 'registrant', vcardArray: ['broken'] }], events: [null], links: [null], cidr0_cidrs: [null, { v4prefix: '8.8.8.0', length: 33 }] }))
    .toEqual({ network: [], organizations: [], abuseEmails: [], contacts: [], events: [], links: [] });
  const info = parseRdap({ objectClassName: 'ip network', entities: [{ roles: ['abuse'], vcardArray: ['vcard', [['fn', {}, 'text', 'Abuse']]] }] });
  expect(info.organizations).toEqual([]);
});
it.each([null, [], {}, { objectClassName: 'entity' }])('IP Network以外を拒否 %j', (data) => expect(() => parseRdap(data)).toThrow());
it('深いentityと不正なjCard・複合住所を扱う', () => {
  const root: { entities: unknown[]; roles?: string[]; vcardArray?: unknown } = { entities: [] };
  let current = root;
  for (let i = 0; i < 2000; i++) { const child = { entities: [] }; current.entities.push(child); current = child; }
  current.roles = ['registrant'];
  current.vcardArray = ['vcard', [null, ['fn', {}, 'text', 'Owner'], ['org', {}, 'text', 123], ['adr', {}, 'text', ['', '', ['Street', 'Suite'], 'City']], ['email', {}, 'text', 123]]];
  const info = parseRdap({ objectClassName: 'ip network', entities: [root] });
  expect(info.organizations).toEqual(['Owner']);
  expect(info.contacts[0]!.addresses).toEqual(['Street, Suite, City']);
});
it('検証済みIPだけURLに使い、安全なHTTPSリンクだけ許可する', () => {
  expect(rdapUrl('2001:db8::1')).toBe('https://rdap.org/ip/2001%3Adb8%3A%3A1');
  expect(isIp('8.8.8.8')).toBe(true);
  expect(() => rdapUrl('8.8.8.8/24')).toThrow();
  for (const url of ['http://example.test', '//example.test', 'https://user:pass@example.test', 'javascript:alert(1)', 123]) expect(httpsUrl(url)).toBeUndefined();
});

it.each([
  ['Example Inc', ['Example Inc']],
  [['Example Inc', 'Network', 'Operations'], ['Example Inc']],
  [[], ['Owner']],
  [['', 'Network'], ['Owner']],
  [[123, 'Network'], ['Owner']],
])('ORG %jは組織名だけを抽出し、部署を代わりに使わない', (org, expected) => {
  const info = parseRdap({ objectClassName: 'ip network', entities: [{
    roles: ['registrant'],
    vcardArray: ['vcard', [['fn', {}, 'text', 'Owner'], ['org', {}, 'text', org]]],
  }] });
  expect(info.organizations).toEqual(expected);
  expect(info.contacts[0]!.organizations).toEqual(expected[0] === 'Owner' ? [] : expected);
});
it.each([
  { roles: ['registrant'], organizations: ['Example Inc'], abuseEmails: [] },
  { roles: ['abuse'], organizations: [], abuseEmails: ['abuse@example.test'] },
  { roles: ['registrant', 'abuse'], organizations: ['Example Inc'], abuseEmails: ['abuse@example.test'] },
  { roles: ['technical'], organizations: [], abuseEmails: [] },
  { roles: ['administrative'], organizations: [], abuseEmails: [] },
])('roles $rolesから管理組織とAbuseメールを独立して抽出する', ({ roles, organizations, abuseEmails }) => {
  const info = parseRdap({ objectClassName: 'ip network', entities: [{
    roles,
    vcardArray: ['vcard', [['org', {}, 'text', 'Example Inc'], ['email', {}, 'text', 'abuse@example.test']]],
  }] });
  expect(info.organizations).toEqual(organizations);
  expect(info.abuseEmails).toEqual(abuseEmails);
});
it('registrantとabuseの兼任でもORG欠損時のfnを管理組織名に使う', () => {
  const info = parseRdap({ objectClassName: 'ip network', entities: [{
    roles: ['registrant', 'abuse'],
    vcardArray: ['vcard', [['fn', {}, 'text', 'Owner'], ['email', {}, 'text', 'abuse@example.test']]],
  }] });
  expect(info.organizations).toEqual(['Owner']);
  expect(info.abuseEmails).toEqual(['abuse@example.test']);
});
it('ネストした兼任entityからも抽出し、組織名とAbuseメールの重複を除く', () => {
  const info = parseRdap({ ...network, entities: [...network.entities, {
    roles: ['technical'],
    entities: [{
      roles: ['registrant', 'abuse'],
      vcardArray: ['vcard', [
        ['org', {}, 'text', ['Example Inc', 'Other Department']],
        ['email', {}, 'text', 'abuse@example.test'],
        ['email', {}, 'text', 'abuse@example.test'],
      ]],
    }],
  }] });
  expect(info.organizations).toEqual(['Example Inc']);
  expect(info.abuseEmails).toEqual(['abuse@example.test']);
  expect(info.contacts).toHaveLength(4);
  expect(info.contacts[3]).toMatchObject({ roles: ['registrant', 'abuse'], organizations: ['Example Inc'] });
});
