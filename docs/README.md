# サーバー不要版（GitHub Pages 用）

Render がスリープ中・停止中でも遊べる受け皿。どちらもサーバー不要で、ブラウザだけで完結する。

| ファイル | 中身 |
|---|---|
| `index.html` | **オフライン版**（約4.6MB）。あり版のサーバーロジックをブラウザ内で動かすので、リッチ画面・GTOボット群・キャッシュ卓・トーナメント・経済（デイリー/ミッション/パス/スロット/ショップ）まで入っている。対人対戦だけ不可。 |
| `solo.html` | 軽量ソロ版（約190KB）。CPU 対戦のみ。すぐ開きたいとき用。 |

## 公開手順（一度だけ）
リポジトリの Settings → Pages → Source を「Deploy from a branch」、
Branch `main` / フォルダ `/docs` にして保存。数分で
`https://<ユーザー名>.github.io/<リポジトリ名>/` から遊べる。

## 仕組み（オフライン版）
`poker-client.html`（リッチ版）の head に、ブラウザ内サーバーのバンドルを 1 本差し込んだだけ。
そのバンドルがグローバルの `WebSocket` をループバック実装へ差し替えるので、
クライアントも bots.ts も「サーバーがある」つもりのまま 1 行も変えずに動く。
→ **あり版を改良すると、作り直すだけでオフライン版にも反映される**（二重管理にならない）。

## 注意
- セーブは端末の localStorage（キー `poker.offline.save.v1`）。JSON 1 塊なので引き継ぎに使える。
  `window.__offlineSave.export() / .import(json) / .reset()` で取り出し・書き戻し可。
- サーバーが権威ではないので、その気になれば残高を書き換えられる。オフライン専用なので実害は無いが、
  ここでランキング等の競争要素は作らないこと。
- 作り直しは `cd poker-engine && node scripts/build-offline.mjs`、検証は `node scripts/smoke-offline.mjs`。
