# GAME PORTAL

ゲームをフォルダーにまとめて、追加・編集・プレイできる単体HTMLランチャーです。
オンライン版とは独立して動作します。

## 使い方

1. 配布ZIPを展開し、GAME-PORTAL.htmlをPC版Chromeで開きます。
2. ホームの「ゲームのフォルダーを選ぶ」から保存先を選びます。
3. ゲームを追加・変更するときは「編集モード」をオンにします。

操作手順はHTML内の「ヘルプ」で確認できます。
配布ZIPは[Actions](https://github.com/ecleaire/Game-Portal-offline-html/actions)の成功した実行からダウンロードできます。

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

[詳しい使い方](docs/OFFLINE_HTML.md) · [別PCへの受け渡し](docs/TRANSFER_GUIDE.md) · [変更履歴](CHANGELOG.md)
