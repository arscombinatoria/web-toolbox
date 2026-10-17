# Web Toolbox

GitHub Pagesで公開する、ブラウザで使える小さな便利ツール集です。バックエンドを持たない静的SPAとして構築しています。

第3段階としてIPアドレス確認が利用可能です。全角・半角変換、Markdown表変換、日時・UTC変換の3ツールは準備中です。

IP確認はブラウザから `https://api.ipify.org?format=json`（ipify）を直接呼び出します。表示時に自動取得し、再取得・コピーに対応します。10秒でタイムアウトし、自動リトライは行いません。IPv4接続、提供元の稼働状況、CORS設定に依存するため、環境によって取得できない場合があります。取得時には接続元IPがipifyへ伝わります。IPは永続保存せず、位置情報やローカルIPは取得しません。

## 使用技術と動作環境

- Vanilla TypeScript（strict）、Vite、HTML/CSS、ブラウザ標準API
- Vitest + jsdom（通信検証・ツールUI・共通基盤の単体テスト）、Playwright（Chromiumの主要操作）
- Node.js **24 LTS**、npm。`.nvmrc`と`package.json`の`engines`でローカル・CIのメジャーバージョンを統一
- モダンブラウザを対象とします。自動E2E検証はChromiumで実施し、他ブラウザの動作は未確認です。

UIフレームワーク、外部フォント、アイコンライブラリ、実行時の外部依存は使用していません。

## ローカル起動

```sh
nvm use
npm ci
npm run dev
```

`http://localhost:5173/web-toolbox/`を開いてください。`nvm`を使用しない場合は、Node.js 24を別途インストールしてください。

## テスト・ビルド

```sh
npm run typecheck
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

単体テスト・E2Eともipify通信をモックし、実APIへはアクセスしません。VitestではHTTP・JSON・IPv4検証、ネットワーク障害、fake timerによる10秒タイムアウト、中止・破棄を確認します。E2Eでは表示・再取得・Clipboard API・失敗からの復帰・切り替え・両テーマの狭幅表示を確認します。実APIの接続確認はこれらと別に行ってください。

`build`には型チェックも含みます。E2Eは事前に生成した`dist/`をVite previewで配信し、実際の`/web-toolbox/`配下で検証します。初回はPlaywrightのブラウザとOS依存パッケージのインストールが必要です。

本番ビルドを手動確認する場合：

```sh
npm run build
npm run preview
```

`http://localhost:4173/web-toolbox/`を開いてください。

## URL・テーマ・モバイルメニュー

- `/web-toolbox/`は暫定的に`ip-address`を表示します。
- `/web-toolbox/?tool=datetime`のように`tool`で選択でき、直接アクセス・再読み込み・戻る・進むに対応します。
- 不明IDは案内画面を表示します。無関係なクエリはツールリンクへ引き継ぎます。
- テーマは初期状態でOS設定に追従します。ライト・ダークの手動選択だけをlocalStorageへ保存し、「システム」で解除できます。ストレージが使用できなくても動作します。
- 幅760px未満ではヘッダーからメニューを開きます。Escape、閉じるボタン、背景クリック、ツール選択で閉じられます。

## GitHub Pagesの設定

1. リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に設定してください。
2. **Settings → Actions → General** でGitHub Actionsとワークフローで使用する公式Actionsの実行を許可してください。
3. `github-pages` environmentに承認・ブランチ制限がある場合は、`main`からのデプロイが可能であることを確認してください。
4. PRのCI結果を確認して`main`へマージします。`main`へのpushでは型チェック・単体テスト・ビルド・E2E成功後に`dist/`が公開されます。PRではデプロイしません。
5. Actionsの **CI and Pages** とPagesの公開URLを確認してください。想定URLは`https://arscombinatoria.github.io/web-toolbox/`です。

ワークフローはGitHub公式のPages用Actionsを使用し、デプロイジョブにのみ`pages: write`と`id-token: write`を付与します。PRの古いCIはキャンセルし、本番デプロイ同士の競合は直列化します。

Viteの`base`は`/web-toolbox/`です。別リポジトリ名やカスタムドメインに移す場合は、`vite.config.ts`とE2E設定の配信パスを見直してください。クエリ方式なので独自のSPA用404は不要です。実際の公開成功は、マージ後のActionsと公開URLで確認する必要があります。

## ツールの追加方法

1. `src/tools/<tool-id>/index.ts`を作成し、次の同期マウント契約を実装します。

   ```ts
   export function mount(container: HTMLElement): () => void {
     const view = document.createElement('div');
     container.append(view);
     return () => {
       // 登録したリスナー、タイマー、通信、購読もここで解放する。
       view.remove();
     };
   }
   ```

2. `src/registry.ts`の`tools`へID、表示名、説明、カテゴリ、`load: () => import('./tools/<tool-id>/index')`を登録します。カテゴリの追加・順序変更も同ファイルの`categories`で行います。サイドバーは自動生成されます。
3. DOM操作と変換ロジックを分け、必要な単体テストを追加します。URLをimportパスへ直接使用しないでください。マウント後の非同期処理も、破棄後に画面を更新しないようにしてください。
4. 必要な設計更新を行い、型チェック・テスト・ビルドを実行します。

詳細は[実装規約](AGENTS.md)と[アーキテクチャー](docs/architecture.md)を参照してください。
