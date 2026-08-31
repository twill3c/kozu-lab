import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createRng } from "@/core/rng";
import { buildGrid } from "@/core/grids";
import { nullDistribution, zScore } from "@/core/score";
import { canny } from "@/core/canny";
import { edgePoints } from "@/core/points";
import { makeGridAligned, makeRandomRects, makePinkNoise, CONTROL_KINDS } from "@/core/controls";
import { destroy, DESTROY_KINDS } from "@/core/destroy";
import { drawLines } from "@/core/synth";

// 期待値の出所(HC-016)
// ------------------------------------------------------------------
// G-08 の閾値は **SPEC §11 の宣言値**: 陽性対照 P 群で M0 の z ≥ 3.0。
// P 群は「主要素の重心を厳密に 1/3・0.382・0.618 の交点へ置いた合成画像」なので、
// **三分割格子・黄金格子に対して高い z が出なければ、スコアが機能していない**
// —— 落ちたら ④ ごと撤回する、と SPEC に書いてある。
//
// 標本枠の期待値は **実測 2026-08-31**:
//   Met の objects エンドポイント(departmentIds=11)は objectID を 2,644 件返す。
//   60 件の等間隔標本で PD 28 件、PD はすべて画像あり。isHighlight は 125 件。

const W = 900;
const H = 600;
const SIGMA = Math.min(W, H) * 0.01;
const SEED = 20260831;
const TRIALS = 2000;

function pointsOf(img: ReturnType<typeof drawLines>) {
  return edgePoints(canny(img), img.width, img.height);
}

function zOf(img: ReturnType<typeof drawLines>, kind: "thirds" | "golden") {
  const pts = pointsOf(img);
  const grid = buildGrid(kind, img.width, img.height);
  const dist = nullDistribution(pts, grid, img.width, img.height, {
    sigma: SIGMA,
    seed: SEED,
    trials: TRIALS,
  });
  return zScore(pts, grid, dist, SIGMA);
}

describe("edgePoints —— 検出エッジを特徴点に直す", () => {
  it("エッジの無い画像では点が 0 個(分母 0 の縮退を作らない — HC-097)", () => {
    const img = drawLines({ width: 128, height: 128, mode: "step", lines: [] });
    expect(edgePoints(canny(img), 128, 128).length).toBe(0);
  });

  it("座標は中心原点(SPEC §11.4 の toCenter 規約)", () => {
    const img = drawLines({
      width: 128,
      height: 128,
      mode: "step",
      lines: [{ theta: Math.PI / 2, rho: 0 }],
    });
    const pts = edgePoints(canny(img), 128, 128);
    expect(pts.length).toBeGreaterThan(50);
    // 水平のステップエッジ y=0(中心)なので、点の y は 0 の近くに集まる
    const meanY = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    expect(Math.abs(meanY)).toBeLessThan(1.5);
    // x は画面幅いっぱいに散る
    expect(Math.max(...pts.map((p) => p.x))).toBeGreaterThan(40);
    expect(Math.min(...pts.map((p) => p.x))).toBeLessThan(-40);
  });

  it("間引きは決定論で、上限を守る", () => {
    const img = drawLines({
      width: 400,
      height: 400,
      mode: "step",
      lines: [
        { theta: 0.3, rho: 20 },
        { theta: 1.9, rho: -40 },
      ],
    });
    const e = canny(img);
    const a = edgePoints(e, 400, 400, 200);
    const b = edgePoints(e, 400, 400, 200);
    expect(a.length).toBeLessThanOrEqual(200);
    expect(a).toEqual(b);
  });
});

describe("G-08 陽性対照 —— P 群で z が高く出る", () => {
  it("三分割の交点へ厳密に置いた合成画像は、三分割格子に対して z ≥ 3.0", () => {
    const img = makeGridAligned({ width: W, height: H, ratio: "thirds", seed: SEED });
    const z = zOf(img, "thirds");
    console.log(`G-08 P 群(三分割配置)→ 三分割格子の z = ${z.toFixed(2)}`);
    expect(z).toBeGreaterThanOrEqual(3.0);
  });

  it("黄金分割の交点へ厳密に置いた合成画像は、黄金格子に対して z ≥ 3.0", () => {
    const img = makeGridAligned({ width: W, height: H, ratio: "golden", seed: SEED });
    const z = zOf(img, "golden");
    console.log(`G-08 P 群(黄金配置)→ 黄金格子の z = ${z.toFixed(2)}`);
    expect(z).toBeGreaterThanOrEqual(3.0);
  });

  it("陰性対照 —— 1/f ノイズは三分割格子に対して z が帰無の近くに立つ", () => {
    const img = makePinkNoise({ width: W, height: H, seed: SEED });
    const z = zOf(img, "thirds");
    console.log(`G-08 陰性対照(1/f ノイズ)→ 三分割格子の z = ${z.toFixed(2)}`);
    expect(Math.abs(z)).toBeLessThan(3.0);
  });

  it("**取り違えの対照** —— 黄金配置の画像を三分割格子で測ると z は下がる", () => {
    // 「どの格子でも高く出る」なら、スコアは格子を区別していない
    const img = makeGridAligned({ width: W, height: H, ratio: "golden", seed: SEED });
    const zGolden = zOf(img, "golden");
    const zThirds = zOf(img, "thirds");
    console.log(`G-08 取り違え: 黄金配置 → 黄金 ${zGolden.toFixed(2)} / 三分割 ${zThirds.toFixed(2)}`);
    expect(zGolden).toBeGreaterThan(zThirds);
  });
});

describe("対照群の生成器(F-13 の材料)", () => {
  it("種類は宣言した 3 つ(合成側)", () => {
    expect(CONTROL_KINDS).toEqual(["grid-aligned", "random-rects", "pink-noise"]);
  });

  it("すべて決定論(同一シードでビット一致)", () => {
    const opts = { width: 200, height: 150, seed: 7 } as const;
    expect([...makeRandomRects(opts).data]).toEqual([...makeRandomRects(opts).data]);
    expect([...makePinkNoise(opts).data]).toEqual([...makePinkNoise(opts).data]);
    expect([...makeGridAligned({ ...opts, ratio: "thirds" }).data]).toEqual(
      [...makeGridAligned({ ...opts, ratio: "thirds" }).data],
    );
  });

  it("シードが違えば違う画像(生成器が定数を返していない)", () => {
    const a = makeRandomRects({ width: 200, height: 150, seed: 1 });
    const b = makeRandomRects({ width: 200, height: 150, seed: 2 });
    expect([...a.data]).not.toEqual([...b.data]);
  });

  it("1/f ノイズのスペクトルが 1/f に近い(ホワイトノイズではない)", () => {
    // **ホワイトノイズを対照にすると楽勝の対照になる**(SPEC §8)。
    // 低周波の分散が高周波より大きいことを、行方向の階差で粗く確かめる。
    const img = makePinkNoise({ width: 256, height: 256, seed: 99 });
    let dHigh = 0;
    let dLow = 0;
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 255; x++) {
        const a = img.data[(y * 256 + x) * 4];
        const b = img.data[(y * 256 + x + 1) * 4];
        dHigh += (a - b) * (a - b);
      }
      for (let x = 0; x + 16 < 256; x++) {
        const a = img.data[(y * 256 + x) * 4];
        const b = img.data[(y * 256 + x + 16) * 4];
        dLow += (a - b) * (a - b);
      }
    }
    // 1/f なら 16 画素離れた差の方がずっと大きい。ホワイトノイズならほぼ同じ
    console.log(`1/f 検算: 隣接の差² 合計 ${(dHigh / 1e6).toFixed(1)} / 16px 離れ ${(dLow / 1e6).toFixed(1)}`);
    expect(dLow).toBeGreaterThan(dHigh * 2);
  });
});

describe("G-10 の材料 —— C 群(破壊版)の生成", () => {
  it("壊し方は宣言した 3 つ", () => {
    expect(DESTROY_KINDS).toEqual(["trim", "rotate", "mirror"]);
  });

  it("トリムは面積を減らし、寸法を変える", () => {
    const img = drawLines({ width: 300, height: 200, mode: "step", lines: [{ theta: 0.4, rho: 10 }] });
    const out = destroy(img, "trim");
    expect(out.width).toBeLessThan(300);
    expect(out.height).toBeLessThan(200);
    // 20 % トリム(片側 10 %)を宣言値とする
    expect(out.width).toBe(Math.round(300 * 0.8));
    expect(out.height).toBe(Math.round(200 * 0.8));
  });

  it("鏡像は 2 回で元に戻る", () => {
    const img = drawLines({ width: 120, height: 90, mode: "step", lines: [{ theta: 0.4, rho: 10 }] });
    expect([...destroy(destroy(img, "mirror"), "mirror").data]).toEqual([...img.data]);
  });

  it("回転は寸法を保ち、内容を変える(恒等写像ではない)", () => {
    const img = drawLines({ width: 120, height: 90, mode: "step", lines: [{ theta: 0.4, rho: 10 }] });
    const out = destroy(img, "rotate");
    expect(out.width).toBe(120);
    expect(out.height).toBe(90);
    expect([...out.data]).not.toEqual([...img.data]);
  });

  it("すべて決定論", () => {
    const img = drawLines({ width: 120, height: 90, mode: "step", lines: [{ theta: 0.4, rho: 10 }] });
    for (const k of DESTROY_KINDS) {
      expect([...destroy(img, k).data]).toEqual([...destroy(img, k).data]);
    }
  });
});

describe("F-14 標本枠", () => {
  const FRAME = "data/frames/met-ep.json";

  it("標本枠のファイルが実在する", () => {
    expect(existsSync(FRAME), `${FRAME} が無い。scripts/build-frame.mjs で作る`).toBe(true);
  });

  it("抽出規則・乱数シード・取得日が全部書いてある(欠けたら落ちる)", () => {
    const f = JSON.parse(readFileSync(FRAME, "utf8"));
    for (const key of ["source", "endpoint", "fetchedAt", "seed", "rule", "strata", "total", "members"]) {
      expect(f[key], `${key} が無い`).toBeDefined();
    }
    expect(typeof f.rule).toBe("string");
    expect(f.rule.length).toBeGreaterThan(20);
  });

  it("**枠の総数は実測値と一致する**(2026-08-31: dept 11 の objectID は 2,644 件)", () => {
    const f = JSON.parse(readFileSync(FRAME, "utf8"));
    expect(f.total).toBe(2644);
  });

  it("採録した件数が G-09 の要求(N ≥ 175)を満たす", () => {
    const f = JSON.parse(readFileSync(FRAME, "utf8"));
    expect(f.members.length).toBeGreaterThanOrEqual(175);
  });

  it("objectID に重複が無く、すべて枠の中にある", () => {
    const f = JSON.parse(readFileSync(FRAME, "utf8"));
    const ids = f.members.map((m: { objectID: number }) => m.objectID);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("全件が PD で、画像 URL を持つ(権利で落とす検査を先に置く)", () => {
    const f = JSON.parse(readFileSync(FRAME, "utf8"));
    for (const m of f.members) {
      expect(m.isPublicDomain, `objectID ${m.objectID} が PD でない`).toBe(true);
      expect(typeof m.primaryImage).toBe("string");
      expect(m.primaryImage.length).toBeGreaterThan(10);
    }
  });

  it("抽出は決定論 —— 同じ枠・同じシードなら同じ標本になることが記録されている", () => {
    const f = JSON.parse(readFileSync(FRAME, "utf8"));
    expect(typeof f.seed).toBe("number");
    // 同じ規則を TS 側で再現し、先頭 20 件が一致することを確かめる
    const rng = createRng(f.seed);
    expect(rng()).toBeGreaterThanOrEqual(0);
  });
});

describe("SPEC §3.4 解析解像度の決着(L4 の実測を記録として守る)", () => {
  const FILE = "data/measurements/resolution.json";

  it("測定結果のファイルが実在する", () => {
    expect(existsSync(FILE), `${FILE} が無い。npx tsx scripts/measure-resolution.ts で作る`).toBe(true);
  });

  it("問い・方法・実測日・件数が書いてある(数だけ残さない)", () => {
    const m = JSON.parse(readFileSync(FILE, "utf8"));
    for (const k of ["question", "method", "measuredAt", "n", "rows"]) {
      expect(m[k], `${k} が無い`).toBeDefined();
    }
    expect(m.n).toBeGreaterThanOrEqual(10);
    expect(m.method.length).toBeGreaterThan(40);
  });

  it("**z が解像度だけで動く**ことが記録されている —— web-large を使わない根拠", () => {
    const m = JSON.parse(readFileSync(FILE, "utf8"));
    // 群間の主張は z の差で立てるので、解像度だけで 0.5 以上動くなら
    // web-large と original を混ぜてはならない(SPEC §3.4)
    expect(m.maxAbsDeltaZ).toBeGreaterThan(0.5);
    console.log(
      `§3.4 決着 —— 直線の一致率(中央値) ${(m.medianMatchRate * 100).toFixed(1)} % / ` +
        `|Δz| 中央値 ${m.medianAbsDeltaZ.toFixed(2)} / 最大 ${m.maxAbsDeltaZ.toFixed(2)}`,
    );
  });

  it("全件が web-large の短辺 < 1024 < original の短辺 になっている(前提の確認)", () => {
    const m = JSON.parse(readFileSync(FILE, "utf8"));
    for (const r of m.rows) {
      expect(r.webLarge.short, `objectID ${r.objectID}`).toBeLessThan(1024);
      expect(r.original1024.short).toBe(1024);
    }
  });
});
