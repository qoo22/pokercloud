# -*- coding: utf-8 -*-
# 第155弾: フェルト6種を追加し、卓で選べるようにする
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

K = ['green', 'wine', 'noir', 'navy', 'jade', 'suede']

# ① 画像変数(横・縦)
rep('''    --felt-arena:url("data:image''',
    ''.join('    --felt-%s:url("%s");\n' % (k, uri('out_%s.webp' % k)) for k in K) +
    '''    --felt-arena:url("data:image''', 'フェルト変数(横)')
rep('''    --felt-t5-p:url("data:image''',
    ''.join('    --felt-%s-p:url("%s");\n' % (k, uri('outp_%s.webp' % k)) for k in K) +
    '''    --felt-t5-p:url("data:image''', 'フェルト変数(縦)')

# ② 卓面CSS。選んだフェルトは卓の格より優先される
GLOW = {
  'green': 'rgba(80,200,140,.4)', 'wine': 'rgba(224,90,90,.45)', 'noir': 'rgba(217,180,95,.6)',
  'navy': 'rgba(90,157,224,.45)', 'jade': 'rgba(64,200,180,.4)', 'suede': 'rgba(200,150,90,.45)',
}
rep('''  /* 秘密卓の卓面(第154弾)。''',
    ''.join(
      '  body[data-felt="%s"] .felt-surface { background:radial-gradient(ellipse at 50%% 38%%, rgba(255,255,255,.07), rgba(0,0,0,0) 52%%, rgba(0,0,0,.34) 100%%), var(--felt-%s) center/cover no-repeat !important;\n'
      '    box-shadow:inset 0 0 70px rgba(0,0,0,.45), inset 0 0 0 3px %s, 0 22px 46px rgba(0,0,0,.7) !important; }\n' % (k, k, GLOW[k])
      for k in K) +
    '''  /* 秘密卓の卓面(第154弾)。''', '卓面CSS(横)')
rep('''    body[data-felt="7"] .felt-surface {''',
    ''.join(
      '    body[data-felt="%s"] .felt-surface { background:radial-gradient(ellipse at 50%% 38%%, rgba(255,255,255,.07), rgba(0,0,0,0) 52%%, rgba(0,0,0,.34) 100%%), var(--felt-%s-p) center/cover no-repeat !important; }\n' % (k, k)
      for k in K) +
    '''    body[data-felt="7"] .felt-surface {''', '卓面CSS(縦)')

# ③ 選んだフェルトを最優先で当てる
rep('''          let tierF = SECRET_FELT[state.tableId]
            || (bbT >= 25e11 ? "6" : bbT >= 5e11 ? "5" : bbT >= 5e10 ? "4" : bbT >= 5e8 ? "3" : bbT >= 1e7 ? "2" : "1");
          document.body.dataset.felt = !isKnownCash && !isPvt ? "arena" : tierF;''',
'''          let tierF = SECRET_FELT[state.tableId]
            || (bbT >= 25e11 ? "6" : bbT >= 5e11 ? "5" : bbT >= 5e10 ? "4" : bbT >= 5e8 ? "3" : bbT >= 1e7 ? "2" : "1");
          feltAuto = !isKnownCash && !isPvt ? "arena" : tierF;
          feltApply();''', '自動値の保存')

rep('''  function renderLobby() {''',
'''  /**
   * 卓面(フェルト)の選択(第155弾)。
   * 「自動」なら卓の格で決まる従来どおりの見た目、選べばどの卓でもその生地になる。
   * 見た目だけの設定なので、卓や配当には一切影響しない
   */
  var FELTS = [
    { k: "green", n: "\\u30AF\\u30E9\\u30B7\\u30C3\\u30AF\\u7DD1" },
    { k: "wine",  n: "\\u30EF\\u30A4\\u30F3\\u30EC\\u30C3\\u30C9" },
    { k: "noir",  n: "\\u9ED2\\u91D1" },
    { k: "navy",  n: "\\u7D3A" },
    { k: "jade",  n: "\\u7FE1\\u7FE0\\u306E\\u9752\\u6D77\\u6CE2" },
    { k: "suede", n: "\\u8336\\u30B9\\u30A8\\u30FC\\u30C9" }
  ];
  var feltAuto = "1";
  function feltPick() {
    try { return localStorage.getItem("feltPick") || "auto"; } catch (e) { return "auto"; }
  }
  function feltApply() {
    var pick = feltPick();
    var ok = pick === "auto" || FELTS.some((f) => f.k === pick);
    document.body.dataset.felt = ok && pick !== "auto" ? pick : feltAuto;
    document.querySelectorAll("#felt-pick .felt-sw").forEach((b) => {
      b.classList.toggle("on", b.dataset.f === (ok ? pick : "auto"));
    });
  }
  var feltBuilt = false;
  function feltBuild() {
    var host = document.getElementById("felt-pick");
    if (!host || feltBuilt) { feltApply(); return; }
    feltBuilt = true;
    host.innerHTML =
      '<button class="felt-sw auto" data-f="auto">\\u81EA\\u52D5</button>' +
      FELTS.map((f) => '<button class="felt-sw" data-f="' + f.k + '" title="' + f.n + '"></button>').join("");
    // 見本の絵柄は CSS 変数から当てる(同じbase64をHTMLに二重に埋めない)
    host.querySelectorAll(".felt-sw[data-f]").forEach((b) => {
      if (b.dataset.f !== "auto") b.style.backgroundImage = "var(--felt-" + b.dataset.f + ")";
    });
    host.addEventListener("click", (e) => {
      var b = e.target.closest(".felt-sw");
      if (!b) return;
      try { localStorage.setItem("feltPick", b.dataset.f); } catch (e2) {}
      feltApply();
    });
    feltApply();
  }

  function renderLobby() {''', 'フェルト選択JS')

# ④ パネルのHTML(席の操作と同じサイドパネル内)
rep('''    <div class="panel hidden" id="tour-hud">''',
'''    <details class="panel" id="felt-panel">
      <summary>\\u5353\\u306E\\u751F\\u5730\\uFF08\\u30D5\\u30A7\\u30EB\\u30C8\\uFF09</summary>
      <div class="felt-row" id="felt-pick"></div>
      <p class="felt-note">\\u898B\\u305F\\u76EE\\u3060\\u3051\\u306E\\u8A2D\\u5B9A\\u3067\\u3059\\u3002\\u300C\\u81EA\\u52D5\\u300D\\u306F\\u5353\\u306E\\u683C\\u306B\\u5408\\u308F\\u305B\\u3066\\u5909\\u308F\\u308A\\u307E\\u3059</p>
    </details>
    <div class="panel hidden" id="tour-hud">''', 'パネルHTML')

# ⑤ パネルのCSS
rep('''  .bac-sw.on{border-color:#d9b45f;box-shadow:0 0 8px rgba(217,180,95,.5)}''',
'''  .bac-sw.on{border-color:#d9b45f;box-shadow:0 0 8px rgba(217,180,95,.5)}
  /* 卓の生地えらび(第155弾) */
  .felt-row{display:flex;gap:7px;flex-wrap:wrap;padding:4px 0 2px}
  .felt-sw{width:46px;height:32px;border-radius:7px;cursor:pointer;padding:0;
    border:1.5px solid #2e3844;background-size:cover;background-position:center}
  .felt-sw.auto{font-size:10px;font-weight:800;color:#d9b45f;background:#171d25;line-height:1}
  .felt-sw.on{border-color:#d9b45f;box-shadow:0 0 9px rgba(217,180,95,.6)}
  .felt-note{margin:6px 0 0;font-size:10.5px;color:#8b97a5;line-height:1.5}''', 'パネルCSS')

# ⑥ 卓を開いたときに組み立てる
rep('''    $("log").innerHTML = "";
    const info = tables.find((t) => t.tableId === tableId);''',
'''    $("log").innerHTML = "";
    feltBuild();
    const info = tables.find((t) => t.tableId === tableId);''', '卓を開いたとき')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
