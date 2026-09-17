# -*- coding: utf-8 -*-
# 第170弾: 押した瞬間に絵柄が消えない / ブランクの上下はジョーカー
import sys
p = sys.argv[1]
s = open(p, encoding='utf8').read()

def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)

# ① 押した瞬間に盤を空にしない。今出ている絵柄を残したまま回し始める
rep("""    if (spin) spin.onclick = function () {
      if (tnBusy || tnCanDouble) return;
      tnBetOpen = false;
      tnBusy = true; tnLast = null; renderTunnel();""",
"""    if (spin) spin.onclick = function () {
      if (tnBusy || tnCanDouble) return;
      tnBetOpen = false;
      tnBusy = true;
      // **盤は空にしない**(第170弾)。以前は tnLast を捨てていたので、
      // 押した瞬間に9マスが真っ黒になってから回り始めていた。
      // 実機は今そこに止まっている絵柄がそのまま動き出す。
      // 消すのは前回の当たり表示だけにして、絵柄は残す
      if (tnLast) {
        tnLast.hitCells = []; tnLast.hits = []; tnLast.cap = ""; tnLast.msg = "";
        tnLast.winner = false; tnLast.freeText = ""; tnLast.freeBadge = "";
        tnLast.heldCenter = false; tnLast.tunnel = 0; tnLast.win = 0; tnLast.paid = 0;
      }
      renderTunnel();""", '盤を消さない')

# ② 回転は「今の絵柄」から、ゆっくり動き出す
rep("""    var H = cells[0].clientHeight || 78;
    var POOL = ["cherry", "orange", "plum", "melon", "bell", "eight", "bar", "red7", "blue7", "joker", "blank"];
    var N = 14;
    var strips = cells.map(function (c, i) {
      // 実機のリールは**上から下へ**流れる(第168弾で向きを直した)。
      // 帯は上ほど後に現れるので、止める絵柄は**先頭**に置く。
      // 送り量を増やすと transform が 0 に近づき、先頭の絵柄が枠に収まる
      var syms = [finalGrid[i]];
      for (var k = 1; k < N; k++) syms.push(POOL[(i * 7 + k * 3 + 2) % POOL.length]);""",
"""    var H = cells[0].clientHeight || 78;
    var POOL = ["cherry", "orange", "plum", "melon", "bell", "eight", "bar", "red7", "blue7", "joker", "blank"];
    var N = 14;
    // いま盤に出ている絵柄。ここから動き出すので、押した瞬間に絵が飛ばない
    var nowGrid = (tnLast && tnLast.grid) ? tnLast.grid : null;
    var strips = cells.map(function (c, i) {
      // 実機のリールは**上から下へ**流れる(第168弾で向きを直した)。
      // 帯は上ほど後に現れるので、止める絵柄は**先頭**に置く。
      // 送り量を増やすと transform が 0 に近づき、先頭の絵柄が枠に収まる
      var syms = [finalGrid[i]];
      for (var k = 1; k < N; k++) syms.push(POOL[(i * 7 + k * 3 + 2) % POOL.length]);
      // 帯の末尾は最初に枠へ入る場所。ここを**今出ている絵柄**にしておくと、
      // 止まっていた絵がそのまま動き出したように見える(第170弾)
      if (nowGrid && nowGrid[i]) syms[N - 1] = nowGrid[i];
      // 中央のブランクは上下をジョーカーで挟む(第170弾)。
      // こうしておくと「さっき通り過ぎたジョーカーが戻ってくるかも」が
      // リールの並びとして成り立つ。戻り演出はサーバーが決めた時だけ出る
      if (i === 4 && finalGrid[i] === "blank") syms[1] = "joker";""", '今の絵柄から始動')

rep("""    tnLoopOn();
    var SPEED = H * 8 / 1000;             // 1秒あたり約8コマ
    var FIRST = 900, GAP = 85;            // 最初の停止まで/1つずつの間隔""",
"""    tnLoopOn();
    var SPEED = H * 8 / 1000;             // 1秒あたり約8コマ
    var FIRST = 1050, GAP = 85;           // 最初の停止まで/1つずつの間隔
    var SPIN_UP = 260;                    // 静止から最高速まで(ゆっくり動き出す)""", '始動時間')

rep("""        all = false;
        // 停止直前だけ短く減速する
        var left = stopAt - t;
        var k = left < 160 ? 0.35 + 0.65 * (left / 160) : 1;""",
"""        all = false;
        // 動き出しはゆっくり(第170弾)。止まっていた絵柄が引きずり出される感じを出す。
        // 最初の数フレームだけ極端に遅いので、何が乗っていたか目で追える
        var up = t < SPIN_UP ? Math.pow(t / SPIN_UP, 2) : 1;
        // 停止直前だけ短く減速する
        var left = stopAt - t;
        var k = left < 160 ? 0.35 + 0.65 * (left / 160) : 1;
        k *= up;""", '加速')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
