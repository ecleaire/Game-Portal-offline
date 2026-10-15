# GAME PORTAL

バージョン：**0.20.1**

ゲームをフォルダーにまとめて、追加・編集・プレイできる単体HTMLランチャーです。

[**使うためのZIPをダウンロード**](https://github.com/ecleaire/Game-Portal-offline-html/releases/latest/download/GAME-PORTAL-HTML.zip)

ZIPを展開すると、直下に `GAME-PORTAL.html` があります。GitHubの「Code → Download ZIP」は開発用ソースです。

## 使い方

1. 配布ZIPを展開し、GAME-PORTAL.htmlをPC版Chromeで開きます。
2. ホームの「ゲームのフォルダーを選ぶ」から作成したゲームの出力保存先フォルダーを選びます。
3. ゲームを追加・変更するときは「編集モード」をオンにします。

詳細な操作手順はHTML内の「ヘルプ」で確認できます。
WindowsのEXEゲームは[起動補助](docs/WINDOWS_EXE.md)を併用します。メイン画面はHTMLのままです。
EXEゲーム用の配布ZIPは[Releases](https://github.com/ecleaire/Game-Portal-offline-html/releases/latest)からダウンロードできます。

## 開発

Node.js 22以上を使用します。

```sh
npm ci
npm run prepare:runtime
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

Windows用の起動補助は `npm run build:windows`、検証は `npm run test:native` で実行します。

[詳しい使い方](docs/OFFLINE_HTML.md) · [別PCへの受け渡し](docs/TRANSFER_GUIDE.md) · [変更履歴](CHANGELOG.md)
