# GAME PORTAL

バージョン：**0.20.2**

ゲームをフォルダーにまとめて、追加・編集・プレイできる単体HTMLランチャーです。

[**ZIPをダウンロード**](https://github.com/ecleaire/Game-Portal-offline-html/archive/refs/heads/main.zip)

GitHubの「Code → Download ZIP」からダウンロードできます。

## 使い方

1. ZIPを展開し、`Game-Portal-offline-html-main` 内の `GAME-PORTAL.html` をPC版Chromeで開きます。
2. ホームの「保存先フォルダーを選ぶ」から作成したゲームの出力保存先フォルダーを選びます。
3. ゲームを追加・変更するときは「編集モード」をオンにします。

詳細な操作手順はHTML内の「ヘルプ」で確認できます。
WindowsのEXEゲームは同じフォルダーの `GAME-PORTAL-WINDOWS.exe` を開きます。[詳しい手順](docs/WINDOWS_EXE.md)

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
