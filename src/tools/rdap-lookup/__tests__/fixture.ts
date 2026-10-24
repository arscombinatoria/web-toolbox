export const network = {
  objectClassName: 'ip network', name: 'EXAMPLE', handle: 'NET-EXAMPLE', startAddress: '8.8.8.0', endAddress: '8.8.8.255',
  country: 'US', type: 'DIRECT ALLOCATION', status: ['active'],
  cidr0_cidrs: [{ v4prefix: '8.8.8.0', length: 24 }, { v6prefix: '2001:db8::', length: 32 }],
  entities: [
    { roles: ['registrant'], vcardArray: ['vcard', [['fn', {}, 'text', 'Owner'], ['org', {}, 'text', ['Example Inc', 'Network']]]],
      entities: [{ roles: ['abuse'], vcardArray: ['vcard', [['fn', {}, 'text', 'Abuse Team'], ['email', {}, 'text', 'abuse@example.test']]] }] },
    { roles: ['technical', 'administrative'], handle: 'TECH', vcardArray: ['vcard', [
      ['fn', {}, 'text', 'Tech Team'], ['email', {}, 'text', 'tech@example.test'], ['tel', {}, 'uri', 'tel:+1-555-0100'],
      ['adr', { label: 'Public address' }, 'text', ['', '', 'Street', 'City', '', '', 'US']],
    ]] },
  ],
  events: [{ eventAction: 'registration', eventDate: '2000-01-01T00:00:00Z' }, { eventAction: 'last changed', eventDate: '2026-01-01T00:00:00Z' }],
  links: [{ rel: 'self', href: 'https://rdap.example.test/ip/8.8.8.8' }, { rel: 'self', href: 'javascript:alert(1)' }],
  unexpected_extension: { anything: true },
};
