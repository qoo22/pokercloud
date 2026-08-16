# クラウドに常設する手順（Render・無料）

このフォルダをそのままクラウド（Render）に上げると、24時間つながる固定 URL でポーカーを遊べます。
あなたの Mac は不要になります。クレジットカードも不要です。

## 事前に知っておくこと（無料プランの割り切り）
- 一定時間（約15分）誰もアクセスしないと自動で休止します。次に開いたとき、起動に **数十秒〜1分** かかります（その後は普通に遊べます）。
- チップ残高などのデータは、休止・再起動でリセットされることがあります（カジュアルに遊ぶ分には問題なし）。

## 手順

### 1. GitHub にこのフォルダを置く（無料アカウント）
1. https://github.com/signup で無料アカウントを作る。
2. https://github.com/new で新しいリポジトリを作る（名前は poker など、Public のまま、他は空でOK、Create）。
3. 次の画面の「uploading an existing file」リンクを開く。
4. このフォルダ（poker-cloud）の**中身**をまとめてドラッグ＆ドロップ（dist / public / package.json / package-lock.json / render.yaml / .gitignore）。
5. 「Commit changes」を押す。

### 2. Render で公開する（無料アカウント）
1. https://dashboard.render.com/register で無料アカウントを作る（「Sign up with GitHub」が簡単）。
2. ダッシュボードで「New +」→「Blueprint」を選ぶ。
3. さっき作った GitHub リポジトリを選ぶ（render.yaml が自動で読まれる）。
4. 「Apply」を押す。数分でビルド＆起動します。
5. 出来上がると `https://poker-friends-xxxx.onrender.com` のような **固定 URL** がもらえます。

### 3. 遊ぶ
- あなたも友人も `https://poker-friends-xxxx.onrender.com/poker-client.html` を開くだけ。
- 同じ卓に着席すれば対戦開始。URL は変わらないので、次からはこの URL を共有するだけでOK。

## 仕組み（参考）
- `render.yaml` … Render がこの内容で自動構築（Node、`public` を配信フォルダに指定、Node 22）。
- `dist/` … ビルド済みサーバー（`node dist/src/server/main.js` で起動）。
- `public/` … ブラウザで開くクライアント（poker-client.html）。

## 残高を消さない運用（バックアップ＆復元）

ゲームを更新（再デプロイ）すると無料プランでは残高DBが消えますが、次の手順で引き継げます。
`<鍵>` は Render のダッシュボード → あなたのサービス → Environment → `POKER_SECRET` の値です。

1. **更新の直前にバックアップ**: ブラウザで
   `https://あなたのURL.onrender.com/admin/backup?key=<鍵>`
   を開く → `poker.db` がダウンロードされる。
2. GitHub にファイルをアップし直して再デプロイ（いつも通り）。
3. **復元**: ターミナルで
   `curl -X POST --data-binary @poker.db "https://あなたのURL.onrender.com/admin/restore?key=<鍵>"`
   → サーバーが自動で再起動し、残高が戻る。

※ 鍵が一致しないと 403 で拒否されます。鍵は人に教えないでください。
※ 面倒になったら: 有料のStarterプラン+永続ディスク(合計 月$7前後)にして、環境変数
   `POKER_DB=/var/data/poker.db` を設定すれば、この作業自体が不要になります。

## 全自動バックアップ（GitHub連携・無料）— 残高が実質消えなくなります

設定すると、サーバーが5分ごと＆停止時に残高DBをあなたのプライベートリポジトリへ自動保存し、
起動時に自動復元します。手動のbackup/restoreは不要になります。

### 設定手順（1回だけ・約3分）

1. **保存先リポジトリを作る**: https://github.com/new で `poker-backup` を **Private** で作成
   （READMEの追加にチェックを入れて作ると確実です）
2. **トークンを作る**: https://github.com/settings/personal-access-tokens/new
   - Token name: `poker-backup` / Expiration: 1年など
   - Repository access: 「Only select repositories」→ `poker-backup` を選択
   - Permissions → Repository permissions → **Contents: Read and write**
   - Generate token → 表示された `github_pat_...` をコピー
3. **Renderに環境変数を追加**: ダッシュボード → サービス → Environment
   ```
   POKER_GH_TOKEN = github_pat_...（さっきのトークン）
   POKER_GH_REPO  = あなたのユーザー名/poker-backup
   ```
   保存すると自動で再起動します。

### 確認

ブラウザで `https://あなたのURL.onrender.com/admin/ghpush?key=<POKER_SECRET>` を開き、
「pushed (xxKB)」と出れば成功。GitHubの poker-backup リポジトリに backup/poker.db ができています。

### 仕組みと注意
- 5分ごと＋サーバー停止時(再デプロイ時)に保存 → 最悪でも失うのは直近5分ぶんだけ
- botの使い捨てデータは自動掃除されるのでDBは小さいまま（リポジトリも太りません）
- トークンは秘密です。render.yaml やコードには絶対に書かないでください
