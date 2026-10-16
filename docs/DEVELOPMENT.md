# 開発・配布の手順

使うだけの場合は、[Code → Download ZIP](https://github.com/ecleaire/Game-Portal-offline-html/archive/refs/heads/main.zip)を展開し、最上位の `GAME-PORTAL.html` を開きます。以下はソースを変更する人向けの手順です。

## 準備・検証

Node.js 22以上を使用します。Windows / macOSの自動検証ではNode.js 24を使用しています。

```sh
npm ci
npm run prepare:runtime
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

`prepare:runtime` は初回のみ公式配布物を取得し、`offline-html/runtime-lock.json` のSHA-256と照合します。キャッシュは `.tools/offline-runtime`、変更先は `OFFLINE_RUNTIME_CACHE` で指定できます。Node.js 24で環境変数のプロキシを利用する場合は `NODE_USE_ENV_PROXY=1` を設定してください。通常の `build` は取得済みキャッシュを使い、ネット取得しません。

WindowsのEXEゲーム用補助はWindows上でビルド・検証します。

```sh
npm run build:windows
npm run test:native
```

Windows補助のビルドには.NET FrameworkのC#コンパイラーが必要です。

## 公開するファイル

| 場所 | 内容 |
| --- | --- |
| 最上位の `GAME-PORTAL.html` | Code ZIPからそのまま開く配布HTML |
| 最上位の `GAME-PORTAL-WINDOWS.exe` / `README-WINDOWS.txt` | Windows起動補助と案内 |
| 最上位の `THIRD-PARTY-LICENSES.txt` | 同梱ランタイムのライセンス |
| `offline-html/` / `assets/` | HTML・画面・実行処理のソース |
| `scripts/` / `tests/` / `.github/` | ビルド・検証・CI |
| `docs/` | 利用・運用・開発の資料 |

ビルドは配布物を最上位と `offline-release/` に生成します。生成物を直接編集せず、ソースを変更して再ビルドしてください。最上位の配布物はGitへ含めます。`offline-release/` と `source-release/` はローカル出力です。

アプリの版を変える場合は `package.json`・`package-lock.json`・`offline-html/compatibility.js`・README・利用案内の表記をそろえ、HTMLとWindows補助を同じ版で作り直してください。

```sh
node scripts/verify-distribution.mjs
npm run source:package
```

`verify-distribution` は最上位HTMLとビルド出力の一致、ライセンス、Windows補助の版を確認します。ソースZIPは `source-release/GAME-PORTAL-SOURCE.zip` へ出力し、ファイルごとのハッシュを記録します。

公開後は実際のCode ZIPをダウンロードし、展開した最上位HTMLの起動とバージョンを確認してください。GitHub Actionsは開発時の自動検証用です。利用者のダウンロード操作には使いません。

ゲーム本体・個人セーブ・認証情報・ローカル作業資料はGitや配布ZIPへ含めないでください。

[資料一覧へ戻る](README.md)
