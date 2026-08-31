import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { houghTransform, extractPeaks, DEFAULT_DETECT, type DetectOptions } from "@/core/hough";
import { rawScore, nullDistribution, zScore } from "@/core/score";
import type { Grid } from "@/core/grids";
import { toCenter, type Point } from "@/core/image";

// 期待値の出所(HC-016)
// ------------------------------------------------------------------
// オラクルは **Rust 実装が書き出した固定フィクスチャ** である
// (`cargo run --release --bin oracle > tests/fixtures/rust_oracle.json`)。
// 入力(エッジ座標・角度表)もそのファイルが持ち、TS 側は自前で三角関数を呼ばない ——
// そうしないと「アルゴリズムの差」と「libm の差」が混ざる(SPEC §11.1)。
//
// 許容の出所(実測 2026-08-31、Rust 1.71 / Node V8、決定論標本 2,000 点):
//   sqrt 0/2000 一致 / cos 44/2000 不一致 / sin 50/2000 不一致 / exp 187/2000 不一致
// IEEE 754 は sqrt にだけ正しい丸めを義務づける。したがって
//   - 整数・四則だけの区間(投票配列・極大)は **完全一致**(G-06a)
//   - exp を通る区間(raw / z)は **|Δz| ≤ 1e-9**(G-06c の宣言値)

type Oracle = {
  width: number;
  height: number;
  thetaSteps: number;
  rhoScale: number;
  rhoSteps: number;
  sigmaBits: string;
  seed: number;
  trials: number;
  voteRatio: number;
  nmsTheta: number;
  nmsRho: number;
  maxLines: number;
  edges: [number, number][];
  cosBits: string[];
  sinBits: string[];
  gridPolarBits: [string, string][];
  votes: number[];
  peaksBits: [string, string][];
  rawBits: string;
  zBits: string;
  nullMeanBits: string;
  nullSdBits: string;
};

const O: Oracle = JSON.parse(readFileSync("tests/fixtures/rust_oracle.json", "utf8"));

/** f64 のビットパターンを値に戻す。十進で持ち回ると往復で最終 ULP が落ちる */
function fromBits(hex: string): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt("0x" + hex));
  return view.getFloat64(0);
}
function toBits(v: number): string {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, v);
  return view.getBigUint64(0).toString(16).padStart(16, "0");
}

const COS = Float64Array.from(O.cosBits, fromBits);
const SIN = Float64Array.from(O.sinBits, fromBits);
const SIGMA = fromBits(O.sigmaBits);

/** フィクスチャのエッジ座標をエッジマスクに戻す */
function edgeMask(): Uint8Array {
  const m = new Uint8Array(O.width * O.height);
  for (const [x, y] of O.edges) m[y * O.width + x] = 1;
  return m;
}

const OPTS: DetectOptions = {
  ...DEFAULT_DETECT,
  thetaSteps: O.thetaSteps,
  rhoScale: O.rhoScale,
  voteRatio: O.voteRatio,
  nmsTheta: O.nmsTheta,
  nmsRho: O.nmsRho,
  maxLines: O.maxLines,
};

describe("フィクスチャそのものの検算", () => {
  it("入力が空でなく、寸法が整合する(走査対象の確認 — HC-041)", () => {
    expect(O.edges.length).toBeGreaterThan(100);
    expect(O.cosBits.length).toBe(O.thetaSteps);
    expect(O.votes.length).toBe(O.thetaSteps * O.rhoSteps);
    expect(O.peaksBits.length).toBeGreaterThan(0);
  });

  it("角度表が f64 として往復する(十進で落ちていない)", () => {
    for (let i = 0; i < O.thetaSteps; i++) {
      expect(toBits(COS[i])).toBe(O.cosBits[i]);
      expect(toBits(SIN[i])).toBe(O.sinBits[i]);
    }
  });
});

describe("T-101 / G-06a 投票配列が完全一致する", () => {
  it("同じエッジ座標・同じ角度表から、TS と Rust の投票平面が全要素一致する", () => {
    const res = houghTransform(edgeMask(), O.width, O.height, {
      ...OPTS,
      angleTable: { cos: COS, sin: SIN },
    });
    expect(res.ctx.rhoSteps).toBe(O.rhoSteps);
    expect(res.acc.length).toBe(O.votes.length);
    let mismatch = 0;
    let firstAt = -1;
    for (let i = 0; i < res.acc.length; i++) {
      if (res.acc[i] !== O.votes[i]) {
        mismatch++;
        if (firstAt < 0) firstAt = i;
      }
    }
    expect(mismatch, `最初の不一致 index=${firstAt}`).toBe(0);
    // 投票が全部 0 の平面と一致しても意味がないので、中身があることを別に見る
    expect(Math.max(...O.votes)).toBeGreaterThan(10);
  });
});

describe("T-102 / G-06a 極大が完全一致する", () => {
  it("θ・ρ が f64 のビットまで一致する(重心補間は四則のみ)", () => {
    const res = houghTransform(edgeMask(), O.width, O.height, {
      ...OPTS,
      angleTable: { cos: COS, sin: SIN },
    });
    const peaks = extractPeaks(res, OPTS);
    expect(peaks.length).toBe(O.peaksBits.length);
    peaks.forEach((p, i) => {
      expect(toBits(p.theta), `極大 ${i} の θ`).toBe(O.peaksBits[i][0]);
      expect(toBits(p.rho), `極大 ${i} の ρ`).toBe(O.peaksBits[i][1]);
    });
  });
});

describe("T-103 / G-06a 陽性対照 —— 経路をずらした版は落ちる", () => {
  it("ρ ビンを 1 つずらした投票関数では一致しない", () => {
    const res = houghTransform(edgeMask(), O.width, O.height, {
      ...OPTS,
      angleTable: { cos: COS, sin: SIN },
      accumulate: (acc, ctx, x, y) => {
        const dx = x - ctx.cx;
        const dy = y - ctx.cy;
        const half = ctx.rhoSteps >> 1;
        for (let t = 0; t < ctx.thetaSteps; t++) {
          const rho = dx * ctx.cosT[t] + dy * ctx.sinT[t];
          const r = Math.round(rho * ctx.rhoScale) + half + 1; // ← ここだけずらす
          if (r >= 0 && r < ctx.rhoSteps) acc[t * ctx.rhoSteps + r]++;
        }
      },
    });
    let mismatch = 0;
    for (let i = 0; i < res.acc.length; i++) if (res.acc[i] !== O.votes[i]) mismatch++;
    expect(mismatch).toBeGreaterThan(0);
  });

  it("丸めの流儀を変えた版も落ちる(JS の Math.round は半整数を +∞ 方向へ丸める)", () => {
    const res = houghTransform(edgeMask(), O.width, O.height, {
      ...OPTS,
      angleTable: { cos: COS, sin: SIN },
      accumulate: (acc, ctx, x, y) => {
        const dx = x - ctx.cx;
        const dy = y - ctx.cy;
        const half = ctx.rhoSteps >> 1;
        for (let t = 0; t < ctx.thetaSteps; t++) {
          const rho = dx * ctx.cosT[t] + dy * ctx.sinT[t];
          const v = rho * ctx.rhoScale;
          const r = (v < 0 ? -Math.round(-v) : Math.round(v)) + half; // 0 から遠い方へ
          if (r >= 0 && r < ctx.rhoSteps) acc[t * ctx.rhoSteps + r]++;
        }
      },
    });
    let mismatch = 0;
    for (let i = 0; i < res.acc.length; i++) if (res.acc[i] !== O.votes[i]) mismatch++;
    expect(mismatch, "丸めの流儀を変えても一致するなら、この入力では区別がつかない").toBeGreaterThan(0);
  });
});

describe("T-106 / G-06b 環境差を測る(閾値なし)", () => {
  it("両実装が自前で角度表を計算したときの投票配列の差を記録する", () => {
    // TS が Math.cos / Math.sin で表を作る = 実運用の経路
    const own = houghTransform(edgeMask(), O.width, O.height, OPTS);
    let tableMismatch = 0;
    for (let i = 0; i < O.thetaSteps; i++) {
      if (toBits(own.ctx.cosT[i]) !== O.cosBits[i]) tableMismatch++;
      if (toBits(own.ctx.sinT[i]) !== O.sinBits[i]) tableMismatch++;
    }
    let voteMismatch = 0;
    let maxDelta = 0;
    for (let i = 0; i < own.acc.length; i++) {
      const d = Math.abs(own.acc[i] - O.votes[i]);
      if (d !== 0) voteMismatch++;
      if (d > maxDelta) maxDelta = d;
    }
    console.log(
      `T-106 環境差 —— 角度表 ${tableMismatch}/${O.thetaSteps * 2} 個が最終 ULP で違う → 投票ビン ${voteMismatch}/${own.acc.length} 個が違う(最大差 ${maxDelta} 票)`,
    );
    // 測定であって合否ではない。記録が取れたことだけを確かめる
    expect(own.acc.length).toBe(O.votes.length);
  });
});

describe("T-107 / G-06c raw と z(exp を通る区間)", () => {
  it("|Δz| ≤ 1e-9 かつ |Δraw| ≤ 1e-12", () => {
    const points: Point[] = O.edges.map(([x, y]) => ({
      x: toCenter(x, O.width),
      y: toCenter(y, O.height),
    }));
    const lines = O.gridPolarBits.map(([t, r]) => ({ theta: fromBits(t), rho: fromBits(r) }));
    const grid: Grid = { id: "thirds", name: "三分割法", lines, points: [], lineCount: lines.length };

    const raw = rawScore(points, grid, SIGMA);
    const dist = nullDistribution(points, grid.lineCount, O.width, O.height, {
      sigma: SIGMA,
      seed: O.seed,
      trials: O.trials,
    });
    const z = zScore(points, grid, dist, SIGMA);

    const dRaw = Math.abs(raw - fromBits(O.rawBits));
    const dMean = Math.abs(dist.mean - fromBits(O.nullMeanBits));
    const dSd = Math.abs(dist.sd - fromBits(O.nullSdBits));
    const dZ = Math.abs(z - fromBits(O.zBits));
    console.log(
      `T-107 二実装差 —— Δraw=${dRaw.toExponential(2)} Δ帰無平均=${dMean.toExponential(2)} Δ帰無sd=${dSd.toExponential(2)} Δz=${dZ.toExponential(2)}`,
    );

    expect(dRaw).toBeLessThanOrEqual(1e-12);
    expect(dZ).toBeLessThanOrEqual(1e-9); // SPEC G-06c の宣言値
  });

  it("陽性対照 —— σ を変えれば許容を超える(検査が働いていることの確認)", () => {
    const points: Point[] = O.edges.map(([x, y]) => ({
      x: toCenter(x, O.width),
      y: toCenter(y, O.height),
    }));
    const lines = O.gridPolarBits.map(([t, r]) => ({ theta: fromBits(t), rho: fromBits(r) }));
    const grid: Grid = { id: "thirds", name: "三分割法", lines, points: [], lineCount: lines.length };
    const raw = rawScore(points, grid, SIGMA * 1.01);
    expect(Math.abs(raw - fromBits(O.rawBits))).toBeGreaterThan(1e-12);
  });
});
