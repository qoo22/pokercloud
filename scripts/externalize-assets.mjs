#!/usr/bin/env node
/**
 * 配信用クライアントに埋まっている data URI の画像を、外部ファイルに切り出す。
 *
 * なぜ必要か:
 *   poker-client.html は 5MB 超あり、その 92% が base64 の画像だった。
 *   しかも多くが <head> の CSS（`--img-…: url("data:…")`）に入っているため、
 *   CSS が描画ブロッキングになり「全部届くまで画面が真っ暗」になっていた。
 *   外に出すと HTML は 400KB 台まで落ち、画像は必要になった時点で並列取得される
 *   （使っていないテーマの背景やスロット絵は、そもそも取得されない）。
 *
 * ファイル名に中身のハッシュを入れているので、サーバーは immutable で
 * 恒久キャッシュに載せられる（更新したら名前が変わる＝古いキャッシュを掴まない）。
 *
 * 使い方:
 *   node scripts/externalize-assets.mjs                 # public/poker-client.html を処理
 *   node scripts/externalize-assets.mjs path/to/x.html  # 対象を指定
 *
 * 何度実行しても安全（data URI が無ければ何もしない）。
 * `npm run client` でクライアントを作り直したら、そのあとに実行すること。
 *
 * 注意: オフライン版 docs/index.html は「1ファイルで完結する」ことが存在理由なので、
 *       対象にしない（サーバーが無い環境で開くため）。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const targets = process.argv.slice(2);
if (targets.length === 0) targets.push(join(ROOT, 'public/poker-client.html'));

/** data URI の直前の文字列から、それらしい名前を拾う（CSS変数・JSの識別子・オブジェクトのキー） */
function nameFrom(context) {
  const patterns = [
    /--([A-Za-z0-9_-]{2,40})\s*:\s*url\(\s*["']?$/, // --img-vip:url("
    /["']([A-Za-z0-9_-]{2,40})["']\s*:\s*["']$/, // "mtt-daily": "
    /\b([A-Za-z0-9_$]{2,40})\s*[:=]\s*["'`]$/, // SLOT_STRIP = "
  ];
  for (const re of patterns) {
    const m = context.match(re);
    if (m) return m[1];
  }
  // 配列に並べてあるもの（DEALERS = ["data:…", "data:…"]）は、配列の名前を借りる
  const arr = context.match(/([A-Za-z0-9_$-]{2,40})\s*[:=]\s*\[[^\]]*$/);
  if (arr) return arr[1].replace(/^-+/, '');
  return 'asset';
}

/** ファイル名に使える形へ（小文字・記号は -） */
function slug(name) {
  return (
    name
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 40) || 'asset'
  );
}

const EXT = { 'image/webp': '.webp', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif' };

for (const target of targets) {
  const html = readFileSync(target, 'utf8');
  const outDir = join(dirname(target), 'assets');
  const re = /data:(image\/(?:webp|png|jpeg|gif));base64,([A-Za-z0-9+/=]+)/g;

  const byHash = new Map(); // hash → 出力ファイル名（同じ画像は1本にまとめる）
  let written = 0;
  let inlineBytes = 0;

  const out = html.replace(re, (whole, mime, b64, offset) => {
    const bin = Buffer.from(b64, 'base64');
    const hash = createHash('sha256').update(bin).digest('hex').slice(0, 8);
    inlineBytes += whole.length;
    let file = byHash.get(hash);
    if (!file) {
      const ctx = html.slice(Math.max(0, offset - 900), offset);
      file = `${slug(nameFrom(ctx))}-${hash}${EXT[mime] ?? '.bin'}`;
      byHash.set(hash, file);
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, file), bin);
      written++;
    }
    return `assets/${file}`;
  });

  if (written === 0) {
    console.log(`${basename(target)}: 埋め込み画像は見つかりませんでした（処理済み）`);
    continue;
  }

  writeFileSync(target, out);

  // 参照されなくなった切り出し済みファイルを片付ける（ハッシュ付きのものだけ）
  let pruned = 0;
  if (existsSync(outDir)) {
    for (const f of readdirSync(outDir)) {
      if (!/-[0-9a-f]{8}\.[a-z0-9]+$/.test(f)) continue;
      if (out.includes(`assets/${f}`)) continue;
      rmSync(join(outDir, f));
      pruned++;
    }
  }

  const before = Buffer.byteLength(html);
  const after = Buffer.byteLength(out);
  console.log(
    `${basename(target)}: ${written} 枚を切り出し` +
      (pruned ? `（未使用 ${pruned} 枚を削除）` : '') +
      ` — HTML ${(before / 1e6).toFixed(2)}MB → ${(after / 1024).toFixed(0)}KB` +
      `（埋め込みだった ${(inlineBytes / 1e6).toFixed(2)}MB を外へ）`,
  );
}
