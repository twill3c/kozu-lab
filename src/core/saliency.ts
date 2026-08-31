// ⑥ 視線の順路の土台 —— spectral residual による顕著性マップ。
//
// **これが測るのは「画像の統計的異常度」であって「人がどこを見るか」ではない。**
// 視線計測データで較正できなければ、⑥ は画面に出さない(SPEC §9 / G-目玉2)。
//
// 真値を参照しない(G-03)。FFT は N-05 の射程内だが、較正の段では TS で足りる。

import { LUMA } from "./canny";
import type { RasterImage } from "./image";

/** 1 次元 FFT(基数 2、in-place)。n は 2 の冪 */
function fft1(re: Float64Array, im: Float64Array, off: number, stride: number, n: number, inverse: boolean): void {
  // ビット反転の並べ替え
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const a = off + i * stride;
      const b = off + j * stride;
      [re[a], re[b]] = [re[b], re[a]];
      [im[a], im[b]] = [im[b], im[a]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = off + (i + k) * stride;
        const b = off + (i + k + len / 2) * stride;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

function assertPow2(v: number, name: string): void {
  if (v < 1 || (v & (v - 1)) !== 0) {
    throw new Error(`${name} は 2 の冪でなければならない(受け取った ${v})—— 黙って切り詰めない`);
  }
}

/** 2 次元 FFT(in-place)。幅・高さとも 2 の冪 */
export function fft2(re: Float64Array, im: Float64Array, w: number, h: number): void {
  assertPow2(w, "幅");
  assertPow2(h, "高さ");
  for (let y = 0; y < h; y++) fft1(re, im, y * w, 1, w, false);
  for (let x = 0; x < w; x++) fft1(re, im, x, w, h, false);
}

/** 2 次元逆 FFT(in-place、1/(wh) で正規化) */
export function ifft2(re: Float64Array, im: Float64Array, w: number, h: number): void {
  assertPow2(w, "幅");
  assertPow2(h, "高さ");
  for (let y = 0; y < h; y++) fft1(re, im, y * w, 1, w, true);
  for (let x = 0; x < w; x++) fft1(re, im, x, w, h, true);
  const s = 1 / (w * h);
  for (let i = 0; i < w * h; i++) {
    re[i] *= s;
    im[i] *= s;
  }
}

export type SaliencyMap = { map: Float64Array; width: number; height: number };

/**
 * spectral residual(Hou & Zhang 2007)。
 *
 * 対数振幅スペクトルから、その平滑版を引いた残差を位相と組み合わせて逆変換し、
 * 二乗してガウシアンで均す。**一様な画像では残差が 0 になり、平坦なマップが返る**
 * —— 分母 0 の縮退を作らない(HC-097)。
 */
export function spectralResidual(img: RasterImage, size = 64): SaliencyMap {
  assertPow2(size, "size");
  // 正方形へ落とす(最近傍)。原論文も小さく落としてから計算する
  const re = new Float64Array(size * size);
  const im = new Float64Array(size * size);
  for (let y = 0; y < size; y++) {
    const sy = Math.min(img.height - 1, Math.floor((y * img.height) / size));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(img.width - 1, Math.floor((x * img.width) / size));
      const i = (sy * img.width + sx) * 4;
      re[y * size + x] =
        LUMA.r * img.data[i] + LUMA.g * img.data[i + 1] + LUMA.b * img.data[i + 2];
    }
  }
  fft2(re, im, size, size);

  // **分母 0 の縮退を明示的に扱う**(HC-097)。一様な画像では DC 以外の振幅がすべて 0 になり、
  // log を取ると −27.6 が並んで DC だけが桁違いに残る —— 残差が発散して「一様なのに顕著」になる。
  let maxAc = 0;
  for (let i = 1; i < size * size; i++) {
    const a = Math.hypot(re[i], im[i]);
    if (a > maxAc) maxAc = a;
  }
  if (maxAc <= 1e-9) {
    return { map: new Float64Array(size * size), width: size, height: size };
  }

  const logAmp = new Float64Array(size * size);
  const phaseR = new Float64Array(size * size);
  const phaseI = new Float64Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const amp = Math.hypot(re[i], im[i]);
    logAmp[i] = Math.log(amp + 1e-12);
    if (amp > 0) {
      phaseR[i] = re[i] / amp;
      phaseI[i] = im[i] / amp;
    }
  }
  const smooth = boxBlur(logAmp, size, size, 3);
  for (let i = 0; i < size * size; i++) {
    const r = Math.exp(logAmp[i] - smooth[i]);
    re[i] = r * phaseR[i];
    im[i] = r * phaseI[i];
  }
  ifft2(re, im, size, size);

  const sq = new Float64Array(size * size);
  for (let i = 0; i < size * size; i++) sq[i] = re[i] * re[i] + im[i] * im[i];
  return { map: boxBlur(sq, size, size, 3), width: size, height: size };
}

function boxBlur(src: Float64Array, w: number, h: number, radius: number): Float64Array {
  const tmp = new Float64Array(w * h);
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let d = -radius; d <= radius; d++) {
        const xx = x + d;
        if (xx < 0 || xx >= w) continue;
        s += src[y * w + xx];
        n++;
      }
      tmp[y * w + x] = s / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let d = -radius; d <= radius; d++) {
        const yy = y + d;
        if (yy < 0 || yy >= h) continue;
        s += tmp[yy * w + x];
        n++;
      }
      out[y * w + x] = s / n;
    }
  }
  return out;
}
