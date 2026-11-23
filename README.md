# 絶叫焼き・焼成スケジュール v1.4

## 主な機能
- Firebase Authenticationでのアカウント登録、ログイン、ログアウト
- 週間予定の登録、編集、削除、焼成完了チェック
- 商品別数量と4個・8個・16個入りセットの合計換算
- 箱入り商品はカスタードとあんこを半分ずつにして集計
- 週間・日別のカスタード、あんこ製作数を表示
- 土曜日は青系、日曜日と日本の祝日・振替休日は赤系で表示
- 日本の祝日を年ごとに計算し、祝日に挟まれた休日も表示

## 既存のFirebase設定と保存データ
Firebase設定は `firebase-config.js` に含まれています。Firestoreのコレクション、日付ID、保存フィールド、`ownerUid` は変更していません。Firebase設定ファイルと `firestore.rules` の置き換えは不要です。

## GitHub Pagesで更新する
1. ZIPを解凍します。
2. 既存の `bake-schedule` リポジトリを開き、`app.js`、`index.html`、`style.css`、`README.md` を置き換えます。
3. GitHubで変更をコミットします。
4. Pagesの再公開後、アプリを再読み込みします。

## 新規に公開する場合
1. ZIPを解凍し、ファイル一式をGitHubリポジトリのルートにアップロードします。
2. Settings → Pages → Deploy from a branch → `main` / root を選びます。
3. 公開されたURLを開き、初回はメールアドレスと6文字以上のパスワードで登録します。

## Firebaseを初めて設定する場合
1. Authenticationでメール/パスワード認証を有効にします。
2. Firestore Databaseを作成します（ロケーションは `asia-northeast1` を推奨）。
3. 同梱の `firestore.rules` をFirebase Consoleのルールに設定します。
