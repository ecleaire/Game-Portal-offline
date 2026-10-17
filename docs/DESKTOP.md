# Windowsデスクトップ試作版

デスクトップ版：**0.1.0-beta.2** ／ 内蔵ランチャー：**0.20.20**

`GAME-PORTAL.exe` がアプリ本体です。HTMLを別に開かず、アプリ内の画面でゲームを追加・編集・プレイできます。保存先の選択・記憶・読み書きはWindowsアプリが行い、Chromeのフォルダーアクセス許可には依存しません。

## はじめる

1. GitHubの **Code → Download ZIP** でダウンロードし、展開します。
2. 一番上の **`GAME-PORTAL.exe`** を開きます。
3. 初回は **「保存先フォルダーを選ぶ」** でゲームの保管場所を選びます。

次回からは同じWindowsユーザーでEXEを開くと、前回の保存先へ接続します。ゲームを追加・変更するときは、設定の「編集モード」をオンにします。保存先を変える場合は、設定の「保存先を選ぶ」を使います。ホームの未接続画面や、設定内の枠へのフォルダーのドラッグでも接続できます。

`GAME-PORTAL-WINDOWS.exe` は従来のHTML用起動補助です。デスクトップ本体の **`GAME-PORTAL.exe`** と区別してください。

## NAS・パスから接続する

設定の **「保存先のパス」** に、エクスプローラーのアドレス欄からコピーしたパスを貼り付け、**「このパスに接続」** を押します。Enterキーでも接続できます。NASは `\\NAS名\共有名\ゲーム` のような共有フォルダーのパスを指定します。ネットワークドライブのパスも使用できます。

フォルダー選択画面のアドレス欄へパスを貼り付ける方法や、設定内の枠へフォルダーをドラッグする方法も使えます。NAS名だけでなく共有名まで指定し、先にエクスプローラーで開けることを確認してください。接続できないパスを指定した場合は、現在の保存先を保持します。

## 保存先とセーブ

- 既存のゲーム保管フォルダーを使えます。ゲームID・作品情報・更新履歴の形式はHTML版と共通です。初めての試用はコピーした保管フォルダーで確認してください。
- 保存先のパスと、このアプリ内のセーブはWindowsユーザーごとの `%LOCALAPPDATA%\GamePortalDesktop` に記憶します。EXEだけを別PCへ渡しても、このPCの設定・個人セーブは含まれません。
- Chrome内のセーブは自動移行しません。必要なセーブはHTML版から書き出し、このアプリで読み込んでください。共有フォルダーへ同期済みの対応セーブは、同じ保存先から同期できます。
- NASへの接続・認証、Windows側の読み取り・保存権限は必要です。保存先が見つからないときは接続を戻すか、設定から選び直します。

## 試作版の範囲

Windows 11 x64・Microsoft Edge WebView2 Runtimeがある環境で検証しています。WebView2 RuntimeがないPCでは、[Microsoftの配布案内](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution)を確認してください。アプリにHTML・ゲーム実行用ランタイム・WebView2の接続部品を内蔵していますが、WebView2 Runtime本体は内蔵していません。

アプリ単体での再起動・追加・編集・プレイ・セーブを検証しています。実NAS・物理的な別PC・HTML版との同時編集は未検証です。本番の保管フォルダーで試す前にバックアップを取り、HTML版との同時編集は避けてください。試作版のEXEにコード署名はありません。

Mac向けのデスクトップ本体は未提供です。Macでは従来のHTML版・起動補助を使ってください。

## 開発する人へ

Windowsと.NET FrameworkのC#コンパイラーを使用します。

```sh
node scripts/build-desktop.mjs --prepare
node scripts/verify-desktop.mjs
node tests/desktop-files.mjs
node tests/desktop-browser.mjs
```

初回のビルドだけMicrosoft公式NuGetから固定版SDKを取得し、`desktop/desktop.json` のSHA-256と照合します。生成したEXEはSDK DLLや隣のHTMLがなくても起動できます。ライセンスはアプリ内ヘルプと `DESKTOP-LICENSES.txt` に含みます。

[READMEへ戻る](../README.md)
