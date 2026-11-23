# 画像変換のサンプル素材

`public/samples/` の4画像は、写真・輪郭イラスト・架空のアプリ画面・透明な幾何学図形で異なる圧縮特性を比較できるようにしています。すべて長辺1,600 px以下、4,194,304画素以下です。ボタンに表示する寸法とファイルサイズは、下記の生成物の実測値です。

| ファイル | 内容 | 寸法 | 形式・サイズ | 権利・元データ |
| --- | --- | ---: | --- | --- |
| `red-panda.jpg` | レッサーパンダの実写 | 1280 × 853 (1,091,840 px) | JPEG・314,622 bytes | Mathias Appel撮影。Wikimedia Commonsの[ファイルページ](https://commons.wikimedia.org/wiki/File:Red_Panda_-_52301663056.jpg)にCC0 1.0 Universalと記載。元の写真は[Flickrの一次ページ](https://www.flickr.com/photos/mathiasappel/52301663056/)のJSON-LD `license` と `rel="license"` でもCC0 1.0を確認。Commons掲載ページではFlickreviewR 2が2023-08-30にライセンスを確認。 |
| `outline.png` | 単色の輪郭イラスト | 1200 × 900 (1,080,000 px) | PNG・70,219 bytes | 独自作成。ソースは`src/tools/image-converter/samples/outline.svg`。 |
| `mobile-screen.png` | 架空の散歩記録アプリ画面 | 900 × 1600 (1,440,000 px) | PNG・80,818 bytes | 独自作成。ソースは`mobile-screen.html`と`mobile-screen.css`。実在サービスのロゴや個人情報を含みません。 |
| `geometry.png` | 半透明、グラデーション、細線を含む幾何学図形 | 1200 × 900 (1,080,000 px) | PNG・542,936 bytes | 独自作成。背景を透明にしたPNG。ソースは`geometry.svg`。 |

実写写真はCC0 1.0により、許可を求めずに加工・再配布できます。Commons掲載JPEGを長辺1,280 pxに縮小し、ブラウザCanvasのJPEG品質0.84で保存しました。ほかの画像もブラウザ内でPNGにラスタライズしています。サムネイルは160 × 100 pxで、写真だけJPEGにして読み込み量を抑えています。 [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/deed.ja)

## 再生成

Node.js 26、`npm ci`、Chromium（`npx playwright install chromium`）、`curl`、ネットワーク接続が必要です。スクリプトは写真の元データを一時ディレクトリに取得して加工し、処理後に削除します。スマートフォン画面はビューポート900 × 1600px、device scale factor 1で描画し、Noto Sans CJK JPを使います。別のChromium実行ファイルを使う場合は`CHROMIUM_PATH`を設定します。

```sh
npm ci
npx playwright install chromium
node src/tools/image-converter/samples/generate.mjs
```

スクリプトは画像とサムネイルを`public/samples/`に書き出し、各ファイルの寸法・バイト数を標準出力に表示します。再生成後にサンプルボタンの`size`値も実測値に合わせて更新してください。

同梱ファイルはDebian 13のChromium 154.0.8037.57で生成しました。同じ環境で再生成した画像とサムネイルは、すべて同梱ファイルとバイト単位で一致しました。ブラウザやフォントのバージョンが異なる場合は、再生成した画像の見た目やファイルサイズが変わることがあります。
