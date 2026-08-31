// 画素バッファの最小の型。canvas の ImageData と同じ形をしているが、
// **ブラウザに依存しない** —— テストは Node 上で生の配列を作って渡す。

export type RasterImage = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

/** 直線の極座標表現。原点は **画像中心**、x cosθ + y sinθ = ρ。θ ∈ [0, π) */
export type Line = {
  theta: number;
  rho: number;
};

export type Point = { x: number; y: number };

export function createImage(width: number, height: number, fill = 255): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(fill);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { data, width, height };
}
