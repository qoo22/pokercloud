# -*- coding: utf-8 -*-
# 第164弾: WINNING TUNNEL の書体設計を実機に寄せる
#   ・役割ごとに4種の文字デザイン(BET数字/情報表示/説明文/WINNER!)
#   ・色で情報の種類を分ける(WAGER=シアン / WIN=黄 / PAID=黄緑 / CREDITS=シアン)
#   ・ビットマップフォントを埋め込み、CRTの走査線と滲みを足す
import sys, base64, os
p = sys.argv[1]
img = sys.argv[2]
s = open(p, encoding='utf8').read()
def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)
def b64(f):
    with open(os.path.join(img, f), 'rb') as fh:
        return base64.b64encode(fh.read()).decode()

font = b64('pressstart.woff2')
winner = 'data:image/webp;base64,' + b64('winner.webp')

# ① フォントを埋め込む(SIL Open Font License 1.1)
rep('''  /* --- 台えらび(第161弾)。台が増えても横に並ぶだけ --- */''',
'''  /* ビットマップフォント(第164弾)。実機は文字をドット絵として描いているので、
     一般的なフォントを並べるより、これを使った方が雰囲気が出る。
     Press Start 2P / SIL Open Font License 1.1 (c) Cody "CodeMan38" Boisclair */
  @font-face{font-family:"PxArcade";font-style:normal;font-weight:400;font-display:block;
    src:url("data:font/woff2;base64,__FONT__") format("woff2")}
  /* --- 台えらび(第161弾)。台が増えても横に並ぶだけ --- */''', 'フォント埋め込み')

# ② 書体設計。役割ごとに使い分ける
rep('''  /* --- WINNING TUNNEL の筐体 --- */''',
'''  /* ==== WINNING TUNNEL の文字設計(第164弾) ====
     実機は全部を同じ書体にせず、役割で4種類を使い分けている:
       ・BET数字       … 太い角ゴシック。数を即座に読ませる
       ・情報表示       … ドット系ゴシック。色で種類を分ける
       ・説明文         … 等幅ビットマップ。淡々と結果を説明する
       ・WINNER!        … 装飾セリフ(画像)。ここだけ感情表現
     基本情報は無機質に、当選の喜びだけ看板風にする対比が肝 */
  #tunnel .px{font-family:"PxArcade","Courier New",monospace;
    -webkit-font-smoothing:none;font-smooth:never;letter-spacing:.04em}
  /* 数値は桁を読み違えないよう、字間を一定にして少し大きく */
  #tunnel .num{font-family:"PxArcade","Courier New",monospace;font-variant-numeric:tabular-nums;
    letter-spacing:.06em;color:#dfe2ff;text-shadow:1px 1px 0 #05081e,2px 2px 0 rgba(0,0,0,.55)}
  /* --- WINNING TUNNEL の筐体 --- */''', '書体の土台')

# ③ 情報表示(WAGER/WIN/PAID と CREDITS)
rep('''  .tn-info{display:flex;justify-content:space-between;align-items:center;gap:8px;
    margin-top:7px;font-size:11px;color:#b9c4cf}
  .tn-info b{color:#ffe9a8;font-size:13px;font-variant-numeric:tabular-nums}''',
'''  /* 左下の情報ブロックと、右下のクレジット。色だけで種類が分かるようにする */
  .tn-info{display:flex;justify-content:space-between;align-items:flex-end;gap:10px;margin-top:9px}
  .tn-stats{display:grid;grid-template-columns:auto 1fr;gap:1px 10px;font-size:9px;line-height:1.5}
  .tn-stats .k{letter-spacing:.14em}
  .tn-stats .k.wager{color:#5fe3ff}
  .tn-stats .k.win{color:#ffd23f}
  .tn-stats .k.paid{color:#9bea4a}
  .tn-stats .v{text-align:right;font-size:11px}
  .tn-credits{text-align:center;min-width:92px}
  .tn-credits .k{display:block;font-size:9px;letter-spacing:.2em;color:#5fe3ff;
    text-shadow:1px 1px 0 #041033}
  .tn-credits .v{display:block;font-size:15px;margin-top:2px}''', '情報表示')

# ④ 説明文(キャプション)と WINNER!
rep('''  .tn-msg{margin-top:7px;text-align:center;font-size:12px;font-weight:800;color:#ffe9a8;min-height:18px}''',
'''  /* リール直下の説明文。倍率も巨大表示せず、1行の説明として淡々と出す */
  .tn-cap{margin-top:6px;text-align:center;font-size:8.5px;color:#fff;letter-spacing:.12em;
    line-height:1.5;text-shadow:1px 1px 0 #05081e;min-height:12px}
  /* 当選表示。ここだけ看板風(画像)。情報表示との対比で目立たせる */
  .tn-winner{display:block;margin:6px auto 0;width:min(62%,300px);height:auto;
    image-rendering:pixelated;filter:drop-shadow(2px 2px 0 rgba(40,6,40,.9));
    animation:tnWin .5s steps(3) both}
  @keyframes tnWin{from{opacity:0;transform:scale(.82)}to{opacity:1;transform:scale(1)}}
  .tn-msg{margin-top:6px;text-align:center;font-size:9px;color:#ffe9a8;min-height:14px;
    letter-spacing:.1em;text-shadow:1px 1px 0 #05081e}''', '説明文とWINNER')

# ⑤ BETプレートとペイライン
rep('''  /* 盤面 3×3 */''',
'''  /* 有効ラインの入口に置く BET プレート。ラインの色と対応させ、
     そこから同色の細い線がリールへ伸びる(実機の見せ方) */
  .tn-board{display:flex;align-items:stretch;gap:3px}
  .tn-rail{display:flex;flex-direction:column;justify-content:space-around;gap:2px;width:26px}
  .tn-plate{position:relative;font-size:8px;color:#fff;text-align:center;padding:2px 0;
    border-radius:2px;border:1px solid rgba(0,0,0,.65);
    text-shadow:1px 1px 0 rgba(0,0,0,.7);letter-spacing:.02em}
  .tn-plate::after{content:"";position:absolute;top:50%;width:6px;height:2px;background:inherit}
  .tn-rail.l .tn-plate::after{right:-6px}
  .tn-rail.r .tn-plate::after{left:-6px}
  /* 上辺を明るく、下辺を暗くして小さくても浮き上がらせる */
  .tn-plate{box-shadow:inset 0 1px 0 rgba(255,255,255,.55),inset 0 -1px 0 rgba(0,0,0,.45)}
  .tn-p1{background:#e0322f}.tn-p2{background:#e246a8}.tn-p3{background:#2f6ee0}
  .tn-p4{background:#2fa84a}.tn-p5{background:#d8b52a}
  /* 盤面 3×3 */''', 'BETプレート')

# ⑥ CRTの質感
rep('''  .tn-cab{background:linear-gradient(180deg,#0d2a6b,#071640 60%,#040d28);''',
'''  /* CRTらしさ: 走査線と、白文字のわずかな青い滲み。強くしすぎると読めなくなる */
  .tn-cab{position:relative;background:linear-gradient(180deg,#0d2a6b,#071640 60%,#040d28);''', 'CRT前準備')
rep('''    box-shadow:0 14px 40px rgba(0,0,0,.6), inset 0 0 40px rgba(20,60,160,.35)}''',
'''    box-shadow:0 14px 40px rgba(0,0,0,.6), inset 0 0 40px rgba(20,60,160,.35)}
  .tn-cab::after{content:"";position:absolute;inset:0;pointer-events:none;border-radius:inherit;
    background:repeating-linear-gradient(180deg,rgba(0,0,0,.16) 0 1px,transparent 1px 3px);
    mix-blend-mode:multiply;opacity:.55;z-index:5}
  @media (prefers-reduced-motion: reduce){ .tn-cab::after{display:none} }''', '走査線')

# ⑦ WILD / TUNNEL のラベル
rep('''  .tn-cell.held{box-shadow:inset 0 0 0 2px #7ad6ff,0 0 16px rgba(90,190,255,.7);z-index:2}''',
'''  .tn-cell.held{box-shadow:inset 0 0 0 2px #7ad6ff,0 0 16px rgba(90,190,255,.7);z-index:2}
  /* ジョーカーに付くラベル。緑=ふつうのWILD / 青=中央のトンネル機能。
     色が違うだけで役割が分かるので、文字を読まなくても区別できる */
  .tn-tag{position:absolute;left:3px;bottom:3px;z-index:3;font-size:6px;letter-spacing:.06em;
    padding:1px 3px;border-radius:1px;font-style:italic;
    text-shadow:1px 1px 0 rgba(0,0,0,.85);pointer-events:none}
  .tn-tag.wild{color:#b6ff3a;background:#0d2a08;border:1px solid #3f7a1c}
  .tn-tag.tunnel{color:#5fe3ff;background:#06183f;border:1px solid #2a6ba8}''', 'WILD/TUNNELラベル')

# ⑧ 描画側: プレート・ラベル・情報表示・WINNER! を組み込む
rep('''    var cells = "";
    for (var i = 0; i < 9; i++) {
      cells += tnCell(g[i], (hit.indexOf(i) >= 0 ? "hit " : "") + (held.indexOf(i) >= 0 ? "held" : ""));
    }''',
'''    var cells = "";
    for (var i = 0; i < 9; i++) {
      var tag = g[i] === "joker" ? (i === 4 ? "tunnel" : "wild") : "";
      cells += tnCell(g[i], (hit.indexOf(i) >= 0 ? "hit " : "") + (held.indexOf(i) >= 0 ? "held" : ""), tag);
    }
    // 有効ラインの入口。BET数はラインの色のプレートに乗せる
    var betTxt = tnFmt(tnBet);
    var rail = function (side) {
      return '<div class="tn-rail ' + side + '">' +
        [1, 2, 3, 4].map(function (n) {
          return '<div class="tn-plate px tn-p' + n + '">' + betTxt + "</div>";
        }).join("") + "</div>";
    };''', 'プレート組み立て')

rep('''      '<div class="tn-grid" id="tn-grid">' + cells + "</div>" +''',
'''      '<div class="tn-board">' + rail("l") +
        '<div class="tn-grid" id="tn-grid" style="flex:1">' + cells + "</div>" +
        rail("r") + "</div>" +''', '盤面をプレートで挟む')

rep('''      '<div class="tn-info"><span>8\\u30E9\\u30A4\\u30F3 + ANY\\u914D\\u5F53</span>' +
        "<span>" + (tnPending > 0 ? "\\u624B\\u5143 <b>" + tnFmt(tnPending) + "</b>" : "") + "</span></div>" +''',
'''      // 説明文 → WINNER! → 情報表示、の順に情報の階層を作る
      '<div class="tn-cap px">' + (tnLast && tnLast.cap ? tnLast.cap : "") + "</div>" +
      (tnLast && tnLast.winner ? '<img class="tn-winner" src="__WINNER__" alt="WINNER!">' : "") +
      '<div class="tn-info">' +
        '<div class="tn-stats px">' +
          '<span class="k wager">WAGER</span><span class="v num">' + betTxt + "</span>" +
          '<span class="k win">WIN</span><span class="v num">' + tnFmt(tnLast && tnLast.win ? tnLast.win : 0) + "</span>" +
          '<span class="k paid">PAID</span><span class="v num">' + tnFmt(tnPending > 0 ? tnPending : (tnLast && tnLast.paid ? tnLast.paid : 0)) + "</span>" +
        "</div>" +
        '<div class="tn-credits px"><span class="k">CREDITS</span>' +
          '<span class="v num">' + tnFmt(tnCredits) + "</span></div>" +
      "</div>" +''', '情報表示')

rep('''  function tnCell(sym, cls) {
    var img = TN_IMG[sym];
    return '<div class="tn-cell ' + (cls || "") + (sym === "blank" ? " blank" : "") + '">' +
      (img ? '<img src="' + img + '" alt="">' : "") + "</div>";
  }''',
'''  function tnCell(sym, cls, tag) {
    var img = TN_IMG[sym];
    return '<div class="tn-cell ' + (cls || "") + (sym === "blank" ? " blank" : "") + '">' +
      (img ? '<img src="' + img + '" alt="">' : "") +
      (tag ? '<span class="tn-tag px ' + tag + '">' + (tag === "tunnel" ? "TUNNEL" : "WILD") + "</span>" : "") +
      "</div>";
  }
  /** 手持ちのクレジット。slot.info の残高をそのまま出す */
  var tnCredits = 0;''', 'セルにラベル')

open(p, 'w', encoding='utf8').write(s.replace('__FONT__', font).replace('__WINNER__', winner))
print('DONE')
