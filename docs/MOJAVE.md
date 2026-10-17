# macOS Mojave用アプリ（プレイ専用・試作版）

macOS Mojave **10.14.6／Intel Mac** 向けです。MacBook Air（11インチ・Early 2015）を想定しています。**`GAME-PORTAL-MOJAVE.app`** を開くと、インストール済みのGoogle ChromeまたはFirefox ESR 115にゲーム一覧を表示します。画面用HTMLはアプリに内蔵しています。

## はじめる

1. このMacで動く **Google Chrome**、または[Mozillaの案内](https://support.mozilla.org/ja/kb/firefox-users-macos-1012-1013-1014-moving-to-extended-support)にある **Firefox ESR 115** を用意します。
2. GitHubの **Code → Download ZIP** を展開し、フォルダーごとNASへ置きます。FinderからそのNASを開ける状態にします。
3. **`GAME-PORTAL-MOJAVE.app`** を開きます。ターミナルを開いておく必要はありません。

共有接続の設定があれば、自動で同じ保存先を開きます。設定がなければ、初回にゲームの保存先を選びます。選んだ保存先はこのMacに記憶します。ブラウザー本体は別途必要です。

Mojave向けChromeは[116が最終対応版](https://groups.google.com/a/chromium.org/g/chromium-dev/c/z-d1QfKuoBU/m/SBO-8xqMCwAJ)です。現在のChromeはインストールできません。継続更新されているブラウザーを使いたい場合は、Firefox ESR 115を選んでください。

## アプリの操作

画面上部のメニューバーにある **「GAME PORTAL」** から操作します。

- **ゲーム一覧を開く**：前回選んだブラウザーで一覧を表示します。アプリをもう一度開いても表示できます。
- **Google Chromeで開く／Firefoxで開く**：使うブラウザーを選びます。次回も選んだブラウザーを使います。初回はFirefox、見つからなければChromeを使います。
- **次回の保存先を選ぶ**：このMacの保存先を変更します。遊んでいるゲームには影響せず、アプリを終了して開き直すと反映します。
- **終了**：接続用アプリを終了します。Firefoxのウィンドウは必要に応じて別途閉じてください。

この試作版はAppleの公証を受けていません。macOSに起動を止められた場合は、配布元を確認したうえでFinderでアプリを右クリックし、**「開く」** を選びます。組織の管理設定で禁止されている場合は管理者へ確認してください。

## Windowsと同じ保存先にする

同じNAS共有内に、アプリ一式とゲームの保管フォルダーを置いてください。Windowsデスクトップ版 **0.1.0-beta.3以降** で一度保存先を選ぶと、EXEの隣に `GAME-PORTAL-CONNECTION.json` が作られます。Mac用 `.app` も同じ場所に置くと、この設定から保存先を読み取ります。WindowsとMacでNASの表示パスが違っても、フォルダー同士の位置関係が同じなら使えます。

このMacで個別に記憶した保存先がある場合は、そちらを優先します。共有設定が既にある状態でWindows側の保存先を変更しても、共有設定は自動で上書きしません。

設定ファイルには相対パスと保存先IDを記録します。パスワードやアクセス権は含みません。各PCでNASへの接続・認証が必要です。設定が壊れていたりIDが違ったりする場合は、自動で別のフォルダーを初期設定せず、接続を止めます。

ゲームの追加・編集・保存先の初期設定はWindowsデスクトップ版で行ってください。Mac側はゲームと作品情報を読み込みます。設定ファイルがない場合も、Windows版で初期設定済みの保管フォルダーを選びます。

## 対応範囲

- **プレイ専用**です。ゲームの追加・編集、共有フォルダーへのセーブ同期は利用できません。対応ゲームのセーブは、このMacの選んだブラウザー内へ保存します。ChromeとFirefoxのセーブは別々です。
- HTML・WebゲームのZIP・展開済みのゲームを対象にしています。WindowsのEXEは動きません。
- 4GBのMacでは、軽い2Dゲームから試してください。ゲームごとのWebGL・メモリ要件があるため、すべてのGodot作品やPyxel作品の動作は保証できません。
- macOS 10.14を対象にビルドしています。新しいmacOS上で、署名・内蔵ファイル・Firefox ESR 115での一覧表示、HTML／ZIPの起動、セーブ保持、再読み込みを検証しています。**Mojave実機での動作とメニューバーのクリック操作は未検証**です。

このMac向けの試作版は、通常の `GAME-PORTAL-MAC.command`（macOS 12以降）とは別です。

`GAME-PORTAL-MOJAVE.command` と拡張子なしの `GAME-PORTAL-MOJAVE` は、開発・確認用の別の起動方法です。通常は `.app` を使ってください。

[READMEへ戻る](../README.md)
