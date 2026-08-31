import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { GRID_KINDS, buildGrid, intersect } from "@/core/grids";

// 期待値の出所(HC-016)
// ------------------------------------------------------------------
// T-008 の期待値は **格子の定義から導出する**。交点の座標を定数で書かない。
// 定数で書けば「格子生成器が自分の書いた定数と一致する」だけの検査になる。
// 導出は intersect(2 直線の交点)で行い、intersect 自体は解析解で別に検算する。

const W = 900;
const H = 600;

describe("intersect(2 直線の交点)を解析解で検算する", () => {
  it("直交する 2 直線の交点が既知の点に一致する", () => {
    // x = 0(θ=0, ρ=0)と y = 0(θ=90°, ρ=0)は原点(画像中心)で交わる。
    // 座標系は SPEC §5 と同じく画像中心原点。
    const p = intersect({ theta: 0, rho: 0 }, { theta: Math.PI / 2, rho: 0 });
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(0, 9);
    expect(p!.y).toBeCloseTo(0, 9);
  });

  it("平行な 2 直線は交わらない(null を返す)", () => {
    expect(intersect({ theta: 0.7, rho: 10 }, { theta: 0.7, rho: -30 })).toBeNull();
  });

  it("任意の交点が両方の直線の定義式を満たす", () => {
    const a = { theta: 0.3, rho: 40 };
    const b = { theta: 1.9, rho: -25 };
    const p = intersect(a, b)!;
    expect(p.x * Math.cos(a.theta) + p.y * Math.sin(a.theta)).toBeCloseTo(a.rho, 9);
    expect(p.x * Math.cos(b.theta) + p.y * Math.sin(b.theta)).toBeCloseTo(b.rho, 9);
  });
});

describe("T-008 格子生成器は線・交点・線数を返し、交点は導出である", () => {
  it("全種類の格子が空でない線集合を返す", () => {
    expect(GRID_KINDS.length).toBeGreaterThanOrEqual(7);
    for (const kind of GRID_KINDS) {
      const g = buildGrid(kind, W, H);
      expect(g.lines.length, `${kind} の線が空`).toBeGreaterThan(0);
      expect(g.lineCount).toBe(g.lines.length);
    }
  });

  it("交点が線の交わりから導出されている(定数ではない)", () => {
    for (const kind of GRID_KINDS) {
      const g = buildGrid(kind, W, H);
      // 生成器が返した交点を捨て、線集合から総当たりで作り直して一致を見る
      const rebuilt: { x: number; y: number }[] = [];
      for (let i = 0; i < g.lines.length; i++) {
        for (let j = i + 1; j < g.lines.length; j++) {
          const p = intersect(g.lines[i], g.lines[j]);
          if (!p) continue;
          if (Math.abs(p.x) > W / 2 + 1e-6 || Math.abs(p.y) > H / 2 + 1e-6) continue;
          rebuilt.push(p);
        }
      }
      const key = (p: { x: number; y: number }) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
      const got = new Set(g.points.map(key));
      const want = new Set(rebuilt.map(key));
      expect([...got].sort(), `${kind} の交点が線の交わりと違う`).toEqual([...want].sort());
    }
  });

  it("すべての線が画面内を通る(画面外の線を数に入れていない)", () => {
    for (const kind of GRID_KINDS) {
      const g = buildGrid(kind, W, H);
      const R = Math.hypot(W / 2, H / 2);
      for (const l of g.lines) {
        expect(Math.abs(l.rho), `${kind} に画面外の線がある`).toBeLessThanOrEqual(R);
      }
    }
  });

  it("格子は決定論である(同一入力で完全一致)", () => {
    for (const kind of GRID_KINDS) {
      const a = JSON.stringify(buildGrid(kind, W, H));
      const b = JSON.stringify(buildGrid(kind, W, H));
      expect(a).toBe(b);
    }
  });
});

describe("T-310 の前倒し —— 走査側に黄金比の定数を置かない準備", () => {
  // L4 の T-310 は「t 走査コードに 0.618 / 0.382 / 1/3 の定数が現れない」を要求する。
  // 格子生成器(規範層)はこれらの比を持って当然なので対象外である。
  // ここでは **その境界が実際に引けること** を確かめる —— 比は grids.ts にだけ現れる。
  it("比の定数は grids.ts の中にある(L4 で走査側と分離できる)", () => {
    const src = readFileSync("src/core/grids.ts", "utf8");
    expect(src).toMatch(/0\.618|1\.618|GOLDEN/);
  });

  it("スコア器には比の定数が無い", () => {
    const src = readFileSync("src/core/score.ts", "utf8");
    expect(src).not.toMatch(/0\.618|0\.382/);
  });
});
