# -*- coding: utf-8 -*-
# 第150弾: 秘密卓(バイイン最大50京)の解禁演出。
# 卓の存在自体はサーバーが隠しているので、クライアントは「初めて現れた瞬間」を祝うだけ。
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

# ① 秘密卓の紋章と解禁演出
rep('''  function renderLobby() {''',
'''  /**
   * 秘密卓(第150弾)。存在の秘匿はサーバーが担う(残高が足りない人には
   * lobby.tables にも出ないし、卓IDを当てても観戦・着席できない)。
   * ここは「初めてロビーに現れた瞬間」を一度だけ祝う演出だけを持つ。
   */
  var SECRET_TABLES = {
    "abyss-6": { seal: "__SEALABYSS__", tag: "\\u6DF1\\u6DF5", lead: "\\u9759\\u304B\\u306A\\u6C34\\u9762\\u306E\\u4E0B\\u306B\\u3001\\u8AB0\\u3082\\u77E5\\u3089\\u306A\\u3044\\u5353\\u304C\\u3042\\u308B" },
    "cosmos-6": { seal: "__SEALCOSMOS__", tag: "\\u5929\\u4E0A", lead: "\\u661F\\u306E\\u5E2D\\u304C\\u3001\\u3042\\u306A\\u305F\\u306E\\u305F\\u3081\\u306B\\u7A7A\\u3044\\u305F" },
    "zenith-6": { seal: "__SEALZENITH__", tag: "\\u6975", lead: "\\u3053\\u3053\\u3088\\u308A\\u5148\\u306F\\u306A\\u3044\\u3002\\u6700\\u5F8C\\u306E\\u5353" }
  };
  function secretSeen() {
    try { return JSON.parse(localStorage.getItem("secretSeen") || "[]"); } catch (e) { return []; }
  }
  function secretMarkSeen(id) {
    try {
      var a = secretSeen();
      if (a.indexOf(id) < 0) { a.push(id); localStorage.setItem("secretSeen", JSON.stringify(a)); }
    } catch (e) {}
  }
  /** 新しく見えるようになった秘密卓があれば、封印が解ける演出を出す */
  function secretRevealCheck() {
    var seen = secretSeen();
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i], sc = SECRET_TABLES[t.tableId];
      if (!sc || seen.indexOf(t.tableId) >= 0) continue;
      secretMarkSeen(t.tableId);
      secretReveal(t, sc);
      return;   // 一度に1卓だけ(続きは次のロビー更新で)
    }
  }
  function secretReveal(t, sc) {
    var ov = document.createElement("div");
    ov.className = "secret-ov";
    ov.innerHTML =
      '<div class="secret-card">' +
      '<div class="secret-rays"></div>' +
      '<div class="secret-sealwrap"><img class="secret-seal" src="' + sc.seal + '" alt="">' +
      '<span class="secret-crack"></span></div>' +
      '<div class="secret-tag">' + sc.tag + "</div>" +
      '<h3 class="secret-name">' + escapeHtml(t.name) + "</h3>" +
      '<p class="secret-lead">' + sc.lead + "</p>" +
      '<div class="secret-buy"><span>\\u30D0\\u30A4\\u30A4\\u30F3</span><b>' +
      fmt(t.minBuyIn) + " \\u301C " + fmt(t.maxBuyIn) + "</b></div>" +
      '<p class="secret-note">\\u3053\\u306E\\u5353\\u306F\\u3001\\u8CAF\\u3081\\u305F\\u4EBA\\u306B\\u3060\\u3051\\u898B\\u3048\\u307E\\u3059</p>' +
      '<button class="primary secret-ok">\\u5353\\u3092\\u898B\\u308B</button>' +
      "</div>";
    document.body.appendChild(ov);
    try { playFanfare && playFanfare(); } catch (e) {}
    requestAnimationFrame(() => ov.classList.add("on"));
    ov.querySelector(".secret-ok").onclick = () => ov.remove();
    ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  }

  function renderLobby() {''', '秘密卓の演出')

# ② ロビー更新のたびに新規解禁を見る + 秘密卓のカードに専用の飾り
rep('''    each("[data-join]", (b) => {
      b.onclick = () => joinTable(b.dataset.join);
    });
  }''',
'''    each("[data-join]", (b) => {
      b.onclick = () => joinTable(b.dataset.join);
    });
    each(".tcard", (c) => {
      var btn = c.querySelector("[data-join]");
      if (btn && SECRET_TABLES[btn.dataset.join]) c.classList.add("secret");
    });
    secretRevealCheck();
  }''', 'ロビーで解禁チェック')

# ③ CSS
rep('''  .bac-sw.on{border-color:#d9b45f;box-shadow:0 0 8px rgba(217,180,95,.5)}''',
'''  .bac-sw.on{border-color:#d9b45f;box-shadow:0 0 8px rgba(217,180,95,.5)}
  /* --- 秘密卓(第150弾) --- */
  .tcard.secret{border-color:rgba(217,180,95,.85);
    box-shadow:0 0 0 1px rgba(217,180,95,.35), 0 10px 30px rgba(0,0,0,.55), 0 0 26px rgba(217,180,95,.22)}
  .tcard.secret h3::after{content:"\\5C01\\5370\\89E3\\9664";margin-left:8px;font-size:9px;font-weight:900;
    letter-spacing:.14em;color:#241503;background:linear-gradient(180deg,#ffe9a8,#d9a53d);
    padding:2px 7px;border-radius:8px;vertical-align:middle}
  .secret-ov{position:fixed;inset:0;z-index:420;display:flex;align-items:center;justify-content:center;
    background:radial-gradient(60% 50% at 50% 45%, rgba(30,22,10,.72), rgba(0,0,0,.94) 70%);
    opacity:0;transition:opacity .5s ease;padding:18px;overflow-y:auto}
  .secret-ov.on{opacity:1}
  .secret-card{position:relative;max-width:340px;width:100%;text-align:center;color:#e8edf2}
  .secret-rays{position:absolute;left:50%;top:96px;width:520px;height:520px;transform:translate(-50%,-50%);
    pointer-events:none;opacity:0;
    background:conic-gradient(from 0deg, rgba(255,220,140,.28) 0deg 8deg, transparent 8deg 26deg,
      rgba(255,220,140,.2) 26deg 32deg, transparent 32deg 60deg, rgba(255,220,140,.26) 60deg 66deg,
      transparent 66deg 96deg, rgba(255,220,140,.18) 96deg 104deg, transparent 104deg 140deg,
      rgba(255,220,140,.24) 140deg 147deg, transparent 147deg 180deg, rgba(255,220,140,.2) 180deg 187deg,
      transparent 187deg 220deg, rgba(255,220,140,.26) 220deg 227deg, transparent 227deg 260deg,
      rgba(255,220,140,.18) 260deg 267deg, transparent 267deg 300deg, rgba(255,220,140,.24) 300deg 307deg,
      transparent 307deg 340deg, rgba(255,220,140,.2) 340deg 347deg, transparent 347deg 360deg);
    -webkit-mask-image:radial-gradient(closest-side, #000 30%, transparent 72%);
    mask-image:radial-gradient(closest-side, #000 30%, transparent 72%);
    animation:secRays 26s linear infinite, secRaysIn 1.1s ease-out .18s forwards}
  @keyframes secRays{to{transform:translate(-50%,-50%) rotate(360deg)}}
  @keyframes secRaysIn{to{opacity:1}}
  .secret-sealwrap{position:relative;display:inline-block}
  .secret-seal{width:min(56vw,196px);height:auto;display:block;
    filter:drop-shadow(0 12px 30px rgba(0,0,0,.7)) drop-shadow(0 0 18px rgba(255,200,90,.45));
    animation:secSeal .9s cubic-bezier(.16,1.5,.3,1) both}
  @keyframes secSeal{
    0%{transform:scale(.42) rotate(-24deg);opacity:0;filter:brightness(2.4) blur(6px)}
    58%{transform:scale(1.08) rotate(3deg);opacity:1;filter:brightness(1.35) blur(0)}
    100%{transform:scale(1) rotate(0);opacity:1}}
  /* 封印が割れる白い線 */
  .secret-crack{position:absolute;left:50%;top:50%;width:2px;height:0;transform:translate(-50%,-50%) rotate(18deg);
    background:linear-gradient(180deg,transparent,#fff6d8,transparent);
    box-shadow:0 0 14px rgba(255,235,180,.95);pointer-events:none;
    animation:secCrack .5s ease-out .34s both}
  @keyframes secCrack{0%{height:0;opacity:0}40%{opacity:1}100%{height:118%;opacity:0}}
  .secret-tag{margin-top:14px;font-size:10px;font-weight:900;letter-spacing:.5em;color:#d9b45f;
    text-indent:.5em;animation:secUp .6s ease-out .5s both}
  .secret-name{margin:4px 0 0;font-size:27px;font-weight:900;letter-spacing:.06em;
    background:linear-gradient(180deg,#fff6d8,#d9a53d);-webkit-background-clip:text;background-clip:text;
    -webkit-text-fill-color:transparent;animation:secUp .6s ease-out .58s both}
  .secret-lead{margin:8px 0 0;font-size:12px;line-height:1.7;color:#b9c4cf;
    animation:secUp .6s ease-out .66s both}
  .secret-buy{margin:14px auto 0;max-width:270px;padding:9px 12px;border-radius:12px;
    border:1px solid rgba(217,180,95,.5);background:rgba(217,180,95,.09);
    animation:secUp .6s ease-out .74s both}
  .secret-buy span{display:block;font-size:9px;letter-spacing:.22em;color:#8b97a5}
  .secret-buy b{display:block;margin-top:2px;font-size:15px;color:#ffe9a8;font-variant-numeric:tabular-nums}
  .secret-note{margin:9px 0 0;font-size:10.5px;color:#8b97a5;animation:secUp .6s ease-out .8s both}
  .secret-ok{margin-top:16px;min-width:160px;animation:secUp .6s ease-out .88s both}
  @keyframes secUp{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}}''', '秘密卓CSS')

# ④ 画像データ
for key, fname in [('__SEALABYSS__','seal_abyss.webp'),
                   ('__SEALCOSMOS__','seal_cosmos.webp'),
                   ('__SEALZENITH__','seal_zenith.webp')]:
    rep('"' + key + '"', '"' + uri(fname) + '"', key)

open(p, 'w', encoding='utf8').write(s)
print('DONE')
