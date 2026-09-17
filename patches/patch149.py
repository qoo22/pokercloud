# -*- coding: utf-8 -*-
# 第149弾: 絵柄スキン+2(海洋/エジプト) / リスピン時の左リール上段欠け修正 /
#          クラシックのWILDリボン重複解消
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

# ① リスピン固定リールの上段欠け修正:
#    .sl-grid::before(回転筒の上端暗転, z-index:4)が locked リール(z-index:2)の
#    上に描画され、第144弾の不透明下地とあいまって一番上のWILDの頭が黒に溶けていた。
#    固定リールは「回っていない」ので筒の暗転より前面(z-index:5)に出す
rep('''  .sl-reel.locked { box-shadow:0 0 0 2px #ffd76a, 0 0 18px rgba(255,215,106,.75); border-radius:6px; z-index:2; }''',
'''  /* z-index:5 = .sl-grid::before/after(筒の暗転, z4)より前面。固定リールの頭が欠けない */
  .sl-reel.locked { box-shadow:0 0 0 2px #ffd76a, 0 0 18px rgba(255,215,106,.75); border-radius:6px; z-index:5; }''', '固定リール前面化')

# ② クラシック(元)のWILD絵柄は画像自体に「WILD」と書いてあるのでリボンを重複表示しない
rep('''  #slot .sl-cell.wd{box-shadow:inset 0 0 0 2px rgba(190,120,255,.85), 0 0 10px rgba(160,80,255,.4)}''',
'''  #slot .sl-cell.wd{box-shadow:inset 0 0 0 2px rgba(190,120,255,.85), 0 0 10px rgba(160,80,255,.4)}
  /* 元(クラシック)のWILDは画像に WILD と描いてあるのでリボンは出さない(第149弾) */
  body.syms-classic #slot .sl-cell.wd::after{display:none}
  body.syms-classic .sl-lockwild::after{display:none}''', 'クラシックのリボン抑止')

rep('''    slotStripBuild();
    return sk;
  }''',
'''    try { document.body.classList.toggle("syms-classic", sk === "classic"); } catch (e2) {}
    slotStripBuild();
    return sk;
  }''', 'syms-classicクラス')

# ③ 絵柄スキン: 海洋/エジプトを追加
rep('''  /** スキンごとの役名(第132弾)。配当は変えず、呼び名だけテーマに合わせる */''',
'''  SLOT_SYM_SKINS.ocean = {
    chip: "__OCHIP__", club: "__OCLUB__", diamond: "__ODIAMOND__", heart: "__OHEART__",
    spade: "__OSPADE__", crown: "__OCROWN__", seven: "__OSEVEN__", wild: "__OWILD__", scatter: "__OSCATTER__"
  };
  SLOT_SYM_SKINS.egypt = {
    chip: "__ECHIP__", club: "__ECLUB__", diamond: "__EDIAMOND__", heart: "__EHEART__",
    spade: "__ESPADE__", crown: "__ECROWN__", seven: "__ESEVEN__", wild: "__EWILD__", scatter: "__ESCATTER__"
  };
  /** スキンごとの役名(第132弾)。配当は変えず、呼び名だけテーマに合わせる */''', '海洋/エジプト画像マップ')

rep('''    space: { chip: "隕石", club: "UFO", diamond: "クリスタル", heart: "火星",
      spade: "ロケット", crown: "土星", seven: "ネオンセブン", wild: "ブラックホール", scatter: "彗星" }
  };''',
'''    space: { chip: "隕石", club: "UFO", diamond: "クリスタル", heart: "火星",
      spade: "ロケット", crown: "土星", seven: "ネオンセブン", wild: "ブラックホール", scatter: "彗星" },
    ocean: { chip: "巻き貝", club: "ヒトデ", diamond: "海の雫", heart: "珊瑚ハート",
      spade: "イカリ", crown: "トライデント", seven: "マリンセブン", wild: "クラーケン", scatter: "宝箱" },
    egypt: { chip: "スカラベ", club: "アンク", diamond: "ピラミッド", heart: "ラーの宝珠",
      spade: "ホルスの目", crown: "ファラオ", seven: "黄金セブン", wild: "スフィンクス", scatter: "翼の太陽" }
  };''', '役名追加')

rep('''        '<button class="bac-sw" data-sy="space"></button>';''',
'''        '<button class="bac-sw" data-sy="space"></button>' +
        '<button class="bac-sw" data-sy="ocean"></button>' +
        '<button class="bac-sw" data-sy="egypt"></button>';''', 'スワッチ追加')

# ④ 画像データ
for key, fname in [
    ('__OCHIP__','o_chip_t.webp'),('__OCLUB__','o_club_t.webp'),('__ODIAMOND__','o_diamond_t.webp'),
    ('__OHEART__','o_heart_t.webp'),('__OSPADE__','o_spade_t.webp'),('__OCROWN__','o_crown_t.webp'),
    ('__OSEVEN__','o_seven_t.webp'),('__OWILD__','o_wild_t.webp'),('__OSCATTER__','o_scatter_t.webp'),
    ('__ECHIP__','e_chip_t.webp'),('__ECLUB__','e_club_t.webp'),('__EDIAMOND__','e_diamond_t.webp'),
    ('__EHEART__','e_heart_t.webp'),('__ESPADE__','e_spade_t.webp'),('__ECROWN__','e_crown_t.webp'),
    ('__ESEVEN__','e_seven_t.webp'),('__EWILD__','e_wild_t.webp'),('__ESCATTER__','e_scatter_t.webp'),
]:
    rep('"' + key + '"', '"' + uri(fname) + '"', key)

open(p, 'w', encoding='utf8').write(s)
print('DONE')
