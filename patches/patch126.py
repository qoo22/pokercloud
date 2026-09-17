# -*- coding: utf-8 -*-
import sys
p = sys.argv[1]
s = open(p, encoding='utf8').read()
def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)

# ============ ① ヘッダーに ⚙設定 と 罫線 ボタン。大路は流し込みから外す ============
rep('''  <div class="bac-head">
    <div class="bac-title">ROYAL BACCARAT<span>絞り(スクイーズ)対応・読み宣言つき</span></div>
    <div class="bac-bal"><b id="bac-bal">0</b><small>チップ</small></div>
  </div>
  <div class="bac-road"><div class="bac-roadgrid" id="bac-road"></div></div>
  <div class="bac-dlr" id="bac-dlr"></div>''',
'''  <div class="bac-head">
    <div class="bac-title">ROYAL BACCARAT<span>絞り(スクイーズ)対応</span></div>
    <div class="bac-headbtns">
      <button class="bac-iconbtn" id="bac-roadbtn">罫線</button>
      <button class="bac-iconbtn" id="bac-setbtn">⚙ 設定</button>
    </div>
    <div class="bac-bal"><b id="bac-bal">0</b><small>チップ</small></div>
  </div>
  <div class="bac-roadpanel" id="bac-roadpanel">
    <div class="bac-panelhead"><b>罫線(大路)</b><button class="bac-iconbtn" id="bac-roadclose">✕ 閉じる</button></div>
    <div class="bac-road"><div class="bac-roadgrid" id="bac-road"></div></div>
  </div>
  <div class="bac-dlr" id="bac-dlr"></div>''', 'ヘッダー+罫線パネル')

# ============ ② ベット帯: P/B大きく上段・TIE下段。宣言と縦スライダーを撤去。デザイン行は設定へ ============
rep('''  <div class="bac-betzone">
  <div class="bac-betleft">
  <div class="bac-spots">
    <div class="bac-spot p" data-s="p"><div class="nm">PLAYER</div><div class="od">1 : 1</div><div class="amt" id="bac-ap"></div><div class="bac-pile" id="bac-pile-p"></div></div>
    <div class="bac-spot t" data-s="tie"><div class="nm">TIE</div><div class="od">8 : 1</div><div class="amt" id="bac-at"></div><div class="bac-pile" id="bac-pile-tie"></div></div>
    <div class="bac-spot b" data-s="b"><div class="nm">BANKER</div><div class="od">0.95 : 1</div><div class="amt" id="bac-ab"></div><div class="bac-pile" id="bac-pile-b"></div></div>
  </div>
  <div class="bac-declare">
    <button class="bac-dbtn" id="bac-dlow">読み宣言 LOW 0–4 <i>+15%</i></button>
    <button class="bac-dbtn" id="bac-dhigh">読み宣言 HIGH 5–9 <i>+25%</i></button>
  </div>
  <div class="bac-dhint">最後に絞る1枚の数字を配る前に宣言。的中で賭け金の一部が上乗せ(任意)</div>
  <div class="bac-chips" id="bac-chips"></div>
  <div class="bac-designs" id="bac-designs">
    <span>卓</span>
    <button class="bac-sw auto" data-tbl="auto">自動</button>
    <button class="bac-sw" data-tbl="green"></button><button class="bac-sw" data-tbl="red"></button>
    <button class="bac-sw" data-tbl="blue"></button><button class="bac-sw" data-tbl="noir"></button>
    <button class="bac-sw" data-tbl="purple"></button><button class="bac-sw" data-tbl="teal"></button>
    <span>カード</span>
    <button class="bac-sw bk" data-bk="classic"></button><button class="bac-sw bk" data-bk="red"></button>
    <button class="bac-sw bk" data-bk="blue"></button><button class="bac-sw bk" data-bk="noir"></button>
    <span>背景</span>
    <button class="bac-sw auto" data-room="auto">自動</button>
    <button class="bac-sw" data-room="floor"></button><button class="bac-sw" data-room="vip"></button>
    <button class="bac-sw" data-room="neon"></button><button class="bac-sw" data-room="grand"></button>
    <button class="bac-sw" data-room="hall"></button>
    <button class="bac-sw" data-room="bar"></button><button class="bac-sw" data-room="stair"></button>
  </div>
  <div class="bac-row">
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
</div>''',
'''  <div class="bac-spots">
    <div class="bac-spot p" data-s="p"><div class="nm">PLAYER</div><div class="od">1 : 1</div><div class="amt" id="bac-ap"></div><div class="bac-pile" id="bac-pile-p"></div></div>
    <div class="bac-spot b" data-s="b"><div class="nm">BANKER</div><div class="od">0.95 : 1</div><div class="amt" id="bac-ab"></div><div class="bac-pile" id="bac-pile-b"></div></div>
    <div class="bac-spot t tie-wide" data-s="tie"><div class="nm">TIE</div><div class="od">8 : 1</div><div class="amt" id="bac-at"></div><div class="bac-pile" id="bac-pile-tie"></div></div>
  </div>
  <div class="bac-chips" id="bac-chips"></div>
  <div class="bac-row">
    <button class="bac-btn ghost" id="bac-clear">クリア</button>
    <button class="bac-btn ghost" id="bac-repeat">リピート</button>
    <button class="bac-btn main" id="bac-deal">DEAL</button>
  </div>
  <div class="bac-setpanel" id="bac-setpanel">
    <div class="bac-panelhead"><b>デザイン設定</b><button class="bac-iconbtn" id="bac-setclose">✕ 閉じる</button></div>
    <div class="bac-setlock" id="bac-setlock">🔒 残高 1,000,000 以上でカスタマイズ解放</div>
    <div class="bac-designs" id="bac-designs">
      <span>卓</span>
      <button class="bac-sw auto" data-tbl="auto">自動</button>
      <button class="bac-sw" data-tbl="green"></button><button class="bac-sw" data-tbl="red"></button>
      <button class="bac-sw" data-tbl="blue"></button><button class="bac-sw" data-tbl="noir"></button>
      <button class="bac-sw" data-tbl="purple"></button><button class="bac-sw" data-tbl="teal"></button>
      <span>カード</span>
      <button class="bac-sw bk" data-bk="classic"></button><button class="bac-sw bk" data-bk="red"></button>
      <button class="bac-sw bk" data-bk="blue"></button><button class="bac-sw bk" data-bk="noir"></button>
      <span>背景</span>
      <button class="bac-sw auto" data-room="auto">自動</button>
      <button class="bac-sw" data-room="floor"></button><button class="bac-sw" data-room="vip"></button>
      <button class="bac-sw" data-room="neon"></button><button class="bac-sw" data-room="grand"></button>
      <button class="bac-sw" data-room="hall"></button>
      <button class="bac-sw" data-room="bar"></button><button class="bac-sw" data-room="stair"></button>
      <span>チップ</span>
      <button class="bac-sw auto" data-skin="photo">写真</button>
      <button class="bac-sw auto" data-skin="flat">フラット</button>
    </div>
  </div>
</div>''', 'ベット帯再編')

# ============ ③ CSS: 新レイアウト+パネル+レスポンシブ ============
rep('''  .bac-betzone{display:grid;grid-template-columns:1fr 58px;gap:10px;align-items:stretch}
  .bac-betleft{min-width:0}''',
'''  .bac-headbtns{display:flex;gap:6px;margin:0 10px}
  .bac-iconbtn{padding:7px 10px;border-radius:9px;border:1px solid #2e3844;background:#171d25;
    color:#e8edf2;font-size:11px;font-weight:700;cursor:pointer}
  .bac-iconbtn:hover{border-color:#d9b45f}
  .bac-panelhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
  .bac-panelhead b{color:#d9b45f;font-size:12px;letter-spacing:.08em}
  /* 罫線とデザイン設定は普段は畳んでおく(画面を占有しない) */
  .bac-roadpanel,.bac-setpanel{display:none;background:rgba(13,16,22,.96);border:1px solid rgba(217,180,95,.4);
    border-radius:12px;padding:10px 12px;margin-bottom:8px}
  .bac-roadpanel.on,.bac-setpanel.on{display:block}
  .bac-setlock{display:none;font-size:11px;color:#e0b45a;background:rgba(217,180,95,.1);
    border:1px dashed rgba(217,180,95,.5);border-radius:8px;padding:8px;margin-bottom:8px;text-align:center}
  .bac-setpanel.locked .bac-setlock{display:block}
  .bac-setpanel.locked .bac-designs{opacity:.35;pointer-events:none}''', 'パネルCSS')

# スポット: P/B 上段大きく・TIE 下段ワイド
rep('''  .bac-spots{display:flex;gap:7px;margin-bottom:8px}''',
'''  .bac-spots{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
  .bac-spot.tie-wide{grid-column:1/3;min-height:64px;padding:8px 4px 8px}
  .bac-spot.tie-wide .bac-pile{bottom:6px;height:46px}
  .bac-spot.tie-wide .amt{position:static;margin-top:2px}''', 'スポット配置')

# 縦スライダーCSSを撤去
i0 = s.index('  /* ポーカーのレイズと同じ縦スライダー: ドラッグで額、チップが積み上がる */')
i1 = s.index('.bacv-pill{position:absolute', i0)
i1 = s.index('}', s.index('box-shadow:0 2px 8px rgba(0,0,0,.5)', i1)) + 1
s = s[:i0] + '' + s[i1:]
print('OK 縦スライダーCSS撤去')

# 宣言CSSも撤去(未使用)
i0 = s.index('  .bac-declare{display:flex;gap:7px;margin-bottom:4px}')
i1 = s.index('.bac-dhint{', i0)
i1 = s.index('}', i1) + 1
s = s[:i0] + s[i1:]
print('OK 宣言CSS撤去')

# フラットチップ皮膚 + レスポンシブ
rep('''  .bac-toast .w{font-size:29px;''',
'''  /* チップの見た目(設定で切替): flat は色ベタ */
  .bac-chips.flat .bac-chip{background-image:none !important;border:2.5px dashed rgba(255,255,255,.55)}
  .bac-chips.flat .bac-chip[data-c="0"]{background-color:#3a6bb0}
  .bac-chips.flat .bac-chip[data-c="1"]{background-color:#b0403a}
  .bac-chips.flat .bac-chip[data-c="2"]{background-color:#2e7d55}
  .bac-chips.flat .bac-chip[data-c="3"]{background-color:#31313b}
  .bac-chips.flat .bac-chip[data-c="4"]{background-color:#7a3f9e}
  .bac-chips.flat .bac-chip[data-c="5"]{background-color:#b8901c}
  .bac-chips.flat .bac-chip[data-c="6"]{background-color:#c46420}
  .bac-chips.flat .bac-chip[data-c="7"]{background-color:#c9cdd4;color:#1a1a1a}
  /* ---- スマホ(縦持ち・親指圏) ---- */
  @media (max-width:480px){
    #bac-root{padding:10px 8px 12px;border-radius:12px}
    .bac-title{font-size:13px}
    .bac-headbtns{margin:0 4px}
    .bac-iconbtn{padding:8px 9px;font-size:10.5px}
    .bac-dlr{height:110px;margin-bottom:-44px;width:min(240px,64vw)}
    .bac-table{min-height:180px;padding:10px 10px}
    .bac-card{width:52px;height:73px}
    .bac-cards{min-height:74px}
    .bac-lab{width:52px}
    .bac-lab .t{font-size:22px}
    .bac-spot{min-height:118px}
    .bac-chip{flex:0 1 48px;max-width:48px;font-size:9px}
    .bac-btn{padding:14px}
    .bac-pile img{width:34px;height:34px;margin-left:-17px}
  }
  /* ---- パソコン(広い画面) ---- */
  @media (min-width:900px){
    #bac-root{max-width:720px}
    .bac-dlr{width:min(340px,40vw);height:170px;margin-bottom:-64px}
    .bac-spot{min-height:150px}
    .bac-chip{flex:0 1 64px;max-width:64px;font-size:11px}
    .bac-chip:hover{transform:translateY(-4px) scale(1.06)}
    .bac-spot:hover{border-color:#d9b45f}
    .bac-bigcard{width:min(38vh,280px)}
  }
  .bac-toast .w{font-size:29px;''', 'チップ皮膚+レスポンシブ')

# ============ ④ JS: 宣言と縦スライダーの配線撤去 ============
rep('''    document.getElementById("bac-dlow").onclick = () => {
      if (bacDealing) return;
      bacDeclare = bacDeclare === "L" ? null : "L"; bacRenderBets(); bacBlip(520, 0.08, "triangle", 0.12);
    };
    document.getElementById("bac-dhigh").onclick = () => {
      if (bacDealing) return;
      bacDeclare = bacDeclare === "H" ? null : "H"; bacRenderBets(); bacBlip(780, 0.08, "triangle", 0.12);
    };''',
'''    // 読み宣言は第126弾で廃止(使われず分かりにくいため)。bacDeclare は常に null
    document.getElementById("bac-setbtn").onclick = () => {
      var pn = document.getElementById("bac-setpanel");
      pn.classList.toggle("on");
      pn.classList.toggle("locked", !bacCustomUnlocked());
      document.getElementById("bac-roadpanel").classList.remove("on");
    };
    document.getElementById("bac-setclose").onclick = () => document.getElementById("bac-setpanel").classList.remove("on");
    document.getElementById("bac-roadbtn").onclick = () => {
      document.getElementById("bac-roadpanel").classList.toggle("on");
      document.getElementById("bac-setpanel").classList.remove("on");
    };
    document.getElementById("bac-roadclose").onclick = () => document.getElementById("bac-roadpanel").classList.remove("on");''', '宣言→パネル配線')

rep('''    var dl = document.getElementById("bac-dlow"), dh = document.getElementById("bac-dhigh");
    if (dl) dl.classList.toggle("sel", bacDeclare === "L");
    if (dh) dh.classList.toggle("sel", bacDeclare === "H");''',
'''''', '宣言表示撤去')

i0 = s.index('''    // 縦スライダー(ポーカーのレイズと同じ操作系): ドラッグで額、上端タップでMAX''')
i1 = s.index('barEl.addEventListener("pointercancel", () => { bacVslDrag = false; });', i0)
i1 = s.index('\n', i1) + 1
s = s[:i0] + '' + s[i1:]
print('OK 縦スライダーJS撤去')

rep('''  /** 縦スライダー(細かい額の指定用)の fill / 値ピル / MAX表示を合わせる */
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
  }''',
'''  /** スライダー廃止後の名残り。選択チップが「残り」を超えないよう縮めるだけ */
  function bacSyncSlider() {
    var mx = Math.max(BAC_MIN_STAKE, bacRemaining() || BAC_MIN_STAKE);
    if (bacChip > mx) bacChip = mx;
  }''', 'sync簡素化')

# ============ ⑤ JS: カスタマイズ解放条件 + チップ皮膚 ============
rep('''  function bacApplyDesign() {
    var host = document.getElementById("baccarat");
    if (!host) return;''',
'''  /** カスタマイズの解放条件: 残高 100万以上(それまでは自動/クラシック固定) */
  function bacCustomUnlocked() {
    return (typeof balance === "number" ? balance : 0) >= 1000000;
  }
  function bacApplyDesign() {
    var host = document.getElementById("baccarat");
    if (!host) return;''', '解放条件')

rep('''    var tk = "auto", bk = "classic", rm = "auto";
    try {
      tk = localStorage.getItem("bacTbl") || tk;
      bk = localStorage.getItem("bacBack") || bk;
      rm = localStorage.getItem("bacRoom") || rm;
    } catch (e) {}''',
'''    var tk = "auto", bk = "classic", rm = "auto", sk = "photo";
    try {
      tk = localStorage.getItem("bacTbl") || tk;
      bk = localStorage.getItem("bacBack") || bk;
      rm = localStorage.getItem("bacRoom") || rm;
      sk = localStorage.getItem("bacSkin") || sk;
    } catch (e) {}
    // 解放前は選択を無視して既定(自動/クラシック/写真)に固定
    if (!bacCustomUnlocked()) { tk = "auto"; bk = "classic"; rm = "auto"; sk = "photo"; }''', '皮膚読み込み+固定')

rep('''    document.querySelectorAll(".bac-sw[data-tbl]").forEach((b) => b.classList.toggle("on", b.dataset.tbl === tk));
    document.querySelectorAll(".bac-sw[data-bk]").forEach((b) => b.classList.toggle("on", b.dataset.bk === bk));
    document.querySelectorAll(".bac-sw[data-room]").forEach((b) => b.classList.toggle("on", b.dataset.room === rm));''',
'''    var chipsRow = document.getElementById("bac-chips");
    if (chipsRow) chipsRow.classList.toggle("flat", sk === "flat");
    document.querySelectorAll(".bac-sw[data-tbl]").forEach((b) => b.classList.toggle("on", b.dataset.tbl === tk));
    document.querySelectorAll(".bac-sw[data-bk]").forEach((b) => b.classList.toggle("on", b.dataset.bk === bk));
    document.querySelectorAll(".bac-sw[data-room]").forEach((b) => b.classList.toggle("on", b.dataset.room === rm));
    document.querySelectorAll(".bac-sw[data-skin]").forEach((b) => b.classList.toggle("on", b.dataset.skin === sk));''', '皮膚適用')

rep('''        if (b.dataset.room) localStorage.setItem("bacRoom", b.dataset.room);
      } catch (e2) {}''',
'''        if (b.dataset.room) localStorage.setItem("bacRoom", b.dataset.room);
        if (b.dataset.skin) localStorage.setItem("bacSkin", b.dataset.skin);
      } catch (e2) {}''', '皮膚保存')

# チップに data-c を復活(フラット用)
rep('''      `<button class="bac-chip" data-v="${v}" style="background-image:url(${BAC_CHIP_IMGS[Math.min(i, 7)]})"><b>${fmt(v)}</b></button>`).join("");''',
'''      `<button class="bac-chip" data-v="${v}" data-c="${Math.min(i, 7)}" style="background-image:url(${BAC_CHIP_IMGS[Math.min(i, 7)]})"><b>${fmt(v)}</b></button>`).join("");''', 'data-c復活')

# ============ ⑥ 引けば勝ちは全部の札を個別に(J/Q/Kまとめ廃止)。0-9はhot強調 ============
rep('''      if (wr >= 11) { if (wl.indexOf("J/Q/K") < 0) wl.push("J/Q/K"); }
      else wl.push(bacRankLabel(wr));''',
'''      wl.push(bacRankLabel(wr));   // J/Q/K もまとめず全部並べる(第126弾)''', '全札表示')

rep('''    document.querySelectorAll("#bac-grid10 .bac-g10").forEach((d) => {
      d.classList.toggle("dead", !vals[+d.dataset.v]);
    });
    bacUpdateOdds(alive);''',
'''    document.querySelectorAll("#bac-grid10 .bac-g10").forEach((d) => {
      var possible = !!vals[+d.dataset.v];
      d.classList.toggle("dead", !possible);
      // まだあり得る数字のうち「出れば勝ち」を金枠で強調
      d.classList.toggle("hot", possible && d.classList.contains("win"));
    });
    bacUpdateOdds(alive);''', 'hot強調')

rep('''  .bac-g10.dead{opacity:.13;transform:scale(.9)}''',
'''  .bac-g10.dead{opacity:.13;transform:scale(.9)}
  .bac-g10.hot{box-shadow:0 0 0 2px #d9b45f,0 0 14px rgba(217,180,95,.75);transform:scale(1.06)}''', 'hotCSS')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
