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

/**
 * 画素の添字を **画像中心原点の連続座標** に直す。
 *
 * 画素 i が覆う区間は [i, i+1) なのでその中心は i + 0.5、
 * 画像 [0, size) の中心は size/2。したがって中心原点座標は **i + 0.5 − size/2** である。
 * `i − size/2` と書くと左端が −size/2、右端が size/2 − 1 に来て、
 * **画素群の重心が原点から 0.5 px ずれる**(SPEC §5 の「原点は画像中心」に反する)。
 *
 * synth / hough / notan と Rust 側がこの一箇所の規約を共有する。
 */
export function toCenter(i: number, size: number): number {
  return i + 0.5 - size / 2;
}

export function createImage(width: number, height: number, fill = 255): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(fill);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { data, width, height };
}
