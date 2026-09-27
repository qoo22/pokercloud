# -*- coding: utf-8 -*-
# 第184弾: 止まってから当選額が出るまでの「ため」
import sys
p = sys.argv[1]
s = open(p, encoding='utf8').read()

def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)

# ① 見た目。ためている間は盤の周りをわずかに沈ませる
rep("""  .tn-cell.hit{z-index:3;animation:tnHitBlink .34s steps(1) infinite}""",
"""  /* 「ため」(第184弾)。止まってから当選額が出るまでのわずかな間。
     周りを沈ませて、盤だけが残る。派手にしない——大きく光らせると
     その時点で当たりが確定してしまい、察する楽しみが消える */
  .tn-hold .tn-tunnel,.tn-hold .tn-info,.tn-hold .tn-pay,
  .tn-hold .tn-cap,.tn-hold .tn-hits{opacity:.35;transition:opacity .18s}
  .tn-hold .tn-board{box-shadow:0 0 28px rgba(255,200,90,.28);transition:box-shadow .3s}
  .tn-cell.hit{z-index:3;animation:tnHitBlink .34s steps(1) infinite}""", 'CSS')

# ② ための本体
rep("""  /** サーバーから返ってきた1スピンを画面に流す */
  function tnShowResult(r) {""",
"""  /**
   * 止まってから当選額が出るまでの「ため」(第184弾)。
   *
   * 高額のときだけ溜めると、**溜まった瞬間に高額が確定**してしまい、
   * 「もしかして」と思う時間が消える。だから**外れのときもたまに溜める**。
   * 溜まったら期待は上がるが、確定ではない——これが察する楽しみになる。
   *
   * 長さは額で変える(大きいほど長い)。ただし短いほうの差は小さくして、
   * 長さだけで結果が読めないようにしてある。
   *
   * @param payX 賭け金の何倍か
   * @param done ためが終わったら呼ぶ
   */
  var TN_HOLD_GASE = 0.12;      // 高額でないときに溜める割合
  function tnHold(payX, done) {
    var big = payX >= TN_BIG_X;
    if (!big && Math.random() >= TN_HOLD_GASE) { done(); return; }
    var ms = big ? (payX >= 100 ? 1100 : 800) : 700;
    var el = document.getElementById("tunnel");
    if (el) el.classList.add("tn-hold");
    try { bacAudioInit(); bacBlip(180, 0.10, "sine", 0.05); } catch (e) {}
    setTimeout(function () {
      var e2 = document.getElementById("tunnel");
      if (e2) e2.classList.remove("tn-hold");
      done();
    }, ms);
  }

  /** サーバーから返ってきた1スピンを画面に流す */
  function tnShowResult(r) {""", 'ための本体')

# ③ 結果の出し方をための後ろへ回す
rep("""    // 戻り演出があるときは、演出が終わってから鳴らす(先に鳴ると結果が割れる)
    if (!o.reverse) tnSfxWin(o.totalPayX || 0, o.freeEntered);
    tnLast = {
      grid: o.grid0, hitCells: hitCells, hits: hits, tunnel: o.tunnel,
      heldCenter: false,
      cap: cap,
      winner: total > 0,          // 当選のときだけ看板を出す
      win: total,
      paid: r.won || 0,
      freeBadge: "",
      msg: ""
    };
    tnPending = r.pending || 0;
    tnCanDouble = r.pending > 0;

    var finish = function () {""",
"""    // 当選額と当たったマスは「ため」のあとに出す。
    // 先に出してしまうと、溜める意味がなくなる
    var reveal = {
      grid: o.grid0, hitCells: hitCells, hits: hits, tunnel: o.tunnel,
      heldCenter: false,
      cap: cap,
      winner: total > 0,          // 当選のときだけ看板を出す
      win: total,
      paid: r.won || 0,
      freeBadge: "",
      msg: ""
    };
    // 溜めている間は、止まった絵柄だけを見せる(当たった印も金額もまだ出さない)
    tnLast = {
      grid: o.grid0, hitCells: [], hits: [], tunnel: o.tunnel,
      heldCenter: false, cap: "", winner: false,
      win: tnLast ? tnLast.win : 0, paid: tnLast ? tnLast.paid : 0,
      freeBadge: "", msg: ""
    };
    tnPending = r.pending || 0;
    tnCanDouble = r.pending > 0;

    var finish = function () {""", '結果を後ろへ')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
