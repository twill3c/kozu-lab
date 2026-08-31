import type { AccumulateFn } from "@/core/hough";

// 陽性対照(TEST_SPEC `fx/broken/*`)。
// 投票累積を退化させる —— すべての票を θ ビン 0 に入れる。
// これで G-01 の検査が落ちなければ、検査は検出器を見ていない(HC-041)。
//
// HC-070: この対照が発火する性質を対照側で表明しておく。
// 「θ ビンを 1 本に潰す」ことが効くのは、真値の θ が 0 から離れている入力に対してだけである。
// tests/hough.test.ts の T-004 は θ=37° を使う。
export const brokenAccumulate: AccumulateFn = (acc, ctx, x, y) => {
  const { cx, cy, rhoSteps, rhoScale, thetaSteps } = ctx;
  if (thetaSteps < 2) throw new Error("陽性対照の前提が崩れている: θ ビンが 2 本未満");
  const dx = x - cx;
  const dy = y - cy;
  // θ = 0 の一本だけに投票する(cos0 = 1, sin0 = 0)
  const rho = dx;
  const r = Math.round(rho * rhoScale) + (rhoSteps >> 1);
  if (r >= 0 && r < rhoSteps) acc[0 * rhoSteps + r]++;
};
