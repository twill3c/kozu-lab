// F-15 ⑦ 作品くらべの事前計算。
//
// 実作品 200 件について、**客観層だけで測れる 3 つ**を出す:
//   角度ヒストグラム(水平・垂直・対角)/ 明度重心 / 対角優位度
//
// 画像は手元のキャッシュ(build-points.ts が落としたもの)を使う。
// **画像は配らない。**配るのは data/compare/works.json の数だけである(N-03)。
//
// 実行: npx tsx scripts/build-compare.ts

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { angleProfileInterior, BORDER_MARGIN, centuryOf } from "../src/core/compare";
import { DEFAULT_DETECT, detectLines } from "../src/core/hough";
import { luminanceCentroid } from "../src/core/notan";
import { fromRaw } from "../src/core/raster";

const FRAME = "data/frames/met-ep.json";
const CACHE = join(tmpdir(), "kozu-images");
const WORK = join(tmpdir(), "kozu-compare");
const OUT = "data/compare/works.json";
const SHORT = 1024;

type Member = {
  objectID: number;
  title: string;
  artistDisplayName: string;
  objectBeginDate: number;
  objectEndDate: number;
};

function decode(jpg: string, prefix: string) {
  execFileSync("python", ["scripts/decode_image.py", jpg, prefix, "--short", String(SHORT)], {
    encoding: "utf-8",
  });
  const meta = JSON.parse(readFileSync(`${prefix}.json`, "utf8")) as { width: number; height: number };
  return fromRaw(new Uint8Array(readFileSync(`${prefix}.bin`)), meta);
}

function main() {
  mkdirSync(WORK, { recursive: true });
  mkdirSync("data/compare", { recursive: true });
  const frame = JSON.parse(readFileSync(FRAME, "utf8")) as { members: Member[] };

  const rows: Record<string, unknown>[] = [];
  const dropped: string[] = [];
  for (const [i, m] of frame.members.entries()) {
    const jpg = join(CACHE, `${m.objectID}.jpg`);
    if (!existsSync(jpg)) {
      // **落としたものは黙って捨てず、理由を残す**
      dropped.push(`${m.objectID}: 手元に画像が無い`);
      continue;
    }
    const img = decode(jpg, join(WORK, String(m.objectID)));
    const lines = detectLines(img, DEFAULT_DETECT);
    const prof = angleProfileInterior(lines, img.width, img.height);
    const c = luminanceCentroid(img);
    rows.push({
      objectID: m.objectID,
      title: m.title,
      artist: m.artistDisplayName,
      century: centuryOf(m.objectBeginDate, m.objectEndDate),
      width: img.width,
      height: img.height,
      aspect: img.width / img.height,
      lines: prof.all.total,
      linesInterior: prof.interior.total,
      borderRemoved: prof.removed,
      horizontal: prof.interior.水平,
      vertical: prof.interior.垂直,
      diagonal: prof.interior.対角,
      diagonalShare: prof.interior.diagonalShare,
      diagonalShareAll: prof.all.diagonalShare,
      // 重心は **短辺で正規化** する —— 画面の大きさが違うので px のままでは比べられない
      centroidX: c ? c.x / Math.min(img.width, img.height) : null,
      centroidY: c ? c.y / Math.min(img.width, img.height) : null,
    });
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${frame.members.length}`);
  }

  writeFileSync(
    OUT,
    JSON.stringify({
      builtAt: "2026-08-31",
      frame: FRAME,
      shortSide: SHORT,
      detector: { voteRatio: DEFAULT_DETECT.voteRatio, thetaSteps: DEFAULT_DETECT.thetaSteps },
      note:
        "角度の分け方は垂直 0°±15°・水平 90°±15°・残りが対角(宣言値)。" +
        `画面の縁から ${BORDER_MARGIN * 100} % 以内の線は落としてある —— 絵の縁そのものが長い直線として立ち、` +
        "実測でその 100 % が水平か垂直だった。落とす前の値も diagonalShareAll に残してある。" +
        "重心は短辺で正規化してある。画像は配らない —— ここにあるのは計算した数だけ。",
      dropped: dropped.length,
      droppedReasons: dropped.slice(0, 20),
      works: rows,
    }),
  );
  console.log(`書いた: ${OUT} —— ${rows.length} 件(落とした ${dropped.length} 件)`);
}

main();
