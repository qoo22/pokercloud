# -*- coding: utf-8 -*-
# 第168弾(4): ダブルダウンの見た目を実機に寄せる
import sys
p = sys.argv[1]
s = open(p, encoding='utf8').read()

def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)

rep("""  .tn-ddstage{display:flex;flex-direction:column;gap:5px;padding:6px;border-radius:8px;
    background:#04081c;border:2px solid rgba(255,120,120,.5)}
  .tn-ddstage .lbl{text-align:center;font-size:9px;letter-spacing:.24em;color:#ff9f9f}
  .tn-ddstage .lbl.p{color:#9fd8ff}
  .tn-ddhead{display:flex;justify-content:space-between;gap:8px;font-size:8px;letter-spacing:.1em;
    color:#8fa2b5;padding:0 2px}
  .tn-ddhead b{color:#ffd23f;font-weight:700}""",
"""  /* 実機は黒地。枠の装飾はほとんど無く、文字色だけで情報を分けている。
     見出しは黄、数値は水色、説明文は黄 —— この3色しか使わない */
  .tn-ddstage{display:flex;flex-direction:column;gap:4px;padding:6px;border-radius:6px;
    background:#000;border:2px solid #2a3550}
  .tn-ddstage .lbl{text-align:center;font-size:9px;letter-spacing:.26em;color:#ffd23f}
  .tn-ddstage .lbl.p{color:#ffd23f}
  /* 上の3段。ORIGINAL WIN / COLLECTED / TRY LUCK を実機と同じ並びで出す */
  .tn-ddhead{display:grid;grid-template-columns:auto 1fr auto;gap:1px 8px;
    font-size:8px;letter-spacing:.1em;color:#5fe3ff;padding:0 2px;line-height:1.55}
  .tn-ddhead .n{text-align:right;color:#fff}
  .tn-ddhead .u{color:#5fe3ff}
  .tn-ddhead .try{color:#ffd23f}
  .tn-ddhead .try .n{color:#ffd23f}
  /* ディーラー枠の右に置くルール文。実機は常時この文言を出したまま */
  .tn-ddmid{display:flex;align-items:center;gap:6px}
  .tn-ddrule{flex:1;font-size:7.5px;line-height:1.7;color:#ffd23f;letter-spacing:.04em}
  /* 左端のスペシャルボーナス表。3つ揃いへの期待はこれが支えている */
  .tn-ddspec{width:74px;font-size:7px;line-height:1.5;color:#5fe3ff}
  .tn-ddspec div{display:flex;justify-content:space-between;gap:4px;padding:0 1px}
  .tn-ddspec div.on{background:#7a1020;color:#fff}
  .tn-ddspec b{color:#fff;font-weight:400}""", 'CSS 実機寄せ')

rep("""    return '<div class="tn-ddstage" style="flex:1">' +
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
      "</div>";""",
"""    var row3 = function (k, v, cls) {
      return '<span class="' + (cls || "") + '">' + k + "</span>" +
why        '<span class="n ' + (cls || "") + '">' + tnFmt(v) + "</span>" +
        '<span class="u ' + (cls || "") + '">COINS</span>';
    };
    return '<div class="tn-ddstage" style="flex:1">' +
      '<div class="tn-ddhead px">' +
        row3("ORIGINAL WIN", d.origin || 0) +
        row3("COLLECTED", d.keep || 0) +
        row3("TRY LUCK", d.tryLuck || 0, "try") +
      "</div>" +
      '<div class="lbl px">DEALER</div>' +
      '<div class="tn-ddmid">' +
        '<div class="tn-ddspec px">' + tnDDSpecHtml() + "</div>" +
        '<div class="tn-ddone" style="flex:1">' + cell("dd-dealer", "tn-dd-d") + "</div>" +
        '<div class="tn-ddrule px">If selected reel<br>beats dealer\\'s,<br>player wins.<br><br>All ties are<br>replayed.</div>' +
      "</div>" +
      '<div class="tn-ddrow' + (d.stage === "picking" ? " live" : "") + '" id="tn-dd-row">' +
        cell("", "tn-dd-p0") + cell("", "tn-dd-p1") + cell("", "tn-dd-p2") +
      "</div>" +
      '<div class="lbl p px">PLAYER</div>' +
      '<div class="tn-ddverdict px ' + (d.verdictCls || "") + '">' + (d.verdict || "") + "</div>" +
      "</div>";""", 'HTML 実機寄せ')

rep("""  /** リールの下に出す操作盤。ダブル中は押せなくする */""",
"""  /**
   * 3つ揃いのスペシャルボーナス表(サーバーの BSZ_SPECIAL と同じ値)。
   * 実機は左端に常時出ていて、いま揃っている行が反転する
   */
  var TN_SPECIAL = { joker: 800, blue7: 30, red7: 20, any7: 10, bar: 5, eight: 4,
    bell: 3, melon: 2, plum: 2, orange: 1, cherry: 1 };
  function tnDDSpecHtml() {
    var order = ["joker","blue7","red7","any7","bar","eight","bell","melon","plum","orange","cherry"];
    var stake = (tnDD && tnDD.tryLuck) || 0;
    var lit = tnDD && tnDD.specKey ? tnDD.specKey : null;
    return order.map(function (k) {
      return '<div' + (lit === k ? ' class="on"' : "") + "><span>" + TN_NAME[k] +
        "</span><b>" + tnFmt(stake * TN_SPECIAL[k]) + "</b></div>";
    }).join("");
  }

  /** リールの下に出す操作盤。ダブル中は押せなくする */""", 'スペシャル表')

# ハーフのときに「確保した額」も出す
rep("""      origin: pend, tryLuck: half ? Math.floor(pend / 2) : pend,""",
"""      origin: pend,
      keep: half ? Math.floor(pend / 2) : 0,          // ハーフで手元に残す額
      tryLuck: half ? pend - Math.floor(pend / 2) : pend,   // 実際に賭ける額""", 'ハーフの内訳')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
