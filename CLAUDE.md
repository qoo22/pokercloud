# ポーカー / スロット

テキサスホールデム + GTOボット + スロット2台(GOLD RUSH / WINNING TUNNEL) + バカラ。
本番は Render(poker-friends-x9o6.onrender.com)。

このリポジトリはソースと配布物の両方を持つ。**ルートがそのままエンジン**。

| 場所 | 中身 |
|---|---|
| `src/` `test/` | サーバーのTypeScript。テスト約550件 |
| `scripts/` | ビルド・E2E・運用スクリプト |
| `public/poker-client.html` | **本体のクライアント(10MB・手編集)** |
| `docs/` | GitHub Pages 用のコピー |
| `dist/` | ビルド済み。**Render はこれを直接動かす** |
| `patches/` | クライアントを編集してきたパッチ群 |

## 絶対に守ること

### 1. `npm run client` / `e2e` / `server` / `demo` / `solo` / `verify` を実行しない

`public/poker-client.html` は**手編集で育てた10MB**(AI生成画像100枚・音声・フォントを
base64で埋め込み済み)。これらのコマンドは内部で `scripts/build-client.mjs` を呼び、
クライアントを**作り直す**。走らせると埋め込み資産が全部消える。実際に一度消した事故がある。
(スクリプト側にもガードがあり `FORCE_REGEN=1` なしでは上書きを拒否する)

E2Eを走らせたいときは、生成を挟まず直接呼ぶ:

```bash
node scripts/smoke-client.mjs
```

### 2. 本番データと秘密をコミットしない

`poker.db` / `poker.secret` / `node_modules` は .gitignore 済み。
`git add -A` の前に必ず `git status` を見る。

### 3. クライアントの編集はパッチスクリプトで

10MBのファイルを編集ツールで直接触らない。`patches/` と同じ形のPythonを書く:

```python
def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))   # 1か所でなければ止める
    s = s.replace(old, new); print('OK', name)
# ...全部の rep が通ってから最後に1回だけ書き込む(途中で失敗しても壊れない)
open(p, 'w', encoding='utf8').write(s)
```

アンカーが合わないときは推測せず、必ず実ファイルを grep してから直す。

### 4. `src/` を直しただけでは本番は変わらない

Render は**コミット済みの `dist/` を直接動かす**。`npx tsc` してから
`dist/` もコミットすること。

## 検証(この順で全部通す)

```bash
node verify_rich_client.mjs        # 埋め込み資産が消えていないか(数秒)
npx tsc && node --test dist/test/*.test.js   # 単体 約550件(2〜10分)
node scripts/smoke-client.mjs      # E2E 約110項目(10分前後)
```

`node --test` と E2E は時間がかかる。ハングではないので待つ。

## データ保全(2026-09に100京を失った経緯あり)

本番は Render の**無料インスタンス**でディスクを付けられないため、
GitHubバックアップ(`src/server/ghsync.ts` → `qoo22/poker-backup` の
`backup/poker.db`)が唯一の永続化。**トークンが切れると黙って全部消える**。

- `POKER_GH_TOKEN` は必ず **No expiration** で作る
- デプロイ後は `node scripts/check-live.mjs <POKER_SECRET>` で
  起動回数が増えることを確認する
- 復元が失敗している状態ではプッシュを止める掛け金が入っている(第167弾)

## オーナーの確定方針(勝手に変えない)

- スロットの **RTP > 100% は許容**。歯止めは1日の回転数上限。再調整しない
- **GMコードは1ユーザー1回**。増やすならコードの種類を足す
- ポーカーの上限バイインは50京。秘密卓は条件を満たすまで存在自体を隠す
- push はオーナーが行う。オフライン版は `qoo22/pokeroff` にも配る
