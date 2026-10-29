# 開発・配布の手順

使うだけの場合は、[Code → Download ZIP](https://github.com/ecleaire/Game-Portal-offline/archive/refs/tags/v0.24.20.zip)を展開し、`HTML/プレイ用/GAME-PORTAL-PLAY.html` を開きます。配布ZIPから開発コード・テスト・Git用設定を除外しています。開発するときは `git clone https://github.com/ecleaire/Game-Portal-offline.git` で取得してください。以下はソースを変更する人向けの手順です。

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

Windowsアプリ（ベータ版）の開発は[デスクトップ版の開発手順](DESKTOP.md#開発する人へ)を参照してください。HTML版とは別に `node scripts/build-desktop.mjs --prepare` で生成します。画面やデスクトップ用ソースを変えた場合はEXEを再ビルドし、`node scripts/verify-desktop.mjs` と `npm run test:desktop` で確認します。

MacアプリとHTML用の起動補助はmacOS上で、XcodeのコマンドラインツールとCMakeを使ってビルドします。初回だけ、固定SHA256で照合した公式CEF SDKを取得します。アプリの利用時にダウンロードは行いません。

```sh
npm run build:macos
node tests/mac-desktop.mjs
npm run test:native-folder
```

Intel・Appleシリコン共通のバイナリーを生成します。最低対応OSはIntelがmacOS 10.14.6、AppleシリコンがmacOS 11です。ビルド先とアプリ情報はscripts/mac-system.mjsでそろえ、Mach-OとInfo.plistの両方を検査します。Windowsでフォルダー自動接続を検証するときも `npm run test:native-folder` を実行してください。

Intel Mac用 `.app` はIntel Mac上で `node scripts/build-mojave.mjs` を実行して生成します。`node scripts/verify-mojave.mjs` でIntel・macOS 10.14の最低条件、内蔵HTML・ライセンス・ソースのハッシュを照合します。macOS上のCIではアプリの署名検査、実Firefox ESR 115と公式Chrome for Testing 116でのゲーム起動・セーブ保持・再読み込み・接続復旧も検証します。テスト用ブラウザーの取得は `node scripts/prepare-mojave-test.mjs`、Firefox ESR検証は `node tests/mojave-esr-browser.mjs`、フォルダー接続検証は `node tests/native-folder-browser.mjs` です。Chrome for Testingは公式の署名なしテスト用ビルドを固定ハッシュで照合し、配布物には含めません。

## 公開するファイル

| 場所 | 内容 |
| --- | --- |
| `HTML/プレイ用`・`HTML/クリエイター用` | そのまま開くHTMLと起動補助 |
| `Windows/プレイ用`・`Windows/クリエイター用` | Windowsアプリとライセンス |
| `Mac/プレイ用`・`Mac/クリエイター用` | Macアプリのbundle全体（実行ファイル・HTML・ライセンス・署名） |
| 各用途の `_内部ファイル/`・Macアプリ内 | 必要なランタイム・ライセンス・署名 |
| `offline-html/` / `assets/` | HTML・画面・実行処理のソース |
| `scripts/` / `tests/` / `.github/` | ビルド・検証・CI |
| `docs/` | 利用・運用・開発の資料 |

ビルドは配布物を最上位と `offline-release/` に生成します。生成物を直接編集せず、ソースを変更して再ビルドしてください。環境・用途別フォルダーの配布物をGitへ含めます。最上位の作業用ファイルは追跡しません。`offline-release/` と `source-release/` はローカル出力です。

アプリの版を変える場合は `package.json`・`package-lock.json`・`offline-html/compatibility.js`・README・利用案内の表記をそろえ、HTML・Windows補助・Mac補助を同じ版で作り直してください。

```sh
node scripts/verify-distribution.mjs
npm run source:package
```

`verify-distribution` は最上位HTMLとビルド出力の一致、ライセンス、Windows・Mac補助の版とMacの対応アーキテクチャー・OS条件を確認します。ソースZIPは `source-release/GAME-PORTAL-SOURCE.zip` へ出力し、ファイルごとのハッシュを記録します。

公開後は実際のCode ZIPをダウンロードし、展開したHTMLフォルダー内の両方のHTMLの起動とバージョンを確認してください。GitHub Actionsは開発時の自動検証用です。利用者のダウンロード操作には使いません。

ゲーム本体・個人セーブ・認証情報・ローカル作業資料はGitや配布ZIPへ含めないでください。

[資料一覧へ戻る](README.md)

## プレイ専用版・クリエイター版の配布

HTMLビルドは `GAME-PORTAL.html`（クリエイター版）と `GAME-PORTAL-PLAY.html`（プレイ専用版）を生成します。Windowsビルドも用途ごとにEXEを生成し、Macビルドは各OS向けにプレイ専用・クリエイターの署名済みアプリを作成します。`node scripts/verify-distribution.mjs` で役割・内蔵HTML・バージョンを確認します。プレイ専用版はゲームの追加・変更をUIと保存処理の両方で制限し、セーブ共有に必要な保存だけを許可します。新しいUIを追加したときは、プレイ専用版に管理用の操作が表示されないか確認してください。

追加検証：`node tests/offline-html/editions-browser.mjs`、Windows上では `node tests/desktop-player.mjs`。どちらも3回のプレイ・保存・再起動を確認します。Windowsのテストでは、アプリへの直接の変更要求も拒否されることを確認します。Mac実機の操作・実NAS・別PCの実権限は自動テストでは代替できません。

配布ファイルは `Windows`・`Mac`・`HTML` の各用途フォルダーに追跡します。ビルドと既存の検証コマンドが使う最上位の生成ファイルは作業用で、Gitには含めません。`scripts/distribution.mjs` が展開・配置・一致検証を行います。配布フォルダーの目印は `_内部ファイル/GAME-PORTAL-DISTRIBUTION.json` です。旧配置の目印も読み取れます。`.gitattributes` の `export-ignore` により、Code ZIPには実行用・利用案内だけが残ります。`git archive --format=zip --output=.tools/distribution-check.zip HEAD` と `node scripts/verify-code-zip.mjs .tools/distribution-check.zip` で起動用ファイル・内部ファイルの配置とMac実行権限を確認してください。

## NASの実機検証

実作品と分けたテストフォルダーと2台のPCを使います。以下は運用前の検証項目で、実機での成功記録ではありません。

1. 共有先設定から未設定PCが自動接続でき、個別設定済みPCは切り替わらないこと。
2. 投稿・編集・本体更新が反映され、編集中・プレイ中の画面やIDを勝手に変更しないこと。
3. 同時保存で競合した操作を拒否し、既存の作品・設定・履歴を保持すること。
4. 読み取り中の切断で中止・別保存先への接続ができること。
5. 保存中や読み戻し中の切断で結果未確認を表示し、再接続後に照合できること。書き込みを自動再実行しないこと。
6. セーブ同期と競合選択、ゲーム本体更新・旧版復元、保管フォルダー全体の移行を確認すること。
7. 共有設定の保存中に別PCから変更を拒否し、強制終了後に再保存できること。旧版ロックは全旧版終了の確認後だけ解除し、未知の内容は残すこと。

OS・アプリ版・NAS／SMB設定・期待結果・実結果を記録します。CIの模擬障害・別プロセス検証は、実NAS・別PCの権限や排他動作を保証するものではありません。私的な接続情報・作品・セーブをGitや配布物へ含めません。
