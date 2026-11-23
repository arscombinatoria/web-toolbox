# 画像変換のサンプル素材

`public/samples/` の4画像は、写真・輪郭イラスト・架空のアプリ画面・透明な幾何学図形で異なる圧縮特性を比較できるようにしています。レッサーパンダ写真は原寸に近い大きな画像の変換と画質評価を試せる素材です。ボタンに表示する寸法とファイルサイズは、下記の生成物の実測値です。

| ファイル | 内容 | 寸法 | 形式・サイズ | 権利・元データ |
| --- | --- | ---: | --- | --- |
| `red-panda.jpg` | レッサーパンダの実写 | 3840 × 2560 (9,830,400 px) | JPEG・3,872,835 bytes | Mathias Appel撮影。Wikimedia Commonsの[ファイルページ](https://commons.wikimedia.org/wiki/File:Red_Panda_-_52301663056.jpg)にCC0 1.0 Universalと記載。元の写真は[Flickrの一次ページ](https://www.flickr.com/photos/mathiasappel/52301663056/)のJSON-LD `license` と `rel="license"` でもCC0 1.0を確認。Commons掲載ページではFlickreviewR 2が2023-08-30にライセンスを確認。 |
| `outline.png` | 単色の輪郭イラスト | 1200 × 900 (1,080,000 px) | PNG・70,219 bytes | 独自作成。ソースは`src/tools/image-converter/samples/outline.svg`。 |
| `mobile-screen.png` | 架空の散歩記録アプリ画面 | 900 × 1600 (1,440,000 px) | PNG・80,818 bytes | 独自作成。ソースは`mobile-screen.html`と`mobile-screen.css`。実在サービスのロゴや個人情報を含みません。 |
| `geometry.png` | 半透明、グラデーション、細線を含む幾何学図形 | 1200 × 900 (1,080,000 px) | PNG・542,936 bytes | 独自作成。背景を透明にしたPNG。ソースは`geometry.svg`。 |

実写写真はCC0 1.0により、許可を求めずに加工・再配布できます。指定URLから取得した3840 × 2560のJPEGを縮小・再圧縮せず、そのまま同梱しています。元データのSHA-256は `149f3498bd8c74f1a109a1e98d55618943afa684057a56ce94cc7c80c4936b4b` です。ほかの画像はブラウザ内でPNGにラスタライズしています。サムネイルは従来どおり160 × 100 pxで、写真だけJPEGにして読み込み量を抑えています。 [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/deed.ja)

## 再生成

Node.js 26、`npm ci`、Chromium（`npx playwright install chromium`）、`curl`、ネットワーク接続が必要です。スクリプトは写真を一時ディレクトリに取得して、HTTP応答、JPEG形式、3840 × 2560の寸法、SHA-256を検証してから元バイト列のまま同梱します。取得・形式・寸法・ハッシュが期待値と異なる場合は、状態コードや実測値を含むエラーで停止します。スマートフォン画面はビューポート900 × 1600px、device scale factor 1で描画し、Noto Sans CJK JPを使います。別のChromium実行ファイルを使う場合は`CHROMIUM_PATH`を設定します。

```sh
npm ci
npx playwright install chromium
node src/tools/image-converter/samples/generate.mjs
```

スクリプトは画像とサムネイルを`public/samples/`に書き出し、各ファイルの寸法・バイト数を標準出力に表示します。再生成後にサンプルボタンの`size`値も実測値に合わせて更新してください。

`red-panda.jpg` は配布元の応答をSHA-256で固定しているため、ブラウザのバージョンに依存せず元バイト列が一致します。サムネイルと独自作成画像はChromiumで生成するため、Chromiumのバージョンによりバイト数が変わることがあります。スマートフォン画面はフォント描画にも依存します。再生成時の出力ログで各ファイルの寸法・バイト数を確認し、写真のハッシュが期待値に一致することを確認してください。
