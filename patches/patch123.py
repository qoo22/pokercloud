# -*- coding: utf-8 -*-
import sys, base64, os
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

# ============ ① 背景: 真っ黒 → 生成したカジノ内観(暗幕オーバーレイで可読性維持) ============
rep('''  #bac-root{max-width:560px;margin:0 auto;border-radius:18px;overflow:hidden;
    border:1px solid rgba(217,180,95,.4);
    background:linear-gradient(180deg,#171d25 0%,#10151c 100%);
    box-shadow:0 18px 50px rgba(0,0,0,.5), inset 0 0 0 1px rgba(0,0,0,.4);
    padding:14px 14px 16px}''',
'''  #bac-root{max-width:560px;margin:0 auto;border-radius:18px;overflow:hidden;
    border:1px solid rgba(217,180,95,.4);
    background:
      linear-gradient(180deg,rgba(13,16,22,.42) 0%,rgba(13,16,22,.62) 46%,rgba(13,16,22,.9) 78%),
      url(__ROOM__) center 30%/cover no-repeat #10151c;
    box-shadow:0 18px 50px rgba(0,0,0,.5), inset 0 0 0 1px rgba(0,0,0,.4);
    padding:14px 14px 16px}''', 'カジノ内観背景')

# 見出しと大路はうっすら板を敷いて読みやすく
rep('''  .bac-road{height:58px;border:1px solid #2e3844;border-radius:8px;
    background:rgba(0,0,0,.35);overflow-x:auto;overflow-y:hidden;padding:3px;margin-bottom:8px}''',
'''  .bac-road{height:58px;border:1px solid rgba(46,56,68,.9);border-radius:8px;
    background:rgba(10,13,18,.62);overflow-x:auto;overflow-y:hidden;padding:3px;margin-bottom:8px}''', '大路の板')

# ============ ② チップボタンを生成画像に(選択式へ戻す) ============
rep('''  /* 実物風のチップ(縁のストライプ+内円)。額面はチップの上に重ねる */
  .bac-chip{flex:0 1 58px;aspect-ratio:1;max-width:58px;border-radius:50%;position:relative;cursor:pointer;
    border:none;padding:0;color:#fff;font-weight:800;font-size:10px;font-variant-numeric:tabular-nums;
    box-shadow:0 3px 8px rgba(0,0,0,.5);transition:.12s}
  .bac-chip::before{content:"";position:absolute;inset:16%;border-radius:50%;
    background:rgba(255,255,255,.16);border:1.5px dashed rgba(255,255,255,.5)}
  .bac-chip b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    text-shadow:0 1px 2px rgba(0,0,0,.7);padding:0 6px;overflow:hidden}''',
'''  /* 生成画像のチップ(Z-Image)。額面は上に重ねる */
  .bac-chip{flex:0 1 58px;aspect-ratio:1;max-width:58px;border-radius:50%;position:relative;cursor:pointer;
    border:none;padding:0;color:#fff;font-weight:800;font-size:10px;font-variant-numeric:tabular-nums;
    background-size:cover;background-position:center;background-color:transparent;
    filter:drop-shadow(0 3px 6px rgba(0,0,0,.55));transition:.12s}
  .bac-chip b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    text-shadow:0 1px 3px rgba(0,0,0,.95),0 0 6px rgba(0,0,0,.8);padding:0 6px;overflow:hidden}''', 'チップ画像CSS')

# ============ ③ スポットの上にチップが積み上がる ============
rep('''  .bac-spot .amt{font-size:12px;font-weight:800;margin-top:4px;color:#d9b45f;min-height:15px;font-variant-numeric:tabular-nums}''',
'''  .bac-spot .amt{font-size:12px;font-weight:800;margin-top:4px;color:#d9b45f;min-height:15px;font-variant-numeric:tabular-nums}
  /* ベットしたチップの山(スポット右下に積む) */
  .bac-pile{position:absolute;right:7px;bottom:8px;width:26px;height:64px;pointer-events:none}
  .bac-pile img{position:absolute;left:0;width:26px;height:26px;
    filter:drop-shadow(0 2px 3px rgba(0,0,0,.6));animation:bacvChipIn .16s cubic-bezier(.2,1.5,.4,1)}
  .bac-pile i{position:absolute;left:50%;transform:translateX(-50%);bottom:-2px;font-style:normal;
    font-size:9px;font-weight:800;color:#f2e3b8;text-shadow:0 1px 3px #000}''', 'スポット積みCSS')

rep('''    <div class="bac-spot p" data-s="p"><div class="nm">PLAYER</div><div class="od">1 : 1</div><div class="amt" id="bac-ap"></div></div>
    <div class="bac-spot t" data-s="tie"><div class="nm">TIE</div><div class="od">8 : 1</div><div class="amt" id="bac-at"></div></div>
    <div class="bac-spot b" data-s="b"><div class="nm">BANKER</div><div class="od">0.95 : 1</div><div class="amt" id="bac-ab"></div></div>''',
'''    <div class="bac-spot p" data-s="p"><div class="nm">PLAYER</div><div class="od">1 : 1</div><div class="amt" id="bac-ap"></div><div class="bac-pile" id="bac-pile-p"></div></div>
    <div class="bac-spot t" data-s="tie"><div class="nm">TIE</div><div class="od">8 : 1</div><div class="amt" id="bac-at"></div><div class="bac-pile" id="bac-pile-tie"></div></div>
    <div class="bac-spot b" data-s="b"><div class="nm">BANKER</div><div class="od">0.95 : 1</div><div class="amt" id="bac-ab"></div><div class="bac-pile" id="bac-pile-b"></div></div>''', 'スポット積みDOM')

# ============ ④ JS: チップ画像定数・スポット積みの描画 ============
rep('''  var BAC_TBLS = {''',
'''  /** 生成したチップ画像(小さい額 → 大きい額の順で色が変わる) */
  var BAC_CHIP_IMGS = ["__CHIP0__", "__CHIP1__", "__CHIP2__", "__CHIP3__", "__CHIP4__", "__CHIP5__"];
  var BAC_TBLS = {''', 'チップ画像定数')

rep('''  var bacRoad = [];               // 'P'|'B'|'T' の履歴(セッション内)''',
'''  var bacRoad = [];               // 'P'|'B'|'T' の履歴(セッション内)
  /** スポットに積んだチップ(色インデックスの列)。表示専用 */
  var bacStack = { p: [], b: [], tie: [] };''', 'スタック状態')

rep('''  function bacRenderBets() {''',
'''  /** 額をチップに分解して色インデックス列にする(スポットの山の表示用) */
  function bacDecompose(amount) {
    var lad = bacLadder();
    var out = [];
    var rest = amount;
    for (var i = lad.length - 1; i >= 0 && out.length < 30; i--) {
      var n = Math.floor(rest / lad[i]);
      for (var k = 0; k < n && out.length < 30; k++) out.push(Math.min(i, 5));
      rest -= n * lad[i];
    }
    return out.reverse();       // 大きい額のチップが下
  }
  /** ベットしたチップの山をスポットの上に描く(押すたび積み上がる) */
  function bacRenderStacks() {
    var m = { p: "bac-pile-p", b: "bac-pile-b", tie: "bac-pile-tie" };
    for (var k in m) {
      var el = document.getElementById(m[k]);
      if (!el) continue;
      var discs = bacStack[k];
      var html = "";
      var show = Math.min(discs.length, 9);
      for (var d = 0; d < show; d++) {
        html += '<img src="' + BAC_CHIP_IMGS[discs[d]] + '" style="bottom:' + (8 + d * 5) + 'px" alt="">';
      }
      if (discs.length > 9) html += "<i>\\u00d7" + discs.length + "</i>";
      if (el.__h !== html) { el.innerHTML = html; el.__h = html; }
    }
  }

  function bacRenderBets() {''', 'スタック描画関数')

rep('''    var deal = document.getElementById("bac-deal");
    if (deal) deal.disabled = bacDealing || (bacBets.p + bacBets.b + bacBets.tie) < BAC_MIN_STAKE;''',
'''    var deal = document.getElementById("bac-deal");
    if (deal) deal.disabled = bacDealing || (bacBets.p + bacBets.b + bacBets.tie) < BAC_MIN_STAKE;
    bacRenderStacks();
    bacSyncSlider();   // ベットを置くと残りが減る → スライダーの最大値も追随''', 'renderBetsで同期')

# ============ ⑤ JS: チップ描画を画像に、クリックは選択式 ============
rep('''    var chipsEl = document.getElementById("bac-chips");
    chipsEl.innerHTML = lad.map((v, i) =>
      `<button class="bac-chip c${Math.min(i, 5)}" data-v="${v}" data-c="${Math.min(i, 5)}"><b>${fmt(v)}</b></button>`).join("");''',
'''    var chipsEl = document.getElementById("bac-chips");
    chipsEl.innerHTML = lad.map((v, i) =>
      `<button class="bac-chip" data-v="${v}" style="background-image:url(${BAC_CHIP_IMGS[Math.min(i, 5)]})"><b>${fmt(v)}</b></button>`).join("");''', 'チップ画像描画')

rep('''    // チップは「連打で積む」: 押すたびにその額が上乗せされ、縦バーに同色のチップが積まれる
    document.getElementById("bac-chips").addEventListener("click", (e) => {
      var b = e.target.closest(".bac-chip");
      if (!b || bacDealing) return;
      bacAudioInit();
      var mx = Math.max(BAC_MIN_STAKE, Math.floor(balance) || BAC_MIN_STAKE);
      var base = bacChipFresh ? 0 : bacChip;   // 直前がドラッグ/リセットなら積み直し
      bacChipFresh = false;
      bacChip = Math.max(BAC_MIN_STAKE, Math.min(mx, base + (+b.dataset.v)));
      bacSyncSlider();
      try { play("chipTick"); } catch (e2) {}
    });''',
'''    // チップは額面の選択。スポットを押すたびにその額が置かれ、山が積み上がる
    document.getElementById("bac-chips").addEventListener("click", (e) => {
      var b = e.target.closest(".bac-chip");
      if (!b || bacDealing) return;
      bacAudioInit();
      bacChip = +b.dataset.v;
      document.querySelectorAll(".bac-chip").forEach((x) => x.classList.toggle("sel", +x.dataset.v === bacChip));
      bacSyncSlider();
      try { play("chipTick"); } catch (e2) {}
    });''', 'チップ選択式')

# ============ ⑥ JS: スポットに置くと山が積まれる+スライダー最大が残高連動 ============
rep('''        // 額は必ずここでクランプする(残高が変わった直後でも置きすぎない)
        var add = Math.floor(Math.min(bacChip, bal - total));
        if (add < 1) { bacMsg("チップが足りません"); return; }
        bacBets[k] += add;
        bacSyncSlider();''',
'''        // 額は必ずここでクランプする(残高が変わった直後でも置きすぎない)
        var add = Math.floor(Math.min(bacChip, bal - total));
        if (add < 1) { bacMsg("チップが足りません"); return; }
        bacBets[k] += add;
        // 置いたぶんのチップがスポットの上に積み上がる
        var discs = bacDecompose(add);
        for (var di = 0; di < discs.length; di++) bacStack[k].push(discs[di]);
        try { play("chipTick"); } catch (e2) {}''', 'スポットに積む')

# クリア/リピート/立て直し/精算で山も揃える
rep('''      bacBets = { p: 0, b: 0, tie: 0 }; bacRenderBets(); bacMsg("チップを選んでベット");''',
'''      bacBets = { p: 0, b: 0, tie: 0 };
      bacStack = { p: [], b: [], tie: [] };
      bacRenderBets(); bacMsg("チップを選んでベット額を作る → エリアをタップ");''', 'クリアで山も')

rep('''      bacBets = { p: bacLast.p, b: bacLast.b, tie: bacLast.tie };
      bacRenderBets(); bacMsg("DEAL で配札");''',
'''      bacBets = { p: bacLast.p, b: bacLast.b, tie: bacLast.tie };
      bacStack = { p: bacDecompose(bacLast.p), b: bacDecompose(bacLast.b), tie: bacDecompose(bacLast.tie) };
      bacRenderBets(); bacMsg("DEAL で配札");''', 'リピートで山再現')

rep('''    bacResult = null;
    bacDealing = false;
    bacBets = { p: 0, b: 0, tie: 0 };
    bacDeclare = null;
    bacRenderBets();
    bacMsg("リピートで同じベットを再投入");''',
'''    bacResult = null;
    bacDealing = false;
    bacBets = { p: 0, b: 0, tie: 0 };
    bacStack = { p: [], b: [], tie: [] };
    bacDeclare = null;
    bacRenderBets();
    bacMsg("リピートで同じベットを再投入");''', '精算で山も')

# ============ ⑦ JS: スライダーは「残り(残高-ベット済み)」が最大。バー内の積みは廃止 ============
rep('''  /** 縦スライダーの fill / 値ピル / チップ積みを bacChip に合わせる */
  var bacChipFresh = true;      // 次のチップ連打を積み直しから始めるか
  var bacTickAt = 0;
  function bacSyncSlider() {
    var bar = document.getElementById("bacv");
    if (!bar) return;
    var mn = BAC_MIN_STAKE, mx = Math.max(mn + 1, Math.floor(balance) || mn + 1);
    var t = (Math.log(Math.max(mn, Math.min(mx, bacChip))) - Math.log(mn)) / (Math.log(mx) - Math.log(mn));
    var fill = document.getElementById("bacv-fill");
    if (fill) fill.style.height = (t * 100).toFixed(1) + "%";
    var pill = document.getElementById("bacv-pill");
    if (pill) {
      pill.textContent = fmt(bacChip);
      pill.style.bottom = "calc(" + (t * 100).toFixed(1) + "% - 12px)";
    }
    var capB = document.getElementById("bacv-max");
    if (capB) capB.textContent = fmt(Math.max(mn, Math.floor(balance) || mn));
    var mnEl = document.getElementById("bacv-min");
    if (mnEl) mnEl.textContent = fmt(mn);
    // 額をチップに分解して、同色のチップが下から積み上がる(ポーカーと同じ見せ方)
    var stack = document.getElementById("bacv-stack");
    if (stack) {
      var lad = bacLadder();
      var discs = [];
      var rest = bacChip;
      for (var i = lad.length - 1; i >= 0 && discs.length < 18; i--) {
        var n = Math.floor(rest / lad[i]);
        for (var k = 0; k < n && discs.length < 18; k++) discs.push(Math.min(i, 5));
        rest -= n * lad[i];
      }
      discs.reverse();          // 大きい額のチップが下
      var html = "";
      for (var d = 0; d < discs.length; d++) {
        html += '<i class="bacv-chip c' + discs[d] + '" style="bottom:' + (16 + d * 8) + 'px;margin-left:' + (((d * 7) % 5) - 2) + 'px"></i>';
      }
      if (stack.__n !== html) {
        var was = stack.childElementCount;
        stack.innerHTML = html;
        stack.__n = html;
        var now = Date.now();
        if (stack.childElementCount !== was && now - bacTickAt > 45) {
          bacTickAt = now;
          try { play("chipTick"); } catch (e) {}
        }
      }
    }
  }''',
'''  /** ベット済みを除いた「置ける残り」。スライダーの最大値はこれに追随する */
  function bacRemaining() {
    var bal = slotBalFreeze != null ? slotBalFreeze : balance;
    var placed = bacBets.p + bacBets.b + bacBets.tie;
    return Math.max(0, Math.floor((bal || 0) - placed));
  }
  /** 縦スライダー(細かい額の指定用)の fill / 値ピル / MAX表示を合わせる */
  function bacSyncSlider() {
    var bar = document.getElementById("bacv");
    if (!bar) return;
    var mn = BAC_MIN_STAKE, mx = Math.max(mn + 1, bacRemaining() || mn + 1);
    if (bacChip > mx) bacChip = mx;   // ベットを置いた直後は残りまで自動で縮む
    var t = (Math.log(Math.max(mn, Math.min(mx, bacChip))) - Math.log(mn)) / (Math.log(mx) - Math.log(mn));
    var fill = document.getElementById("bacv-fill");
    if (fill) fill.style.height = (t * 100).toFixed(1) + "%";
    var pill = document.getElementById("bacv-pill");
    if (pill) {
      pill.textContent = fmt(bacChip);
      pill.style.bottom = "calc(" + (t * 100).toFixed(1) + "% - 12px)";
    }
    var capB = document.getElementById("bacv-max");
    if (capB) capB.textContent = fmt(Math.max(mn, bacRemaining() || mn));
    var mnEl = document.getElementById("bacv-min");
    if (mnEl) mnEl.textContent = fmt(mn);
  }''', 'スライダー残り連動')

# ドラッグとMAXも「残り」を上限に
rep('''    var bacVslFromPtr = (e) => {
      var rc = barEl.getBoundingClientRect();
      var t = bacClamp(1 - (e.clientY - rc.top) / Math.max(40, rc.height), 0, 1);
      var mn = BAC_MIN_STAKE, mx = Math.max(mn, Math.floor(balance) || mn);
      var v = Math.round(Math.exp(Math.log(mn) + (Math.log(mx) - Math.log(mn)) * t));
      var mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(v)) - 1));
      bacChip = Math.max(mn, Math.min(mx, Math.round(v / mag) * mag));
      bacChipFresh = true;
      bacSyncSlider();
    };''',
'''    var bacVslFromPtr = (e) => {
      var rc = barEl.getBoundingClientRect();
      var t = bacClamp(1 - (e.clientY - rc.top) / Math.max(40, rc.height), 0, 1);
      var mn = BAC_MIN_STAKE, mx = Math.max(mn, bacRemaining() || mn);
      var v = Math.round(Math.exp(Math.log(mn) + (Math.log(mx) - Math.log(mn)) * t));
      var mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(v)) - 1));
      bacChip = Math.max(mn, Math.min(mx, Math.round(v / mag) * mag));
      document.querySelectorAll(".bac-chip").forEach((x) => x.classList.toggle("sel", +x.dataset.v === bacChip));
      bacSyncSlider();
    };''', 'ドラッグ上限=残り')

rep('''      if (e.target.closest("#bacv-cap")) {
        bacChip = Math.max(BAC_MIN_STAKE, Math.floor(balance) || BAC_MIN_STAKE);
        bacChipFresh = true;
        bacSyncSlider();
        try { play("chipTick"); } catch (e2) {}
        return;
      }
      if (e.target.closest("#bacv-min")) {
        bacChip = BAC_MIN_STAKE; bacChipFresh = true; bacSyncSlider(); return;
      }''',
'''      if (e.target.closest("#bacv-cap")) {
        bacChip = Math.max(BAC_MIN_STAKE, bacRemaining() || BAC_MIN_STAKE);
        bacSyncSlider();
        try { play("chipTick"); } catch (e2) {}
        return;
      }
      if (e.target.closest("#bacv-min")) {
        bacChip = BAC_MIN_STAKE; bacSyncSlider(); return;
      }''', 'MAX=残り')

# ============ ⑧ 画像データ流し込み ============
rep('__ROOM__', uri('room.webp'), 'room')
for i in range(6):
    rep('"__CHIP%d__"' % i, '"' + uri('chip%d.webp' % i) + '"', 'chip%d' % i)

open(p, 'w', encoding='utf8').write(s)
print('DONE')
