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

# ============ ① チップ8色・ラダー8段 ============
s_old = 'var BAC_CHIP_IMGS = ['
i0 = s.index(s_old)
i1 = s.index('];', i0) + 2
seg = s[i0:i1]
s = s[:i0] + seg[:-2] + ', "__CHIP6__", "__CHIP7__"];' + s[i1:]
print('OK チップ8色')

rep('''    var mults = [1, 5, 25, 100, 500, 2500];''',
'''    var mults = [1, 5, 25, 100, 500, 2500, 10000, 50000];''', 'ラダー8段')
rep('''      `<button class="bac-chip" data-v="${v}" style="background-image:url(${BAC_CHIP_IMGS[Math.min(i, 5)]})"><b>${fmt(v)}</b></button>`).join("");''',
'''      `<button class="bac-chip" data-v="${v}" style="background-image:url(${BAC_CHIP_IMGS[Math.min(i, 7)]})"><b>${fmt(v)}</b></button>`).join("");''', 'ボタン8色')
rep('''      for (var k = 0; k < n && out.length < 30; k++) out.push(Math.min(i, 5));''',
'''      for (var k = 0; k < n && out.length < 30; k++) out.push(Math.min(i, 7));''', '分解8色')
rep('''  .bac-chips{display:flex;gap:8px;margin-bottom:8px;justify-content:center}''',
'''  .bac-chips{display:flex;gap:7px;margin-bottom:8px;justify-content:center;flex-wrap:wrap}''', 'チップ折返し')

# ============ ② スポットの積みをポーカー風に(中央に大きく+飛んでくる) ============
rep('''  .bac-spot{flex:1;padding:10px 4px 8px;border-radius:11px;text-align:center;cursor:pointer;position:relative;
    border:1.5px solid #2e3844;background:#171d25;transition:.15s}''',
'''  .bac-spot{flex:1;padding:10px 4px 26px;border-radius:11px;text-align:center;cursor:pointer;position:relative;
    min-height:132px;border:1.5px solid #2e3844;background:#171d25;transition:.15s}''', 'スポット拡張')

rep('''  .bac-spot .amt{font-size:12px;font-weight:800;margin-top:4px;color:#d9b45f;min-height:15px;font-variant-numeric:tabular-nums}
  /* ベットしたチップの山(スポット右下に積む) */
  .bac-pile{position:absolute;right:7px;bottom:8px;width:26px;height:64px;pointer-events:none}
  .bac-pile img{position:absolute;left:0;width:26px;height:26px;
    filter:drop-shadow(0 2px 3px rgba(0,0,0,.6));animation:bacvChipIn .16s cubic-bezier(.2,1.5,.4,1)}
  .bac-pile i{position:absolute;left:50%;transform:translateX(-50%);bottom:-2px;font-style:normal;
    font-size:9px;font-weight:800;color:#f2e3b8;text-shadow:0 1px 3px #000}''',
'''  .bac-spot .amt{position:absolute;left:0;right:0;bottom:5px;font-size:12.5px;font-weight:800;
    color:#f2e3b8;min-height:15px;font-variant-numeric:tabular-nums;text-shadow:0 1px 3px #000}
  /* ベットしたチップの山(ポーカーと同じく中央にドンと積む) */
  .bac-pile{position:absolute;left:50%;transform:translateX(-50%);bottom:24px;width:44px;height:78px;pointer-events:none}
  .bac-pile img{position:absolute;left:50%;width:40px;height:40px;margin-left:-20px;
    filter:drop-shadow(0 3px 4px rgba(0,0,0,.65));animation:bacvChipIn .16s cubic-bezier(.2,1.5,.4,1)}
  .bac-pile i{position:absolute;left:50%;transform:translateX(-50%);top:-14px;font-style:normal;
    font-size:10px;font-weight:800;color:#f2e3b8;text-shadow:0 1px 3px #000}
  /* チップ台からスポットへ飛ぶ演出 */
  .bac-fly{position:fixed;z-index:400;width:40px;height:40px;pointer-events:none;
    transition:transform .28s cubic-bezier(.2,.8,.3,1), opacity .28s;
    filter:drop-shadow(0 4px 6px rgba(0,0,0,.6))}''', '中央積み+飛びCSS')

rep('''  /** ベットしたチップの山をスポットの上に描く(押すたび積み上がる) */
  function bacRenderStacks() {''',
'''  /** チップ台からスポットへチップが飛ぶ(ポーカーの配布演出と同じ気持ち良さ) */
  function bacFlyChip(colorIdx, spotKey) {
    try {
      var from = document.querySelector('.bac-chip[data-v="' + bacChip + '"]') || document.querySelector(".bac-chip.sel");
      var pile = document.getElementById("bac-pile-" + spotKey);
      if (!from || !pile) return;
      var a = from.getBoundingClientRect(), b = pile.getBoundingClientRect();
      if (!a.width || !b.width) return;    // 実寸が取れない環境(E2E)は飛ばさない
      var im = document.createElement("img");
      im.className = "bac-fly";
      im.src = BAC_CHIP_IMGS[colorIdx];
      im.style.left = (a.left + a.width / 2 - 20) + "px";
      im.style.top = (a.top + a.height / 2 - 20) + "px";
      document.body.appendChild(im);
      var dx = (b.left + b.width / 2) - (a.left + a.width / 2);
      var dy = (b.top + b.height - 24) - (a.top + a.height / 2);
      requestAnimationFrame(() => { im.style.transform = "translate(" + dx + "px," + dy + "px) scale(.95)"; });
      setTimeout(() => im.remove(), 320);
    } catch (e) {}
  }

  /** ベットしたチップの山をスポットの上に描く(押すたび積み上がる) */
  function bacRenderStacks() {''', 'bacFlyChip')

rep('''      var discs = bacStack[k];
      var html = "";
      var show = Math.min(discs.length, 9);
      for (var d = 0; d < show; d++) {
        html += '<img src="' + BAC_CHIP_IMGS[discs[d]] + '" style="bottom:' + (8 + d * 5) + 'px" alt="">';
      }
      if (discs.length > 9) html += "<i>\\u00d7" + discs.length + "</i>";''',
'''      var discs = bacStack[k];
      var html = "";
      var show = Math.min(discs.length, 10);
      for (var d = 0; d < show; d++) {
        // 少し崩れた実物の山に見えるよう、決定的な揺らぎを入れる
        var jx = ((d * 37) % 7) - 3;
        html += '<img src="' + BAC_CHIP_IMGS[discs[d]] + '" style="bottom:' + (d * 7) + 'px;margin-left:' + (jx - 20) + 'px" alt="">';
      }
      if (discs.length > 10) html += "<i>\\u00d7" + discs.length + "</i>";''', '山の描画調整')

rep('''        // 置いたぶんのチップがスポットの上に積み上がる
        var discs = bacDecompose(add);
        for (var di = 0; di < discs.length; di++) bacStack[k].push(discs[di]);
        try { play("chipTick"); } catch (e2) {}''',
'''        // 置いたぶんのチップがスポットへ飛んで積み上がる
        var discs = bacDecompose(add);
        for (var di = 0; di < discs.length; di++) bacStack[k].push(discs[di]);
        bacFlyChip(discs.length ? discs[discs.length - 1] : 0, k);
        try { play("chipTick"); } catch (e2) {}''', '置くと飛ぶ')

# ============ ③ 勝てる札(アウツのカード)を上に表示 ============
rep('''    if (!tot) { el.innerHTML = ""; return; }
    var pp = Math.round(cnt.P / tot * 100), pb = Math.round(cnt.B / tot * 100);
    var pt = Math.max(0, 100 - pp - pb);
    var lead = cnt.P > cnt.B ? "PLAYER有利" : cnt.B > cnt.P ? "BANKER有利" : "互角";
    el.innerHTML =
      '<div class="bar"><i class="op" style="width:' + pp + '%"></i><i class="ot" style="width:' + pt + '%"></i><i class="ob" style="width:' + pb + '%"></i></div>' +
      "<p>" + lead + " — P " + pp + "% / T " + pt + "% / B " + pb + "%　勝ちのアウツ <b>" + outs + "</b> / " + tot + "</p>";''',
'''    if (!tot) { el.innerHTML = ""; return; }
    var pp = Math.round(cnt.P / tot * 100), pb = Math.round(cnt.B / tot * 100);
    var pt = Math.max(0, 100 - pp - pb);
    var lead = cnt.P > cnt.B ? "PLAYER有利" : cnt.B > cnt.P ? "BANKER有利" : "互角";
    // 引けば勝つ札そのものを見せる(J/Q/Kはひとまとめ)
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
      if (wr >= 11) { if (wl.indexOf("J/Q/K") < 0) wl.push("J/Q/K"); }
      else wl.push(bacRankLabel(wr));
    }
    var wcards = wl.length
      ? '<div class="ocards">引けば勝ち: ' + wl.map((x) => "<i>" + x + "</i>").join("") + "</div>"
      : '<div class="ocards none">勝ち目の札は残っていない…</div>';
    el.innerHTML = wcards +
      '<div class="bar"><i class="op" style="width:' + pp + '%"></i><i class="ot" style="width:' + pt + '%"></i><i class="ob" style="width:' + pb + '%"></i></div>' +
      "<p>" + lead + " — P " + pp + "% / T " + pt + "% / B " + pb + "%　勝ちのアウツ <b>" + outs + "</b> / " + tot + "</p>";''', '勝てる札表示')

rep('''  .bac-oddsbar .bar{display:flex;height:8px;border-radius:4px;overflow:hidden;background:rgba(255,255,255,.1)}''',
'''  .bac-oddsbar .ocards{display:flex;gap:4px;justify-content:center;align-items:center;flex-wrap:wrap;
    margin-bottom:7px;font-size:10.5px;color:#a9b7c2;letter-spacing:.04em}
  .bac-oddsbar .ocards i{font-style:normal;min-width:22px;padding:3px 5px;border-radius:4px;text-align:center;
    font-size:12px;font-weight:800;color:#241a05;background:linear-gradient(180deg,#f2df9a,#d9a53d);
    box-shadow:0 1px 3px rgba(0,0,0,.5)}
  .bac-oddsbar .ocards.none{color:#e0655a}
  .bac-oddsbar .bar{display:flex;height:8px;border-radius:4px;overflow:hidden;background:rgba(255,255,255,.1)}''', '勝てる札CSS')

# ============ ④ 配札をもっと焦らす ============
rep('''    // 全部裏で順に置く。音はポーカーの配布音(playCardDealSound)と同じ
    bacDealerFrames(hand.order.length * (150 + 190) + 600);''',
'''    // 全部裏で順に置く。音はポーカーの配布音(playCardDealSound)と同じ。
    // テンポは意図的に遅く(第125弾: 1枚ずつ「来る…」と思わせる焦らし)
    bacDealerFrames(hand.order.length * (380 + 520) + 900);''', 'ディーラー時間')
rep('''      try { playCardDealSound({ pan: o.s === "p" ? -0.25 : 0.25, distance: 0.35, intensity: 0.9 }); } catch (e) {}
      bacBuzz(5);
      await bacSleep(150);
    }
    await bacSleep(180);''',
'''      try { playCardDealSound({ pan: o.s === "p" ? -0.25 : 0.25, distance: 0.35, intensity: 0.9 }); } catch (e) {}
      bacBuzz(5);
      await bacSleep(380);
    }
    await bacSleep(500);''', '配布間隔')
rep('''      try { playCardDealSound({ pan: o2.s === "p" ? -0.2 : 0.2, distance: 0.55, intensity: 0.6 }); } catch (e) {}
      await bacSleep(190);''',
'''      try { playCardDealSound({ pan: o2.s === "p" ? -0.2 : 0.2, distance: 0.55, intensity: 0.6 }); } catch (e) {}
      await bacSleep(520);''', 'めくり間隔')
rep('''    els[slot.s][slot.i].style.opacity = ".35";
    await bacSleep(300);''',
'''    els[slot.s][slot.i].style.opacity = ".35";
    await bacSleep(650);''', '絞り前の間')

# ============ ⑤ 卓と背景を追加+「自動(時間で入替)」 ============
s_old2 = 'var BAC_TBLS = { green:'
i0 = s.index(s_old2)
i1 = s.index('};', i0) + 2
seg = s[i0:i1]
s = s[:i0] + seg[:-2] + ', purple: "__TPURPLE__", teal: "__TTEAL__" };' + s[i1:]
print('OK 卓追加')
s_old3 = 'var BAC_ROOMS = { floor:'
i0 = s.index(s_old3)
i1 = s.index('};', i0) + 2
seg = s[i0:i1]
s = s[:i0] + seg[:-2] + ', bar: "__RBAR__", stair: "__RSTAIR__" };' + s[i1:]
print('OK 背景追加')

rep('''    var tk = "green", bk = "classic", rm = "floor";
    try {
      tk = localStorage.getItem("bacTbl") || tk;
      bk = localStorage.getItem("bacBack") || bk;
      rm = localStorage.getItem("bacRoom") || rm;
    } catch (e) {}
    if (!BAC_TBLS[tk]) tk = "green";
    if (!BAC_BKS[bk]) bk = "classic";
    if (!BAC_ROOMS[rm]) rm = "floor";
    host.style.setProperty("--bac-tbl", 'url("' + BAC_TBLS[tk] + '")');
    host.style.setProperty("--bac-back", 'url("' + BAC_BKS[bk] + '")');
    host.style.setProperty("--bac-room", 'url("' + BAC_ROOMS[rm] + '")');''',
'''    var tk = "auto", bk = "classic", rm = "auto";
    try {
      tk = localStorage.getItem("bacTbl") || tk;
      bk = localStorage.getItem("bacBack") || bk;
      rm = localStorage.getItem("bacRoom") || rm;
    } catch (e) {}
    if (tk !== "auto" && !BAC_TBLS[tk]) tk = "auto";
    if (!BAC_BKS[bk]) bk = "classic";
    if (rm !== "auto" && !BAC_ROOMS[rm]) rm = "auto";
    // 「自動」は1時間ごとに順番で入れ替わる(気分が変わる)
    var hourIdx = Math.floor(Date.now() / 3600000);
    var tKeys = Object.keys(BAC_TBLS), rKeys = Object.keys(BAC_ROOMS);
    var tUse = tk === "auto" ? tKeys[hourIdx % tKeys.length] : tk;
    var rUse = rm === "auto" ? rKeys[(hourIdx + 2) % rKeys.length] : rm;
    host.style.setProperty("--bac-tbl", 'url("' + BAC_TBLS[tUse] + '")');
    host.style.setProperty("--bac-back", 'url("' + BAC_BKS[bk] + '")');
    host.style.setProperty("--bac-room", 'url("' + BAC_ROOMS[rUse] + '")');''', '自動ローテ')

rep('''    <span>卓</span>
    <button class="bac-sw" data-tbl="green"></button><button class="bac-sw" data-tbl="red"></button>
    <button class="bac-sw" data-tbl="blue"></button><button class="bac-sw" data-tbl="noir"></button>''',
'''    <span>卓</span>
    <button class="bac-sw auto" data-tbl="auto">自動</button>
    <button class="bac-sw" data-tbl="green"></button><button class="bac-sw" data-tbl="red"></button>
    <button class="bac-sw" data-tbl="blue"></button><button class="bac-sw" data-tbl="noir"></button>
    <button class="bac-sw" data-tbl="purple"></button><button class="bac-sw" data-tbl="teal"></button>''', '卓スワッチ')

rep('''    <span>背景</span>
    <button class="bac-sw" data-room="floor"></button><button class="bac-sw" data-room="vip"></button>
    <button class="bac-sw" data-room="neon"></button><button class="bac-sw" data-room="grand"></button>
    <button class="bac-sw" data-room="hall"></button>''',
'''    <span>背景</span>
    <button class="bac-sw auto" data-room="auto">自動</button>
    <button class="bac-sw" data-room="floor"></button><button class="bac-sw" data-room="vip"></button>
    <button class="bac-sw" data-room="neon"></button><button class="bac-sw" data-room="grand"></button>
    <button class="bac-sw" data-room="hall"></button>
    <button class="bac-sw" data-room="bar"></button><button class="bac-sw" data-room="stair"></button>''', '背景スワッチ')

rep('''  .bac-sw.bk{width:23px;height:32px}''',
'''  .bac-sw.bk{width:23px;height:32px}
  .bac-sw.auto{font-size:9px;font-weight:800;color:#d9b45f;background:#171d25;line-height:1}''', '自動スワッチCSS')

rep('''    document.querySelectorAll(".bac-sw[data-tbl]").forEach((b) => {
      b.style.backgroundImage = 'url("' + BAC_TBLS[b.dataset.tbl] + '")';
    });''',
'''    document.querySelectorAll(".bac-sw[data-tbl]").forEach((b) => {
      if (BAC_TBLS[b.dataset.tbl]) b.style.backgroundImage = 'url("' + BAC_TBLS[b.dataset.tbl] + '")';
    });''', '卓サムネguard')
rep('''    document.querySelectorAll(".bac-sw[data-room]").forEach((b) => {
      b.style.backgroundImage = 'url("' + BAC_ROOMS[b.dataset.room] + '")';
    });''',
'''    document.querySelectorAll(".bac-sw[data-room]").forEach((b) => {
      if (BAC_ROOMS[b.dataset.room]) b.style.backgroundImage = 'url("' + BAC_ROOMS[b.dataset.room] + '")';
    });''', '背景サムネguard')

# ============ ⑥ 絞りを重く+二段階(持ち替え)+回転の手応え ============
rep('''  var bacRaw = 0, bacRev = 0, bacDragging = false, bacStartPt = 0, bacStartRaw = 0;''',
'''  var bacRaw = 0, bacRev = 0, bacDragging = false, bacStartPt = 0, bacStartRaw = 0;
  /** 絞りの段階。1=前半(真ん中まで)。一度指を離す(持ち替える)と 2=後半が解禁 */
  var bacSqStage = 1;''', '段階変数')

rep('''      bacRaw = 0; bacRev = 0; bacLocked = false; bacLastSig = "";''',
'''      bacRaw = 0; bacRev = 0; bacLocked = false; bacLastSig = ""; bacSqStage = 1;''', '段階リセット')

rep('''      if (Math.abs(pt - bacStartPt) > 6) clearTimeout(bacPressTimer);
      bacApplyRaw(bacStartRaw + (pt - bacStartPt) / Math.max(40, size));
      if (bacRaw >= 0.985) bacFinishSqueeze();''',
'''      if (Math.abs(pt - bacStartPt) > 6) clearTimeout(bacPressTimer);
      // 重い紙: 指の移動の約半分しかめくれない(慎重に大きく動かす必要がある)
      var next = bacStartRaw + (pt - bacStartPt) / Math.max(40, size) * 0.55;
      // 前半は真ん中まで。そこから先は一度持ち替え(指を離す)ないと開かない
      if (bacSqStage === 1) next = Math.min(next, 0.52);
      bacApplyRaw(next);
      if (bacRaw >= 0.985) bacFinishSqueeze();''', '重さ+前半キャップ')

rep('''    var end = () => {
      if (!bacDragging) return;
      bacDragging = false; clearTimeout(bacPressTimer); bacFrictionOff();
      if (bacLocked) return;''',
'''    var end = () => {
      if (!bacDragging) return;
      bacDragging = false; clearTimeout(bacPressTimer); bacFrictionOff();
      if (bacLocked) return;
      // 真ん中まで来て指を離した=持ち替え完了。後半が解禁される
      if (bacSqStage === 1 && bacRaw >= 0.4) {
        bacSqStage = 2;
        var h2 = document.getElementById("bac-hint");
        if (h2) {
          h2.textContent = "持ち替えた…！ここからが勝負(縦横も切替できる)";
          h2.style.display = "";
        }
        bacBuzz([8, 30, 12]);
      }''', '持ち替え解禁')

rep('''      b.onclick = () => {
        bacDir = b.dataset.d;
        document.querySelectorAll(".bac-dir").forEach((x) => x.classList.toggle("on", x.dataset.d === bacDir));
        bacApplyRaw(bacRaw); // 方向を変えたら同じめくれ量で描き直す
        var h = document.getElementById("bac-hint");
        if (h) h.textContent = bacDir === "h" ? "→ 右へなぞって絞る" : "↑ 上へなぞって絞る";
      };''',
'''      b.onclick = () => {
        bacDir = b.dataset.d;
        document.querySelectorAll(".bac-dir").forEach((x) => x.classList.toggle("on", x.dataset.d === bacDir));
        // カードを持ち替えて回す手応え(揺れ)
        var bw = document.querySelector(".bac-bigwrap");
        if (bw) { bw.classList.remove("rot"); void bw.offsetWidth; bw.classList.add("rot"); }
        bacApplyRaw(bacRaw); // 方向を変えても同じめくれ量から続き(回転しながら絞れる)
        var h = document.getElementById("bac-hint");
        if (h) h.textContent = bacDir === "h" ? "→ 右へなぞって絞る" : "↑ 上へなぞって絞る";
      };''', '回転の手応え')

rep('''  .bac-bigwrap{position:relative}''',
'''  .bac-bigwrap{position:relative}
  .bac-bigwrap.rot{animation:bacRot .38s cubic-bezier(.2,.9,.3,1.1)}
  @keyframes bacRot{0%{transform:rotate(0)}40%{transform:rotate(-7deg) scale(1.02)}100%{transform:rotate(0)}}''', '回転CSS')

# ヒント文言を段階制に合わせる
rep('''      h.textContent = bacDir === "h" ? "→ 右へなぞって絞る" : "↑ 上へなぞって絞る";
      h.style.display = "";
      document.getElementById("bac-stage").classList.add("on");''',
'''      h.textContent = (bacDir === "h" ? "→ 大きくなぞって絞る" : "↑ 大きくなぞって絞る") + "(真ん中で一度持ち替え)";
      h.style.display = "";
      document.getElementById("bac-stage").classList.add("on");''', 'ヒント文言')

# ============ ⑦ 画像データ ============
rep('"__CHIP6__"', '"' + uri('chip6.webp') + '"', 'chip6')
rep('"__CHIP7__"', '"' + uri('chip7.webp') + '"', 'chip7')
rep('"__TPURPLE__"', '"' + uri('t_purple.webp') + '"', 't purple')
rep('"__TTEAL__"', '"' + uri('t_teal.webp') + '"', 't teal')
rep('"__RBAR__"', '"' + uri('room_bar.webp') + '"', 'room bar')
rep('"__RSTAIR__"', '"' + uri('room_stair.webp') + '"', 'room stair')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
