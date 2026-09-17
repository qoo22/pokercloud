# -*- coding: utf-8 -*-
import sys
p = sys.argv[1]
s = open(p, encoding='utf8').read()
def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)

# ============ ① 絵札は絞り中も「絵柄がめくれていく」(実物と同じ) ============
rep('''    var body = "";
    if (rank >= 11 && showIndex) {
      // 絵札(表向き): 二重罫の内枠 + 双頭の人物画(生成PNG)。枠色でスートの赤黒を示す
      var cid = "bacc" + (++bacSvgSeq);
      var im = BAC_COURT[rank];
      body +=
        '<defs><clipPath id="' + cid + '"><rect x="53" y="57" width="144" height="117"/></clipPath></defs>' +
        '<rect x="46" y="50" width="158" height="250" rx="4" fill="none" stroke="' + ink + '" stroke-width="2"/>' +
        '<rect x="50" y="54" width="150" height="242" rx="3" fill="none" stroke="#d9b45f" stroke-width="1"/>' +
        '<line x1="50" y1="175" x2="200" y2="175" stroke="#d9b45f" stroke-width="1"/>' +
        '<image href="' + im + '" x="53" y="55" width="144" height="130" preserveAspectRatio="xMidYMin meet" clip-path="url(#' + cid + ')"/>' +
        '<g transform="rotate(180 125 175)"><image href="' + im + '" x="53" y="55" width="144" height="130" preserveAspectRatio="xMidYMin meet" clip-path="url(#' + cid + ')"/></g>';
    } else {
      // 数札 / 絞り中の絵札。絞り中の絵札は四隅ピップだけにして、
      // 候補絞り込み(bacSig)が見ている情報と画面が完全に一致するようにする
      var cells = rank >= 11 ? BAC_FACE_CELLS : BAC_CELLS[rank];
      var size = rank === 1 ? 105 : 56;
      for (var i = 0; i < cells.length; i++) {
        var c = cells[i][0], rw = cells[i][1];
        body += pip(BAC_COLS[c] * 250, BAC_ROWS[rw] * 350, size, BAC_ROWS[rw] > 0.55);
      }
    }''',
'''    var body = "";
    if (rank >= 11) {
      // 絵札は常に 二重罫の内枠+双頭の人物画。絞りではこの絵柄がカバーの下から
      // めくれていく(実物と同じ)。コーナーの数字だけが showIndex まで隠れる
      var cid = "bacc" + (++bacSvgSeq);
      var im = BAC_COURT[rank];
      body +=
        '<defs><clipPath id="' + cid + '"><rect x="53" y="57" width="144" height="117"/></clipPath></defs>' +
        '<rect x="46" y="50" width="158" height="250" rx="4" fill="none" stroke="' + ink + '" stroke-width="2"/>' +
        '<rect x="50" y="54" width="150" height="242" rx="3" fill="none" stroke="#d9b45f" stroke-width="1"/>' +
        '<line x1="50" y1="175" x2="200" y2="175" stroke="#d9b45f" stroke-width="1"/>' +
        '<image href="' + im + '" x="53" y="55" width="144" height="130" preserveAspectRatio="xMidYMin meet" clip-path="url(#' + cid + ')"/>' +
        '<g transform="rotate(180 125 175)"><image href="' + im + '" x="53" y="55" width="144" height="130" preserveAspectRatio="xMidYMin meet" clip-path="url(#' + cid + ')"/></g>';
    } else {
      var cells = BAC_CELLS[rank];
      var size = rank === 1 ? 105 : 56;
      for (var i = 0; i < cells.length; i++) {
        var c = cells[i][0], rw = cells[i][1];
        body += pip(BAC_COLS[c] * 250, BAC_ROWS[rw] * 350, size, BAC_ROWS[rw] > 0.55);
      }
    }''', '絵札の絞り描写')

# bacSig: 絵札は内枠(x=46/250, y下端=300/350)が見えた時点で「絵札」と割れる
rep('''  /** めくれ量 rev のとき、rank のカードで見えているピップの署名 */
  function bacSig(rank, rev, dir) {
    var cells = rank >= 11 ? BAC_FACE_CELLS : BAC_CELLS[rank];
    var out = [];''',
'''  /** めくれ量 rev のとき、rank のカードで見えている情報の署名 */
  function bacSig(rank, rev, dir) {
    if (rank >= 11) {
      // 絵札は内枠の縁(横絞り: x=46/250、縦絞り: y=300/350)が見えた瞬間に
      // 「絵札だ」と分かる(画面の見た目と完全に同じ条件で候補を割る)
      var vis = dir === "h" ? rev >= 0.184 : rev >= 0.143;
      return vis ? "COURT" : "";
    }
    var cells = BAC_CELLS[rank];
    var out = [];''', 'bacSig絵札対応')

# ============ ② 横スライダー → ポーカー式の縦スライダー ============
rep('''  <div class="bac-chips" id="bac-chips"></div>
  <div class="bac-sliderrow">
    <input type="range" id="bac-slider" min="0" max="1000" value="0">
    <b id="bac-chipamt">1,000</b>
  </div>
  <div class="bac-designs" id="bac-designs">''',
'''  <div class="bac-chips" id="bac-chips"></div>
  <div class="bac-designs" id="bac-designs">''', '横スライダー撤去')

# ベット操作帯をグリッド化して右に縦スライダー
rep('''  <div class="bac-msg" id="bac-msg">チップを選んでベット</div>
  <div class="bac-spots">''',
'''  <div class="bac-msg" id="bac-msg">チップを連打でベット額を積む → エリアをタップ</div>
  <div class="bac-betzone">
  <div class="bac-betleft">
  <div class="bac-spots">''', 'betzone開始')

rep('''  <div class="bac-row">
    <button class="bac-btn ghost" id="bac-clear">クリア</button>
    <button class="bac-btn ghost" id="bac-repeat">リピート</button>
    <button class="bac-btn main" id="bac-deal">DEAL</button>
  </div>
</div>''',
'''  <div class="bac-row">
    <button class="bac-btn ghost" id="bac-clear">クリア</button>
    <button class="bac-btn ghost" id="bac-repeat">リピート</button>
    <button class="bac-btn main" id="bac-deal">DEAL</button>
  </div>
  </div>
  <div class="bacv-col">
    <div class="bacv" id="bacv">
      <div class="bacv-fill" id="bacv-fill"></div>
      <div class="bacv-stack" id="bacv-stack"></div>
      <div class="bacv-cap" id="bacv-cap">MAX<b id="bacv-max"></b></div>
      <div class="bacv-min" id="bacv-min">1,000</div>
      <div class="bacv-pill" id="bacv-pill">1,000</div>
    </div>
  </div>
  </div>
</div>''', 'betzone終了+縦スライダー')

# ============ ③ CSS ============
rep('''  .bac-sliderrow{display:flex;align-items:center;gap:10px;margin-bottom:9px;padding:0 2px}
  .bac-sliderrow input{flex:1;accent-color:#d9b45f}
  .bac-sliderrow b{flex:0 0 auto;min-width:86px;text-align:right;color:#d9b45f;font-size:13px;
    font-variant-numeric:tabular-nums}''',
'''  .bac-betzone{display:grid;grid-template-columns:1fr 58px;gap:10px;align-items:stretch}
  .bac-betleft{min-width:0}
  /* ポーカーのレイズと同じ縦スライダー: ドラッグで額、チップが積み上がる */
  .bacv-col{position:relative}
  .bacv{position:absolute;inset:0;min-height:240px;border-radius:18px;touch-action:none;cursor:pointer;
    background:linear-gradient(180deg,rgba(217,180,95,.38),rgba(96,66,22,.5) 40%,rgba(22,17,8,.9));
    border:1px solid rgba(217,180,95,.55);
    box-shadow:inset 0 2px 8px rgba(0,0,0,.45),0 4px 18px rgba(0,0,0,.5)}
  .bacv-fill{position:absolute;left:3px;right:3px;bottom:3px;border-radius:15px;height:0%;
    background:linear-gradient(180deg,#f2df9a,#d9b45f 55%,#8a6b25);
    box-shadow:0 0 12px rgba(217,180,95,.45);pointer-events:none}
  .bacv-stack{position:absolute;inset:0;pointer-events:none;overflow:hidden;border-radius:18px;z-index:1}
  .bacv-chip{position:absolute;left:50%;width:34px;height:10px;border-radius:50%;
    transform:translateX(-50%);border:1px solid rgba(255,255,255,.4);
    box-shadow:0 1px 2px rgba(0,0,0,.6);animation:bacvChipIn .16s cubic-bezier(.2,1.5,.4,1)}
  @keyframes bacvChipIn{from{transform:translateX(-50%) translateY(-10px)}to{transform:translateX(-50%)}}
  .bacv-chip.c0{background:#3a6bb0}.bacv-chip.c1{background:#b0403a}.bacv-chip.c2{background:#2e7d55}
  .bacv-chip.c3{background:#31313b}.bacv-chip.c4{background:#7a3f9e}.bacv-chip.c5{background:#b8901c}
  .bacv-cap{position:absolute;top:-1px;left:-1px;right:-1px;z-index:3;text-align:center;
    font-size:9px;font-weight:800;letter-spacing:.04em;color:#241a05;cursor:pointer;
    background:linear-gradient(180deg,#f2df9a,#d9a53d);border-radius:17px 17px 8px 8px;padding:4px 2px 5px}
  .bacv-cap b{display:block;font-size:10px;letter-spacing:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .bacv-min{position:absolute;bottom:5px;left:0;right:0;z-index:3;text-align:center;font-size:9px;
    font-weight:700;color:rgba(255,255,255,.85);cursor:pointer}
  .bacv-pill{position:absolute;right:calc(100% + 6px);bottom:0;z-index:4;pointer-events:none;
    background:#171d25;border:1px solid #d9b45f;color:#f2e3b8;border-radius:10px;padding:4px 9px;
    font-size:11.5px;font-weight:800;white-space:nowrap;font-variant-numeric:tabular-nums;
    box-shadow:0 2px 8px rgba(0,0,0,.5)}''', '縦スライダーCSS')

rep('''  .bac-chip.c4{background:conic-gradient(#e9e6da 0 25deg,#7a3f9e 25deg 65deg,#e9e6da 65deg 115deg,#7a3f9e 115deg 155deg,#e9e6da 155deg 205deg,#7a3f9e 205deg 245deg,#e9e6da 245deg 295deg,#7a3f9e 295deg 335deg,#e9e6da 335deg 360deg)}''',
'''  .bac-chip.c4{background:conic-gradient(#e9e6da 0 25deg,#7a3f9e 25deg 65deg,#e9e6da 65deg 115deg,#7a3f9e 115deg 155deg,#e9e6da 155deg 205deg,#7a3f9e 205deg 245deg,#e9e6da 245deg 295deg,#7a3f9e 295deg 335deg,#e9e6da 335deg 360deg)}
  .bac-chip.c5{background:conic-gradient(#e9e6da 0 25deg,#b8901c 25deg 65deg,#e9e6da 65deg 115deg,#b8901c 115deg 155deg,#e9e6da 155deg 205deg,#b8901c 205deg 245deg,#e9e6da 245deg 295deg,#b8901c 295deg 335deg,#e9e6da 335deg 360deg)}
  .bac-chip:active{transform:translateY(-3px) scale(1.06)}''', 'チップc5+押下')

# ============ ④ JS: ラダー6段(残高比例)・チップ連打で加算 ============
rep('''    var out = [];
    var mults = [1, 5, 25, 100, 500];''',
'''    var out = [];
    var mults = [1, 5, 25, 100, 500, 2500];''', 'ラダー6段')

rep('''    var lad = bacLadder();
    if (bacChip === 0 || lad.indexOf(bacChip) < 0) bacChip = lad[Math.min(1, lad.length - 1)];
    var chipsEl = document.getElementById("bac-chips");
    chipsEl.innerHTML = lad.map((v, i) =>
      `<button class="bac-chip c${i % 5}${v === bacChip ? " sel" : ""}" data-v="${v}"><b>${fmt(v)}</b></button>`).join("");
    bacSyncSlider();
    bacApplyDesign();''',
'''    var lad = bacLadder();
    if (!bacChip || bacChip < BAC_MIN_STAKE) bacChip = lad[0];
    bacChip = Math.min(bacChip, Math.max(BAC_MIN_STAKE, Math.floor(balance) || BAC_MIN_STAKE));
    var chipsEl = document.getElementById("bac-chips");
    chipsEl.innerHTML = lad.map((v, i) =>
      `<button class="bac-chip c${Math.min(i, 5)}" data-v="${v}" data-c="${Math.min(i, 5)}"><b>${fmt(v)}</b></button>`).join("");
    bacSyncSlider();
    bacApplyDesign();''', 'chip描画(選択制廃止)')

rep('''    document.getElementById("bac-chips").addEventListener("click", (e) => {
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
    });''',
'''    // チップは「連打で積む」: 押すたびにその額が上乗せされ、縦バーに同色のチップが積まれる
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
    });
    // 縦スライダー(ポーカーのレイズと同じ操作系): ドラッグで額、上端タップでMAX
    var barEl = document.getElementById("bacv");
    var bacVslDrag = false;
    var bacVslFromPtr = (e) => {
      var rc = barEl.getBoundingClientRect();
      var t = bacClamp(1 - (e.clientY - rc.top) / Math.max(40, rc.height), 0, 1);
      var mn = BAC_MIN_STAKE, mx = Math.max(mn, Math.floor(balance) || mn);
      var v = Math.round(Math.exp(Math.log(mn) + (Math.log(mx) - Math.log(mn)) * t));
      var mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(v)) - 1));
      bacChip = Math.max(mn, Math.min(mx, Math.round(v / mag) * mag));
      bacChipFresh = true;
      bacSyncSlider();
    };
    barEl.addEventListener("pointerdown", (e) => {
      if (bacDealing) return;
      bacAudioInit();
      if (e.target.closest("#bacv-cap")) {
        bacChip = Math.max(BAC_MIN_STAKE, Math.floor(balance) || BAC_MIN_STAKE);
        bacChipFresh = true;
        bacSyncSlider();
        try { play("chipTick"); } catch (e2) {}
        return;
      }
      if (e.target.closest("#bacv-min")) {
        bacChip = BAC_MIN_STAKE; bacChipFresh = true; bacSyncSlider(); return;
      }
      bacVslDrag = true;
      try { barEl.setPointerCapture(e.pointerId); } catch (e2) {}
      bacVslFromPtr(e);
      e.preventDefault();
    });
    barEl.addEventListener("pointermove", (e) => { if (bacVslDrag) bacVslFromPtr(e); });
    barEl.addEventListener("pointerup", () => { bacVslDrag = false; });
    barEl.addEventListener("pointercancel", () => { bacVslDrag = false; });''', 'チップ連打+縦スライダー配線')

# ============ ⑤ JS: bacSyncSlider を縦バー同期に置き換え ============
rep('''  /** スライダーのつまみ位置と額面表示を bacChip に合わせる */
  function bacSyncSlider() {
    var slEl = document.getElementById("bac-slider");
    var amt = document.getElementById("bac-chipamt");
    if (amt) amt.textContent = fmt(bacChip);
    if (!slEl) return;
    var mn = BAC_MIN_STAKE, mx = Math.max(mn + 1, Math.floor(balance) || mn + 1);
    var t = (Math.log(Math.max(mn, Math.min(mx, bacChip))) - Math.log(mn)) / (Math.log(mx) - Math.log(mn));
    slEl.value = String(Math.round(t * 1000));
  }''',
'''  /** 縦スライダーの fill / 値ピル / チップ積みを bacChip に合わせる */
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
  }''', 'bacSyncSlider縦バー版')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
