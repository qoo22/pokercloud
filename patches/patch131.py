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

# ① 絵柄スキン(配当はキー対応のまま完全不変。画像マップだけ差し替える)
rep('''  /** 看板とリール盤面のデザイン(第130弾)。classic は従来のまま */''',
'''  /**
   * 絵柄スキン(第131弾)。配当は SLOT_IMG のキー対応のままなので**全く同じ**。
   * SLOT_IMG を直接書き換える(描画は全部 SLOT_IMG[k] 参照なので、これで全画面に効く)
   */
  var SLOT_SYM_SKINS = {
    gems: {
      chip: "__GCHIP__", club: "__GCLUB__", diamond: "__GDIAMOND__", heart: "__GHEART__",
      spade: "__GSPADE__", crown: "__GCROWN__", seven: "__GSEVEN__", wild: "__GWILD__", scatter: "__GSCATTER__"
    },
    fruits: {
      chip: "__FCHIP__", club: "__FCLUB__", diamond: "__FDIAMOND__", heart: "__FHEART__",
      spade: "__FSPADE__", crown: "__FCROWN__", seven: "__FSEVEN__", wild: "__FWILD__", scatter: "__FSCATTER__"
    }
  };
  var SLOT_IMG_BASE = null;
  function slotSymsApply() {
    if (!SLOT_IMG_BASE) SLOT_IMG_BASE = Object.assign({}, SLOT_IMG);
    var sk = "classic";
    try { sk = localStorage.getItem("slSyms") || sk; } catch (e) {}
    if (sk !== "classic" && !SLOT_SYM_SKINS[sk]) sk = "classic";
    var set = sk === "classic" ? SLOT_IMG_BASE : SLOT_SYM_SKINS[sk];
    var changed = false;
    for (var k in SLOT_IMG_BASE) {
      var want = set[k] || SLOT_IMG_BASE[k];
      if (SLOT_IMG[k] !== want) { SLOT_IMG[k] = want; changed = true; }
    }
    if (changed && typeof slotSpinning !== "undefined" && !slotSpinning) {
      try { renderSlot(); } catch (e) {}
    }
    return sk;
  }

  /** 看板とリール盤面のデザイン(第130弾)。classic は従来のまま */''', 'スキン定義')

# ② デザイン行に「絵柄」を追加
rep('''        '<span>リール</span>' +
        '<button class="bac-sw auto" data-rl="classic">元</button>' +
        '<button class="bac-sw" data-rl="purple"></button>' +
        '<button class="bac-sw" data-rl="green"></button>';''',
'''        '<span>リール</span>' +
        '<button class="bac-sw auto" data-rl="classic">元</button>' +
        '<button class="bac-sw" data-rl="purple"></button>' +
        '<button class="bac-sw" data-rl="green"></button>' +
        '<span>絵柄</span>' +
        '<button class="bac-sw auto" data-sy="classic">元</button>' +
        '<button class="bac-sw" data-sy="gems"></button>' +
        '<button class="bac-sw" data-sy="fruits"></button>';''', '絵柄スワッチ')

rep('''      host.querySelectorAll(".bac-sw[data-rl]").forEach((b) => {
        if (SLOT_REELS[b.dataset.rl]) b.style.backgroundImage = 'url("' + SLOT_REELS[b.dataset.rl] + '")';
      });''',
'''      host.querySelectorAll(".bac-sw[data-rl]").forEach((b) => {
        if (SLOT_REELS[b.dataset.rl]) b.style.backgroundImage = 'url("' + SLOT_REELS[b.dataset.rl] + '")';
      });
      host.querySelectorAll(".bac-sw[data-sy]").forEach((b) => {
        var st = SLOT_SYM_SKINS[b.dataset.sy];
        if (st) { b.style.backgroundImage = 'url("' + st.seven + '")'; b.style.backgroundSize = "contain"; b.style.backgroundRepeat = "no-repeat"; }
      });''', '絵柄サムネ')

rep('''        try {
          if (b.dataset.mq) localStorage.setItem("slMarquee", b.dataset.mq);
          if (b.dataset.rl) localStorage.setItem("slReel", b.dataset.rl);
        } catch (e2) {}
        slotDesignApply();''',
'''        try {
          if (b.dataset.mq) localStorage.setItem("slMarquee", b.dataset.mq);
          if (b.dataset.rl) localStorage.setItem("slReel", b.dataset.rl);
          if (b.dataset.sy) localStorage.setItem("slSyms", b.dataset.sy);
        } catch (e2) {}
        slotDesignApply();''', '絵柄保存')

rep('''    var im = document.querySelector(".slot-marquee");
    if (im) { var want = slotMarqueeSrc(); if (im.getAttribute("src") !== want) im.setAttribute("src", want); }''',
'''    var im = document.querySelector(".slot-marquee");
    if (im) { var want = slotMarqueeSrc(); if (im.getAttribute("src") !== want) im.setAttribute("src", want); }
    var sy = slotSymsApply();
    document.querySelectorAll("#sl-design .bac-sw[data-sy]").forEach((b) => {
      b.classList.toggle("on", b.dataset.sy === sy);
    });''', '絵柄適用')

# ③ 画像データ
for key, fname in [
    ('__GCHIP__','g_chip_t.webp'),('__GCLUB__','g_club_t.webp'),('__GDIAMOND__','g_diamond_t.webp'),
    ('__GHEART__','g_heart_t.webp'),('__GSPADE__','g_spade_t.webp'),('__GCROWN__','g_crown_t.webp'),
    ('__GSEVEN__','g_seven_t.webp'),('__GWILD__','g_wild_t.webp'),('__GSCATTER__','g_scatter_t.webp'),
    ('__FCHIP__','f_chip_t.webp'),('__FCLUB__','f_club_t.webp'),('__FDIAMOND__','f_diamond_t.webp'),
    ('__FHEART__','f_heart_t.webp'),('__FSPADE__','f_spade_t.webp'),('__FCROWN__','f_crown_t.webp'),
    ('__FSEVEN__','f_seven_t.webp'),('__FWILD__','f_wild_t.webp'),('__FSCATTER__','f_scatter_t.webp'),
]:
    rep('"' + key + '"', '"' + uri(fname) + '"', key)

open(p, 'w', encoding='utf8').write(s)
print('DONE')
