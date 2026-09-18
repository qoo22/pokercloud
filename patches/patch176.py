# -*- coding: utf-8 -*-
# 第176弾: ダブルは負けるまで同じ画面で続けられる
import sys
p = sys.argv[1]
s = open(p, encoding='utf8').read()

def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)

# ① 続けられるようにする。盤は作り直さず、4本のリールだけ元に戻す
rep("""  /** ダブル開始。まずサーバーにディーラーだけ決めてもらう */
  function tnDDBegin(half) {
    if (tnDD || !tnCanDouble) return;
    var pend = tnPending || 0;
    tnDD = {
      stage: "dealing", half: half, pick: -1, reels: [], dealer: null,
      origin: pend,
      keep: half ? Math.floor(pend / 2) : 0,          // ハーフで手元に残す額
      tryLuck: half ? pend - Math.floor(pend / 2) : pend,   // 実際に賭ける額
      verdict: "", verdictCls: "",
    };
    renderTunnel();
    tnDD.built = true;        // ここから先は盤を作り直さない
    send({ t: "tunnel.double.deal", half: half });
  }""",
"""  /**
   * ダブル開始(第176弾で「続けられる」形にした)。
   *
   * 実機は勝つたびに画面が戻ったりしない。**負けるか、確定するまで同じ画面**で
   * 何度でも挑める。勝った額がそのまま次の賭け金になる。
   * そのため2回目以降は盤を作り直さず、4本のリールだけ元に戻して回し直す。
   * 作り直すと一瞬画面が飛んで、続いている感じが切れてしまう。
   */
  function tnDDBegin(half) {
    if (!tnCanDouble) return;
    if (tnDD && tnDD.stage !== "again") return;   // 進行中は受け付けない
    var pend = tnPending || 0;
    var keep = half ? Math.floor(pend / 2) : 0;
    var info = {
      stage: "dealing", half: half, pick: -1, reels: [], dealer: null,
      origin: pend, keep: keep, tryLuck: pend - keep,
      verdict: "", verdictCls: "",
    };
    if (!tnDD) {
      tnDD = info;
      renderTunnel();
      tnDD.built = true;      // ここから先は盤を作り直さない
    } else {
      info.built = true;
      info.round = (tnDD.round || 1) + 1;
      tnDD = info;
      tnDDResetStage();       // 同じ盤を使い回す
    }
    send({ t: "tunnel.double.deal", half: half });
  }

  /** 2回目以降。リールを空に戻し、上の金額と操作盤だけ書き換える */
  function tnDDResetStage() {
    ["tn-dd-d", "tn-dd-p0", "tn-dd-p1", "tn-dd-p2"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.className = "tn-cell s-blank " + (id === "tn-dd-d" ? "dd-dealer" : "");
      el.innerHTML = "";
      el.style.removeProperty("--tnh");
    });
    var row = document.getElementById("tn-dd-row");
    if (row) row.classList.remove("live");
    tnDDPaint();
    tnDDPaintHead();
  }

  /** 上段の金額(ORIGINAL WIN / COLLECTED / TRY LUCK)だけ書き換える */
  function tnDDPaintHead() {
    var head = document.querySelector(".tn-ddhead");
    if (!head || !tnDD) return;
    var v = head.querySelectorAll(".n");
    if (v.length >= 3) {
      v[0].textContent = tnFmt(tnDD.origin || 0);
      v[1].textContent = tnFmt(tnDD.keep || 0);
      v[2].textContent = tnFmt(tnDD.tryLuck || 0);
    }
    var spec = document.querySelector(".tn-ddspec");
    if (spec) spec.innerHTML = tnDDSpecHtml();
    var btns = document.querySelector(".tn-dd .btns");
    if (btns) btns.outerHTML = tnDDButtonsHtml();
    tnWire();
  }""", '続けられるようにする')

# ② 勝って続けられるときは画面を閉じない
rep("""  function tnDDShowVerdict(view) {
    if (!tnDD) { tnDDFinish(view); return; }
    var r = view.result;
    tnDD.verdict = r.result === "win" ? "WINNER!" : r.result === "tie" ? "TIE \\u2014 REPLAY" : "LOSE";
    tnDD.verdictCls = r.result;
    tnDDPaint();
    // ジョーカーが出ていればトンネルへ。文字より先に上を見せる
    var wait = r.tunnel ? 900 : 700;
    setTimeout(function () { tnDDFinish(view); }, wait);
  }""",
"""  function tnDDShowVerdict(view) {
    if (!tnDD) { tnDDFinish(view); return; }
    var r = view.result;
    tnDD.verdict = r.result === "win" ? "WINNER!" : r.result === "tie" ? "TIE \\u2014 REPLAY" : "LOSE";
    tnDD.verdictCls = r.result;
    tnDDPaint();
    // 勝ち負けの音。高額まで伸びていれば GOLD RUSH の大当たり音に切り替わる
    try {
      if (r.result === "win" || r.specialX > 0) tnSfxWin(r.payX || 0, false);
      else if (r.result === "tie") sfx("btn");
    } catch (e) {}
    var wait = r.tunnel ? 900 : 700;
    setTimeout(function () {
      // **まだ賭けられるなら画面を閉じない**(第176弾)。
      // 実機は負けるか確定するまで同じ画面で続く。勝った額が次の賭け金になる
      if (tnDD && view.canDouble) {
        tnPending = view.pending || 0;
        tnCanDouble = true;
        tnCredits = typeof balance === "number" ? balance : tnCredits;
        tnDD.stage = "again";
        tnDD.origin = tnPending;
        tnDD.keep = 0;
        tnDD.tryLuck = tnPending;
        tnDDPaintHead();
        return;
      }
      tnDDFinish(view);
    }, wait);
  }""", '勝てば閉じない')

# ③ 操作盤を組み立て直せるように切り出す
rep("""  /** リールの下に出す操作盤。ダブル中は押せなくする */
  function tnDoubleHtml() {
    var busy = !!tnDD;
    var dis = busy ? " disabled" : "";
    return '<div class="tn-dd">' +
      '<div class="btns">' +
        '<button id="tn-collect"' + dis + ">\\u78BA\\u5B9A</button>" +
        '<button id="tn-half"' + dis + ">\\u30CF\\u30FC\\u30D5</button>" +
        '<button class="go" id="tn-full"' + dis + ">\\u30C0\\u30D6\\u30EB</button>" +
      "</div></div>";
  }""",
"""  /**
   * リールの下に出す操作盤。
   * ダブルの**演出中だけ**押せなくする。勝って次を待っている間は押せる(第176弾)
   */
  function tnDDButtonsHtml() {
    var dis = (tnDD && tnDD.stage !== "again") ? " disabled" : "";
    var again = tnDD && tnDD.stage === "again";
    return '<div class="btns">' +
      '<button id="tn-collect"' + dis + ">\\u78BA\\u5B9A</button>" +
      '<button id="tn-half"' + dis + ">\\u30CF\\u30FC\\u30D5</button>" +
      '<button class="go" id="tn-full"' + dis + ">" +
        (again ? "\\u3082\\u3046\\u4E00\\u5EA6\\u30C0\\u30D6\\u30EB" : "\\u30C0\\u30D6\\u30EB") + "</button>" +
      "</div>";
  }
  function tnDoubleHtml() { return '<div class="tn-dd">' + tnDDButtonsHtml() + "</div>"; }""", '操作盤の切り出し')

# ④ 確定ボタンはダブル画面からも効くようにする
rep("""    if (c) c.onclick = function () { if (tnDD) return; tnBusy = true; send({ t: "tunnel.collect" }); };""",
"""    if (c) c.onclick = function () {
      if (tnDD && tnDD.stage !== "again") return;   // 演出中は触らせない
      if (tnDD) tnDDFinish(null);                   // ダブル画面を閉じてから確定する
      tnBusy = true;
      send({ t: "tunnel.collect" });
    };""", '確定の配線')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
