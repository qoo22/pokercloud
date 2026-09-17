# -*- coding: utf-8 -*-
import sys
p = sys.argv[1]
s = open(p, encoding='utf8').read()
def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)

# ① ピップを大きく(スート視認性。位置は不変なので bacSig への影響なし)
rep('''      var cells = rank >= 11 ? BAC_FACE_CELLS : BAC_CELLS[rank];
      var size = rank === 1 ? 66 : 34;''',
'''      var cells = rank >= 11 ? BAC_FACE_CELLS : BAC_CELLS[rank];
      var size = rank === 1 ? 88 : 46;''', 'ピップ拡大')
rep('''        pip(29, 82, 30, false) +''',
'''        pip(29, 84, 34, false) +''', 'コーナースート拡大')

# ② テンプレート: 写真の帯を廃止し、ポーカーと同じディーラー絵を卓の上に重ねる
rep('''  <div class="bac-dealer"><b>DEALER</b></div>
  <div class="bac-road"><div class="bac-roadgrid" id="bac-road"></div></div>''',
'''  <div class="bac-road"><div class="bac-roadgrid" id="bac-road"></div></div>
  <div class="bac-dlr" id="bac-dlr"></div>''', 'テンプレート差し替え')

# ③ CSS: 写真の帯を撤去 → ポーカーの .dealer と同じ構図(卓の縁に体が隠れる)
start = s.index('  .bac-dealer{')
end = s.index('  .bac-road{')
s = s[:start] + '''  /* ポーカーの卓と同じ構図: ディーラーの下半身が卓の縁に隠れる。
     絵は DEALERS[](ポーカーと同じ人物プール)から JS が入れる */
  .bac-dlr{width:min(300px,70vw);height:150px;margin:0 auto -58px;position:relative;z-index:0;
    pointer-events:none;background:var(--img-dealer) center bottom/auto 100% no-repeat;
    filter:drop-shadow(0 6px 14px rgba(0,0,0,.5))}
  .bac-dlr.dealing{animation:dealerDeal .46s ease-in-out infinite;transform-origin:50% 82%}
''' + s[end:]
print('OK ディーラーCSS')

rep('''  .bac-table{display:flex;flex-direction:column;gap:6px;padding:12px 14px;min-height:206px;justify-content:center;
    border-radius:14px;border:1px solid rgba(217,180,95,.3);margin-bottom:8px;''',
'''  .bac-table{display:flex;flex-direction:column;gap:6px;padding:12px 14px;min-height:206px;justify-content:center;
    border-radius:14px;border:1px solid rgba(217,180,95,.3);margin-bottom:8px;position:relative;z-index:1;''', '卓を前面に')

# ④ JS: ディーラーの人物選択と配りモーション(ポーカーの DEALERS / DEALERS_DEAL を共用)
rep('''  function bacMsg(t) { var el = document.getElementById("bac-msg"); if (el) el.textContent = t; }''',
'''  function bacMsg(t) { var el = document.getElementById("bac-msg"); if (el) el.textContent = t; }

  /** ポーカーと同じ人物プールからディーラーを選ぶ(初回表示時) */
  var bacDealerIdx = 0, bacDlrTimer = null;
  function bacPickDealer() {
    var el = document.getElementById("bac-dlr");
    if (!el || typeof DEALERS === "undefined" || !DEALERS.length) return;
    bacDealerIdx = Math.floor(Math.random() * DEALERS.length);
    el.style.backgroundImage = 'url("' + DEALERS[bacDealerIdx] + '")';
  }
  /** 配っている間、ポーカーと同じく配りポーズと通常ポーズを交互に(体も揺れる) */
  function bacDealerFrames(ms) {
    var el = document.getElementById("bac-dlr");
    if (!el) return;
    el.classList.add("dealing");
    if (typeof DEALERS_DEAL !== "undefined" && DEALERS_DEAL[bacDealerIdx]) {
      var on = false;
      clearInterval(bacDlrTimer);
      bacDlrTimer = setInterval(() => {
        on = !on;
        el.style.backgroundImage = 'url("' + (on ? DEALERS_DEAL[bacDealerIdx] : DEALERS[bacDealerIdx]) + '")';
      }, 320);
    }
    setTimeout(() => {
      clearInterval(bacDlrTimer);
      el.classList.remove("dealing");
      if (typeof DEALERS !== "undefined" && DEALERS[bacDealerIdx])
        el.style.backgroundImage = 'url("' + DEALERS[bacDealerIdx] + '")';
    }, ms);
  }''', 'ディーラー関数')

rep('''    bacSetBal(slotBalFreeze != null ? slotBalFreeze : balance);
    bacRenderBets();
    bacRenderRoad();
  }''',
'''    bacSetBal(slotBalFreeze != null ? slotBalFreeze : balance);
    bacRenderBets();
    bacRenderRoad();
    bacPickDealer();
  }''', '初回表示で人物選択')

# ⑤ 配る音をポーカーの playCardDealSound に。配りの間はディーラーが動く
rep('''    // 全部裏で順に置く
    var els = { p: [], b: [] };
    for (var oi = 0; oi < hand.order.length; oi++) {
      var o = hand.order[oi];
      var arr = o.s === "p" ? hand.p : hand.b;
      var el = bacCardEl(arr[o.i], false);
      (o.s === "p" ? pc : bc).appendChild(el);
      els[o.s][o.i] = el;
      bacBlip(1200, 0.045, "square", 0.06); bacBuzz(5);
      await bacSleep(150);
    }''',
'''    // 全部裏で順に置く。音はポーカーの配布音(playCardDealSound)と同じ
    bacDealerFrames(hand.order.length * (150 + 190) + 600);
    var els = { p: [], b: [] };
    for (var oi = 0; oi < hand.order.length; oi++) {
      var o = hand.order[oi];
      var arr = o.s === "p" ? hand.p : hand.b;
      var el = bacCardEl(arr[o.i], false);
      (o.s === "p" ? pc : bc).appendChild(el);
      els[o.s][o.i] = el;
      try { playCardDealSound({ pan: o.s === "p" ? -0.25 : 0.25, distance: 0.35, intensity: 0.9 }); } catch (e) {}
      bacBuzz(5);
      await bacSleep(150);
    }''', '配布音')

rep('''      bacSetTotals(hand, upMask);
      bacBlip(700, 0.05, "triangle", 0.09);
      await bacSleep(190);''',
'''      bacSetTotals(hand, upMask);
      try { playCardDealSound({ pan: o2.s === "p" ? -0.2 : 0.2, distance: 0.55, intensity: 0.6 }); } catch (e) {}
      await bacSleep(190);''', 'めくり音もカード音')

open(p, 'w', encoding='utf8').write(s)
