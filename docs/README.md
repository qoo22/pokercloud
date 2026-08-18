# サーバー不要のソロ版（GitHub Pages 用）

`index.html` は CPU 対戦のソロ版ポーカー。完全に自己完結しており、サーバー無しでブラウザだけで動く。

## 公開手順（一度だけ）
GitHub のリポジトリ設定 → Pages → Source を「Deploy from a branch」、
Branch を `main` / フォルダを `/docs` にして保存。
数分後に `https://<ユーザー名>.github.io/<リポジトリ名>/` で遊べる。

- 残高・戦績はブラウザの localStorage に保存（端末ごと）
- マルチプレイ版（Render の poker-friends）とは独立。こちらはスリープも帯域消費も無い
- 更新するときは outputs/poker-solo.html をここへコピーし直す
