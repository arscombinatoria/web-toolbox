export interface ToolModule {
  mount(container: HTMLElement, input?: string): () => void;
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
    description: 'グローバルIPv4・IPv6アドレスを確認',
    load: () => import('./tools/ip-address/index'),
  },
  {
    id: 'rdap-lookup', name: 'IP登録情報検索', category: 'network',
    description: 'IPアドレスの管理組織・ネットワーク情報を検索',
    load: () => import('./tools/rdap-lookup/index'),
  },
  {
    id: 'width-converter', name: '全角・半角変換', category: 'text-data',
    description: '英数字・記号・カタカナ・スペースの変換',
    load: () => import('./tools/width-converter/index'),
  },
  {
    id: 'markdown-table', name: 'Markdown表変換', category: 'text-data',
    description: 'Markdown表とExcelデータの相互変換、XLSX出力',
    load: () => import('./tools/markdown-table/index'),
  },
  {
    id: 'datetime', name: '日時・UTC変換', category: 'date-time',
    description: 'JST・UTCの24時間対応表と日時変換',
    load: () => import('./tools/datetime/index'),
  },
];

export const defaultToolId = 'ip-address';

export function findTool(id: string): ToolDefinition | undefined {
  return tools.find((tool) => tool.id === id);
}
