# -*- coding: utf-8 -*-
import sys
p = sys.argv[1]
s = open(p, encoding='utf8').read()
def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)

# ① ステージ上部に「いまの筋」ボード
rep('''  <div class="bac-stagetop">
    <div class="bac-need" id="bac-need"></div>
    <div class="bac-grid10" id="bac-grid10"></div>''',
'''  <div class="bac-stagetop">
    <div class="bac-need" id="bac-need"></div>
    <div class="bac-sqstate" id="bac-sqstate"></div>
    <div class="bac-grid10" id="bac-grid10"></div>''', '筋ボード枠')

# ② ミニカード生成(実カードの見た目で小さく)
rep('''  /** めくれ量 rev のとき、rank のカードで見えている情報の署名 */''',
'''  /** アウツ表示用のミニカード(実カードの見た目)。スートはランクごとに固定で散らす */
  function bacMiniCard(rank, outcome) {
    var suitIdx = (rank * 7 + 1) % 4;
    var red = suitIdx === 1 || suitIdx === 2;
    var ink = red ? "#c0342b" : "#131313";
    var fs = rank === 10 ? 26 : 34;
    return '<span class="bac-mini ' + outcome + '"><svg viewBox="0 0 60 84">' +
      '<rect x="0" y="0" width="60" height="84" rx="7" fill="#f6f4ec"/>' +
      '<rect x="1" y="1" width="58" height="82" rx="6" fill="none" stroke="#d8d2c2"/>' +
      '<text x="30" y="42" text-anchor="middle" font-family="-apple-system,Inter,sans-serif" font-weight="800" font-size="' + fs + '" fill="' + ink + '">' + bacRankLabel(rank) + "</text>" +
      '<path d="' + BAC_SPATH[suitIdx] + '" fill="' + ink + '" transform="translate(30 62) scale(1.05) translate(-12 -12)"/>' +
      "</svg></span>";
  }

  /** めくれ量 rev のとき、rank のカードで見えている情報の署名 */''', 'bacMiniCard')

# ③ 絞り開始時に「いまの筋」を出す
rep('''      document.getElementById("bac-need").textContent =
        (slot.s === "p" ? "PLAYER" : "BANKER") + " の最後の1枚 — この数字で決まる";''',
'''      document.getElementById("bac-need").textContent =
        (slot.s === "p" ? "PLAYER" : "BANKER") + " の最後の1枚 — この数字で決まる";
      // いまの筋: 確定している側は最終合計、絞る側は「見えている合計 +?」
      var sumVis = function (arr, skipIdx) {
        var t = 0;
        for (var si = 0; si < arr.length; si++) { if (si !== skipIdx) t += bacValue(arr[si].r); }
        return t % 10;
      };
      var pVis = slot.s === "p" ? sumVis(hand.p, slot.i) : hand.pt;
      var bVis = slot.s === "b" ? sumVis(hand.b, slot.i) : hand.bt;
      document.getElementById("bac-sqstate").innerHTML =
        '<div class="side p' + (slot.s === "p" ? " sq" : "") + '"><span>PLAYER</span><b>' + pVis + (slot.s === "p" ? "<i>+?</i>" : "") + "</b><small>" + hand.p.length + "枚</small></div>" +
        '<div class="vs">vs</div>' +
        '<div class="side b' + (slot.s === "b" ? " sq" : "") + '"><span>BANKER</span><b>' + bVis + (slot.s === "b" ? "<i>+?</i>" : "") + "</b><small>" + hand.b.length + "枚</small></div>";''', '筋ボード描画')

# ④ 勝ち/分け/負けの全通りをミニカードで
rep('''    // 引けば勝つ札そのものを見せる(J/Q/Kはひとまとめ)
    var wl = [];
    for (var wr = 1; wr <= 13; wr++) {
      if (!alive[wr]) continue;
      var res2 = bacConsistent(bacSqHand, bacSqSlot, bacValue(wr));
      if (res2 === null) continue;
      var net2 = -(bacBets.p + bacBets.b + bacBets.tie);
      if (res2 === "P") net2 += bacBets.p * 2;
      if (res2 === "B") net2 += bacBets.b * 1.95;
      if (res2 === "T") net2 += bacBets.tie * 9 + bacBets.p + bacBets.b;
      if (net2 <= 0.001) continue;
      wl.push(bacRankLabel(wr));   // J/Q/K もまとめず全部並べる(第126弾)
    }
    // 勝ち目が無いときは何も出さない(オーナー指定: 煽らない)
    var wcards = wl.length
      ? '<div class="ocards">これが出ればあなたの勝ち: ' + wl.map((x) => "<i>" + x + "</i>").join("") + "</div>"
      : "";
    el.innerHTML = wcards +''',
'''    // 可能性のある札を勝ち/分け/負けに分けて**全通り**ミニカードで見せる(第128弾)
    var rows = { win: [], push: [], lose: [] };
    for (var wr = 1; wr <= 13; wr++) {
      if (!alive[wr]) continue;
      var res2 = bacConsistent(bacSqHand, bacSqSlot, bacValue(wr));
      if (res2 === null) continue;
      var net2 = -(bacBets.p + bacBets.b + bacBets.tie);
      if (res2 === "P") net2 += bacBets.p * 2;
      if (res2 === "B") net2 += bacBets.b * 1.95;
      if (res2 === "T") net2 += bacBets.tie * 9 + bacBets.p + bacBets.b;
      var oc = net2 > 0.001 ? "win" : net2 < -0.001 ? "lose" : "push";
      rows[oc].push(bacMiniCard(wr, oc));
    }
    var wcards = "";
    if (rows.win.length) wcards += '<div class="ocrow win"><em>勝ち</em>' + rows.win.join("") + "</div>";
    if (rows.push.length) wcards += '<div class="ocrow push"><em>分け</em>' + rows.push.join("") + "</div>";
    if (rows.lose.length) wcards += '<div class="ocrow lose"><em>負け</em>' + rows.lose.join("") + "</div>";
    el.innerHTML = wcards +''', '全通り表示')

# ⑤ CSS
rep('''  .bac-oddsbar .ocards{display:flex;gap:4px;justify-content:center;align-items:center;flex-wrap:wrap;
    margin-bottom:7px;font-size:10.5px;color:#a9b7c2;letter-spacing:.04em}
  .bac-oddsbar .ocards i{font-style:normal;min-width:22px;padding:3px 5px;border-radius:4px;text-align:center;
    font-size:12px;font-weight:800;color:#241a05;background:linear-gradient(180deg,#f2df9a,#d9a53d);
    box-shadow:0 1px 3px rgba(0,0,0,.5)}
  .bac-oddsbar .ocards.none{color:#e0655a}''',
'''  /* いまの筋(絞り中の P vs B) */
  .bac-sqstate{display:flex;gap:10px;justify-content:center;align-items:stretch;margin-bottom:8px}
  .bac-sqstate .side{min-width:96px;padding:5px 10px;border-radius:10px;text-align:center;
    border:1.5px solid #2e3844;background:rgba(23,29,37,.9)}
  .bac-sqstate .side span{display:block;font-size:9px;letter-spacing:.14em;font-weight:800}
  .bac-sqstate .side.p span{color:#5a9de0}.bac-sqstate .side.b span{color:#e05a5a}
  .bac-sqstate .side b{font-size:24px;line-height:1.15;color:#e8edf2;font-variant-numeric:tabular-nums}
  .bac-sqstate .side b i{font-style:normal;font-size:14px;color:#d9b45f}
  .bac-sqstate .side small{display:block;font-size:8.5px;color:#8b97a5}
  .bac-sqstate .side.sq{border-color:#d9b45f;box-shadow:0 0 12px rgba(217,180,95,.4)}
  .bac-sqstate .vs{align-self:center;font-size:10px;color:#6c7a88;font-weight:800}
  /* 勝ち/分け/負けの全通り(ミニカード) */
  .bac-oddsbar .ocrow{display:flex;gap:4px;justify-content:center;align-items:center;flex-wrap:wrap;
    margin-bottom:5px}
  .bac-oddsbar .ocrow em{font-style:normal;font-size:10px;font-weight:800;min-width:30px;text-align:right;
    margin-right:3px;letter-spacing:.06em}
  .bac-oddsbar .ocrow.win em{color:#4dbd7a}.bac-oddsbar .ocrow.push em{color:#5a9de0}.bac-oddsbar .ocrow.lose em{color:#e05a5a}
  .bac-mini{display:inline-block;width:26px;border-radius:4px;line-height:0}
  .bac-mini svg{width:100%;height:auto;display:block;border-radius:4px}
  .bac-mini.win svg{box-shadow:0 0 0 1.5px #4dbd7a,0 0 8px rgba(77,189,122,.5)}
  .bac-mini.push svg{box-shadow:0 0 0 1.5px #5a9de0}
  .bac-mini.lose svg{box-shadow:0 0 0 1.5px rgba(224,90,90,.7);opacity:.8}''', 'CSS一式')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
