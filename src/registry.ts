export interface ToolModule {
  mount(container: HTMLElement): () => void;
}

// 配列順がカテゴリとカテゴリ内ツールの表示順になる。
export const categories = [
  { id: 'network', name: 'ネットワーク' },
  { id: 'text-data', name: 'テキスト・データ' },
  { id: 'date-time', name: '日時' },
] as const;

export interface ToolDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: (typeof categories)[number]['id'];
  readonly load: () => Promise<ToolModule>;
}

export const tools: readonly ToolDefinition[] = [
  {
    id: 'ip-address', name: 'IPアドレス確認', category: 'network',
    description: '現在のグローバルIPv4・IPv6アドレスを確認できます',
    load: () => import('./tools/ip-address/index'),
  },
  {
    id: 'width-converter', name: '全角・半角変換', category: 'text-data',
    description: '英数字やカタカナなどの全角・半角を変換できます。',
    load: () => import('./tools/width-converter/index'),
  },
  {
    id: 'markdown-table', name: 'Markdown表変換', category: 'text-data',
    description: 'Markdownの表とTSV形式のデータを相互に変換できます。',
    load: () => import('./tools/markdown-table/index'),
  },
  {
    id: 'datetime', name: '日時・UTC変換', category: 'date-time',
    description: 'JST・UTCの日時やUnix timeを変換できます。',
    load: () => import('./tools/datetime/index'),
  },
];

export const defaultToolId = 'ip-address';

export function findTool(id: string): ToolDefinition | undefined {
  return tools.find((tool) => tool.id === id);
}
