// Canny エッジ検出。客観層(SPEC §2)。
//
// 真値を参照しない —— 入力は画素だけである(G-03 / T-007)。
// しきい値は **最大勾配強度に対する比** で与える。絶対値で持つと、画像の明暗で
// 意味が変わってしまい、① のスライダーが「その絵の構図線」を動かす道具にならない。

import type { RasterImage } from "./image";

/** 輝度変換は一箇所に持つ(SPEC N-07)。Rec.601 の係数 */
export const LUMA = { r: 0.299, g: 0.587, b: 0.114 } as const;

export type CannyOptions = {
  /** ガウシアンの σ(px)。既定 1.0 */
  sigma: number;
  /** 弱エッジのしきい値。最大勾配強度に対する比 */
  lowRatio: number;
  /** 強エッジのしきい値。最大勾配強度に対する比 */
  highRatio: number;
};

export const DEFAULT_CANNY: CannyOptions = { sigma: 1.0, lowRatio: 0.1, highRatio: 0.25 };

export function toGray(img: RasterImage): Float32Array {
  const n = img.width * img.height;
  const g = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    g[p] = LUMA.r * img.data[i] + LUMA.g * img.data[i + 1] + LUMA.b * img.data[i + 2];
  }
  return g;
}

/** 分離可能ガウシアン。端は複製で延長する */
export function gaussianBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0) return src.slice();
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;

  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -radius; i <= radius; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i));
        s += src[y * w + xx] * k[i + radius];
      }
      tmp[y * w + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -radius; i <= radius; i++) {
        const yy = Math.min(h - 1, Math.max(0, y + i));
        s += tmp[yy * w + x] * k[i + radius];
      }
      out[y * w + x] = s;
    }
  }
  return out;
}

export type Gradient = { mag: Float32Array; dir: Float32Array; max: number };

export function sobel(src: Float32Array, w: number, h: number): Gradient {
  const mag = new Float32Array(w * h);
  const dir = new Float32Array(w * h);
  let max = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = src[i - w - 1];
      const b = src[i - w];
      const c = src[i - w + 1];
      const d = src[i - 1];
      const f = src[i + 1];
      const g = src[i + w - 1];
      const hh = src[i + w];
      const k = src[i + w + 1];
      const gx = c + 2 * f + k - (a + 2 * d + g);
      const gy = g + 2 * hh + k - (a + 2 * b + c);
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      dir[i] = Math.atan2(gy, gx);
      if (m > max) max = m;
    }
  }
  return { mag, dir, max };
}

/** 勾配方向を 4 方位に丸めて非極大を落とす */
export function nonMaxSuppression(grad: Gradient, w: number, h: number): Float32Array {
  const { mag, dir } = grad;
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i];
      if (m === 0) continue;
      // 勾配角 a の向きにある 2 近傍と比べる。y は下向きなので、
      // a≈45° の近傍は (x+1, y+1) = i+w+1 と (x−1, y−1) = i−w−1、
      // a≈135° の近傍は (x−1, y+1) = i+w−1 と (x+1, y−1) = i−w+1 である。
      // **この 2 分岐を取り違えると、対角エッジだけが細線化されない**(HC-097)。
      // 軸に平行なエッジでは正しい分岐に落ちるので、代表値 1 点の検査では通ってしまう。
      const a = ((dir[i] * 180) / Math.PI + 180) % 180;
      let p: number;
      let q: number;
      if (a < 22.5 || a >= 157.5) {
        p = mag[i - 1];
        q = mag[i + 1];
      } else if (a < 67.5) {
        p = mag[i - w - 1];
        q = mag[i + w + 1];
      } else if (a < 112.5) {
        p = mag[i - w];
        q = mag[i + w];
      } else {
        p = mag[i - w + 1];
        q = mag[i + w - 1];
      }
      if (m >= p && m >= q) out[i] = m;
    }
  }
  return out;
}

/** 二重しきい値 + 連結。1 = エッジ */
export function hysteresis(
  nms: Float32Array,
  w: number,
  h: number,
  low: number,
  high: number,
): Uint8Array {
  const out = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let i = 0; i < nms.length; i++) {
    if (nms[i] >= high) {
      out[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (out[j] === 0 && nms[j] >= low) {
          out[j] = 1;
          stack.push(j);
        }
      }
    }
  }
  return out;
}

export function canny(img: RasterImage, opts: CannyOptions = DEFAULT_CANNY): Uint8Array {
  const { width: w, height: h } = img;
  const blurred = gaussianBlur(toGray(img), w, h, opts.sigma);
  const grad = sobel(blurred, w, h);
  // 分母 0 の縮退を明示的に扱う(HC-097)。勾配が全く無い画像では、
  // しきい値が 0 になり `nms[i] >= 0` が全画素で真になる ——
  // 「エッジが 1 本も無い」と「全画素がエッジ」が同じ経路から出てしまう。
  if (grad.max === 0) return new Uint8Array(w * h);
  const nms = nonMaxSuppression(grad, w, h);
  return hysteresis(nms, w, h, grad.max * opts.lowRatio, grad.max * opts.highRatio);
}
