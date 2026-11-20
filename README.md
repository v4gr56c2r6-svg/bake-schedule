# 絶叫焼き・焼成スケジュール v1.1

## 実装内容
- Firebase Authentication（メール/パスワード）
- 初回アカウント登録・ログイン・ログアウト
- Firestoreに本人UID付きで保存
- Firestoreクエリはログイン中のUIDで絞り込み
- 週間予定、商品別入力、4個/8個セット換算、合計、自動計算、編集/削除、完了チェック

## Firebase Consoleで行うこと
1. Authentication → 始める → Sign-in method → メール/パスワードを有効化
2. Firestore Database → データベースを作成（本番モード）
3. ロケーションは `asia-northeast1`（東京）を推奨
4. Firestore Database → ルールに同梱の `firestore.rules` を貼り付けて公開

## Webアプリ設定
Firebase設定は `firebase-config.js` に入力済みです。
このファイルはブラウザから見える公開設定です。秘密鍵は含めないでください。

## GitHub Pages
1. ZIPを解凍
2. 中のファイルを新規GitHubリポジトリのルートにアップロード
3. Settings → Pages → Deploy from a branch → main / root
4. 公開されたURLを開く
5. 初回はメールアドレスと6文字以上のパスワードで新規登録

## セキュリティ
FirestoreルールはログインUIDと各ドキュメントの `ownerUid` を照合します。
初回アカウントを作った後、Firebase Authenticationのユーザー一覧に自分のアカウントがあることを確認してください。
Google Cloud/FirebaseのAPIキー制限は必要に応じて設定できますが、Firebase Authentication/Firestoreへのアクセス制御は必ずSecurity Rulesで行います。
