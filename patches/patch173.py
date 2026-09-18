# -*- coding: utf-8 -*-
# 第173弾: 中央がブランクのとき、隣のジョーカーを少しだけ覗かせる
import sys
p = sys.argv[1]
s = open(p, encoding='utf8').read()

def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)

# ① 覗かせ方。**縮めない**のが肝。
#    以前の覗き(第165弾)は絵を小さくして並べていたのでゴミのように見えた。
#    通常と同じ大きさのまま枠の外へ押し出し、はみ出した部分を枠で切り取る。
rep("""  .tn-cell.blank{background:#05070f}""",
"""  .tn-cell.blank{background:#05070f}
  /* 中央がブランクのとき、隣のジョーカーの端を覗かせる(第173弾)。
     リールはブランクの上下をジョーカーで挟んであるので、「すぐそこにいる」のが
     見えているのが正しい。これが見えているから「戻ってくるかも」が成り立つ。
     **絵は縮めない**。通常と同じ大きさのまま枠の外へ押し出し、はみ出しを切り取る。
     (縮めて並べると小さなゴミが散らかったように見える。第165弾でそれをやって外した) */
  .tn-jpeek{position:absolute;left:0;right:0;height:100%;pointer-events:none;z-index:1}
  .tn-jpeek img{width:100%;height:100%;object-fit:cover;display:block}
  .tn-jpeek.t{top:-78%}     /* 上にいる。下端だけが見える */
  .tn-jpeek.b{bottom:-78%}  /* 下にいる。上端だけが見える */
  /* 枠の内側に細い影を落として、続きがあることを示す */
  .tn-cell.s-blank::after{content:"";position:absolute;inset:0;pointer-events:none;z-index:2;
    box-shadow:inset 0 10px 10px -8px #000,inset 0 -10px 10px -8px #000}""", 'CSS')

# ② 中央のブランクにだけ出す
rep("""  function tnCell(sym, cls, tag, idx) {
    var img = TN_IMG[sym];
    // 上下から隣の絵柄を覗かせるのはやめた(第168弾)。小さい絵が散らかって
    // 肝心の停止図柄が読みにくく、実機よりもごちゃついて見えるため
    return '<div class="tn-cell s-' + sym + " " + (cls || "") + (sym === "blank" ? " blank" : "") + '">' +
      (img ? '<img src="' + img + '" alt="">' : "") +""",
"""  function tnCell(sym, cls, tag, idx) {
    var img = TN_IMG[sym];
    // 全マスに隣の絵柄を覗かせるのはやめた(第168弾)。小さい絵が散らかって
    // 肝心の停止図柄が読みにくかった。
    // ただし**中央がブランクのときだけ**は別で、隣のジョーカーを覗かせる(第173弾)。
    // ブランクの上下はジョーカーで挟んであるので、これが見えているのが正しい。
    // 上と下のどちらから覗くかは、そのスピンごとに決まる
    var peek = "";
    if (idx === 4 && sym === "blank" && TN_IMG.joker) {
      var side = tnPeekSide ? "t" : "b";
      peek = '<span class="tn-jpeek ' + side + '"><img src="' + TN_IMG.joker + '" alt=""></span>';
    }
    return '<div class="tn-cell s-' + sym + " " + (cls || "") + (sym === "blank" ? " blank" : "") + '">' +
      peek +
      (img ? '<img src="' + img + '" alt="">' : "") +""", '覗かせる')

# ③ どちら側から覗くかは1スピンに1回だけ決める。描き直すたびに入れ替わると落ち着かない
rep("""  /** 進行中のダブル。null なら通常のリール画面 */
  var tnDD = null;""",
"""  /** 中央のブランクの、どちら側にジョーカーがいるか(true=上)。
      1スピンに1回だけ決める。描き直すたびに入れ替わると目障りなので固定する */
  var tnPeekSide = true;

  /** 進行中のダブル。null なら通常のリール画面 */
  var tnDD = null;""", '覗く側の保持')

# ④ スピンのたびに決め直す
rep("""    var nowGrid = (tnLast && tnLast.grid) ? tnLast.grid : null;""",
"""    var nowGrid = (tnLast && tnLast.grid) ? tnLast.grid : null;
    tnPeekSide = Math.random() < 0.5;   // このスピンではどちら側にいることにするか""", '毎スピン決め直す')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
