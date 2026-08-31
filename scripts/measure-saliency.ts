// G-目玉2 —— ⑥ 視線の順路を **出すか削るか** を決める測定。
//
// SPEC §9 の宣言: 公開視線データで AUC-Judd を測り、**≥ 0.75 なら出す。下回れば ⑥ ごと削る。**
// 較正できないものは画面に出さない —— 視線計測データ無しに順路線を引けば、
// それは反証不能な図であり、§1 で批判した当のものになる。
//
// 出典: Judd, Ehinger, Durand, Torralba (ICCV 2009) "Learning to predict where people look"
//       https://people.csail.mit.edu/tjudd/WherePeopleLook/
//       15 名 × 1,003 枚。**明示のライセンス文は無く**、ページに "publicly available with
//       this paper" と BibTeX の引用依頼があるのみ(取得日 2026-08-31)。
//       **再配布しない** —— 手元で測り、配るのは数だけである(N-03)。
//
// **標本は自然写真であって絵画ではない。**領域が違うことは結果と一緒に書く。
//
// 実行: npx tsx scripts/measure-saliency.ts

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aucJudd, type Fixation } from "../src/core/auc";
import { fromRaw } from "../src/core/raster";
import { spectralResidual } from "../src/core/saliency";

const GAZE = "C:/Users/TETRUR~1/AppData/Local/Temp/kozu-gaze";
const WORK = join(GAZE, "work");
const OUT = "data/measurements/saliency.json";
const SIZE = 64; // 顕著性マップの一辺(2 の冪)
const THRESHOLD = 0.75; // SPEC §9 の宣言値

function unzip(zip: string, dest: string): void {
  if (existsSync(dest)) return;
  mkdirSync(dest, { recursive: true });
  execFileSync(
    "python",
    ["-c", `import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])`, zip, dest],
    { encoding: "utf-8" },
  );
}

function decode(src: string, prefix: string) {
  execFileSync("python", ["scripts/decode_image.py", src, prefix], { encoding: "utf-8" });
  const meta = JSON.parse(readFileSync(`${prefix}.json`, "utf8")) as { width: number; height: number };
  return fromRaw(new Uint8Array(readFileSync(`${prefix}.bin`)), meta);
}

/** fixPts 画像(注視点が白点)から座標を拾い、顕著性マップの格子へ写す */
function fixationsFrom(img: ReturnType<typeof fromRaw>, size: number): Fixation[] {
  const out: Fixation[] = [];
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4] > 128) {
        out.push({
          x: Math.min(size - 1, Math.floor((x / img.width) * size)),
          y: Math.min(size - 1, Math.floor((y / img.height) * size)),
        });
      }
    }
  }
  return out;
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function main() {
  mkdirSync("data/measurements", { recursive: true });
  mkdirSync(WORK, { recursive: true });
  unzip(join(GAZE, "ALLFIXATIONMAPS.zip"), join(GAZE, "fix"));
  unzip(join(GAZE, "ALLSTIMULI.zip"), join(GAZE, "stim"));

  const fixDir = join(GAZE, "fix", "ALLFIXATIONMAPS");
  const stimDir = join(GAZE, "stim", "ALLSTIMULI");
  const fixFiles = readdirSync(fixDir).filter((f) => f.endsWith("_fixPts.jpg"));
  const stimSet = new Set(readdirSync(stimDir));
  console.log(`注視点画像 ${fixFiles.length} 件 / 刺激画像 ${stimSet.size} 件`);

  const aucs: number[] = [];
  const dropped: string[] = [];
  for (const [i, f] of fixFiles.entries()) {
    const base = f.replace("_fixPts.jpg", "");
    const stim = [`${base}.jpeg`, `${base}.jpg`].find((s) => stimSet.has(s));
    if (!stim) {
      // **落としたものは黙って捨てず、理由を残す**
      dropped.push(`${base}: 刺激画像が無い`);
      continue;
    }
    try {
      const img = decode(join(stimDir, stim), join(WORK, "s"));
      const pts = decode(join(fixDir, f), join(WORK, "f"));
      const sal = spectralResidual(img, SIZE);
      const fix = fixationsFrom(pts, SIZE);
      if (fix.length === 0) {
        dropped.push(`${base}: 注視点が 0`);
        continue;
      }
      aucs.push(aucJudd(sal.map, sal.width, sal.height, fix));
    } catch (e) {
      dropped.push(`${base}: ${(e as Error).message}`);
    }
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${fixFiles.length}(平均 ${(aucs.reduce((a, b) => a + b, 0) / Math.max(1, aucs.length)).toFixed(4)})`);
  }

  const mean = aucs.reduce((a, b) => a + b, 0) / aucs.length;
  const verdict = mean >= THRESHOLD ? "出す" : "削る";
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        question: "SPEC §9 / G-目玉2: 顕著性マップは視線を当てるか。当てなければ ⑥ を削る",
        source:
          "Judd, Ehinger, Durand, Torralba (ICCV 2009), MIT WherePeopleLook —— 15 名 × 1,003 枚",
        sourceUrl: "https://people.csail.mit.edu/tjudd/WherePeopleLook/",
        license:
          "明示のライセンス文は無い。ページに『publicly available with this paper』と BibTeX の引用依頼があるのみ(取得日 2026-08-31)。再配布はしていない —— 手元で測り、配るのは数だけ",
        method:
          `spectral residual(Hou & Zhang 2007)で ${SIZE}×${SIZE} の顕著性マップを作り、` +
          "_fixPts 画像から拾った注視点に対して AUC-Judd(順位に基づく定義。同値は 0.5 で数える)を測る。",
        caveat:
          "**標本は自然写真であって絵画ではない。**絵画に当てたときの当たり方は、この数からは分からない。",
        measuredAt: "2026-08-31",
        threshold: THRESHOLD,
        n: aucs.length,
        meanAuc: mean,
        medianAuc: median(aucs),
        minAuc: Math.min(...aucs),
        maxAuc: Math.max(...aucs),
        dropped: dropped.length,
        droppedReasons: dropped.slice(0, 20),
        verdict,
      },
      null,
      1,
    ),
  );
  console.log(
    `\n書いた: ${OUT}\n  AUC-Judd 平均 ${mean.toFixed(4)} / 中央 ${median(aucs).toFixed(4)} ` +
      `(n=${aucs.length}、落とした ${dropped.length} 件)→ **判定「${verdict}」**(閾値 ${THRESHOLD})`,
  );
}

main();
