# -*- coding: utf-8 -*-
# 第168弾(2/2): ダブルダウンを通常のリール画面で行う。実機の手順と焦らしを再現
import sys
p = sys.argv[1]
s = open(p, encoding='utf8').read()

def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)

# ---------------------------------------------------------------- CSS
rep("""  /* ダブルダウン */
  .tn-dd{margin-top:9px;padding:9px;border-radius:10px;
    background:linear-gradient(180deg,rgba(120,20,30,.5),rgba(50,8,14,.6));
    border:1px solid rgba(255,120,120,.45)}
  .tn-dd h4{margin:0 0 6px;font-size:12px;font-weight:900;letter-spacing:.14em;color:#ffd0d0;text-align:center}
  .tn-dd .row{display:flex;gap:6px;justify-content:center;margin-bottom:6px}
  .tn-pick{flex:1;max-width:92px;aspect-ratio:3/4;border-radius:8px;cursor:pointer;
    border:1.5px solid rgba(255,255,255,.25);background:#04081c;
    display:flex;align-items:center;justify-content:center;padding:0}
  .tn-pick img{width:78%;height:78%;object-fit:contain}
  .tn-pick.on{border-color:#ffd76a;box-shadow:0 0 12px rgba(255,215,106,.7)}
  .tn-pick.dealer{border-color:rgba(255,120,120,.7)}
  .tn-dd .lbl{text-align:center;font-size:9.5px;letter-spacing:.16em;color:#b9c4cf;margin-bottom:3px}
  .tn-dd .btns{display:flex;gap:6px;margin-top:7px}
  .tn-dd .btns button{flex:1;padding:9px;border-radius:9px;font-size:12px;font-weight:800;cursor:pointer;
    border:1px solid rgba(255,255,255,.3);background:rgba(0,0,0,.3);color:#e8edf2}
  .tn-dd .btns button.go{background:linear-gradient(180deg,#ffe9a8,#d9a53d);color:#241503;border:none}""",
"""  /* ダブルダウン(第168弾)。
     下に別の盤を作らず、**通常のリール画面と同じ場所を入れ替える**。
     リールは通常時と同じ横長のコマを使うので、正方形に押し込んで余る問題も消える。
     構図は実機と同じ逆三角形: 上にディーラー1本、下にプレイヤー3本 */
  .tn-ddstage{display:flex;flex-direction:column;gap:5px;padding:6px;border-radius:8px;
    background:#04081c;border:2px solid rgba(255,120,120,.5)}
  .tn-ddstage .lbl{text-align:center;font-size:9px;letter-spacing:.24em;color:#ff9f9f}
  .tn-ddstage .lbl.p{color:#9fd8ff}
  .tn-ddhead{display:flex;justify-content:space-between;gap:8px;font-size:8px;letter-spacing:.1em;
    color:#8fa2b5;padding:0 2px}
  .tn-ddhead b{color:#ffd23f;font-weight:700}
  .tn-ddone{display:flex;justify-content:center}
  .tn-ddone .tn-cell{width:calc((100% - 12px) / 3)}
  .tn-ddrow{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
  .tn-cell.dd-dealer{box-shadow:inset 0 0 0 2px rgba(255,120,120,.85)}
  /* 選べるあいだは3本を対等に見せる。特定の1本を目立たせない */
  .tn-ddrow.live .tn-cell{cursor:pointer;animation:tnDDWait 1s ease-in-out infinite}
  @keyframes tnDDWait{0%,100%{box-shadow:inset 0 0 0 1px rgba(150,200,255,.25)}
    50%{box-shadow:inset 0 0 0 1px rgba(150,200,255,.7)}}
  .tn-cell.dd-sel{animation:none;box-shadow:inset 0 0 0 3px #ffd76a,0 0 18px rgba(255,215,106,.8);z-index:3}
  .tn-cell.dd-dim{animation:none;filter:brightness(.72)}
  .tn-cell.dd-flash{animation:tnDDFlash .16s steps(2) 2}
  @keyframes tnDDFlash{0%,100%{filter:brightness(1)}50%{filter:brightness(2.1)}}
  .tn-ddverdict{text-align:center;font-size:13px;font-weight:900;letter-spacing:.2em;min-height:16px}
  .tn-ddverdict.win{color:#ffe07a;text-shadow:0 0 10px rgba(255,200,60,.8)}
  .tn-ddverdict.tie{color:#cfe0ee}
  .tn-ddverdict.lose{color:#8fa2b5}
  .tn-dd .btns{display:flex;gap:6px;margin-top:7px}
  .tn-dd .btns button{flex:1;padding:9px;border-radius:9px;font-size:12px;font-weight:800;cursor:pointer;
    border:1px solid rgba(255,255,255,.3);background:rgba(0,0,0,.3);color:#e8edf2}
  .tn-dd .btns button.go{background:linear-gradient(180deg,#ffe9a8,#d9a53d);color:#241503;border:none}
  .tn-dd .btns button:disabled{opacity:.4;cursor:default}""", 'CSS')

# ---------------------------------------------------------------- 画面の入れ替え
rep("""      '<div class="tn-board">' + rail("l") +
        '<div class="tn-grid" id="tn-grid" style="flex:1">' + cells + "</div>" +
        rail("r") + "</div>" +""",
"""      // ダブル中は同じ場所をダブルダウンの盤に入れ替える(第168弾)
      (tnDD
        ? '<div class="tn-board">' + tnDDStageHtml() + "</div>"
        : '<div class="tn-board">' + rail("l") +
          '<div class="tn-grid" id="tn-grid" style="flex:1">' + cells + "</div>" +
          rail("r") + "</div>") +""", '盤の入れ替え')

# ---------------------------------------------------------------- 下のパネル
rep("""  function tnDoubleHtml() {
    var d = tnLast && tnLast.dd;
    return '<div class="tn-dd">' +
      "<h4>DOUBLE DOWN</h4>" +
      '<div class="lbl">DEALER</div>' +
      '<div class="row">' + (d ? '<button class="tn-pick dealer"><img src="' + TN_IMG[d.dealer] + '" alt=""></button>'
        : '<button class="tn-pick dealer">?</button>') + "</div>" +
      '<div class="lbl">PLAYER \\uFF08\\u3081\\u304F\\u308B\\u524D\\u306B1\\u3064\\u9078\\u3076\\uFF09</div>' +
      '<div class="row" id="tn-picks">' +
        [0,1,2].map(function (i) {
          var sym = d ? d.player[i] : null;
          return '<button class="tn-pick' + (tnPick === i ? " on" : "") + '" data-p="' + i + '">' +
            (sym ? '<img src="' + TN_IMG[sym] + '" alt="">' : "?") + "</button>";
        }).join("") +
      "</div>" +
      '<div class="btns">' +
        '<button id="tn-collect">\\u78BA\\u5B9A</button>' +
        '<button id="tn-half">\\u30CF\\u30FC\\u30D5</button>' +
        '<button class="go" id="tn-full">\\u30C0\\u30D6\\u30EB</button>' +
      "</div></div>";
  }""",
"""  /**
   * ダブルダウンの盤(第168弾)。通常のリール画面と同じ場所に出す。
   *
   * 構図は実機と同じ逆三角形。ディーラーが上に1本、プレイヤーが下に3本。
   * リールは通常時と同じ `.tn-cell`(横長)を使う。
   */
  function tnDDStageHtml() {
    var d = tnDD || {};
    var cell = function (extra, id) {
      return '<div class="tn-cell s-blank ' + (extra || "") + '"' + (id ? ' id="' + id + '"' : "") + "></div>";
    };
    return '<div class="tn-ddstage" style="flex:1">' +
      '<div class="tn-ddhead px">' +
        "<span>ORIGINAL WIN <b>" + tnFmt(d.origin || 0) + "</b></span>" +
        "<span>TRY LUCK <b>" + tnFmt(d.tryLuck || 0) + "</b></span>" +
      "</div>" +
      '<div class="lbl px">DEALER</div>' +
      '<div class="tn-ddone">' + cell("dd-dealer", "tn-dd-d") + "</div>" +
      '<div class="tn-ddrow' + (d.stage === "picking" ? " live" : "") + '" id="tn-dd-row">' +
        cell("", "tn-dd-p0") + cell("", "tn-dd-p1") + cell("", "tn-dd-p2") +
      "</div>" +
      '<div class="lbl p px">PLAYER</div>' +
      '<div class="tn-ddverdict px ' + (d.verdictCls || "") + '">' + (d.verdict || "") + "</div>" +
      "</div>";
  }

  /** リールの下に出す操作盤。ダブル中は押せなくする */
  function tnDoubleHtml() {
    var busy = !!tnDD;
    var dis = busy ? " disabled" : "";
    return '<div class="tn-dd">' +
      '<div class="btns">' +
        '<button id="tn-collect"' + dis + ">\\u78BA\\u5B9A</button>" +
        '<button id="tn-half"' + dis + ">\\u30CF\\u30FC\\u30D5</button>" +
        '<button class="go" id="tn-full"' + dis + ">\\u30C0\\u30D6\\u30EB</button>" +
      "</div></div>";
  }""", '操作盤')

# ---------------------------------------------------------------- 配線
rep("""    var picks = $$("tn-picks");
    if (picks) picks.onclick = function (e) {
      var b = e.target.closest(".tn-pick[data-p]");
      if (!b) return;
      tnPick = Number(b.dataset.p); renderTunnel();
    };
    var c = $$("tn-collect"), h = $$("tn-half"), f = $$("tn-full");
    if (c) c.onclick = function () { tnBusy = true; send({ t: "tunnel.collect" }); };
    if (h) h.onclick = function () { tnBusy = true; send({ t: "tunnel.double", half: true, pick: tnPick }); };
    if (f) f.onclick = function () { tnBusy = true; send({ t: "tunnel.double", half: false, pick: tnPick }); };""",
"""    var c = $$("tn-collect"), h = $$("tn-half"), f = $$("tn-full");
    if (c) c.onclick = function () { if (tnDD) return; tnBusy = true; send({ t: "tunnel.collect" }); };
    // ハーフもダブルも、同じ手順(ディーラー→3本回転→3択)を通る
    if (h) h.onclick = function () { tnDDBegin(true); };
    if (f) f.onclick = function () { tnDDBegin(false); };
    var row = $$("tn-dd-row");
    if (row) row.onclick = function (e) {
      if (!tnDD || tnDD.stage !== "picking") return;
      var cell = e.target.closest(".tn-cell");
      if (!cell) return;
      var idx = Array.prototype.indexOf.call(row.children, cell);
      if (idx < 0) return;
      tnDDChoose(idx);
    };""", '配線')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
