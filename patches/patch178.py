# -*- coding: utf-8 -*-
# 第178弾: 不自然な拡大をやめる / 当選リールを光らせる / ファンファーレを揃える
#           / オートは戻り演出を見届けてから次へ
import sys, base64, re
p, sheet = sys.argv[1], sys.argv[2]
s = open(p, encoding='utf8').read()
SHEET = base64.b64encode(open(sheet, 'rb').read()).decode()

def rep(old, new, name):
    global s
    assert s.count(old) == 1, (name, s.count(old))
    s = s.replace(old, new); print('OK', name)

# ① スプライトを「拡大しない版」に差し替える
m = re.search(r'var TN_JOKER_SHEET = "(data:image/webp;base64,[A-Za-z0-9+/=]+)"', s)
assert m, 'スプライトが見つからない'
s = s.replace(m.group(1), 'data:image/webp;base64,' + SHEET, 1)
print('OK スプライト(拡大なし)')

# ② 戻って当たったときの拡大もやめる。明るさだけで表す
rep("""  .tn-cell.revhit{animation:tnRevHit .5s cubic-bezier(.2,1.6,.35,1)}
  .tn-cell.revhit img{filter:drop-shadow(0 0 12px rgba(255,215,106,1))}
  @keyframes tnRevHit{
    0%{transform:translateY(-6%) scale(1)}
    45%{transform:translateY(3%) scale(1.12)}
    70%{transform:translateY(-1%) scale(1.04)}
    100%{transform:translateY(0) scale(1)}}""",
"""  /* 収まった瞬間(第178弾で拡大をやめた)。
     絵柄を大きくすると、リールそのものが伸び縮みしたように見えて不自然だった。
     上下のわずかな揺れと明るさだけで「収まった」を表す */
  .tn-cell.revhit{animation:tnRevHit .5s cubic-bezier(.2,1.6,.35,1)}
  .tn-cell.revhit img{filter:drop-shadow(0 0 12px rgba(255,215,106,1)) brightness(1.25)}
  @keyframes tnRevHit{
    0%{transform:translateY(-6%)}
    45%{transform:translateY(3%)}
    70%{transform:translateY(-1%)}
    100%{transform:translateY(0)}}""", '戻り当たりの拡大をやめる')

# ③ 当選したマスを高速で点滅させる
rep("""  .tn-cell.hit{box-shadow:inset 0 0 0 2px #ffd76a,0 0 14px rgba(255,215,106,.7);z-index:2}""",
"""  /* 当選したマス(第178弾)。**速い点滅**にして、どこが当たったのか一目で分かるようにする。
     以前は金の枠を静かに出すだけで、他のマスに紛れて気づけなかった。
     大きさは変えない(変えると盤面が揺れて読みにくい)。枠と明るさだけで示す */
  .tn-cell.hit{z-index:3;animation:tnHitBlink .34s steps(1) infinite}
  .tn-cell.hit img{animation:tnHitGlow .34s ease-in-out infinite}
  @keyframes tnHitBlink{
    0%{box-shadow:inset 0 0 0 3px #ffe9a8,0 0 24px rgba(255,220,130,1)}
    50%{box-shadow:inset 0 0 0 2px rgba(255,215,106,.45),0 0 8px rgba(255,215,106,.35)}
    100%{box-shadow:inset 0 0 0 3px #ffe9a8,0 0 24px rgba(255,220,130,1)}}
  @keyframes tnHitGlow{
    0%,100%{filter:brightness(1.45) drop-shadow(0 0 8px rgba(255,220,130,.95))}
    50%{filter:brightness(1)}}""", '当選マスの点滅')

# ④ 高額のファンファーレを GOLD RUSH と同じ組み合わせに
rep("""      if (payX >= TN_BIG_X) {                         // 高額: GOLD RUSH の大当たり音
        sfx("gong");
        setTimeout(function () { try { play("bigwin"); } catch (e) {} }, 140);
        return;
      }""",
"""      if (payX >= TN_BIG_X) {
        // 高額のファンファーレ(第178弾)。GOLD RUSH の大当たりと**同じ組み合わせ**。
        // 銅鑼のあと、少し置いて拍手が入る。片方だけだと台ごとに違って聞こえる
        sfx("gong");
        setTimeout(function () { try { play("applause"); } catch (e) {} }, 1200);
        return;
      }""", 'ファンファーレ')

# ⑤ オートは戻り演出を見届けてから次へ。当たり・ハズレのどちらでも同じだけ待つ
rep("""          } else {
            finish();
          }
        });
      }, 700);
      return;""",
"""          } else {
            // ハズレでも、通り過ぎたことを見せてから次へ(第178弾)。
            // ここを即座に終えると、オート中は結果を見る間もなく次が回り始める
            setTimeout(finish, 700);
          }
        });
      }, 700);
      return;""", 'ハズレも見届ける')

open(p, 'w', encoding='utf8').write(s)
print('DONE')
