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

Windowsデスクトップ本体の試作版は[デスクトップ版の開発手順](DESKTOP.md#開発する人へ)を参照してください。HTML版とは別に `node scripts/build-desktop.mjs --prepare` で生成します。画面やデスクトップ用ソースを変えた場合はEXEを再ビルドし、`node scripts/verify-desktop.mjs` と `npm run test:desktop` で確認します。

Mac補助はmacOS上で、Xcodeのコマンドラインツールを使ってビルドします。

```sh
npm run build:macos
npm run test:native-folder
```

Intel・Appleシリコン共通のバイナリーを生成し、macOS 12以降を対象にします。Windowsでフォルダー自動接続を検証するときも `npm run test:native-folder` を実行してください。

Intel Mac用 `.app` はIntel Mac上で `node scripts/build-mojave.mjs` を実行して生成します。`node scripts/verify-mojave.mjs` でIntel・macOS 10.14の最低条件、内蔵HTML・ライセンス・ソースのハッシュを照合します。macOS上のCIではアプリの署名検査、実Firefox ESR 115と公式Chrome for Testing 116でのゲーム起動・セーブ保持・再読み込み・接続復旧も検証します。テスト用ブラウザーの取得は `node scripts/prepare-mojave-test.mjs`、Firefox ESR検証は `node tests/mojave-esr-browser.mjs`、フォルダー接続検証は `node tests/native-folder-browser.mjs` です。Chrome for Testingは公式の署名なしテスト用ビルドを固定ハッシュで照合し、配布物には含めません。

## 公開するファイル

| 場所 | 内容 |
| --- | --- |
| 最上位の `GAME-PORTAL.html` | Code ZIPからそのまま開く配布HTML |
| 最上位の `GAME-PORTAL.exe` / `DESKTOP-LICENSES.txt` | Windowsデスクトップ本体の試作版とライセンス |
| 最上位の `GAME-PORTAL-WINDOWS.exe` / `README-WINDOWS.txt` | Windows起動補助と案内 |
| 最上位の `GAME-PORTAL-MAC` / `GAME-PORTAL-MAC.command` | Mac起動補助と起動用スクリプト |
| 最上位の `GAME-PORTAL-MOJAVE.app` | Intel Mac用アプリ。実行ファイル・HTML・ライセンス・ビルド情報・署名を含むbundle全体を公開します。 |
| 最上位の `GAME-PORTAL-MOJAVE` / `GAME-PORTAL-MOJAVE.command` | Intel Mac用の開発・確認用起動方法 |
| 最上位の `GAME-PORTAL-FOLDER.example.txt` | 自動接続の設定例。個人の設定ファイルはGitへ含めません。 |
| 最上位の `THIRD-PARTY-LICENSES.txt` | 同梱ランタイムのライセンス |
| `offline-html/` / `assets/` | HTML・画面・実行処理のソース |
| `scripts/` / `tests/` / `.github/` | ビルド・検証・CI |
| `docs/` | 利用・運用・開発の資料 |

ビルドは配布物を最上位と `offline-release/` に生成します。生成物を直接編集せず、ソースを変更して再ビルドしてください。最上位の配布物はGitへ含めます。`offline-release/` と `source-release/` はローカル出力です。

アプリの版を変える場合は `package.json`・`package-lock.json`・`offline-html/compatibility.js`・README・利用案内の表記をそろえ、HTML・Windows補助・Mac補助を同じ版で作り直してください。

```sh
node scripts/verify-distribution.mjs
npm run source:package
```

`verify-distribution` は最上位HTMLとビルド出力の一致、ライセンス、Windows・Mac補助の版とMacの対応アーキテクチャー・OS条件を確認します。ソースZIPは `source-release/GAME-PORTAL-SOURCE.zip` へ出力し、ファイルごとのハッシュを記録します。

公開後は実際のCode ZIPをダウンロードし、展開した最上位HTMLの起動とバージョンを確認してください。GitHub Actionsは開発時の自動検証用です。利用者のダウンロード操作には使いません。

ゲーム本体・個人セーブ・認証情報・ローカル作業資料はGitや配布ZIPへ含めないでください。

[資料一覧へ戻る](README.md)

## 2つの版の配布

HTMLビルドは `GAME-PORTAL.html`（クリエイター）と `GAME-PORTAL-PLAY.html`（プレイ専用）を生成します。Windowsビルドも同じ2版を生成し、Macビルドは各OS向けに2つの署名済みアプリを作成します。`node scripts/verify-distribution.mjs` で全版の役割・内蔵HTML・バージョンを確認します。プレイ専用版の制限はUIと保存処理の両方で維持し、対応セーブの同期だけ許可します。新しいUIを追加したときはプレイ専用版への露出を確認してください。

追加検証：`node tests/offline-html/editions-browser.mjs`、Windows上では `node tests/desktop-player.mjs`。両方とも3回のプレイ・保存・再起動を確認し、後者はアプリへの直接変更要求も拒否されることを確認します。Mac実機の操作・実NAS・別PCの実権限は自動テストでは代替できません。
