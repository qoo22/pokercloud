# -*- coding: utf-8 -*-
# 第181弾: フリーは倍率が決まってから / 1回ずつゆっくり回す / 音を GOLD RUSH に揃える
import sys
p = sys.argv[1]
s = open(p, encoding='utf8').read()

def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)

# ① 回転に「中央を固定」と「ゆっくり」を足す
rep("""  function tnSpinReels(finalGrid, done) {""",
"""  /**
   * @param opt.hold 回さずに据え置くマス(フリー中の中央ワイルドなど)
   * @param opt.slow 何倍ゆっくり回すか。フリー中は3倍遅くして1回ずつ見せる
   */
  function tnSpinReels(finalGrid, done, opt) {
    opt = opt || {};
    var HOLD = opt.hold || [];
    var SLOW = opt.slow || 1;""", '引数')

rep("""    var strips = cells.map(function (c, i) {""",
"""    var strips = cells.map(function (c, i) {
      // 据え置くマスは触らない。フリー中の中央ワイルドがここ。
      // 回してしまうと「固定されている」ことが伝わらない
      if (HOLD.indexOf(i) >= 0) return null;""", '据え置き')

rep("""      return { el: c.querySelector(".tn-strip"), n: syms.length, pos: 0, stopped: false };
    });""",
"""      return { el: c.querySelector(".tn-strip"), n: syms.length, pos: 0, stopped: false };
    });""", '位置確認(変更なし)')

rep("""      for (var i = 0; i < 9; i++) {
        var st = strips[i];
        if (st.stopped) continue;""",
"""      for (var i = 0; i < 9; i++) {
        var st = strips[i];
        if (!st || st.stopped) continue;""", '据え置きを飛ばす')

rep("""    var SPEED = H * 8 / 1000;             // 1秒あたり約8コマ
    var FIRST = 1050, GAP = 85;           // 最初の停止まで/1つずつの間隔
    var SPIN_UP = 260;                    // 静止から最高速まで(ゆっくり動き出す)""",
"""    var SPEED = H * 8 / 1000 / SLOW;      // 1秒あたり約8コマ(ゆっくり指定で割る)
    var FIRST = 1050 * SLOW, GAP = 85 * SLOW;   // 最初の停止まで/1つずつの間隔
    var SPIN_UP = 260 * SLOW;             // 静止から最高速まで(ゆっくり動き出す)""", '速度')

rep("""      if (!all || t < FIRST + 8 * GAP) { requestAnimationFrame(loop); return; }""",
"""      if (!all || t < FIRST + 8 * GAP) { requestAnimationFrame(loop); return; }""", '位置確認2(変更なし)')

# ② フリーは1回ずつ回して見せる。中央は固定したまま
rep("""  function tnPlayFree(o, r) {
    var i = 0;
    tnBusy = true; renderTunnel();
    var step = function () {
      if (i >= o.free.length) {""",
"""  /**
   * フリーゲームの再生(第181弾で1回ずつ回すようにした)。
   *
   * 以前は盤面を700msごとに差し替えるだけで、5回ぶんが一瞬で流れていた。
   * 実機は**中央のワイルドを固定したまま、他の8マスだけを回して**
   * 1回ずつ抽選を見せる。回転は通常の3倍ゆっくりにして、
   * 1回1回の結果を追えるようにする
   */
  function tnPlayFree(o, r) {
    var i = 0;
    tnBusy = true; renderTunnel();
    try { sfx("letsgo"); } catch (e) {}     // 開始音は GOLD RUSH と同じ
    var step = function () {
      if (i >= o.free.length) {""", 'フリーの入口')

rep("""      renderTunnel();
      i++;
      setTimeout(step, 700);
    };
    setTimeout(step, 700);""",
"""      // まず前の盤面のまま「中央だけ残して回す」。止まってから結果を出す
      var showing = tnLast;
      tnLast = {
        grid: showing && showing.grid ? showing.grid.slice() : f.grid.slice(),
        hitCells: [], heldCenter: true, tunnel: o.tunnel, hits: [],
        cap: "TUNNEL " + o.tunnel + "x  FREE GAME " + (i + 1) + " / " + o.free.length,
        freeBadge: "FREE GAME " + (i + 1) + " / " + o.free.length,
        winner: false, win: showing ? showing.win : 0, paid: showing ? showing.paid : 0, msg: ""
      };
      tnLast.grid[4] = "joker";       // 中央は固定
      renderTunnel();
      var landed = result;            // 上で組み立てた「止まったあとの表示」
      tnSpinReels(f.grid, function () {
        tnLast = landed;
        renderTunnel();
        if (f.payX > 0) { try { tnSfxWin(f.payX, false); } catch (e) {} }
        i++;
        setTimeout(step, 900);
      }, { hold: [4], slow: 3 });     // 中央は据え置き / 3倍ゆっくり
    };
    setTimeout(step, 700);""", '1回ずつ回す')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
