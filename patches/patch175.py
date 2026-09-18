# -*- coding: utf-8 -*-
# 第175弾: ダブルを続けられるように / 当選音 / ANY配当の表示
import sys
p = sys.argv[1]
s = open(p, encoding='utf8').read()

def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)

# ---------------------------------------------------------------- ① 当選音
rep("""  /** START音。GOLD RUSH のスピンと同じボタン音(第169弾) */
  function tnSfxStart() { try { sfx("btn"); } catch (e) {} }""",
"""  /** START音。GOLD RUSH のスピンと同じボタン音(第169弾) */
  function tnSfxStart() { try { sfx("btn"); } catch (e) {} }

  /**
   * 当選音(第175弾)。GOLD RUSH の録音をそのまま流用する。
   *
   * 台ごとに当たりの音が違うと、同じ筐体の別ゲームに聞こえない。
   * 額に応じて3段階に分け、**高額だけ特別な音**にする。ここを一律にすると、
   * 大きい当たりを引いたときの手応えが消える。
   *
   * @param payX 賭け金の何倍か
   * @param free フリーゲームに入ったか
   */
  var TN_BIG_X = 50;        // これ以上を「高額」とする(フリー1回の平均が26倍)
  function tnSfxWin(payX, free) {
    try {
      if (free) { sfx("bonusin"); return; }          // 突入音
      if (payX >= TN_BIG_X) {                         // 高額: GOLD RUSH の大当たり音
        sfx("gong");
        setTimeout(function () { try { play("bigwin"); } catch (e) {} }, 140);
        return;
      }
      if (payX <= 0) return;
      if (payX < 5) sfx("smallwin");                  // 小役
      else sfx("winsure");                            // 中位
    } catch (e) {}
  }""", '当選音')

rep("""    var total = (r.won || 0) + (r.pending || 0);
    var cap = "";
    if (o.freeEntered) cap = "TUNNEL " + o.tunnel + "x WINNING COMBINATION";
    else if (total > 0) cap = "WINNING COMBINATION";""",
"""    var total = (r.won || 0) + (r.pending || 0);
    var cap = "";
    if (o.freeEntered) cap = "TUNNEL " + o.tunnel + "x WINNING COMBINATION";
    else if (total > 0) cap = "WINNING COMBINATION";
    // 戻り演出があるときは、演出が終わってから鳴らす(先に鳴ると結果が割れる)
    if (!o.reverse) tnSfxWin(o.totalPayX || 0, o.freeEntered);""", '当選音を鳴らす')

# ---------------------------------------------------------------- ② ANY配当の表
rep("""  function tnPayHtml() {
    var order = ["joker","blue7","red7","any7","bar","eight","bell","melon","plum","orange","cherry"];
    return '<div class="tn-pay"><table><tr><th>3\\u3064\\u4E26\\u3073(8\\u30E9\\u30A4\\u30F3)</th><th>\\u500D\\u7387</th></tr>' +
      order.map(function (k) {
        return "<tr><td>" + (TN_IMG[k] ? '<img src="' + TN_IMG[k] + '" alt="">' : "") +
          TN_NAME[k] + "</td><td>\\u00D7" + TN_LINE_PAY[k] + "</td></tr>";
      }).join("") + "</table></div>";
  }""",
"""  /** ANY配当(サーバーの BSZ_ANY_PAY と同じ値)。画面内の個数で決まる */
  var TN_ANY_PAY = {
    cherry: { 4: 1, 5: 2, 6: 10, 7: 40, 8: 200, 9: 1000 },
    orange: { 4: 1, 5: 2, 6: 15, 7: 60, 8: 300, 9: 1500 },
    plum:   { 4: 1, 5: 4, 6: 20, 7: 80, 8: 400, 9: 2000 },
    melon:  { 4: 2, 5: 6, 6: 30, 7: 120, 8: 600, 9: 3000 },
    bell:   { 3: 1, 4: 2, 5: 8, 6: 40, 7: 160, 8: 800, 9: 4000 },
    eight:  { 3: 1, 4: 2, 5: 10, 6: 50, 7: 200, 8: 1000, 9: 5000 },
    bar:    { 3: 1, 4: 3, 5: 15, 6: 60, 7: 240, 8: 1200, 9: 6000 },
    any7:   { 3: 1, 4: 4, 5: 20, 6: 80, 7: 320, 8: 2000, 9: 8000 },
  };

  function tnPayHtml() {
    var order = ["joker","blue7","red7","any7","bar","eight","bell","melon","plum","orange","cherry"];
    var line = '<div class="tn-pay"><table><tr><th>3\\u3064\\u4E26\\u3073(8\\u30E9\\u30A4\\u30F3)</th><th>\\u500D\\u7387</th></tr>' +
      order.map(function (k) {
        return "<tr><td>" + (TN_IMG[k] ? '<img src="' + TN_IMG[k] + '" alt="">' : "") +
          TN_NAME[k] + "</td><td>\\u00D7" + TN_LINE_PAY[k] + "</td></tr>";
      }).join("") + "</table></div>";

    // ANY配当(第175弾)。ラインに乗っていなくても、**画面内に何個あるか**で付く。
    // 実機ではこちらの方が当たる機会が多いので、出しておかないと配当が読めない
    var cols = [3, 4, 5, 6, 7, 8, 9];
    var anyOrder = ["any7", "bar", "eight", "bell", "melon", "plum", "orange", "cherry"];
    var any = '<div class="tn-pay any"><table>' +
      "<tr><th>ANY(\\u753B\\u9762\\u5185\\u306E\\u500B\\u6570)</th>" +
      cols.map(function (c) { return "<th>" + c + "</th>"; }).join("") + "</tr>" +
      anyOrder.map(function (k) {
        var row = TN_ANY_PAY[k] || {};
        return "<tr><td>" + (TN_IMG[k] ? '<img src="' + TN_IMG[k] + '" alt="">' : "") + TN_NAME[k] + "</td>" +
          cols.map(function (c) {
            return "<td>" + (row[c] ? "\\u00D7" + row[c] : "\\u2014") + "</td>";
          }).join("") + "</tr>";
      }).join("") + "</table>" +
      '<p class="note">\\u30B8\\u30E7\\u30FC\\u30AB\\u30FC\\u306F\\u30EF\\u30A4\\u30EB\\u3002' +
      '\\u4E2D\\u592E\\u306B\\u6B62\\u307E\\u308C\\u3070\\u30D5\\u30EA\\u30FC\\u30B2\\u30FC\\u30E05\\u56DE\\u3002</p></div>';
    return line + any;
  }""", 'ANY配当の表')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
