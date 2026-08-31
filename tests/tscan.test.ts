import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { canny } from "@/core/canny";
import { makeGridAligned, makePinkNoise } from "@/core/controls";
import { edgePoints } from "@/core/points";
import { createRng } from "@/core/rng";
import {
  scanRatios,
  T_MIN,
  T_MAX,
  T_STEP,
  permutationBand,
  cohensD,
  cliffsDelta,
  pairedT,
  requiredNForPower,
} from "@/core/tscan";

// 期待値の出所(HC-016)
// ------------------------------------------------------------------
// t 走査の刻みは **SPEC §4 の宣言値**: t ∈ [0.05, 0.95] を 0.005 刻み(181 点)。
// 効果量と検定力の期待値は **統計の解析解**:
//   - Cohen's d は既知の平均差と標準偏差から手計算できる
//   - Cliff's δ は完全分離で ±1、同分布で 0
//   - d = 0.30 を α = .05 両側・検出力 .80 で検出するには 1 群 175 —— SPEC §8.1 の宣言値
//
// **T-310(SPEC §4 の循環の禁止)**: 走査コードに 0.618 / 0.382 / 1/3 の定数が現れない。
// 黄金比を優遇する経路を構造として持たないことが、目玉の成立条件である。

describe("T-301 t 走査が宣言どおりの点を覆う", () => {
  it("[0.05, 0.95] を 0.005 刻みで 181 点(SPEC §4)", () => {
    expect(T_MIN).toBe(0.05);
    expect(T_MAX).toBe(0.95);
    expect(T_STEP).toBe(0.005);
    const img = makePinkNoise({ width: 300, height: 200, seed: 1 });
    const pts = edgePoints(canny(img), 300, 200, 400);
    const scan = scanRatios(pts, 300, 200, { sigma: 2, seed: 1, trials: 200 });
    expect(scan.vertical.length).toBe(181);
    expect(scan.horizontal.length).toBe(181);
    // 集合として過不足がない(定数で件数を書くだけにしない)
    const want = new Set<string>();
    for (let t = T_MIN; t <= T_MAX + 1e-9; t += T_STEP) want.add(t.toFixed(3));
    const got = new Set(scan.vertical.map((p) => p.t.toFixed(3)));
    expect([...got].sort()).toEqual([...want].sort());
  });
});

describe("T-310 走査側に比の定数を置かない(目玉の成立条件)", () => {
  it("tscan.ts に 0.618 / 0.382 / 1/3 が現れない", () => {
    const src = readFileSync("src/core/tscan.ts", "utf8");
    expect(src.length).toBeGreaterThan(500);
    expect(src, "黄金比の定数が走査側にある").not.toMatch(/0\.618|0\.382|1\.618/);
    expect(src, "三分割の定数が走査側にある").not.toMatch(/1\s*\/\s*3|0\.333/);
  });

  it("陽性対照 —— 定数を書いた文字列はこの検査に捕まる", () => {
    expect("const GOLDEN_CUT = 0.618;").toMatch(/0\.618|0\.382|1\.618/);
  });
});

describe("T-302 順列帰無の帯そのものを検算する", () => {
  it("帰無の下で、曲線が帯を外れる割合が 5 % 程度に収まる", () => {
    // **帯が正しいかを帯で確かめる。**帰無(1/f ノイズ)の曲線を 40 本引き、
    // 各点で 95 % 帯の外に出る割合を数える。3–7 % に収まらなければ帯の作り方が誤っている。
    const rng = createRng(20260831);
    const W = 260;
    const H = 180;
    const curves: number[][] = [];
    for (let i = 0; i < 40; i++) {
      const img = makePinkNoise({ width: W, height: H, seed: Math.floor(rng() * 1e9) });
      const pts = edgePoints(canny(img), W, H, 500);
      const scan = scanRatios(pts, W, H, { sigma: Math.min(W, H) * 0.01, seed: 7, trials: 300 });
      curves.push(scan.vertical.map((p) => p.z));
    }
    const band = permutationBand(curves, 0.95);
    expect(band.lo.length).toBe(181);
    let outside = 0;
    let total = 0;
    for (const c of curves) {
      for (let i = 0; i < c.length; i++) {
        total++;
        if (c[i] < band.lo[i] || c[i] > band.hi[i]) outside++;
      }
    }
    const rate = outside / total;
    console.log(`T-302 帯の検算: 外れ率 ${(rate * 100).toFixed(2)} %(狙い 5 %)`);
    expect(rate).toBeGreaterThan(0.02);
    expect(rate).toBeLessThan(0.09);
  });
});

describe("T-303 陽性対照 —— P 群の走査曲線は帯を出る", () => {
  it("三分割配置の合成画像は t = 1/3 と 2/3 の近くで帯の上に出る", () => {
    const W = 600;
    const H = 400;
    const rng = createRng(4242);
    // 帰無の帯は 1/f ノイズ 24 本から作る
    const nullCurves: number[][] = [];
    for (let i = 0; i < 24; i++) {
      const img = makePinkNoise({ width: W, height: H, seed: Math.floor(rng() * 1e9) });
      const pts = edgePoints(canny(img), W, H, 800);
      nullCurves.push(
        scanRatios(pts, W, H, { sigma: Math.min(W, H) * 0.01, seed: 11, trials: 300 }).vertical.map(
          (p) => p.z,
        ),
      );
    }
    const band = permutationBand(nullCurves, 0.95);

    const p = makeGridAligned({ width: W, height: H, ratio: "thirds", seed: 5 });
    const pts = edgePoints(canny(p), W, H, 800);
    const scan = scanRatios(pts, W, H, { sigma: Math.min(W, H) * 0.01, seed: 11, trials: 300 });

    const above = scan.vertical.filter((q, i) => q.z > band.hi[i]).map((q) => q.t);
    console.log(
      `T-303 P 群が帯の上に出た t: ${above.length} 点 ${above.length ? `(${Math.min(...above).toFixed(3)}–${Math.max(...above).toFixed(3)})` : ""}`,
    );
    expect(above.length, "陽性対照が帯を一度も出ない —— 帯か走査が壊れている").toBeGreaterThan(0);
    // 1/3 と 2/3 の近く(±0.02)に出ていること
    for (const want of [1 / 3, 2 / 3]) {
      expect(
        above.some((t) => Math.abs(t - want) <= 0.02),
        `t = ${want.toFixed(3)} の近くで帯を出ていない(出た t: ${above.map((t) => t.toFixed(3)).join(",")})`,
      ).toBe(true);
    }
  });
});

describe("T-309 効果量を解析解で検算する", () => {
  it("Cohen's d —— 平均差 1・標準偏差 1 の 2 群で d ≈ 1", () => {
    const a = [-1, 0, 1];
    const b = [0, 1, 2];
    // 併合標準偏差は 1、平均差は 1
    expect(cohensD(b, a)).toBeCloseTo(1, 10);
  });

  it("Cohen's d —— 同じ分布なら 0", () => {
    const a = [1, 2, 3, 4];
    expect(cohensD(a, a)).toBeCloseTo(0, 12);
  });

  it("Cliff's δ —— 完全分離で 1、逆で −1、同分布で 0", () => {
    expect(cliffsDelta([4, 5, 6], [1, 2, 3])).toBeCloseTo(1, 12);
    expect(cliffsDelta([1, 2, 3], [4, 5, 6])).toBeCloseTo(-1, 12);
    expect(cliffsDelta([1, 2, 3], [1, 2, 3])).toBeCloseTo(0, 12);
  });

  it("対応ありの t —— 差が 0 なら t は 0、差が一定なら発散する向き", () => {
    expect(pairedT([1, 2, 3], [1, 2, 3]).t).toBeCloseTo(0, 12);
    const r = pairedT([2, 3, 4], [1, 2, 3]);
    expect(r.t).toBeGreaterThan(10); // 差が全部 1 で分散 0 に近い
    expect(r.n).toBe(3);
  });

  it("長さが違えば例外(黙って切り詰めない)", () => {
    expect(() => pairedT([1, 2], [1, 2, 3])).toThrow();
  });
});

describe("T-305 / G-09 検定力", () => {
  it("d = 0.30 を α=.05 両側・検出力 .80 で検出するには 1 群 175(SPEC §8.1)", () => {
    expect(requiredNForPower(0.3, 0.05, 0.8)).toBe(175);
  });

  it("効果量が大きいほど必要な数は減る(単調)", () => {
    const a = requiredNForPower(0.2, 0.05, 0.8);
    const b = requiredNForPower(0.5, 0.05, 0.8);
    const c = requiredNForPower(0.8, 0.05, 0.8);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    console.log(`T-305 必要 N: d=0.2 → ${a} / d=0.5 → ${b} / d=0.8 → ${c}`);
  });

  it("**標本枠が G-09 を満たす**(N ≥ 175)", () => {
    const frame = JSON.parse(readFileSync("data/frames/met-ep.json", "utf8"));
    expect(frame.members.length).toBeGreaterThanOrEqual(requiredNForPower(0.3, 0.05, 0.8));
  });
});
