# 使い方・資料

基本操作は `GAME-PORTAL.html` 内の「ヘルプ」で確認できます。
[ダウンロード・起動手順](../README.md)へ戻る。

## 目的から探す

| 知りたいこと | 案内 |
| --- | --- |
| WindowsでHTMLを開かずに使う | [デスクトップ試作版](DESKTOP.md) |
| ゲームの追加・編集・プレイ、保存と同期 | [詳しい使い方](OFFLINE_HTML.md) |
| 別のPC・他の人へ渡す | [受け渡し手順](TRANSFER_GUIDE.md) |
| Windows・Macでフォルダー選択を省略する | [自動接続（ベータ版）](AUTO_CONNECT.md) |
| WindowsのEXEゲームを起動する | [EXE起動補助（ベータ版）](WINDOWS_EXE.md) |
| NASで運用する前に確認する | [NAS検証手順](NAS_VALIDATION.md) |
| 更新内容を確認する | [変更履歴](../CHANGELOG.md) |

## ZIPの中で使うファイル

ZIPを展開した `Game-Portal-offline-html-main` の一番上にあります。

| ファイル | 使う場面 |
| --- | --- |
| **`GAME-PORTAL.exe`** | Windowsデスクトップ本体の試作版。HTMLは内蔵しています。 |
| **`GAME-PORTAL.html`** | 通常の起動。まずこのHTMLをChromeで開きます。 |
| `GAME-PORTAL-WINDOWS.exe` | Windowsの自動接続・EXEゲーム用の起動補助。ベータ版。 |
| `GAME-PORTAL-MAC.command` ＋ `GAME-PORTAL-MAC` | Macの自動接続用の起動補助。2つを同じ場所に置きます。ベータ版。 |
| `GAME-PORTAL-FOLDER.example.txt` | 自動接続の設定例。[準備方法](AUTO_CONNECT.md)を参照してください。 |
| `README-WINDOWS.txt` | Windows起動補助の説明。 |
| `THIRD-PARTY-LICENSES.txt` | 同梱ソフトのライセンス。 |

ゲームと作品情報は、自分で選んだ保存先フォルダーで管理します。配布ZIPにゲームや個人のセーブは含みません。

## 開発する人へ

ソースの配置・ビルド・検証・配布物の更新は、[開発手順](DEVELOPMENT.md)を参照してください。
