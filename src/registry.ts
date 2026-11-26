import { ArrowLeftRight, Clock, Globe, Image, Search, ShieldCheck, Table, Workflow, type IconNode } from 'lucide';

export interface ToolModule {
  mount(container: HTMLElement, input?: string): () => void;
}

// 配列順がカテゴリとカテゴリ内ツールの表示順になる。
export const categories = [
  { id: 'network', name: 'ネットワーク' },
  { id: 'text-data', name: 'テキスト・データ' },
  { id: 'date-time', name: '日時' },
  { id: 'image', name: '画像' },
] as const;

export interface ToolDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: (typeof categories)[number]['id'];
  readonly icon: IconNode;
  readonly load: () => Promise<ToolModule>;
}

export const tools: readonly ToolDefinition[] = [
  {
    id: 'ip-address', name: 'IPアドレス確認', category: 'network',
    description: 'グローバルIPv4・IPv6アドレスを確認',
    icon: Globe,
    load: () => import('./tools/ip-address/index'),
  },
  {
    id: 'rdap-lookup', name: 'IP登録情報検索', category: 'network',
    description: 'IPアドレスの管理組織・ネットワーク情報を検索',
    icon: Search,
    load: () => import('./tools/rdap-lookup/index'),
  },
  {
    id: 'width-converter', name: '全角・半角変換', category: 'text-data',
    description: '英数字・記号・カタカナ・スペースの変換',
    icon: ArrowLeftRight,
    load: () => import('./tools/width-converter/index'),
  },
  {
    id: 'markdown-table', name: 'Markdown表変換', category: 'text-data',
    description: 'Markdown表とExcelデータの相互変換、XLSX出力',
    icon: Table,
    load: () => import('./tools/markdown-table/index'),
  },
  {
    id: 'regex-visualizer', name: '正規表現ビジュアライザー', category: 'text-data',
    description: 'JavaScriptの正規表現を図で可視化し、テキストでマッチ確認',
    icon: Workflow,
    load: () => import('./tools/regex-visualizer/index'),
  },
  {
    id: 'jwt-debugger', name: 'JWTデバッガー', category: 'text-data',
    description: 'JWTのデコード・Claims確認・署名検証',
    icon: ShieldCheck,
    load: () => import('./tools/jwt-debugger/index'),
  },
  {
    id: 'datetime', name: '日時・UTC変換', category: 'date-time',
    description: 'JST・UTCの24時間対応表と日時変換',
    icon: Clock,
    load: () => import('./tools/datetime/index'),
  },
  {
    id: 'image-converter', name: '画像変換', category: 'image',
    description: 'JPEG・PNG・AVIFへの画像変換、画質比較、元ファイル比の確認',
    icon: Image,
    load: () => import('./tools/image-converter/index'),
  },
];

export const defaultToolId = 'ip-address';

export function findTool(id: string): ToolDefinition | undefined {
  return tools.find((tool) => tool.id === id);
}
