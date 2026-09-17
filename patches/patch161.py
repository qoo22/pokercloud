# -*- coding: utf-8 -*-
# 第161弾: 2台目のスロット「WINNING TUNNEL」と、台を選べるタブ
import sys, base64, os
p = sys.argv[1]
img = sys.argv[2]
s = open(p, encoding='utf8').read()
def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)
def uri(f):
    with open(os.path.join(img, f), 'rb') as fh:
        return 'data:image/webp;base64,' + base64.b64encode(fh.read()).decode()

SYMS = ['joker', 'cherry', 'orange', 'plum', 'melon', 'bell', 'eight', 'bar', 'red7', 'blue7']

# ① 台えらびのバーと、2台目の置き場
rep('''  <div class="tabpage hidden" id="tab-slot">
    <div class="sl-designbar">''',
'''  <div class="tabpage hidden" id="tab-slot">
    <div class="mc-bar" id="mc-bar"></div>
    <div class="sl-designbar">''', '台えらびのバー')

rep('''    <div id="slot"></div>
  </div>

  <div class="tabpage hidden" id="tab-baccarat">''',
'''    <div id="slot"></div>
    <div id="tunnel" class="hidden"></div>
  </div>

  <div class="tabpage hidden" id="tab-baccarat">''', '2台目の置き場')

# ② CSS
rep('''  .sl-designrow span{font-size:10px;color:#8b97a5;letter-spacing:.08em;margin-left:6px}''',
'''  .sl-designrow span{font-size:10px;color:#8b97a5;letter-spacing:.08em;margin-left:6px}
  /* --- 台えらび(第161弾)。台が増えても横に並ぶだけ --- */
  .mc-bar{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:0 auto 8px;max-width:520px}
  .mc-btn{padding:7px 14px;border-radius:20px;font-size:11.5px;font-weight:800;cursor:pointer;
    letter-spacing:.04em;border:1.5px solid rgba(217,180,95,.45);background:rgba(217,180,95,.06);color:#ffe9a8}
  .mc-btn.on{background:linear-gradient(180deg,rgba(217,180,95,.34),rgba(217,180,95,.16));
    border-color:#d9b45f;box-shadow:0 0 12px rgba(217,180,95,.5)}
  /* --- WINNING TUNNEL の筐体 --- */
  #tunnel{max-width:520px;margin:0 auto;color:#e8edf2}
  .tn-cab{background:linear-gradient(180deg,#0d2a6b,#071640 60%,#040d28);
    border:2px solid rgba(120,170,255,.4);border-radius:14px;padding:10px;
    box-shadow:0 14px 40px rgba(0,0,0,.6), inset 0 0 40px rgba(20,60,160,.35)}
  .tn-title{text-align:center;font-size:13px;font-weight:900;letter-spacing:.22em;color:#ffe9a8;margin:2px 0 8px}
  /* トンネル(上部ユニット) */
  .tn-tunnel{position:relative;height:52px;border-radius:10px;margin-bottom:8px;overflow:hidden;
    background:radial-gradient(ellipse at 50% 50%, #1b2f7a, #06102e 70%);
    border:1px solid rgba(120,170,255,.35);display:flex;align-items:center;justify-content:center}
  .tn-tunnel i{position:absolute;border:1px solid rgba(120,200,255,.35);border-radius:50%;
    left:50%;top:50%;transform:translate(-50%,-50%)}
  .tn-tunnel b{position:relative;z-index:2;font-size:22px;font-weight:900;color:#ffe9a8;
    text-shadow:0 0 14px rgba(255,200,90,.9);letter-spacing:.06em}
  .tn-tunnel.spin i{animation:tnRing 1.1s linear infinite}
  @keyframes tnRing{0%{transform:translate(-50%,-50%) scale(.2);opacity:0}
    30%{opacity:1}100%{transform:translate(-50%,-50%) scale(1.6);opacity:0}}
  /* 盤面 3×3 */
  .tn-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:6px;border-radius:10px;
    background:#04081c;border:2px solid rgba(120,170,255,.45)}
  .tn-cell{position:relative;aspect-ratio:1;border-radius:6px;background:#000;
    display:flex;align-items:center;justify-content:center;overflow:hidden}
  .tn-cell img{width:82%;height:82%;object-fit:contain;display:block}
  .tn-cell.blank{background:#05070f}
  .tn-cell.hit{box-shadow:inset 0 0 0 2px #ffd76a,0 0 14px rgba(255,215,106,.7);z-index:2}
  .tn-cell.held{box-shadow:inset 0 0 0 2px #7ad6ff,0 0 16px rgba(90,190,255,.7);z-index:2}
  .tn-cell.roll img{animation:tnRoll .18s linear infinite}
  @keyframes tnRoll{0%{transform:translateY(-12%)}100%{transform:translateY(12%)}}
  /* 情報行 */
  .tn-info{display:flex;justify-content:space-between;align-items:center;gap:8px;
    margin-top:7px;font-size:11px;color:#b9c4cf}
  .tn-info b{color:#ffe9a8;font-size:13px;font-variant-numeric:tabular-nums}
  .tn-free{margin-top:7px;padding:7px 10px;border-radius:10px;text-align:center;
    background:linear-gradient(180deg,rgba(90,40,160,.55),rgba(40,16,80,.55));
    border:1px solid rgba(180,130,255,.5);font-size:12px;font-weight:800;color:#ffe9a8}
  .tn-hits{margin-top:6px;max-height:96px;overflow-y:auto;font-size:10.5px;color:#cfd8e3}
  .tn-hits div{display:flex;justify-content:space-between;gap:8px;padding:1px 4px}
  .tn-hits i{font-style:normal;color:#8b97a5}
  /* 操作 */
  .tn-ctrl{display:flex;gap:8px;align-items:center;margin-top:9px}
  .tn-bet{flex:1;text-align:center;padding:8px;border-radius:10px;background:rgba(0,0,0,.35);
    border:1px solid rgba(120,170,255,.35)}
  .tn-bet span{display:block;font-size:9px;color:#8b97a5;letter-spacing:.18em}
  .tn-bet b{font-size:16px;color:#ffe9a8;font-variant-numeric:tabular-nums}
  .tn-btn{padding:10px 14px;border-radius:10px;font-size:13px;font-weight:900;cursor:pointer;
    border:1px solid rgba(217,180,95,.6);background:rgba(217,180,95,.12);color:#ffe9a8}
  .tn-spin{width:100%;margin-top:9px;padding:14px;border-radius:12px;font-size:17px;font-weight:900;
    letter-spacing:.1em;cursor:pointer;border:none;color:#241503;
    background:linear-gradient(180deg,#ffe9a8,#d9a53d);box-shadow:0 6px 18px rgba(217,165,61,.45)}
  .tn-spin:disabled{opacity:.45;cursor:default}
  /* ダブルダウン */
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
  .tn-dd .btns button.go{background:linear-gradient(180deg,#ffe9a8,#d9a53d);color:#241503;border:none}
  .tn-msg{margin-top:7px;text-align:center;font-size:12px;font-weight:800;color:#ffe9a8;min-height:18px}
  /* 配当表 */
  .tn-pay{margin-top:9px;font-size:10px;color:#b9c4cf}
  .tn-pay table{width:100%;border-collapse:collapse}
  .tn-pay td,.tn-pay th{padding:2px 4px;border-bottom:1px solid rgba(255,255,255,.07);text-align:right}
  .tn-pay td:first-child,.tn-pay th:first-child{text-align:left}
  .tn-pay img{width:15px;height:15px;object-fit:contain;vertical-align:-3px;margin-right:3px}''', 'CSS')

# ③ JS
rep('''  function renderSlot() {''',
'''  // ==========================================================================
  // 2台目「WINNING TUNNEL」(第161弾)
  //
  // 抽選・判定・ダブルの勝敗は全部サーバー(bsz.ts)。ここは絵を出すだけ。
  // 台を増やせるよう、台の一覧は MACHINES にまとめてある
  // ==========================================================================
  var TN_IMG = {__TNIMG__};
  var TN_NAME = {
    joker: "\\u30B8\\u30E7\\u30FC\\u30AB\\u30FC", cherry: "\\u30C1\\u30A7\\u30EA\\u30FC",
    orange: "\\u30AA\\u30EC\\u30F3\\u30B8", plum: "\\u30D7\\u30E9\\u30E0", melon: "\\u30B9\\u30A4\\u30AB",
    bell: "\\u30D9\\u30EB", eight: "8", bar: "BAR", red7: "\\u8D647", blue7: "\\u93877",
    any7: "ANY 7", blank: "\\u2014"
  };
  var TN_LINE_PAY = { joker: 100, blue7: 40, red7: 30, any7: 20, bar: 8, eight: 5, bell: 4, melon: 3, plum: 2, orange: 1, cherry: 1 };
  var tnBet = 1000, tnBusy = false, tnPending = 0, tnCanDouble = false, tnPick = 0, tnLast = null;

  function tnCell(sym, cls) {
    var img = TN_IMG[sym];
    return '<div class="tn-cell ' + (cls || "") + (sym === "blank" ? " blank" : "") + '">' +
      (img ? '<img src="' + img + '" alt="">' : "") + "</div>";
  }
  function tnFmt(n) { return typeof fmt === "function" ? fmt(n) : String(n); }

  function renderTunnel() {
    var el = document.getElementById("tunnel");
    if (!el) return;
    var g = tnLast ? tnLast.grid : ["blank","blank","blank","blank","blank","blank","blank","blank","blank"];
    var hit = tnLast ? tnLast.hitCells : [];
    var held = tnLast && tnLast.heldCenter ? [4] : [];
    var cells = "";
    for (var i = 0; i < 9; i++) {
      cells += tnCell(g[i], (hit.indexOf(i) >= 0 ? "hit " : "") + (held.indexOf(i) >= 0 ? "held" : ""));
    }
    var hits = "";
    if (tnLast && tnLast.hits && tnLast.hits.length) {
      hits = tnLast.hits.map(function (h) {
        return "<div><i>" + h.what + "</i><b>\\u00D7" + h.x + "</b></div>";
      }).join("");
    }
    el.innerHTML =
      '<div class="tn-cab">' +
      '<div class="tn-title">WINNING TUNNEL</div>' +
      '<div class="tn-tunnel' + (tnBusy ? " spin" : "") + '" id="tn-tunnel">' +
        '<i style="width:26px;height:26px"></i><i style="width:52px;height:52px"></i>' +
        '<i style="width:80px;height:80px"></i>' +
        '<b id="tn-mult">' + (tnLast && tnLast.tunnel ? "\\u00D7" + tnLast.tunnel : "TUNNEL") + "</b>" +
      "</div>" +
      '<div class="tn-grid" id="tn-grid">' + cells + "</div>" +
      (tnLast && tnLast.freeText ? '<div class="tn-free">' + tnLast.freeText + "</div>" : "") +
      '<div class="tn-info"><span>8\\u30E9\\u30A4\\u30F3 + ANY\\u914D\\u5F53</span>' +
        "<span>" + (tnPending > 0 ? "\\u624B\\u5143 <b>" + tnFmt(tnPending) + "</b>" : "") + "</span></div>" +
      (hits ? '<div class="tn-hits">' + hits + "</div>" : "") +
      '<div class="tn-msg" id="tn-msg">' + (tnLast && tnLast.msg ? tnLast.msg : "") + "</div>" +
      (tnCanDouble ? tnDoubleHtml() : "") +
      '<div class="tn-ctrl">' +
        '<button class="tn-btn" id="tn-minus">\\u2212</button>' +
        '<div class="tn-bet"><span>\\u8CDE\\u3051\\u91D1</span><b id="tn-betv">' + tnFmt(tnBet) + "</b></div>" +
        '<button class="tn-btn" id="tn-plus">\\uFF0B</button>' +
      "</div>" +
      '<button class="tn-spin" id="tn-spin"' + (tnBusy || tnCanDouble ? " disabled" : "") + ">" +
        (tnCanDouble ? "\\u30C0\\u30D6\\u30EB\\u3092\\u9078\\u3093\\u3067\\u304F\\u3060\\u3055\\u3044" : "SPIN") + "</button>" +
      tnPayHtml() +
      "</div>";
    tnWire();
  }

  function tnDoubleHtml() {
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
  }

  function tnPayHtml() {
    var order = ["joker","blue7","red7","any7","bar","eight","bell","melon","plum","orange","cherry"];
    return '<div class="tn-pay"><table><tr><th>3\\u3064\\u4E26\\u3073(8\\u30E9\\u30A4\\u30F3)</th><th>\\u500D\\u7387</th></tr>' +
      order.map(function (k) {
        return "<tr><td>" + (TN_IMG[k] ? '<img src="' + TN_IMG[k] + '" alt="">' : "") +
          TN_NAME[k] + "</td><td>\\u00D7" + TN_LINE_PAY[k] + "</td></tr>";
      }).join("") + "</table></div>";
  }

  function tnWire() {
    var $$ = function (id) { return document.getElementById(id); };
    var minus = $$("tn-minus"), plus = $$("tn-plus"), spin = $$("tn-spin");
    if (minus) minus.onclick = function () { tnBet = Math.max(1000, Math.floor(tnBet / 2)); renderTunnel(); };
    if (plus) plus.onclick = function () { tnBet = tnBet * 2; renderTunnel(); };
    if (spin) spin.onclick = function () {
      if (tnBusy || tnCanDouble) return;
      tnBusy = true; tnLast = null; renderTunnel();
      send({ t: "tunnel.spin", bet: tnBet });
    };
    var picks = $$("tn-picks");
    if (picks) picks.onclick = function (e) {
      var b = e.target.closest(".tn-pick[data-p]");
      if (!b) return;
      tnPick = Number(b.dataset.p); renderTunnel();
    };
    var c = $$("tn-collect"), h = $$("tn-half"), f = $$("tn-full");
    if (c) c.onclick = function () { tnBusy = true; send({ t: "tunnel.collect" }); };
    if (h) h.onclick = function () { tnBusy = true; send({ t: "tunnel.double", half: true, pick: tnPick }); };
    if (f) f.onclick = function () { tnBusy = true; send({ t: "tunnel.double", half: false, pick: tnPick }); };
  }

  /** サーバーから返ってきた1スピンを画面に流す */
  function tnShowResult(r) {
    var o = r.outcome;
    var hitCells = [];
    o.base.lines.forEach(function (l) { l.cells.forEach(function (c) { if (hitCells.indexOf(c) < 0) hitCells.push(c); }); });
    var hits = o.base.lines.map(function (l) {
      return { what: TN_NAME[l.key] + " 3\\u3064\\u4E26\\u3073", x: l.x };
    }).concat(o.base.anys.map(function (a) {
      return { what: "ANY " + TN_NAME[a.key] + " " + a.count + "\\u500B", x: a.x };
    }));
    tnLast = {
      grid: o.grid0, hitCells: hitCells, hits: hits, tunnel: o.tunnel,
      heldCenter: false,
      freeText: o.freeEntered
        ? "TUNNEL \\u00D7" + o.tunnel + "\\u3000FREE GAME 5\\u56DE"
        : "",
      msg: r.won > 0 ? "WIN " + tnFmt(r.won) : (o.canDouble ? "" : "")
    };
    tnPending = r.pending || 0;
    tnCanDouble = r.pending > 0;
    tnBusy = false;
    renderTunnel();
    // フリーがあれば1回ずつ見せる
    if (o.freeEntered && o.free && o.free.length) tnPlayFree(o, r);
  }

  function tnPlayFree(o, r) {
    var i = 0;
    tnBusy = true; renderTunnel();
    var step = function () {
      if (i >= o.free.length) {
        tnBusy = false;
        tnLast.freeText = "FREE GAME \\u7D42\\u4E86\\u3000TUNNEL \\u00D7" + o.tunnel;
        tnLast.msg = r.won > 0 ? "WIN " + tnFmt(r.won) : (r.pending > 0 ? "" : "");
        renderTunnel();
        return;
      }
      var f = o.free[i];
      var cells = [];
      f.lines.forEach(function (l) { l.cells.forEach(function (c) { if (cells.indexOf(c) < 0) cells.push(c); }); });
      tnLast = {
        grid: f.grid, hitCells: cells, heldCenter: true, tunnel: o.tunnel,
        hits: f.lines.map(function (l) { return { what: TN_NAME[l.key] + " 3\\u3064\\u4E26\\u3073", x: l.x }; })
          .concat(f.anys.map(function (a) { return { what: "ANY " + TN_NAME[a.key] + " " + a.count + "\\u500B", x: a.x }; })),
        freeText: "FREE GAME " + (i + 1) + " / " + o.free.length + "\\u3000TUNNEL \\u00D7" + o.tunnel,
        msg: ""
      };
      renderTunnel();
      i++;
      setTimeout(step, 700);
    };
    setTimeout(step, 700);
  }

  function tnShowDouble(v) {
    var d = v.result;
    tnLast = tnLast || { grid: ["blank","blank","blank","blank","blank","blank","blank","blank","blank"], hitCells: [], hits: [] };
    tnLast.dd = d;
    tnLast.msg = d.result === "win" ? "WIN\\uFF01" : d.result === "tie" ? "\\u5F15\\u304D\\u5206\\u3051" : "LOSE";
    if (d.specialX) tnLast.msg += "\\u3000SPECIAL \\u00D7" + d.specialX;
    if (d.tunnel) tnLast.msg += "\\u3000TUNNEL \\u00D7" + d.tunnel;
    tnPending = v.pending;
    tnCanDouble = v.canDouble;
    tnBusy = false;
    renderTunnel();
  }

  /** 台の一覧。増やすときはここに足す */
  var MACHINES = [
    { k: "gold", n: "GOLD RUSH", el: "slot" },
    { k: "tunnel", n: "WINNING TUNNEL", el: "tunnel" }
  ];
  function machinePick() {
    try { return localStorage.getItem("slotMachine") || "gold"; } catch (e) { return "gold"; }
  }
  function machineApply() {
    var k = machinePick();
    if (!MACHINES.some(function (m) { return m.k === k; })) k = "gold";
    MACHINES.forEach(function (m) {
      var el = document.getElementById(m.el);
      if (el) el.classList.toggle("hidden", m.k !== k);
    });
    // デザイン設定は GOLD RUSH 専用なので、他の台では隠す
    var db = document.querySelector(".sl-designbar");
    if (db) db.classList.toggle("hidden", k !== "gold");
    document.querySelectorAll("#mc-bar .mc-btn").forEach(function (b) {
      b.classList.toggle("on", b.dataset.m === k);
    });
    if (k === "tunnel") renderTunnel();
    return k;
  }
  var mcBuilt = false;
  function machineBuild() {
    var host = document.getElementById("mc-bar");
    if (!host) return;
    if (!mcBuilt) {
      mcBuilt = true;
      host.innerHTML = MACHINES.map(function (m) {
        return '<button class="mc-btn" data-m="' + m.k + '">' + m.n + "</button>";
      }).join("");
      host.addEventListener("click", function (e) {
        var b = e.target.closest(".mc-btn");
        if (!b) return;
        try { localStorage.setItem("slotMachine", b.dataset.m); } catch (e2) {}
        machineApply();
      });
    }
    machineApply();
  }

  function renderSlot() {''', 'JS一式')

# ④ 受信の配線
rep('''      case "lobby.tables":''',
'''      case "tunnel.result":
        tnShowResult(msg.result);
        break;
      case "tunnel.double":
        tnShowDouble(msg.result);
        break;
      case "tunnel.collected":
        tnPending = 0; tnCanDouble = false; tnBusy = false;
        if (tnLast) tnLast.msg = msg.won > 0 ? "\\u78BA\\u5B9A " + tnFmt(msg.won) : "";
        renderTunnel();
        break;
      case "lobby.tables":''', '受信')

rep('''    if (tab === "slot") { send({ t: "slot.state" }); slotDesignBuild(); }''',
'''    if (tab === "slot") { send({ t: "slot.state" }); slotDesignBuild(); machineBuild(); }''', 'タブを開いたとき')

# ⑤ 絵柄データ
imgmap = ', '.join('%s: "%s"' % (k, uri('s_%s.webp' % k)) for k in SYMS)
rep('__TNIMG__', imgmap, '絵柄データ')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
