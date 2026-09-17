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

# ============ ① タブのモバイル崩れ(1文字ずつ縦に折れる)を修正 ============
rep('''  .tab { background:none; border:none; border-bottom:2px solid transparent; border-radius:0;
    padding:8px 14px; color:var(--muted); }''',
'''  .tab { background:none; border:none; border-bottom:2px solid transparent; border-radius:0;
    padding:8px 14px; color:var(--muted); white-space:nowrap; }
  /* スマホでは折り返さず横スクロール(1文字ずつ縦に積まれる崩れの対策) */
  @media (max-width:640px){
    .tabs{overflow-x:auto;gap:0;-webkit-overflow-scrolling:touch;scrollbar-width:none}
    .tabs::-webkit-scrollbar{display:none}
    .tab{flex:0 0 auto;padding:9px 11px;font-size:13.5px}
  }''', 'タブ崩れ対策')

# ============ ② バカラ卓: 奥行きのある透過切り抜き卓へ差し替え ============
i0 = s.index('var BAC_TBLS = {')
i1 = s.index('};', i0) + 2
s = s[:i0] + 'var BAC_TBLS = { pgreen: "__PTGREEN__", pred: "__PTRED__", pnoir: "__PTNOIR__" };' + s[i1:]
print('OK 卓プール差し替え')

rep('''    <span>卓</span>
      <button class="bac-sw auto" data-tbl="auto">自動</button>
      <button class="bac-sw" data-tbl="green"></button><button class="bac-sw" data-tbl="red"></button>
      <button class="bac-sw" data-tbl="blue"></button><button class="bac-sw" data-tbl="noir"></button>
      <button class="bac-sw" data-tbl="purple"></button><button class="bac-sw" data-tbl="teal"></button>''',
'''    <span>卓</span>
      <button class="bac-sw auto" data-tbl="auto">自動</button>
      <button class="bac-sw" data-tbl="pgreen"></button><button class="bac-sw" data-tbl="pred"></button>
      <button class="bac-sw" data-tbl="pnoir"></button>''', '卓スワッチ')

rep('''  .bac-table{display:flex;flex-direction:column;gap:6px;padding:16px 22px;justify-content:center;
    border-radius:16px;margin-bottom:8px;position:relative;z-index:1;aspect-ratio:16/9;min-height:230px;
    background:var(--bac-tbl,#0d3628) center/100% 100% no-repeat;
    box-shadow:0 10px 30px rgba(0,0,0,.45)}''',
'''  /* 卓は「切り抜き+透過」画像。枠や影は付けず、部屋の上に浮かぶ奥行きのある卓に見せる */
  .bac-table{display:flex;flex-direction:column;gap:6px;padding:34px 46px 20px;justify-content:center;
    margin-bottom:8px;position:relative;z-index:1;aspect-ratio:16/9;min-height:230px;
    background:var(--bac-tbl) center bottom/contain no-repeat;
    filter:drop-shadow(0 14px 26px rgba(0,0,0,.55))}''', '卓CSS透過化')

# ============ ③ スロット: 看板とリール盤面を選べるように ============
rep('''  <div class="tabpage hidden" id="tab-slot">
    <div id="slot"></div>
  </div>''',
'''  <div class="tabpage hidden" id="tab-slot">
    <div class="sl-designrow" id="sl-design"></div>
    <div id="slot"></div>
  </div>''', 'スロットデザイン枠')

rep('''          <img class="slot-marquee" src="${SLOT_MARQUEE}" alt="">''',
'''          <img class="slot-marquee" src="${slotMarqueeSrc()}" alt="">''', 'marquee差し替え点')

rep('''    background:linear-gradient(180deg, #120a18 0%, #1c0e22 45%, #0d0713 100%);
    border:2px solid rgba(212,175,55,.75);''',
'''    background:var(--sl-reel, linear-gradient(180deg, #120a18 0%, #1c0e22 45%, #0d0713 100%));
    border:2px solid rgba(212,175,55,.75);''', 'リール背景を変数化')

rep('''    if (tab === "slot") send({ t: "slot.state" });''',
'''    if (tab === "slot") { send({ t: "slot.state" }); slotDesignBuild(); }''', 'switchTabフック')

rep('''  var SLOT_MARQUEE = "data:image/webp;base64,''',
'''  /** 看板とリール盤面のデザイン(第130弾)。classic は従来のまま */
  var SLOT_MARQUEES_EXTRA = { red2: "__MQRED__", noir: "__MQNOIR__", blue: "__MQBLUE__" };
  var SLOT_REELS = { classic: "", purple: "__RLPURPLE__", green: "__RLGREEN__" };
  function slotMarqueeSrc() {
    var mk = "classic";
    try { mk = localStorage.getItem("slMarquee") || mk; } catch (e) {}
    return SLOT_MARQUEES_EXTRA[mk] || SLOT_MARQUEE;
  }
  function slotDesignApply() {
    var rk = "classic";
    try { rk = localStorage.getItem("slReel") || rk; } catch (e) {}
    if (!(rk in SLOT_REELS)) rk = "classic";
    document.body.style.setProperty("--sl-reel",
      SLOT_REELS[rk] ? 'url("' + SLOT_REELS[rk] + '") center/cover no-repeat' : "");
    var im = document.querySelector(".slot-marquee");
    if (im) { var want = slotMarqueeSrc(); if (im.getAttribute("src") !== want) im.setAttribute("src", want); }
    document.querySelectorAll("#sl-design .bac-sw[data-mq]").forEach((b) => {
      var cur = "classic";
      try { cur = localStorage.getItem("slMarquee") || cur; } catch (e) {}
      b.classList.toggle("on", b.dataset.mq === cur);
    });
    document.querySelectorAll("#sl-design .bac-sw[data-rl]").forEach((b) => {
      var cur = "classic";
      try { cur = localStorage.getItem("slReel") || cur; } catch (e) {}
      b.classList.toggle("on", b.dataset.rl === cur);
    });
  }
  var slDesignBuilt = false;
  function slotDesignBuild() {
    var host = document.getElementById("sl-design");
    if (!host) return;
    if (!slDesignBuilt) {
      slDesignBuilt = true;
      host.innerHTML =
        '<span>看板</span>' +
        '<button class="bac-sw auto" data-mq="classic">元</button>' +
        '<button class="bac-sw" data-mq="red2"></button>' +
        '<button class="bac-sw" data-mq="noir"></button>' +
        '<button class="bac-sw" data-mq="blue"></button>' +
        '<span>リール</span>' +
        '<button class="bac-sw auto" data-rl="classic">元</button>' +
        '<button class="bac-sw" data-rl="purple"></button>' +
        '<button class="bac-sw" data-rl="green"></button>';
      host.querySelectorAll(".bac-sw[data-mq]").forEach((b) => {
        if (SLOT_MARQUEES_EXTRA[b.dataset.mq]) b.style.backgroundImage = 'url("' + SLOT_MARQUEES_EXTRA[b.dataset.mq] + '")';
      });
      host.querySelectorAll(".bac-sw[data-rl]").forEach((b) => {
        if (SLOT_REELS[b.dataset.rl]) b.style.backgroundImage = 'url("' + SLOT_REELS[b.dataset.rl] + '")';
      });
      host.addEventListener("click", (e) => {
        var b = e.target.closest(".bac-sw");
        if (!b) return;
        try {
          if (b.dataset.mq) localStorage.setItem("slMarquee", b.dataset.mq);
          if (b.dataset.rl) localStorage.setItem("slReel", b.dataset.rl);
        } catch (e2) {}
        slotDesignApply();
      });
    }
    slotDesignApply();
  }
  var SLOT_MARQUEE = "data:image/webp;base64,''', 'スロットデザインJS')

rep('''  .bac-sw.auto{font-size:9px;font-weight:800;color:#d9b45f;background:#171d25;line-height:1}''',
'''  .bac-sw.auto{font-size:9px;font-weight:800;color:#d9b45f;background:#171d25;line-height:1}
  .sl-designrow{display:flex;gap:6px;align-items:center;justify-content:center;flex-wrap:wrap;
    margin:0 auto 8px;max-width:380px}
  .sl-designrow span{font-size:10px;color:#8b97a5;letter-spacing:.08em;margin-left:6px}''', 'デザイン行CSS')

# ============ ④ 画像データ ============
rep('"__PTGREEN__"', '"' + uri('pt_green.webp') + '"', 'pt green')
rep('"__PTRED__"', '"' + uri('pt_red.webp') + '"', 'pt red')
rep('"__PTNOIR__"', '"' + uri('pt_noir.webp') + '"', 'pt noir')
rep('"__MQRED__"', '"' + uri('mqs_red.webp') + '"', 'mq red')
rep('"__MQNOIR__"', '"' + uri('mqs_noir.webp') + '"', 'mq noir')
rep('"__MQBLUE__"', '"' + uri('mqs_blue.webp') + '"', 'mq blue')
rep('"__RLPURPLE__"', '"' + uri('reels_purple.webp') + '"', 'reel purple')
rep('"__RLGREEN__"', '"' + uri('reels_green.webp') + '"', 'reel green')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
