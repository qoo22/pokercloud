# -*- coding: utf-8 -*-
import sys, base64, os, re
p = sys.argv[1]
img = sys.argv[2]
s = open(p, encoding='utf8').read()
def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)
def uri(name):
    with open(os.path.join(img, name), 'rb') as f:
        return 'data:image/webp;base64,' + base64.b64encode(f.read()).decode()

# ============ ① ピップさらに拡大(56 / A105、コーナースート40) ============
rep('      var size = rank === 1 ? 88 : 46;', '      var size = rank === 1 ? 105 : 56;', 'pips 56')
rep('        pip(29, 84, 34, false) +', '        pip(29, 84, 40, false) +', 'corner suit 40')

# ============ ② 卓とカード裏を CSS 変数化(デザイン切替の土台) ============
# 卓: 埋めてあった felt URL を除去して var(--bac-tbl) に。楕円が切れないよう 100% 100%
i0 = s.index('  .bac-table{display:flex')
i1 = s.index('box-shadow:inset 0 0 60px rgba(0,0,0,.45)}', i0) + len('box-shadow:inset 0 0 60px rgba(0,0,0,.45)}')
s = s[:i0] + '''  .bac-table{display:flex;flex-direction:column;gap:6px;padding:16px 22px;justify-content:center;
    border-radius:16px;margin-bottom:8px;position:relative;z-index:1;aspect-ratio:16/9;min-height:230px;
    background:var(--bac-tbl,#0d3628) center/100% 100% no-repeat;
    box-shadow:0 10px 30px rgba(0,0,0,.45)}''' + s[i1:]
print('OK 卓CSS→変数')

# カード裏: URL を JS へ移すため、まず CSS から classic の data URI を取り出す
m = re.search(r'\.bac-back\{position:absolute;inset:0;border-radius:6px;\n    background:url\((data:image/webp;base64,[^)]+)\) center/cover no-repeat #0d3628;', s)
assert m, 'classic back not found'
classic = m.group(1)
s = s[:m.start()] + '''.bac-back{position:absolute;inset:0;border-radius:6px;
    background:var(--bac-back,#0d3628) center/cover no-repeat #0d3628;''' + s[m.end():]
print('OK 裏面CSS→変数')

# ============ ③ CSS 追加(チップ画像・スライダー・デザイン選択・祝勝・オッズ) ============
rep('''  .bac-chips{display:flex;gap:6px;margin-bottom:9px}
  .bac-chip{flex:1;min-width:0;padding:10px 2px;border-radius:22px;font-size:10.5px;font-weight:800;cursor:pointer;
    color:#e8edf2;background:#212a34;border:2px dashed #2e3844;
    font-variant-numeric:tabular-nums;transition:.12s;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .bac-chip.sel{transform:translateY(-3px);border-style:solid;border-color:#d9b45f;
    background:rgba(217,180,95,.18);color:#f2e3b8;box-shadow:0 6px 14px rgba(0,0,0,.5)}''',
'''  .bac-chips{display:flex;gap:8px;margin-bottom:8px;justify-content:center}
  /* 実物風のチップ(縁のストライプ+内円)。額面はチップの上に重ねる */
  .bac-chip{flex:0 1 58px;aspect-ratio:1;max-width:58px;border-radius:50%;position:relative;cursor:pointer;
    border:none;padding:0;color:#fff;font-weight:800;font-size:10px;font-variant-numeric:tabular-nums;
    box-shadow:0 3px 8px rgba(0,0,0,.5);transition:.12s}
  .bac-chip::before{content:"";position:absolute;inset:16%;border-radius:50%;
    background:rgba(255,255,255,.16);border:1.5px dashed rgba(255,255,255,.5)}
  .bac-chip b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    text-shadow:0 1px 2px rgba(0,0,0,.7);padding:0 6px;overflow:hidden}
  .bac-chip.c0{background:conic-gradient(#e9e6da 0 25deg,#3a6bb0 25deg 65deg,#e9e6da 65deg 115deg,#3a6bb0 115deg 155deg,#e9e6da 155deg 205deg,#3a6bb0 205deg 245deg,#e9e6da 245deg 295deg,#3a6bb0 295deg 335deg,#e9e6da 335deg 360deg)}
  .bac-chip.c1{background:conic-gradient(#e9e6da 0 25deg,#b0403a 25deg 65deg,#e9e6da 65deg 115deg,#b0403a 115deg 155deg,#e9e6da 155deg 205deg,#b0403a 205deg 245deg,#e9e6da 245deg 295deg,#b0403a 295deg 335deg,#e9e6da 335deg 360deg)}
  .bac-chip.c2{background:conic-gradient(#e9e6da 0 25deg,#2e7d55 25deg 65deg,#e9e6da 65deg 115deg,#2e7d55 115deg 155deg,#e9e6da 155deg 205deg,#2e7d55 205deg 245deg,#e9e6da 245deg 295deg,#2e7d55 295deg 335deg,#e9e6da 335deg 360deg)}
  .bac-chip.c3{background:conic-gradient(#e9e6da 0 25deg,#31313b 25deg 65deg,#e9e6da 65deg 115deg,#31313b 115deg 155deg,#e9e6da 155deg 205deg,#31313b 205deg 245deg,#e9e6da 245deg 295deg,#31313b 295deg 335deg,#e9e6da 335deg 360deg)}
  .bac-chip.c4{background:conic-gradient(#e9e6da 0 25deg,#7a3f9e 25deg 65deg,#e9e6da 65deg 115deg,#7a3f9e 115deg 155deg,#e9e6da 155deg 205deg,#7a3f9e 205deg 245deg,#e9e6da 245deg 295deg,#7a3f9e 295deg 335deg,#e9e6da 335deg 360deg)}
  .bac-chip.sel{transform:translateY(-4px) scale(1.07);box-shadow:0 0 0 2.5px #d9b45f,0 8px 16px rgba(0,0,0,.55)}
  .bac-sliderrow{display:flex;align-items:center;gap:10px;margin-bottom:9px;padding:0 2px}
  .bac-sliderrow input{flex:1;accent-color:#d9b45f}
  .bac-sliderrow b{flex:0 0 auto;min-width:86px;text-align:right;color:#d9b45f;font-size:13px;
    font-variant-numeric:tabular-nums}
  .bac-designs{display:flex;align-items:center;gap:6px;margin-bottom:9px;flex-wrap:wrap;justify-content:center}
  .bac-designs span{font-size:10px;color:#8b97a5;letter-spacing:.08em;margin-left:6px}
  .bac-sw{width:36px;height:23px;border-radius:6px;border:2px solid #2e3844;background-size:cover;
    background-position:center;cursor:pointer;padding:0}
  .bac-sw.bk{width:23px;height:32px}
  .bac-sw.on{border-color:#d9b45f;box-shadow:0 0 8px rgba(217,180,95,.5)}
  /* 勝者側の点滅と、絞り数字の加算演出 */
  .bac-side.winblink{animation:bacSideBlink .32s linear 5}
  @keyframes bacSideBlink{0%,100%{filter:none}50%{filter:brightness(2) drop-shadow(0 0 12px rgba(217,180,95,.9))}}
  .bac-lab{position:relative}
  .bac-addfloat{position:absolute;left:44px;top:12px;font-weight:800;font-size:20px;color:#f2e3b8;
    animation:bacFloatUp 1s ease forwards;text-shadow:0 1px 4px rgba(0,0,0,.9);pointer-events:none}
  @keyframes bacFloatUp{from{opacity:0;transform:translateY(10px)}30%{opacity:1}to{opacity:0;transform:translateY(-18px)}}
  .bac-lab .t.pulse{animation:bacTPulse .6s ease}
  @keyframes bacTPulse{30%{transform:scale(1.5);color:#f2e3b8}}
  /* 絞り中の有利表示(どちらが勝ちそうか+アウツ) */
  .bac-oddsbar{max-width:420px;margin:8px auto 0}
  .bac-oddsbar .bar{display:flex;height:8px;border-radius:4px;overflow:hidden;background:rgba(255,255,255,.1)}
  .bac-oddsbar .bar i{display:block;height:100%}
  .bac-oddsbar .bar .op{background:#5a9de0}.bac-oddsbar .bar .ot{background:#4dbd7a}.bac-oddsbar .bar .ob{background:#e05a5a}
  .bac-oddsbar p{margin:5px 0 0;font-size:10.5px;color:#a9b7c2;letter-spacing:.04em;
    font-variant-numeric:tabular-nums;text-align:center}
  .bac-oddsbar p b{color:#f2e3b8}
  .bac-toast .w{font-size:29px;font-weight:900;letter-spacing:1px;color:#f2e3b8;margin-top:5px;
    font-variant-numeric:tabular-nums;text-shadow:0 0 18px rgba(217,180,95,.65)}''', 'CSS一式')

# ============ ④ テンプレート(スライダー・デザイン選択・オッズ・WIN行) ============
rep('''  <div class="bac-chips" id="bac-chips"></div>''',
'''  <div class="bac-chips" id="bac-chips"></div>
  <div class="bac-sliderrow">
    <input type="range" id="bac-slider" min="0" max="1000" value="0">
    <b id="bac-chipamt">1,000</b>
  </div>
  <div class="bac-designs" id="bac-designs">
    <span>卓</span>
    <button class="bac-sw" data-tbl="green"></button><button class="bac-sw" data-tbl="red"></button>
    <button class="bac-sw" data-tbl="blue"></button><button class="bac-sw" data-tbl="noir"></button>
    <span>カード</span>
    <button class="bac-sw bk" data-bk="classic"></button><button class="bac-sw bk" data-bk="red"></button>
    <button class="bac-sw bk" data-bk="blue"></button><button class="bac-sw bk" data-bk="noir"></button>
  </div>''', 'template chips+slider+designs')

rep('''    <div class="bac-grid10" id="bac-grid10"></div>
  </div>''',
'''    <div class="bac-grid10" id="bac-grid10"></div>
    <div class="bac-oddsbar" id="bac-odds"></div>
  </div>''', 'template odds')

rep('''<div class="bac-toast" id="bac-toast"><div class="h" id="bac-th"></div><div class="s" id="bac-ts"></div><div class="b" id="bac-tb"></div></div>''',
'''<div class="bac-toast" id="bac-toast"><div class="h" id="bac-th"></div><div class="w" id="bac-tw"></div><div class="s" id="bac-ts"></div><div class="b" id="bac-tb"></div></div>''', 'template toast WIN')

# ============ ⑤ JS: デザイン定数と適用 ============
rep('''  var BAC_MAX_STAKE = 50000000000000;
  var BAC_MIN_STAKE = 1000;''',
'''  var BAC_MIN_STAKE = 1000; // 上限なし(第121弾)。天井は残高だけ

  /** 卓とカード裏のデザイン(Z-Image生成)。選択は端末に保存 */
  var BAC_TBLS = { green: "__TGREEN__", red: "__TRED__", blue: "__TBLUE__", noir: "__TNOIR__" };
  var BAC_BKS = { classic: "__BKCLASSIC__", red: "__BKRED__", blue: "__BKBLUE__", noir: "__BKNOIR__" };
  function bacApplyDesign() {
    var host = document.getElementById("baccarat");
    if (!host) return;
    var tk = "green", bk = "classic";
    try { tk = localStorage.getItem("bacTbl") || tk; bk = localStorage.getItem("bacBack") || bk; } catch (e) {}
    if (!BAC_TBLS[tk]) tk = "green";
    if (!BAC_BKS[bk]) bk = "classic";
    host.style.setProperty("--bac-tbl", 'url("' + BAC_TBLS[tk] + '")');
    host.style.setProperty("--bac-back", 'url("' + BAC_BKS[bk] + '")');
    document.querySelectorAll(".bac-sw[data-tbl]").forEach((b) => b.classList.toggle("on", b.dataset.tbl === tk));
    document.querySelectorAll(".bac-sw[data-bk]").forEach((b) => b.classList.toggle("on", b.dataset.bk === bk));
  }''', 'デザイン定数')

# ============ ⑥ JS: ラダー上限は残高、スライダー同期 ============
rep('''      var v = Math.min(base * mults[i], BAC_MAX_STAKE);''',
'''      var v = Math.min(base * mults[i], Math.max(BAC_MIN_STAKE, bal || BAC_MIN_STAKE));''', 'ladder cap=残高')

rep('''    var chipsEl = document.getElementById("bac-chips");
    chipsEl.innerHTML = lad.map((v) =>
      `<button class="bac-chip${v === bacChip ? " sel" : ""}" data-v="${v}">${fmt(v)}</button>`).join("");''',
'''    var chipsEl = document.getElementById("bac-chips");
    chipsEl.innerHTML = lad.map((v, i) =>
      `<button class="bac-chip c${i % 5}${v === bacChip ? " sel" : ""}" data-v="${v}"><b>${fmt(v)}</b></button>`).join("");
    bacSyncSlider();
    bacApplyDesign();''', 'chip描画+design適用')

# ============ ⑦ JS: スライダーとデザインの配線 ============
rep('''    document.getElementById("bac-chips").addEventListener("click", (e) => {
      var b = e.target.closest(".bac-chip");
      if (!b || bacDealing) return;
      bacAudioInit();
      bacChip = +b.dataset.v;
      document.querySelectorAll(".bac-chip").forEach((x) => x.classList.toggle("sel", +x.dataset.v === bacChip));
      bacBlip(880, 0.05, "square", 0.07);
    });''',
'''    document.getElementById("bac-chips").addEventListener("click", (e) => {
      var b = e.target.closest(".bac-chip");
      if (!b || bacDealing) return;
      bacAudioInit();
      bacChip = +b.dataset.v;
      document.querySelectorAll(".bac-chip").forEach((x) => x.classList.toggle("sel", +x.dataset.v === bacChip));
      bacSyncSlider();
      bacBlip(880, 0.05, "square", 0.07);
    });
    // スライダー: 1000〜残高を対数で割り付け、上2桁に丸める(上限なし)
    var slEl = document.getElementById("bac-slider");
    slEl.addEventListener("input", () => {
      var mn = BAC_MIN_STAKE, mx = Math.max(mn, Math.floor(balance) || mn);
      var t = +slEl.value / 1000;
      var v = Math.round(Math.exp(Math.log(mn) + (Math.log(mx) - Math.log(mn)) * t));
      var mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(v)) - 1));
      bacChip = Math.max(mn, Math.min(mx, Math.round(v / mag) * mag));
      document.querySelectorAll(".bac-chip").forEach((x) => x.classList.toggle("sel", +x.dataset.v === bacChip));
      var amt = document.getElementById("bac-chipamt");
      if (amt) amt.textContent = fmt(bacChip);
    });
    document.getElementById("bac-designs").addEventListener("click", (e) => {
      var b = e.target.closest(".bac-sw");
      if (!b) return;
      try {
        if (b.dataset.tbl) localStorage.setItem("bacTbl", b.dataset.tbl);
        if (b.dataset.bk) localStorage.setItem("bacBack", b.dataset.bk);
      } catch (e2) {}
      bacApplyDesign();
      bacBlip(700, 0.05, "triangle", 0.08);
    });
    document.querySelectorAll(".bac-sw[data-tbl]").forEach((b) => {
      b.style.backgroundImage = 'url("' + BAC_TBLS[b.dataset.tbl] + '")';
    });
    document.querySelectorAll(".bac-sw[data-bk]").forEach((b) => {
      b.style.backgroundImage = 'url("' + BAC_BKS[b.dataset.bk] + '")';
    });''', 'slider+design配線')

rep('''  function bacMsg(t) { var el = document.getElementById("bac-msg"); if (el) el.textContent = t; }''',
'''  function bacMsg(t) { var el = document.getElementById("bac-msg"); if (el) el.textContent = t; }
  /** スライダーのつまみ位置と額面表示を bacChip に合わせる */
  function bacSyncSlider() {
    var slEl = document.getElementById("bac-slider");
    var amt = document.getElementById("bac-chipamt");
    if (amt) amt.textContent = fmt(bacChip);
    if (!slEl) return;
    var mn = BAC_MIN_STAKE, mx = Math.max(mn + 1, Math.floor(balance) || mn + 1);
    var t = (Math.log(Math.max(mn, Math.min(mx, bacChip))) - Math.log(mn)) / (Math.log(mx) - Math.log(mn));
    slEl.value = String(Math.round(t * 1000));
  }''', 'bacSyncSlider')

# ============ ⑧ JS: 上限チェック撤去(残高のみ) ============
rep('''        if (total + bacChip > bal) { bacMsg("チップが足りません"); return; }
        if (total + bacChip > BAC_MAX_STAKE) { bacMsg("合計 " + fmt(BAC_MAX_STAKE) + " が上限です"); return; }''',
'''        if (total + bacChip > bal) { bacMsg("チップが足りません"); return; }''', '上限チェック撤去')

# ============ ⑨ JS: 有利/アウツの計算と表示 ============
rep('''  function bacUpdateCands() {
    if (!bacSqHand) return;
    var card = (bacSqSlot.s === "p" ? bacSqHand.p : bacSqHand.b)[bacSqSlot.i];
    var actual = bacSig(card.r, bacRev, bacDir);
    var alive = {};
    for (var r = 1; r <= 13; r++) if (bacSig(r, bacRev, bacDir) === actual) alive[r] = true;''',
'''  /**
   * 残っている候補ランクから P/B/T の勝率と「勝ちのアウツ」を出す。
   * 絞りが進んで候補が減るたびに数字が動く(=期待値が動く瞬間が見える)
   */
  function bacUpdateOdds(alive) {
    var el = document.getElementById("bac-odds");
    if (!el || !bacSqHand) return;
    var cnt = { P: 0, B: 0, T: 0 }, outs = 0, tot = 0;
    for (var r = 1; r <= 13; r++) {
      if (!alive[r]) continue;
      var res = bacConsistent(bacSqHand, bacSqSlot, bacValue(r));
      if (res === null) continue;
      tot++;
      cnt[res]++;
      var net = -(bacBets.p + bacBets.b + bacBets.tie);
      if (res === "P") net += bacBets.p * 2;
      if (res === "B") net += bacBets.b * 1.95;
      if (res === "T") net += bacBets.tie * 9 + bacBets.p + bacBets.b;
      if (net > 0.001) outs++;
    }
    if (!tot) { el.innerHTML = ""; return; }
    var pp = Math.round(cnt.P / tot * 100), pb = Math.round(cnt.B / tot * 100);
    var pt = Math.max(0, 100 - pp - pb);
    var lead = cnt.P > cnt.B ? "PLAYER有利" : cnt.B > cnt.P ? "BANKER有利" : "互角";
    el.innerHTML =
      '<div class="bar"><i class="op" style="width:' + pp + '%"></i><i class="ot" style="width:' + pt + '%"></i><i class="ob" style="width:' + pb + '%"></i></div>' +
      "<p>" + lead + " — P " + pp + "% / T " + pt + "% / B " + pb + "%　勝ちのアウツ <b>" + outs + "</b> / " + tot + "</p>";
  }

  function bacUpdateCands() {
    if (!bacSqHand) return;
    var card = (bacSqSlot.s === "p" ? bacSqHand.p : bacSqHand.b)[bacSqSlot.i];
    var actual = bacSig(card.r, bacRev, bacDir);
    var alive = {};
    for (var r = 1; r <= 13; r++) if (bacSig(r, bacRev, bacDir) === actual) alive[r] = true;''', 'odds関数')

rep('''    document.querySelectorAll("#bac-grid10 .bac-g10").forEach((d) => {
      d.classList.toggle("dead", !vals[+d.dataset.v]);
    });
  }''',
'''    document.querySelectorAll("#bac-grid10 .bac-g10").forEach((d) => {
      d.classList.toggle("dead", !vals[+d.dataset.v]);
    });
    bacUpdateOdds(alive);
  }''', 'odds呼び出し')

# ============ ⑩ JS: 絞り数字の加算演出 ============
rep('''    var f3 = document.createElement("div"); f3.className = "bac-face";
    bacBuildFace(f3, card.r, card.s, true); el3.appendChild(f3);
    bacSetTotals(hand, upMask);
    await bacSleep(420);
    await bacResolve(r);''',
'''    var f3 = document.createElement("div"); f3.className = "bac-face";
    bacBuildFace(f3, card.r, card.s, true); el3.appendChild(f3);
    bacSetTotals(hand, upMask);
    // 絞った数字が合計へ「+n」と加算される(第121弾)
    bacFloatAdd(slot.s, bacValue(card.r));
    await bacSleep(720);
    await bacResolve(r);''', '加算演出呼び出し')

rep('''  async function bacResolve(r) {''',
'''  /** 絞り札の値が合計へ加算される様子を見せる(+n の浮き上がり + 合計のパルス) */
  function bacFloatAdd(side, v) {
    var lab = document.querySelector(".bac-side." + side + " .bac-lab");
    if (!lab) return;
    var t = lab.querySelector(".t");
    if (t) { t.classList.remove("pulse"); void t.offsetWidth; t.classList.add("pulse"); }
    var f = document.createElement("div");
    f.className = "bac-addfloat";
    f.textContent = "+" + v;
    lab.appendChild(f);
    setTimeout(() => f.remove(), 1100);
  }

  async function bacResolve(r) {''', 'bacFloatAdd')

# ============ ⑪ JS: 勝者点滅 → ファンファーレ+拍手+勝ち額 ============
rep('''  async function bacResolve(r) {
    var hand = r.hand;
    var net = r.won - r.stake;
    bacRoad.push(hand.res);
    bacRenderRoad();
    var names = { P: "PLAYER", B: "BANKER", T: "TIE" };
    var th = document.getElementById("bac-th"), ts = document.getElementById("bac-ts"), tb = document.getElementById("bac-tb");
    th.textContent = names[hand.res] + "  " + hand.pt + " - " + hand.bt;
    ts.className = "s " + (net > 0 ? "plus" : net < 0 ? "minus" : "");
    ts.textContent = (net > 0 ? "+" : "") + fmt(net);
    tb.textContent = r.bonus > 0 ? "読み的中ボーナス +" + fmt(r.bonus) : (r.declare ? "読みは外れ" : "");
    document.getElementById("bac-toast").classList.add("on");
    var betKey = hand.res === "P" ? "p" : hand.res === "B" ? "b" : "tie";
    var sp = document.querySelector('.bac-spot[data-s="' + betKey + '"]');
    if (sp && r.bets[betKey] > 0) sp.classList.add("wingl");
    if (net > 0) { bacBlip(784, 0.12, "triangle", 0.18); setTimeout(() => bacBlip(1046, 0.2, "triangle", 0.15), 110); bacBuzz([10, 50, 10, 50, 20]); }
    else if (net < 0) { bacBlip(196, 0.28, "sine", 0.14); }

    // 精算が見えてから残高の凍結を解く(ここまでヘッダーは控除後のまま)
    slotBalFreeze = null;
    renderBalance();
    bacSetBal(typeof r.balance === "number" ? r.balance : balance);

    await bacSleep(1600);''',
'''  async function bacResolve(r) {
    var hand = r.hand;
    var net = r.won - r.stake;
    bacRoad.push(hand.res);
    bacRenderRoad();
    var names = { P: "PLAYER", B: "BANKER", T: "TIE" };

    // まず勝者側を点滅させる(オーナー指定の順: 点滅 → ファンファーレで祝う)
    var sideEl = hand.res === "P" ? document.querySelector(".bac-side.p")
      : hand.res === "B" ? document.querySelector(".bac-side.b") : null;
    if (sideEl) {
      sideEl.classList.add("winblink");
      setTimeout(() => sideEl.classList.remove("winblink"), 1700);
    }
    var betKey = hand.res === "P" ? "p" : hand.res === "B" ? "b" : "tie";
    var sp = document.querySelector('.bac-spot[data-s="' + betKey + '"]');
    if (sp && r.bets[betKey] > 0) sp.classList.add("wingl");
    await bacSleep(1650);

    var th = document.getElementById("bac-th"), ts = document.getElementById("bac-ts"), tb = document.getElementById("bac-tb");
    var tw = document.getElementById("bac-tw");
    th.textContent = names[hand.res] + "  " + hand.pt + " - " + hand.bt;
    tw.textContent = net > 0 ? "WIN +" + fmt(net) : "";
    ts.className = "s " + (net > 0 ? "plus" : net < 0 ? "minus" : "");
    ts.textContent = (net > 0 ? "+" : "") + fmt(net);
    tb.textContent = r.bonus > 0 ? "読み的中ボーナス +" + fmt(r.bonus) : (r.declare ? "読みは外れ" : "");
    document.getElementById("bac-toast").classList.add("on");
    if (net > 0) {
      // 勝ち: ポーカーと同じ拍手・歓声 + スロットのファンファーレで祝う
      try { play("applause"); } catch (e) {}
      try { fanfarePlay(); } catch (e) {}
      bacBuzz([10, 50, 10, 50, 20]);
    } else if (net < 0) {
      bacBlip(196, 0.28, "sine", 0.14);
    }

    // 精算が見えてから残高の凍結を解く(ここまでヘッダーは控除後のまま)
    slotBalFreeze = null;
    renderBalance();
    bacSetBal(typeof r.balance === "number" ? r.balance : balance);

    await bacSleep(net > 0 ? 2700 : 1600);''', '祝勝シーケンス')

# ============ ⑫ 画像データ流し込み ============
rep('"__TGREEN__"', '"' + uri('t_green.webp') + '"', 'tbl green')
rep('"__TRED__"', '"' + uri('t_red.webp') + '"', 'tbl red')
rep('"__TBLUE__"', '"' + uri('t_blue.webp') + '"', 'tbl blue')
rep('"__TNOIR__"', '"' + uri('t_noir.webp') + '"', 'tbl noir')
rep('"__BKCLASSIC__"', '"' + classic + '"', 'back classic')
rep('"__BKRED__"', '"' + uri('bk_red.webp') + '"', 'back red')
rep('"__BKBLUE__"', '"' + uri('bk_blue.webp') + '"', 'back blue')
rep('"__BKNOIR__"', '"' + uri('bk_noir.webp') + '"', 'back noir')

# 使わなくなった felt(第118弾) のデータはもう CSS に無いことを確認
assert 'center 42%/cover' not in s
open(p, 'w', encoding='utf8').write(s)
print('DONE')
