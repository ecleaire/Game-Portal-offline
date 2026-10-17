# GAME PORTAL

バージョン：**0.21.1**

フォルダーにまとめたゲームを、オフラインで遊べるランチャーです。
**遊ぶ人はプレイ専用版、ゲームを準備する人はクリエイター版**を使います。

## ダウンロードして使う

**[ZIPをダウンロード](https://github.com/ecleaire/Game-Portal-offline-html/archive/refs/heads/main.zip)**

GitHubの **Code → Download ZIP** でもダウンロードできます。ZIPを展開し、一番上のフォルダーから次のファイルを開きます。Actionsの操作やビルドは不要です。

| 使うPC | プレイ専用 | クリエイター（プレイも可能） |
| --- | --- | --- |
| Windows 10 / 11（64bit） | **`GAME-PORTAL-PLAY.exe`** | **`GAME-PORTAL.exe`** |
| Windows・MacのGoogle Chrome | **`GAME-PORTAL-PLAY.html`** | **`GAME-PORTAL.html`** |
| Mac（macOS 12以降） | `GAME-PORTAL-PLAY-MAC.app` | `GAME-PORTAL-MAC.app` |
| Intel Mac（Mojave 10.14.6以降） | `GAME-PORTAL-PLAY-MOJAVE.app` | `GAME-PORTAL-MOJAVE.app` |

EXE・Macアプリはベータ版です。Macアプリは別途Google Chromeを使い、画面上部の「GAME PORTAL」メニューから終了できます。Mojave用は実機で未検証です。[Macの注意点](docs/MOJAVE.md)

1. 使うファイルを開きます。
2. **保存先フォルダーを選ぶ**か、設定の枠へフォルダーをドラッグします。
3. ゲームのカードを押して遊びます。検索やタグで絞り込めます。

ゲームは配布ZIPに含まれていません。ゲームが入った保存先は、準備した人に確認してください。
**HTMLをブックマークしておくと、次回からすぐ開けます。** 移動した場合は登録し直してください。

## 2つの版の違い

**プレイ専用版**は、一覧・検索・プレイを中心にした画面です。表示設定と対応セーブの操作はできます。ゲームの追加・編集・削除・本体更新はできません。

**クリエイター版**は、これまでの全機能を使えます。設定の「編集モード」をオンにすると、ゲームの追加や情報の編集、本体更新ができます。JPG・PNGのサムネイル、説明、操作方法も設定できます。

HTML・WebゲームのZIP・展開済みフォルダー・Pyxelに対応しています。GodotはWeb書き出し一式を使い、Scratch（sb3）はHTMLへ変換します。手順は画面内の**ヘルプ**で確認できます。

Macの自動接続は読み取り用です。クリエイター版で追加・編集する際は、Chromeの画面で保存先を選ぶかドラッグし、書き込みを許可します。Firefox ESR 115はMojaveのプレイ用の予備手段で、ドラッグ接続・編集にはChromeを使ってください。

## 次回の起動・共有

同じPCで許可が残っていれば、前回の保存先へ自動接続します。別PCの初回や許可が切れた場合は、そのPCで許可・選び直しが必要です。

接続に失敗しても操作は続けられます。**接続待ちを中止**して、設定から保存先を選び直してください。自動再試行は失敗が続くと停止し、書き込みは自動で繰り返しません。

同じNASなどの共有フォルダーを使うと、ゲームと作品情報を共有できます。ホームで3分操作がないと変更を確認し、対応するセーブも同期します。EXE・Pyxel独自のセーブなどは対象外です。

[詳しい使い方](docs/README.md) · [Windowsアプリ](docs/DESKTOP.md) · [起動補助](docs/AUTO_CONNECT.md) · [変更履歴](CHANGELOG.md)
