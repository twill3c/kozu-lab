import { describe, expect, it } from "vitest";
import { buildGrid, randomGrid } from "@/core/grids";
import { rawScore, nullDistribution, zScore } from "@/core/score";
import { createRng } from "@/core/rng";

// 期待値の出所(HC-016)
// ------------------------------------------------------------------
// T-009 の閾値は **SPEC §11 の G-05 の宣言値**:
//   ランダム格子に対する z が |平均| ≤ 0.05 かつ |標準偏差 − 1| ≤ 0.05
// これは自己整合の検算である —— 帰無分布の作り方が正しければ、帰無から引いた格子の z は
// 定義上 N(0,1) に従う。従わなければ、z 化が線数の交絡を落としていない。
//
// シードは **測る前に宣言する**: 20260831。合わなかったらシードを変えて通すのではなく、
// 正規化の側を疑う(SPEC §11 の「落ちたら閾値を緩めず主張を格下げする」と同じ規律)。
//
// 標本サイズの出所(実測 2026-08-31)。初版は帰無 1,000 枚・検査 2,000 枚で書いて落ちた。
// 原因は実装ではなく **検査の側** だった —— 帰無を有限標本で推定する誤差が 1/√枚数 で入り、
// 1,000 枚では 0.032 になる。閾値 0.05 に対して 1.6σ しかなく、通るかどうかがシード次第になる。
// 8 シードで測ると平均は両側に散り、その平均は -0.0019 だった(系統誤差ではない)。
// 帰無 16,000 枚・検査 20,000 枚まで上げると z 平均 -0.008 / +0.001、sd 0.999 / 0.988 に収束する。
// **閾値ではなく標本サイズを上げた。**

const W = 900;
const H = 600;
const SEED = 20260831;
const SIGMA = Math.min(W, H) * 0.01; // SPEC §5.1 の既定
/** 帰無の枚数(SPEC §5.1)。1,000 では推定誤差 0.032 で閾値 0.05 に足りない —— 上の注記を参照 */
const NULL_TRIALS = 16_000;
/** 検査側の引き数。ここが小さいと sd の推定が 1.6 % 揺れる */
const TEST_DRAWS = 20_000;

/** 検査用の特徴点。実画像の代わりに一様乱数の点群を使う(帰無の検算に画像は要らない) */
function uniformPoints(n: number, seed: number) {
  const rng = createRng(seed);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    pts.push({ x: (rng() - 0.5) * W, y: (rng() - 0.5) * H });
  }
  return pts;
}

describe("rawScore の素性", () => {
  it("線上の点は 1 に近く、遠い点は 0 に近い", () => {
    const grid = { id: "t", name: "t", lines: [{ theta: 0, rho: 0 }], points: [], lineCount: 1 };
    const on = rawScore([{ x: 0, y: 0 }], grid, SIGMA);
    const far = rawScore([{ x: W / 2, y: 0 }], grid, SIGMA);
    expect(on).toBeCloseTo(1, 9);
    expect(far).toBeLessThan(1e-6);
  });

  it("点が無ければ 0(ゼロ除算を作らない)", () => {
    const grid = { id: "t", name: "t", lines: [{ theta: 0, rho: 0 }], points: [], lineCount: 1 };
    expect(rawScore([], grid, SIGMA)).toBe(0);
  });

  it("線が多いほど raw は上がる(z 化が必要な理由 —— SPEC §5.2 の根拠)", () => {
    const pts = uniformPoints(3000, 7);
    const few = rawScore(pts, randomGrid(4, W, H, createRng(11)), SIGMA);
    const many = rawScore(pts, randomGrid(20, W, H, createRng(11)), SIGMA);
    expect(many).toBeGreaterThan(few);
  });
});

describe("T-009 z 正規化が線数の交絡を落とす(G-05)", () => {
  for (const lineCount of [4, 8, 20]) {
    it(`線数 ${lineCount} のランダム格子に対する z が N(0,1) に従う`, () => {
      const pts = uniformPoints(1000, 4242);
      const dist = nullDistribution(pts, lineCount, W, H, { sigma: SIGMA, seed: SEED, trials: NULL_TRIALS });

      // 帰無を作ったシードとは別のシードで、同じ線数の格子を引いて z を測る
      const rng = createRng(SEED + 1);
      const zs: number[] = [];
      for (let i = 0; i < TEST_DRAWS; i++) {
        zs.push(zScore(pts, randomGrid(lineCount, W, H, rng), dist, SIGMA));
      }
      const mean = zs.reduce((a, b) => a + b, 0) / zs.length;
      const sd = Math.sqrt(zs.reduce((a, b) => a + (b - mean) ** 2, 0) / (zs.length - 1));
      console.log(`T-009 線数 ${lineCount}: 平均 ${mean.toFixed(4)} / 標準偏差 ${sd.toFixed(4)}`);

      expect(Math.abs(mean)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(sd - 1)).toBeLessThanOrEqual(0.05);
    });
  }

  it("線数の違う格子の z が同じ尺度に乗る(生スコアでは乗らない)", () => {
    const pts = uniformPoints(2000, 99);
    const zs = [4, 8, 20].map((n) => {
      const dist = nullDistribution(pts, n, W, H, { sigma: SIGMA, seed: SEED, trials: 500 });
      return zScore(pts, randomGrid(n, W, H, createRng(SEED + 5)), dist, SIGMA);
    });
    // すべて帰無から引いた格子なので、どれも 0 の近くに立つはず
    for (const z of zs) expect(Math.abs(z)).toBeLessThan(4);
  });

  it("陽性対照 —— 線数を無視した帰無(常に線数 4)では交絡が残る", () => {
    // 正規化を壊す: 線数 20 の格子を、線数 4 の帰無で測る。
    // raw は線数とともに上がる(上のケースで確かめた)ので、z は大きく外れるはず。
    const pts = uniformPoints(2000, 4242);
    const wrong = nullDistribution(pts, 4, W, H, { sigma: SIGMA, seed: SEED, trials: NULL_TRIALS });
    const z = zScore(pts, randomGrid(20, W, H, createRng(SEED + 1)), wrong, SIGMA);
    expect(Math.abs(z)).toBeGreaterThan(3);
  });
});

describe("T-010 σ 依存を記録する(主張はしない)", () => {
  it("σ を 0.5 % / 1 % / 2 % に振ったときの z を記録に残す", () => {
    const pts = uniformPoints(2000, 31337);
    const grid = buildGrid("thirds", W, H);
    const rows: string[] = [];
    for (const frac of [0.005, 0.01, 0.02]) {
      const sigma = Math.min(W, H) * frac;
      const dist = nullDistribution(pts, grid.lineCount, W, H, { sigma, seed: SEED, trials: 500 });
      rows.push(`σ=${(frac * 100).toFixed(1)}% → z=${zScore(pts, grid, dist, sigma).toFixed(3)}`);
    }
    console.log("T-010 σ 依存(一様点群・三分割格子): " + rows.join(" / "));
    // 測定であって合否ではない。記録が取れたことだけを確かめる
    expect(rows.length).toBe(3);
  });
});

describe("z 計算の決定論(G-04)", () => {
  it("同一シードで 20 回、z がビット一致する", () => {
    const pts = uniformPoints(500, 5);
    const grid = buildGrid("thirds", W, H);
    const first = zScore(
      pts,
      grid,
      nullDistribution(pts, grid.lineCount, W, H, { sigma: SIGMA, seed: SEED, trials: 200 }),
      SIGMA,
    );
    for (let i = 0; i < 20; i++) {
      const z = zScore(
        pts,
        grid,
        nullDistribution(pts, grid.lineCount, W, H, { sigma: SIGMA, seed: SEED, trials: 200 }),
        SIGMA,
      );
      expect(z).toBe(first);
    }
  });
});
