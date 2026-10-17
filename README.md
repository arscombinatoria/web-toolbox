# Web Toolbox

GitHub Pagesで公開する、ブラウザで使える小さな便利ツール集です。バックエンドを持たない静的SPAとして構築しています。

第4段階としてIPアドレス確認と全角・半角変換が利用可能です。Markdown表変換、日時・UTC変換の2ツールは準備中です。

IP確認はブラウザからIPv4用の `https://api.ipify.org?format=json` とIPv6用の `https://api6.ipify.org?format=json`（ipify）を並行して直接呼び出します。それぞれ独立した表示・取得状態・コピーに対応し、共通ボタンで両方を再取得できます。表示時に自動取得します。10秒でタイムアウトし、自動リトライは行いません。各IPバージョンの接続環境、DNS、提供元の稼働状況、CORS設定に依存するため、環境によって取得できない場合があります。IPv6の取得失敗だけではIPv6非対応とは判断できません。取得時には接続元IPがipifyへ伝わります。IPは永続保存せず、位置情報やローカルIPは取得しません。

## 全角・半角変換

`/web-toolbox/?tool=width-converter`で利用できます。初期設定は「全角 → 半角」、英数字・記号・スペースがON、カタカナがOFFです。方向と4カテゴリを独立して選択でき、入力・設定変更で結果を更新します。全カテゴリOFFでは入力をそのまま出力します。

- 英数字：ASCII英数字と全角英数字。
- 記号：ASCII U+0021–U+007Eから英数字を除いた文字と、U+FF01–U+FF5Eの全角対応。`~` ↔ `～`、`\` ↔ `＼`も対象です。波ダッシュ`〜`（U+301C）や円記号`¥`（U+00A5）・`￥`は対象外です。
- カタカナ：U+FF61–U+FF9Fに対応するカナ、小書きカナ、長音、中黒、日本語句読点、濁点・半濁点。句読点は記号設定に依存しません。合成済み・結合文字の濁点にも対応します。単独の半角濁点・半濁点は全角方向で結合文字U+3099・U+309Aになります。幅のある`゛`・`゜`も半角方向で`ﾞ`・`ﾟ`になります。
- スペース：U+0020とU+3000のみ。タブ・改行・その他のUnicode空白は保持します。

例：`ＡＢＣ１２３！＠＃　ガギグ` → 初期設定では`ABC123!@# ガギグ`。

全文正規化は行わず、丸数字・ローマ数字・ひらがな・半角対応がないカナ（ヵ・ヶ・ヮなど）や非対応文字は保持します。Unicode全体での完全な往復一致は保証しません。日本語IMEの変換中は更新を抑制し、確定後に反映します。結果はreadonly欄から手動選択でき、Clipboard APIによるコピーの成功・失敗を通知します。入力・結果は外部送信せず、URLやストレージにも保存しません。ツールを切り替えると入力は破棄されます。

## 使用技術と動作環境

- Vanilla TypeScript（strict）、Vite、HTML/CSS、ブラウザ標準API
- Vitest + jsdom（変換処理・通信検証・ツールUI・共通基盤の単体テスト）、Playwright（Chromiumの主要操作）
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

単体テスト・E2Eともipify通信をモックし、実APIへはアクセスしません。VitestではHTTP・JSON・IPv4／IPv6検証、ネットワーク障害、fake timerによる10秒タイムアウト、中止・破棄、両バージョンの成功・失敗の組み合わせを確認します。E2Eでは表示・再取得・Clipboard API・失敗からの復帰・切り替え・両テーマの狭幅表示を確認します。実APIの接続確認はこれらと別に行ってください。全角・半角変換ではカテゴリ別・Unicode境界値をVitestで、設定変更・IMEイベント順序・コピー・破棄・モバイル表示をPlaywrightで検証します。

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
