import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createImage } from "@/core/image";
import { createRng } from "@/core/rng";
import { fft2, ifft2, spectralResidual } from "@/core/saliency";
import { aucJudd } from "@/core/auc";
import { angleProfile, centuryOf, classifyAngle } from "@/core/compare";

// 期待値の出所(HC-016)
// ------------------------------------------------------------------
// FFT の期待値は **解析解**:
//   - 定数画像の変換は DC 成分だけが立つ
//   - 逆変換は元に戻る(往復の同一性)
//   - Parseval の等式(空間の二乗和 = 周波数の二乗和 / N)
// AUC の期待値も **解析解**:
//   - 完全な予測で 1、完全に逆で 0、無情報で 0.5
//
// G-目玉2 の閾値は **SPEC §9 の宣言値**: AUC-Judd ≥ 0.75 なら ⑥ を出す。
// 下回れば ⑥ ごと削る —— 較正できないものは画面に出さない。

describe("FFT の検算(解析解)", () => {
  it("定数画像の変換は DC 成分だけが立つ", () => {
    const n = 8;
    const re = new Float64Array(n * n).fill(3);
    const im = new Float64Array(n * n);
    fft2(re, im, n, n);
    expect(re[0]).toBeCloseTo(3 * n * n, 8);
    expect(im[0]).toBeCloseTo(0, 8);
    for (let i = 1; i < n * n; i++) {
      expect(Math.hypot(re[i], im[i]), `index ${i} が 0 でない`).toBeLessThan(1e-8);
    }
  });

  it("往復すると元に戻る", () => {
    const n = 16;
    const rng = createRng(7);
    const src = Float64Array.from({ length: n * n }, () => rng() * 100);
    const re = Float64Array.from(src);
    const im = new Float64Array(n * n);
    fft2(re, im, n, n);
    ifft2(re, im, n, n);
    for (let i = 0; i < n * n; i++) expect(re[i]).toBeCloseTo(src[i], 8);
  });

  it("Parseval の等式が成り立つ", () => {
    const n = 16;
    const rng = createRng(11);
    const src = Float64Array.from({ length: n * n }, () => rng() * 2 - 1);
    const re = Float64Array.from(src);
    const im = new Float64Array(n * n);
    fft2(re, im, n, n);
    let space = 0;
    for (const v of src) space += v * v;
    let freq = 0;
    for (let i = 0; i < n * n; i++) freq += re[i] * re[i] + im[i] * im[i];
    expect(freq / (n * n)).toBeCloseTo(space, 6);
  });

  it("2 の冪でない大きさは例外(黙って切り詰めない)", () => {
    const re = new Float64Array(6 * 8);
    const im = new Float64Array(6 * 8);
    expect(() => fft2(re, im, 6, 8)).toThrow();
  });
});

describe("spectral residual —— 顕著性マップ", () => {
  it("一様な画像では顕著性が平坦(分母 0 の縮退を作らない — HC-097)", () => {
    const img = createImage(64, 64, 128);
    const s = spectralResidual(img, 64);
    const min = Math.min(...s.map);
    const max = Math.max(...s.map);
    expect(max - min).toBeLessThan(1e-6);
  });

  it("孤立した明るい点は、その位置の顕著性が高い(陽性対照)", () => {
    const img = createImage(64, 64, 30);
    for (let y = 30; y < 34; y++) {
      for (let x = 30; x < 34; x++) {
        const i = (y * 64 + x) * 4;
        img.data[i] = 240;
        img.data[i + 1] = 240;
        img.data[i + 2] = 240;
      }
    }
    const s = spectralResidual(img, 64);
    let best = 0;
    for (let i = 1; i < s.map.length; i++) if (s.map[i] > s.map[best]) best = i;
    const bx = best % s.width;
    const by = Math.floor(best / s.width);
    // 縮小されているので、比で位置を見る
    expect(Math.abs(bx / s.width - 32 / 64)).toBeLessThan(0.15);
    expect(Math.abs(by / s.height - 32 / 64)).toBeLessThan(0.15);
  });

  it("決定論(同一入力で 20 回ビット一致)", () => {
    const img = createImage(64, 64, 100);
    const rng = createRng(3);
    for (let p = 0; p < 64 * 64; p++) {
      const v = Math.floor(rng() * 256);
      img.data[p * 4] = v;
      img.data[p * 4 + 1] = v;
      img.data[p * 4 + 2] = v;
    }
    const first = [...spectralResidual(img, 64).map];
    for (let i = 0; i < 20; i++) expect([...spectralResidual(img, 64).map]).toEqual(first);
  });
});

describe("AUC-Judd の検算(解析解)", () => {
  const W = 8;
  const H = 8;
  const fix = [
    { x: 1, y: 1 },
    { x: 6, y: 6 },
  ];

  it("完全な予測で 1 に近い", () => {
    const m = new Float64Array(W * H).fill(0);
    for (const f of fix) m[f.y * W + f.x] = 1;
    expect(aucJudd(m, W, H, fix)).toBeGreaterThan(0.95);
  });

  it("完全に逆の予測で 0 に近い", () => {
    const m = new Float64Array(W * H).fill(1);
    for (const f of fix) m[f.y * W + f.x] = 0;
    expect(aucJudd(m, W, H, fix)).toBeLessThan(0.05);
  });

  it("無情報(一様)なら 0.5 の近く", () => {
    const m = new Float64Array(W * H).fill(0.5);
    expect(aucJudd(m, W, H, fix)).toBeCloseTo(0.5, 1);
  });

  it("注視点が無ければ例外(黙って 0.5 を返さない)", () => {
    const m = new Float64Array(W * H).fill(0.5);
    expect(() => aucJudd(m, W, H, [])).toThrow();
  });
});

describe("G-目玉2 —— ⑥ を出すか削るか", () => {
  const FILE = "data/measurements/saliency.json";

  it("測定結果のファイルが実在する", () => {
    expect(
      existsSync(FILE),
      `${FILE} が無い。npx tsx scripts/measure-saliency.ts で作る(公開視線データが要る)`,
    ).toBe(true);
  });

  it("問い・出典・方法・件数が書いてある", () => {
    const m = JSON.parse(readFileSync(FILE, "utf8"));
    for (const k of ["question", "source", "license", "method", "measuredAt", "n", "meanAuc", "verdict"]) {
      expect(m[k], `${k} が無い`).toBeDefined();
    }
    expect(m.n).toBeGreaterThanOrEqual(100);
  });

  it("**判定が閾値と一致している**(SPEC §9: AUC-Judd ≥ 0.75 なら出す)", () => {
    const m = JSON.parse(readFileSync(FILE, "utf8"));
    const shouldShip = m.meanAuc >= 0.75;
    expect(m.verdict).toBe(shouldShip ? "出す" : "削る");
    console.log(`G-目玉2 —— AUC-Judd 平均 ${m.meanAuc.toFixed(4)}(n=${m.n})→ 判定「${m.verdict}」`);
  });

  it("**判定どおりの実装になっている** —— 削るなら ⑥ の画面が存在しない", () => {
    const m = JSON.parse(readFileSync(FILE, "utf8"));
    const exists = existsSync("src/app/shisen/page.tsx");
    expect(exists, m.verdict === "出す" ? "出す判定なのに画面が無い" : "削る判定なのに画面がある").toBe(
      m.verdict === "出す",
    );
  });
});

describe("F-15 ⑦ 角度の分け方", () => {
  const deg = (d: number) => (d * Math.PI) / 180;

  it("境界は宣言どおり(垂直 0°±15°、水平 90°±15°、残りが対角)", () => {
    expect(classifyAngle(deg(0))).toBe("垂直");
    expect(classifyAngle(deg(14))).toBe("垂直");
    expect(classifyAngle(deg(16))).toBe("対角");
    expect(classifyAngle(deg(45))).toBe("対角");
    expect(classifyAngle(deg(80))).toBe("水平");
    expect(classifyAngle(deg(90))).toBe("水平");
    expect(classifyAngle(deg(170))).toBe("垂直");
  });

  it("割合の合計が 1(取りこぼしが無い)", () => {
    const lines = [0, 20, 45, 70, 90, 120, 160].map((d) => ({ theta: deg(d), rho: 0 }));
    const p = angleProfile(lines);
    expect(p.水平 + p.垂直 + p.対角).toBe(lines.length);
    expect(p.total).toBe(lines.length);
  });

  it("線が無ければ対角優位度は NaN(0 と偽らない)", () => {
    expect(Number.isNaN(angleProfile([]).diagonalShare)).toBe(true);
  });

  it("世紀の層は **標本枠が刻んだ規則** で出る(自分の思い込みで書かない)", () => {
    // 出所: data/frames/met-ep.json の rule —— 「objectBeginDate と objectEndDate の
    // 中点の世紀」で、実装は floor(中点/100)+1。慣用の数え方(1900 年は 19 世紀)とは
    // **境界が 1 年ずれる**が、枠は既にこの規則で作られているので実装を合わせる。
    expect(centuryOf(1600, 1650)).toBe("17世紀");
    expect(centuryOf(1850, 1860)).toBe("19世紀");
    expect(centuryOf(NaN, 1)).toBe("不明");
  });

  it("境界の約束を明示する —— 中点がちょうど 1900 なら 20 世紀に入る", () => {
    // **慣用と違うことを検査に書いておく。**書かないと、後から見た人が
    // 「バグでは」と思って直し、枠と層が食い違う
    expect(centuryOf(1899, 1901)).toBe("20世紀");
    expect(centuryOf(1898, 1900)).toBe("19世紀");
  });
});

describe("T-403 / T-404 ⑦ の事前計算(SPEC §9.2)", () => {
  const FILE = "data/compare/works.json";

  it("ファイルが実在し、縁を落とす前後の両方が入っている", () => {
    expect(existsSync(FILE), `${FILE} が無い。npx tsx scripts/build-compare.ts で作る`).toBe(true);
    const d = JSON.parse(readFileSync(FILE, "utf8"));
    expect(d.works.length).toBeGreaterThanOrEqual(175);
    for (const w of d.works) {
      expect(w.lines, "落とす前の本数が無い").toBeDefined();
      expect(w.linesInterior, "落とした後の本数が無い").toBeDefined();
      expect(w.borderRemoved, "落とした本数が無い").toBeDefined();
      expect(w.diagonalShareAll, "落とす前の対角優位度が無い").toBeDefined();
      expect(w.linesInterior + w.borderRemoved).toBe(w.lines);
    }
  });

  it("T-404 材料の乏しさを記録する(閾値なし)", () => {
    const d = JSON.parse(readFileSync(FILE, "utf8"));
    const zero = d.works.filter((w: { linesInterior: number }) => w.linesInterior === 0).length;
    const withDiag = d.works.filter((w: { diagonal: number }) => w.diagonal > 0).length;
    const removed = d.works.reduce((s: number, w: { borderRemoved: number }) => s + w.borderRemoved, 0);
    const total = d.works.reduce((s: number, w: { lines: number }) => s + w.lines, 0);
    console.log(
      `⑦ 材料の乏しさ —— 縁を除くと 0 本になる作品 ${zero}/${d.works.length} = ${((zero / d.works.length) * 100).toFixed(1)} % / ` +
        `対角が 1 本以上ある作品 ${withDiag}/${d.works.length} / 縁の線 ${removed}/${total} = ${((removed / total) * 100).toFixed(1)} %`,
    );
    expect(d.works.length).toBeGreaterThan(0);
  });

  it("**縁を落とす規律が効いている** —— 落とした線が実際に存在する", () => {
    const d = JSON.parse(readFileSync(FILE, "utf8"));
    const removed = d.works.reduce((s: number, w: { borderRemoved: number }) => s + w.borderRemoved, 0);
    // 落とした本数が 0 なら規律が働いていない(陽性対照の代わり)
    expect(removed, "縁の線を 1 本も落としていない —— 判定が働いていない").toBeGreaterThan(0);
  });
});

describe("F-16 /about が測定と食い違わない", () => {
  it("σ 依存の測定が実在し、3 段すべて入っている", () => {
    const f = "src/data/sigma.json";
    expect(existsSync(f), `${f} が無い。cargo run --release --bin scan_sigma で作る`).toBe(true);
    const d = JSON.parse(readFileSync(f, "utf8"));
    expect(d.rows.length).toBe(3);
    expect(d.n).toBeGreaterThanOrEqual(175);
    for (const r of d.rows) {
      expect(r.peakT).toBeGreaterThan(0.05);
      expect(r.peakT).toBeLessThan(0.95);
      expect(Object.keys(r.residual).length).toBeGreaterThanOrEqual(5);
    }
  });

  it("**σ を振っても頂点が中央から動かない**(/about の主張の根拠)", () => {
    const d = JSON.parse(readFileSync("src/data/sigma.json", "utf8"));
    const peaks = d.rows.map((r: { peakT: number }) => r.peakT);
    console.log(`/about σ 依存 —— 頂点 t: ${peaks.map((p: number) => p.toFixed(3)).join(" / ")}`);
    for (const p of peaks) expect(Math.abs(p - 0.5)).toBeLessThan(0.1);
    // 三分割が一貫して最低の部類であること
    for (const r of d.rows) {
      expect(r.residual["三分割 1/3"]).toBeLessThan(r.residual["黄金 0.382"]);
    }
  });

  it("/about が読む測定ファイルが src/ に揃っている(ビルドで外へ出ない)", () => {
    for (const f of ["src/data/sigma.json", "src/data/saliency.json", "src/data/scores.json", "src/data/compare.json"]) {
      expect(existsSync(f), `${f} が無い`).toBe(true);
    }
  });
});
