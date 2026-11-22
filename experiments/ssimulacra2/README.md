# SSIMULACRA2 ブラウザ検証 PoC

画像変換の採用判断用です。本番の Vite エントリ、Registry、依存関係、CI から参照されない独立エントリです。結論と計測値は [検証レポート](./report.md) にあります。

## 手動実行

リポジトリのルートで Node.js 26、Bash、curl、tar、sha256sum を使用します。準備時に npm の Wasm と scikit-image の検証画像を取得し、固定したハッシュを照合します。実行時のアセット取得は同一オリジンの GET だけです。画像データを送信する処理はありません。

```bash
npm ci
bash experiments/ssimulacra2/prepare.sh
npx tsc -p experiments/ssimulacra2
npx vite build experiments/ssimulacra2 --config vite.config.ts
npx vite preview experiments/ssimulacra2 --config vite.config.ts --host 127.0.0.1 --port 4174 --strictPort
```

`http://127.0.0.1:4174/web-toolbox/` を開き、画像の種類と寸法、変換形式を選んで「計測」を押します。初回と2回目の採点を同一 Worker 内で行います。「中止」は Worker を終了します。結果の JSON にロード、画像準備、画素詰め替え、採点と Wasm メモリ容量が含まれます。

## Chromium・Firefox の自動検証

ビルド後、Playwright のブラウザを準備します。検証スクリプトは Vite の出力をループバックの `/web-toolbox/` で静的配信し、ブラウザを順次実行します。Vite preview の起動は不要です。

```bash
npx playwright install --with-deps --only-shell chromium firefox
node experiments/ssimulacra2/verify.mjs > /tmp/ssimulacra2-results.json
```

公式値も取得するには `verify.mjs` の第1引数に libjxl の `ssimulacra2` CLI のパスを指定します。例は Linux x86_64 用の公式 v0.13.0 リリースです。CMake で同タグの `ssimulacra2` ターゲットをビルドした実行ファイルも利用できます。

```bash
mkdir -p /tmp/ssimulacra2-libjxl
curl -fsSL https://github.com/libjxl/libjxl/releases/download/v0.13.0/jxl-linux-x86_64-static.tar.lz \
  -o /tmp/ssimulacra2-libjxl/jxl.tar.lz
(
  cd /tmp/ssimulacra2-libjxl
  sha256sum -c <<< '637599dae477dbb4e6d6ee71b0554e8a65c20dc25fd2892cf2bebb935d54d527  jxl.tar.lz'
  lzip -dc jxl.tar.lz | tar -xf - tools/ssimulacra2
)
node experiments/ssimulacra2/verify.mjs /tmp/ssimulacra2-libjxl/tools/ssimulacra2 \
  > /tmp/ssimulacra2-results.json
```

各ブラウザで14件の画質比較と4サイズの性能測定を行います。加えて、採点中の連続キャンセル、Wasm の HTTP 503、入力エラー、復帰と Worker の終了を検証します。PPM は採点器に渡す RGB 画素列から生成し、CLI にはそのまま渡します。比較用の一時ファイルは実行終了時に削除します。性能測定だけを再実行する場合は `SSIM_BENCHMARK_ONLY=1` を指定します。

検証写真は NASA の Eileen Collins の肖像で、scikit-image v0.25.2 の `astronaut.png` を使っています。画像はパブリックドメインとされています。同梱 Wasm の `LICENSE` と `NOTICE` は準備時に `public/third-party/` にコピーします。 [写真の出典](https://github.com/scikit-image/scikit-image/blob/v0.25.2/skimage/data/_fetchers.py#L382) · [npm 配布元](https://www.npmjs.com/package/bytecut-ssimulacra2)
