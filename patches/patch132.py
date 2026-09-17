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

# ① 和風・宇宙スキンと、スキンごとの役名を追加
rep('''  var SLOT_IMG_BASE = null;''',
'''  SLOT_SYM_SKINS.wa = {
    chip: "__WCHIP__", club: "__WCLUB__", diamond: "__WDIAMOND__", heart: "__WHEART__",
    spade: "__WSPADE__", crown: "__WCROWN__", seven: "__WSEVEN__", wild: "__WWILD__", scatter: "__WSCATTER__"
  };
  SLOT_SYM_SKINS.space = {
    chip: "__SCHIP__", club: "__SCLUB__", diamond: "__SDIAMOND__", heart: "__SHEART__",
    spade: "__SSPADE__", crown: "__SCROWN__", seven: "__SSEVEN__", wild: "__SWILD__", scatter: "__SSCATTER__"
  };
  /** スキンごとの役名(第132弾)。配当は変えず、呼び名だけテーマに合わせる */
  var SLOT_SYM_NAMES = {
    gems: { chip: "金貨", club: "エメラルド", diamond: "サファイア", heart: "ルビー",
      spade: "オニキス", crown: "ティアラ", seven: "ジュエルセブン", wild: "虹色ダイヤ", scatter: "金の星" },
    fruits: { chip: "チェリー", club: "ぶどう", diamond: "レモン", heart: "スイカ",
      spade: "プラム", crown: "ベル", seven: "赤セブン", wild: "BAR", scatter: "スター" },
    wa: { chip: "小判", club: "松", diamond: "扇", heart: "だるま",
      spade: "錦鯉", crown: "兜", seven: "朱セブン", wild: "黄金龍", scatter: "桜" },
    space: { chip: "隕石", club: "UFO", diamond: "クリスタル", heart: "火星",
      spade: "ロケット", crown: "土星", seven: "ネオンセブン", wild: "ブラックホール", scatter: "彗星" }
  };
  /** 現在のスキンでの役名。無ければ null(=既定の名前を使う) */
  function slotSymSkinName(key) {
    var sk = "classic";
    try { sk = localStorage.getItem("slSyms") || sk; } catch (e) {}
    var m = SLOT_SYM_NAMES[sk];
    return m ? (m[key] || null) : null;
  }
  var SLOT_IMG_BASE = null;''', 'スキン追加+役名')

# ② slotSymName はスキン名を最優先に
rep('''  function slotSymName(sv, key) {
    if (key === "wild") return "WILD";
    if (key === "scatter") return "SCATTER";
    const f = ((sv && sv.symbols) || []).find((x) => x.key === key);
    return f ? f.name : key;
  }''',
'''  function slotSymName(sv, key) {
    const ov = slotSymSkinName(key);
    if (ov) return ov;
    if (key === "wild") return "WILD";
    if (key === "scatter") return "SCATTER";
    const f = ((sv && sv.symbols) || []).find((x) => x.key === key);
    return f ? f.name : key;
  }''', 'slotSymName上書き')

# ③ 配当表の名前もスキンに追随
rep('''          <td><img class="pay-ico" src="${SLOT_IMG[sym.key]}" alt=""> ${escapeHtml(sym.name)}</td>''',
'''          <td><img class="pay-ico" src="${SLOT_IMG[sym.key]}" alt=""> ${escapeHtml(slotSymSkinName(sym.key) || sym.name)}</td>''', '配当表の名前')

rep('''src="${SLOT_IMG.wild}" alt=""> \\u30EF\\u30A4\\u30EB\\u30C9</td>''',
'''src="${SLOT_IMG.wild}" alt=""> ${escapeHtml(slotSymSkinName("wild") || "\\u30EF\\u30A4\\u30EB\\u30C9")}</td>''', 'WILD行の名前')

rep('''src="${SLOT_IMG.scatter}" alt=""> \\u30B9\\u30AD\\u30E3\\u30C3\\u30BF\\u30FC</td>''',
'''src="${SLOT_IMG.scatter}" alt=""> ${escapeHtml(slotSymSkinName("scatter") || "\\u30B9\\u30AD\\u30E3\\u30C3\\u30BF\\u30FC")}</td>''', 'SCATTER行の名前')

# ④ スワッチ追加
rep('''        '<button class="bac-sw" data-sy="gems"></button>' +
        '<button class="bac-sw" data-sy="fruits"></button>';''',
'''        '<button class="bac-sw" data-sy="gems"></button>' +
        '<button class="bac-sw" data-sy="fruits"></button>' +
        '<button class="bac-sw" data-sy="wa"></button>' +
        '<button class="bac-sw" data-sy="space"></button>';''', 'スワッチ追加')

# ⑤ 画像データ
for key, fname in [
    ('__WCHIP__','w_chip_t.webp'),('__WCLUB__','w_club_t.webp'),('__WDIAMOND__','w_diamond_t.webp'),
    ('__WHEART__','w_heart_t.webp'),('__WSPADE__','w_spade_t.webp'),('__WCROWN__','w_crown_t.webp'),
    ('__WSEVEN__','w_seven_t.webp'),('__WWILD__','w_wild_t.webp'),('__WSCATTER__','w_scatter_t.webp'),
    ('__SCHIP__','s_chip_t.webp'),('__SCLUB__','s_club_t.webp'),('__SDIAMOND__','s_diamond_t.webp'),
    ('__SHEART__','s_heart_t.webp'),('__SSPADE__','s_spade_t.webp'),('__SCROWN__','s_crown_t.webp'),
    ('__SSEVEN__','s_seven_t.webp'),('__SWILD__','s_wild_t.webp'),('__SSCATTER__','s_scatter_t.webp'),
]:
    rep('"' + key + '"', '"' + uri(fname) + '"', key)

open(p, 'w', encoding='utf8').write(s)
print('DONE')
