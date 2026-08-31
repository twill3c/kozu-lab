import { describe, expect, it } from "vitest";
import { createImage, type RasterImage } from "@/core/image";
import { luminanceCentroid, posterize, mirrorHorizontal, NOTAN_LEVELS } from "@/core/notan";

// 期待値の出所(HC-016)
// ------------------------------------------------------------------
// 明度重心の期待値は **対称性と解析解** から出す。実装の式を書き写さない ——
// 書き写せば「実装が実装と一致する」だけの検査になる。
//
//   (a) 左右対称な画像 → 重心の x は 0(対称性。計算しない)
//   (b) 明るい矩形が 1 つだけの画像 → 重心はその矩形の中心(定義から)
//   (c) 面積比 1:3 の矩形が ±d にある → 重心は −d/2(加重平均の解析解)
//
// 座標は画像中心原点(SPEC §5 と同じ)。

const W = 120;
const H = 80;

/** 背景 0 の上に明るい矩形を置く。x0,y0 は左上、値は 0–255 */
function withRects(rects: { x0: number; y0: number; w: number; h: number; v: number }[]): RasterImage {
  const img = createImage(W, H, 0);
  for (const r of rects) {
    for (let y = r.y0; y < r.y0 + r.h; y++) {
      for (let x = r.x0; x < r.x0 + r.w; x++) {
        const i = (y * W + x) * 4;
        img.data[i] = r.v;
        img.data[i + 1] = r.v;
        img.data[i + 2] = r.v;
      }
    }
  }
  return img;
}

describe("T-104 / F-09 明度重心", () => {
  it("(b) 明るい矩形が 1 つなら、重心はその矩形の中心", () => {
    // 矩形 [10,14) の画素中心は 10.5…13.5、その平均は 12。画像中心は W/2 = 60。
    // したがって中心原点で 12 − 60 = −48(縦も同様)
    const img = withRects([{ x0: 10, y0: 20, w: 4, h: 10, v: 200 }]);
    const c = luminanceCentroid(img)!;
    expect(c.x).toBeCloseTo(10 + 4 / 2 - W / 2, 9);
    expect(c.y).toBeCloseTo(20 + 10 / 2 - H / 2, 9);
  });

  it("(a) 左右対称な画像の重心 x は 0(対称性 —— 式を写さない)", () => {
    const img = withRects([
      { x0: 20, y0: 30, w: 8, h: 8, v: 180 },
      { x0: W - 28, y0: 30, w: 8, h: 8, v: 180 },
    ]);
    const c = luminanceCentroid(img)!;
    expect(c.x).toBeCloseTo(0, 9);
  });

  it("(c) 面積比 1:3 の矩形が ±d にあるとき、重心は −d/2(加重平均の解析解)", () => {
    // 左に面積 3S(明るさ v)、右に面積 S(同じ v)。中心はそれぞれ ∓d
    const d = 30;
    const cxLeft = W / 2 - d;
    const cxRight = W / 2 + d;
    // 左: 6×4 = 24、右: 2×4 = 8 → 比 3:1
    const img = withRects([
      { x0: cxLeft - 3, y0: 38, w: 6, h: 4, v: 150 },
      { x0: cxRight - 1, y0: 38, w: 2, h: 4, v: 150 },
    ]);
    const c = luminanceCentroid(img)!;
    // 加重平均 = (3·(−d) + 1·(+d)) / 4 = −d/2
    expect(c.x).toBeCloseTo(-d / 2, 9);
  });

  it("真っ黒な画像では重心を返さない(分母 0 の縮退 —— HC-097)", () => {
    const img = createImage(W, H, 0);
    expect(luminanceCentroid(img)).toBeNull();
  });

  it("一様な画像の重心は画面中心", () => {
    const img = createImage(W, H, 128);
    const c = luminanceCentroid(img)!;
    expect(c.x).toBeCloseTo(0, 9);
    expect(c.y).toBeCloseTo(0, 9);
  });
});

describe("T-105 / F-09 ノタン(2 値・3 値)", () => {
  it("段数は 2 と 3 だけ", () => {
    expect(NOTAN_LEVELS).toEqual([2, 3]);
  });

  it("2 値化の出力は 2 種類の輝度しか持たない", () => {
    const img = withRects([{ x0: 10, y0: 10, w: 40, h: 40, v: 200 }]);
    const out = posterize(img, 2, 0.5);
    const seen = new Set<number>();
    for (let i = 0; i < out.data.length; i += 4) seen.add(out.data[i]);
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 255]);
  });

  it("3 値化の出力は 3 種類以下の輝度しか持たない", () => {
    const img = createImage(W, H, 0);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = Math.round((255 * x) / (W - 1));
        const i = (y * W + x) * 4;
        img.data[i] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v;
      }
    }
    const out = posterize(img, 3, 0.5);
    const seen = new Set<number>();
    for (let i = 0; i < out.data.length; i += 4) seen.add(out.data[i]);
    expect(seen.size).toBeLessThanOrEqual(3);
    expect(seen.size).toBeGreaterThan(1);
  });

  it("しきい値を上げれば暗い側の面積は単調に増える", () => {
    const img = createImage(W, H, 0);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = Math.round((255 * x) / (W - 1));
        const i = (y * W + x) * 4;
        img.data[i] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v;
      }
    }
    const darkArea = (t: number) => {
      const out = posterize(img, 2, t);
      let n = 0;
      for (let i = 0; i < out.data.length; i += 4) if (out.data[i] === 0) n++;
      return n;
    };
    const a = darkArea(0.25);
    const b = darkArea(0.5);
    const c = darkArea(0.75);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it("決定論 —— 同一入力で 50 回、出力がビット一致する", () => {
    const img = withRects([{ x0: 5, y0: 5, w: 33, h: 21, v: 199 }]);
    const first = [...posterize(img, 3, 0.42).data];
    for (let i = 0; i < 50; i++) {
      expect([...posterize(img, 3, 0.42).data]).toEqual(first);
    }
  });
});

describe("F-09 左右反転の並置", () => {
  it("2 回反転すると元に戻る", () => {
    const img = withRects([{ x0: 7, y0: 11, w: 13, h: 17, v: 222 }]);
    expect([...mirrorHorizontal(mirrorHorizontal(img)).data]).toEqual([...img.data]);
  });

  it("左右対称な画像は反転しても変わらない(陰性対照)", () => {
    const img = withRects([
      { x0: 20, y0: 30, w: 8, h: 8, v: 180 },
      { x0: W - 28, y0: 30, w: 8, h: 8, v: 180 },
    ]);
    expect([...mirrorHorizontal(img).data]).toEqual([...img.data]);
  });

  it("非対称な画像は反転で変わる(陽性対照 —— 恒等写像を返していない)", () => {
    const img = withRects([{ x0: 3, y0: 30, w: 8, h: 8, v: 180 }]);
    expect([...mirrorHorizontal(img).data]).not.toEqual([...img.data]);
  });

  it("反転すると明度重心の x が符号反転する", () => {
    const img = withRects([{ x0: 10, y0: 20, w: 6, h: 6, v: 210 }]);
    const a = luminanceCentroid(img)!;
    const b = luminanceCentroid(mirrorHorizontal(img))!;
    expect(b.x).toBeCloseTo(-a.x, 9);
    expect(b.y).toBeCloseTo(a.y, 9);
  });
});
