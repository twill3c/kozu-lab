import { describe, expect, it } from "vitest";
import { drawLines, degrade, HALF_WIDTH } from "@/core/synth";
import { createRng } from "@/core/rng";

// 期待値の出所(HC-016)
// ------------------------------------------------------------------
// T-001 の期待値は **SPEC の条項でも外部権威でもなく、生成器の引数そのもの**である。
// 直線 (θ, ρ) の定義式 x cosθ + y sinθ = ρ(原点は画像中心)を、
// 描かれた画素が満たすことを検算する。**画像から (θ, ρ) を読み戻さない** —
// 読み戻せば「生成器が生成器と一致する」という循環になる(SPEC §6 / G-03)。
//
// 許容 0.5 は TEST_SPEC T-001 の宣言値であり、同時に生成器の設計値でもある:
// drawLines は距離場 |x cosθ + y sinθ − ρ| ≤ HALF_WIDTH で画素を塗る。
// HALF_WIDTH = 0.5 のとき、塗られた画素は定義上すべて 0.5 以内に入る。
// したがってこの検算が落ちるのは、**塗り方が距離場から外れたとき**だけである。

const W = 512;
const H = 384;

describe("T-001 合成線分生成器が引数どおりの (θ, ρ) を描く", () => {
  it("塗られた画素がすべて直線の定義式を満たす(画像から読み戻さない)", () => {
    // θ は 0–179° を 7° 刻み、ρ は画像対角半径の −0.6〜0.6 を 5 段階。
    // 生成器の引数として与えた値だけを真値として使う。
    const R = Math.hypot(W / 2, H / 2);
    const thetas = Array.from({ length: 26 }, (_, i) => (i * 7 * Math.PI) / 180);
    const rhos = [-0.6, -0.3, 0, 0.3, 0.6].map((f) => f * R);

    let checked = 0;
    for (const theta of thetas) {
      for (const rho of rhos) {
        const img = drawLines({ width: W, height: H, lines: [{ theta, rho }] });
        const cx = W / 2;
        const cy = H / 2;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            // 背景は白、線は黒。塗られた画素だけを検算する
            if (img.data[i] === 255) continue;
            const d = Math.abs(
              (x - cx) * Math.cos(theta) + (y - cy) * Math.sin(theta) - rho,
            );
            expect(d).toBeLessThanOrEqual(0.5);
            checked++;
          }
        }
      }
    }
    // 走査対象が空でないことを別に確かめる(HC-041: 検査が働いていることの確認)
    expect(checked).toBeGreaterThan(10_000);
  });

  it("HALF_WIDTH は 0.5 である(T-001 の許容の出所)", () => {
    expect(HALF_WIDTH).toBe(0.5);
  });

  it("線を 1 本も与えなければ 1 画素も塗られない(陰性対照)", () => {
    const img = drawLines({ width: 64, height: 64, lines: [] });
    const painted = [...img.data].filter((_, i) => i % 4 === 0 && img.data[i] !== 255);
    expect(painted.length).toBe(0);
  });
});

describe("劣化器(F-02)は決定論である", () => {
  it("同一シードで同一出力(SPEC G-04)", () => {
    const base = drawLines({
      width: 128,
      height: 128,
      lines: [{ theta: Math.PI / 5, rho: 10 }],
    });
    const a = degrade(base, { noiseSigma: 12, brushStrength: 0.4 }, createRng(20260831));
    const b = degrade(base, { noiseSigma: 12, brushStrength: 0.4 }, createRng(20260831));
    expect([...a.data]).toEqual([...b.data]);
  });

  it("シードが違えば出力も違う(陽性対照 — 劣化が実際に効いていることの確認)", () => {
    const base = drawLines({
      width: 128,
      height: 128,
      lines: [{ theta: Math.PI / 5, rho: 10 }],
    });
    const a = degrade(base, { noiseSigma: 12 }, createRng(1));
    const b = degrade(base, { noiseSigma: 12 }, createRng(2));
    expect([...a.data]).not.toEqual([...b.data]);
  });

  it("劣化を何も指定しなければ入力をそのまま返す(恒等)", () => {
    const base = drawLines({
      width: 64,
      height: 64,
      lines: [{ theta: 0, rho: 0 }],
    });
    const out = degrade(base, {}, createRng(1));
    expect([...out.data]).toEqual([...base.data]);
  });
});
