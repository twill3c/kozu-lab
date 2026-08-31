import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { drawLines } from "@/core/synth";
import { detectLines, lineDistance, DEFAULT_DETECT } from "@/core/hough";
import { brokenAccumulate } from "./fixtures/brokenHough";

// 期待値の出所(HC-016)
// ------------------------------------------------------------------
// T-002 / T-003 の閾値は **SPEC §11 の G-01 の宣言値**である:
//   Δθ ≤ 1.0° かつ Δρ ≤ 短辺の 0.5 %
// 真値は生成器の引数(tests/synth.test.ts と同じ立場)。画像から読み戻さない。
//
// 注意:(θ, ρ) と (θ+180°, −ρ) は同じ直線である。比較はこの同値を畳んだ
// lineDistance で行う。畳まずに比べると、正しい実装が θ≈0 と θ≈179 の境界で落ちる。

const W = 512;
const H = 384;
const SHORT = Math.min(W, H);
const TOL_THETA_DEG = 1.0; // SPEC G-01
const TOL_RHO_PX = SHORT * 0.005; // SPEC G-01 = 1.92 px

const R = Math.hypot(W / 2, H / 2);

/**
 * 真値の集合を作る。
 *
 * ρ は **θ に依存する支持関数** h(θ) = (W/2)|cosθ| + (H/2)|sinθ| に対する比で与える。
 * 対角半径 R を一律の基準にすると、θ によっては線が画像の外へ出る ——
 * 実測(2026-08-31)では θ=90° / ρ=0.6R が画像の下端の外に落ち、
 * 「線が 1 本も写っていない画像から線を検出せよ」という不能な要求になっていた。
 * **フィクスチャは、検査が要求する性質(線が画面内を通ること)を実際に持たねばならない**(HC-070)。
 */
function support(thetaDeg: number): number {
  const t = (thetaDeg * Math.PI) / 180;
  return (W / 2) * Math.abs(Math.cos(t)) + (H / 2) * Math.abs(Math.sin(t));
}
function truth(thetaDeg: number, rhoFrac: number) {
  return { theta: (thetaDeg * Math.PI) / 180, rho: rhoFrac * support(thetaDeg) };
}

describe("T-002 無劣化の単一線分で Hough が真値を復元する(G-01)", () => {
  it("θ 0–179° を 1° 刻み × ρ 5 段階で、Δθ ≤ 1.0° かつ Δρ ≤ 短辺の 0.5 %", () => {
    const rhoFracs = [-0.6, -0.3, 0, 0.3, 0.6];
    const worst = { dTheta: 0, dRho: 0, at: "" };
    let cases = 0;

    for (let deg = 0; deg < 180; deg++) {
      for (const f of rhoFracs) {
        const t = truth(deg, f);
        const img = drawLines({ width: W, height: H, mode: "step", lines: [t] });
        const found = detectLines(img, DEFAULT_DETECT);
        expect(found.length).toBeGreaterThan(0);

        // 最も近い検出線を採る
        let best = found[0];
        let bestD = lineDistance(t, best, R);
        for (const c of found.slice(1)) {
          const d = lineDistance(t, c, R);
          if (d.combined < bestD.combined) {
            best = c;
            bestD = d;
          }
        }
        if (bestD.dThetaDeg > worst.dTheta) {
          worst.dTheta = bestD.dThetaDeg;
          worst.at = `θ=${deg}° ρ=${f}`;
        }
        if (bestD.dRho > worst.dRho) worst.dRho = bestD.dRho;

        expect(bestD.dThetaDeg).toBeLessThanOrEqual(TOL_THETA_DEG);
        expect(bestD.dRho).toBeLessThanOrEqual(TOL_RHO_PX);
        cases++;
      }
    }
    expect(cases).toBe(900);
    // 走査が空でないことと、最悪値を記録に残す(G-13 の土台)
    console.log(
      `T-002 最悪 Δθ=${worst.dTheta.toFixed(3)}° (${worst.at}) / 最悪 Δρ=${worst.dRho.toFixed(3)} px（許容 ${TOL_RHO_PX.toFixed(2)} px）`,
    );
  });
});

describe("T-003 線分 5 本の同時検出は集合として一致する", () => {
  it("真値集合と検出集合が 1:1 に対応する(件数の定数では書かない)", () => {
    const lines = [
      truth(0, -0.5),
      truth(37, 0.2),
      truth(90, 0.0),
      truth(118, -0.25),
      truth(160, 0.55),
    ];
    const img = drawLines({ width: W, height: H, mode: "step", lines });
    const found = detectLines(img, DEFAULT_DETECT);

    // 各真値にちょうど 1 本が対応し、対応先が重複しない(1:1)
    const used = new Set<number>();
    for (const t of lines) {
      const idx = found
        .map((c, i) => ({ i, d: lineDistance(t, c, R) }))
        .filter((e) => e.d.dThetaDeg <= TOL_THETA_DEG && e.d.dRho <= TOL_RHO_PX)
        .sort((a, b) => a.d.combined - b.d.combined);
      expect(idx.length).toBeGreaterThan(0);
      const pick = idx.find((e) => !used.has(e.i));
      expect(pick).toBeDefined();
      used.add(pick!.i);
    }
    expect(used.size).toBe(lines.length);
  });
});

describe("T-004 陽性対照 —— 壊した検出器は T-002 を落とす", () => {
  it("投票累積を退化させると真値を復元できない", () => {
    // brokenAccumulate は θ ビンを 1 本に潰す(すべての票を θ=0 に入れる)。
    // この対照が落ちないなら、T-002 は検出器を検査していない(HC-041)。
    const t = truth(37, 0.2);
    const img = drawLines({ width: W, height: H, mode: "step", lines: [t] });
    const found = detectLines(img, { ...DEFAULT_DETECT, accumulate: brokenAccumulate });
    const ok = found.some((c) => {
      const d = lineDistance(t, c, R);
      return d.dThetaDeg <= TOL_THETA_DEG && d.dRho <= TOL_RHO_PX;
    });
    expect(ok).toBe(false);
  });

  it("壊していない検出器では同じ入力で復元できる(対照の対)", () => {
    const t = truth(37, 0.2);
    const img = drawLines({ width: W, height: H, mode: "step", lines: [t] });
    const found = detectLines(img, DEFAULT_DETECT);
    const ok = found.some((c) => {
      const d = lineDistance(t, c, R);
      return d.dThetaDeg <= TOL_THETA_DEG && d.dRho <= TOL_RHO_PX;
    });
    expect(ok).toBe(true);
  });
});

describe("T-005 陰性対照 —— 正常な検出器の誤検出が 0(HC-074)", () => {
  it("真値に対応しない検出直線が出ない", () => {
    const sets = [
      [truth(0, 0)],
      [truth(45, 0.3)],
      [truth(90, -0.4)],
      [truth(30, 0.1), truth(120, -0.2)],
      [truth(15, 0.5), truth(75, 0), truth(135, -0.5)],
    ];
    for (const lines of sets) {
      const img = drawLines({ width: W, height: H, mode: "step", lines });
      const found = detectLines(img, DEFAULT_DETECT);
      for (const c of found) {
        const near = lines.some((t) => {
          const d = lineDistance(t, c, R);
          return d.dThetaDeg <= TOL_THETA_DEG && d.dRho <= TOL_RHO_PX;
        });
        expect(near, `真値に対応しない直線 θ=${((c.theta * 180) / Math.PI).toFixed(1)}° ρ=${c.rho.toFixed(1)}`).toBe(true);
      }
    }
  });

  it("線の無い一様な画像から直線を検出しない", () => {
    const img = drawLines({ width: W, height: H, mode: "step", lines: [] });
    expect(detectLines(img, DEFAULT_DETECT).length).toBe(0);
  });
});

describe("T-006 決定論(G-04)", () => {
  it("同一入力で 100 回、検出結果が完全一致する", () => {
    const img = drawLines({
      width: 256,
      height: 256,
      mode: "step",
      lines: [truth(23, 0.3), truth(101, -0.15)],
    });
    const first = JSON.stringify(detectLines(img, DEFAULT_DETECT));
    let mismatch = 0;
    for (let i = 0; i < 100; i++) {
      if (JSON.stringify(detectLines(img, DEFAULT_DETECT)) !== first) mismatch++;
    }
    expect(mismatch).toBe(0);
  });
});

describe("T-007 循環の禁止(G-03)", () => {
  // 検出器・スコア器が真値(生成器の引数)へ到達する経路を持たないことを静的に見る。
  // 述語の射程を先に観測してある(HC-040): src/core 配下の実装ファイルのみを対象とし、
  // 生成器そのもの(synth.ts)は真値を持って当然なので対象から外す。
  const targets = ["src/core/hough.ts", "src/core/canny.ts", "src/core/score.ts", "src/core/grids.ts"];

  it("対象ファイルが実在し、空でない(走査対象の確認)", () => {
    for (const f of targets) {
      expect(readFileSync(f, "utf8").length).toBeGreaterThan(200);
    }
  });

  it("検出器・スコア器が生成器やテストを参照しない", () => {
    for (const f of targets) {
      const src = readFileSync(f, "utf8");
      expect(src, `${f} が synth を参照している`).not.toMatch(/from\s+["'][^"']*synth["']/);
      expect(src, `${f} が tests を参照している`).not.toMatch(/from\s+["'][^"']*tests\//);
    }
  });

  it("陽性対照 —— 参照する版はこの検査に捕まる", () => {
    const bad = `import { drawLines } from "@/core/synth";\n`;
    expect(bad).toMatch(/from\s+["'][^"']*synth["']/);
  });
});
