// F-02 合成画像生成器。
//
// このファイルだけが「真値」を知っている。検出器・スコア器はここを参照してはならない
// (SPEC G-03 / tests/hough.test.ts の T-007 が静的に検査する)。
//
// 描画は **距離場** で行う: 画素 (x, y) は |x cosθ + y sinθ − ρ| ≤ HALF_WIDTH のとき塗る。
// 原点は画像中心。この定義により、塗られた画素は定義上すべて HALF_WIDTH 以内に入る
// —— T-001 が検算しているのは「塗り方が距離場から外れていないこと」である。

import { createImage, type Line, type RasterImage } from "./image";
import { randNormal, type Rng } from "./rng";

/** 線の太さの半分。T-001 の許容 0.5 の出所 */
export const HALF_WIDTH = 0.5;

/**
 * 描き方の別。
 *
 * - `stroke` —— 細線を引く。**線の両側にエッジが立つ**ので、エッジ検出器は
 *   線の中心ではなく端に反応する。T-001(ラスタライザの検算)はこちらを使う
 * - `step` —— 半平面の排他的論理和で塗る。境界がちょうど (θ, ρ) の一本になる。
 *   **G-01 のオラクルはこちら。**SPEC §2 が客観層に挙げる「建築・地平線・卓の縁」は
 *   細線ではなく領域の境界であり、ステップエッジの方が対象に忠実でもある
 */
export type DrawMode = "stroke" | "step";

export type DrawOptions = {
  width: number;
  height: number;
  lines: Line[];
  /** 既定 "stroke" */
  mode?: DrawMode;
  /** 線の太さの半分。既定 HALF_WIDTH(mode="stroke" のときだけ効く) */
  halfWidth?: number;
  /** 背景の輝度(0–255)。既定 255 */
  background?: number;
  /** 線の輝度(0–255)。既定 0 */
  foreground?: number;
};

export function drawLines(opts: DrawOptions): RasterImage {
  const { width, height, lines } = opts;
  const hw = opts.halfWidth ?? HALF_WIDTH;
  const bg = opts.background ?? 255;
  const fg = opts.foreground ?? 0;
  const img = createImage(width, height, bg);
  const cx = width / 2;
  const cy = height / 2;

  if ((opts.mode ?? "stroke") === "step") {
    const ct = lines.map((l) => Math.cos(l.theta));
    const st = lines.map((l) => Math.sin(l.theta));
    for (let y = 0; y < height; y++) {
      const dy = y - cy;
      for (let x = 0; x < width; x++) {
        const dx = x - cx;
        let side = 0;
        for (let k = 0; k < lines.length; k++) {
          if (dx * ct[k] + dy * st[k] - lines[k].rho > 0) side ^= 1;
        }
        const v = side ? fg : bg;
        const i = (y * width + x) * 4;
        img.data[i] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
    return img;
  }

  for (const l of lines) {
    const ct = Math.cos(l.theta);
    const st = Math.sin(l.theta);
    for (let y = 0; y < height; y++) {
      const dy = y - cy;
      for (let x = 0; x < width; x++) {
        const d = Math.abs((x - cx) * ct + dy * st - l.rho);
        if (d > hw) continue;
        const i = (y * width + x) * 4;
        img.data[i] = fg;
        img.data[i + 1] = fg;
        img.data[i + 2] = fg;
        img.data[i + 3] = 255;
      }
    }
  }
  return img;
}

export type DegradeOptions = {
  /** JPEG 相当の 8×8 DCT 量子化の品質(1–100)。**真の JPEG エンコーダではない**(下の注記) */
  jpegQuality?: number;
  /** 加法性ガウスノイズの標準偏差(0–255 スケール) */
  noiseSigma?: number;
  /** 筆触。低周波の輝度うねりを重ねる(0–1) */
  brushStrength?: number;
  /** 額縁。画面の外周を暗くする帯の幅(短辺に対する %) */
  frameWidthPct?: number;
};

// 注記(HC-077 の「実装の説明」)。
// jpegQuality は **真の JPEG エンコーダを通していない**。8×8 ブロック DCT に
// 標準輝度量子化表を品質でスケールして掛け、逆変換で戻している ——
// JPEG の非可逆段そのものであり、ブロック歪みとリンギングという同じ歪みの族を出す。
// ハフマン符号化・色差間引き・chroma 側の量子化は含まない。
// G-13 は「どこで壊れるかを測る」ものなので、歪みの族が同じであれば足りる。

const QUANT_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14,
  17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49,
  64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];

export function degrade(img: RasterImage, opts: DegradeOptions, rng: Rng): RasterImage {
  const { width, height } = img;
  const out: RasterImage = {
    data: new Uint8ClampedArray(img.data),
    width,
    height,
  };
  const touched =
    opts.jpegQuality !== undefined ||
    opts.noiseSigma !== undefined ||
    opts.brushStrength !== undefined ||
    opts.frameWidthPct !== undefined;
  if (!touched) return out;

  // 輝度面に落として加工する(構図解析は色に依存しない — SPEC §3.4)
  const lum = new Float64Array(width * height);
  for (let p = 0; p < width * height; p++) lum[p] = img.data[p * 4];

  if (opts.brushStrength !== undefined && opts.brushStrength > 0) {
    // 低周波のうねり。位相は rng から引くので決定論
    const s = opts.brushStrength;
    const phases = [rng(), rng(), rng(), rng()].map((v) => v * Math.PI * 2);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const u = x / width;
        const v = y / height;
        const w =
          Math.sin(u * 9.1 + phases[0]) * Math.cos(v * 7.3 + phases[1]) +
          Math.sin(u * 21.7 + phases[2]) * Math.cos(v * 17.9 + phases[3]);
        lum[y * width + x] += w * 28 * s;
      }
    }
  }

  if (opts.jpegQuality !== undefined) {
    dctQuantize(lum, width, height, opts.jpegQuality);
  }

  if (opts.noiseSigma !== undefined && opts.noiseSigma > 0) {
    for (let p = 0; p < lum.length; p++) lum[p] += randNormal(rng) * opts.noiseSigma;
  }

  if (opts.frameWidthPct !== undefined && opts.frameWidthPct > 0) {
    const band = Math.round((Math.min(width, height) * opts.frameWidthPct) / 100);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const inBand = x < band || y < band || x >= width - band || y >= height - band;
        if (inBand) lum[y * width + x] = 40;
      }
    }
  }

  for (let p = 0; p < width * height; p++) {
    const v = lum[p];
    out.data[p * 4] = v;
    out.data[p * 4 + 1] = v;
    out.data[p * 4 + 2] = v;
    out.data[p * 4 + 3] = 255;
  }
  return out;
}

/** 8×8 ブロック DCT-II → 量子化 → 逆変換。JPEG の非可逆段に相当する */
function dctQuantize(lum: Float64Array, width: number, height: number, quality: number): void {
  const q = Math.min(100, Math.max(1, quality));
  const scale = q < 50 ? 5000 / q : 200 - 2 * q;
  const qt = QUANT_LUMA.map((v) => Math.max(1, Math.floor((v * scale + 50) / 100)));

  const cos = new Float64Array(64);
  for (let u = 0; u < 8; u++) {
    for (let x = 0; x < 8; x++) cos[u * 8 + x] = Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  }
  const c = (u: number) => (u === 0 ? Math.SQRT1_2 : 1);
  const block = new Float64Array(64);
  const coef = new Float64Array(64);

  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const sy = Math.min(by + y, height - 1);
          const sx = Math.min(bx + x, width - 1);
          block[y * 8 + x] = lum[sy * width + sx] - 128;
        }
      }
      for (let u = 0; u < 8; u++) {
        for (let v = 0; v < 8; v++) {
          let s = 0;
          for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) s += block[y * 8 + x] * cos[u * 8 + x] * cos[v * 8 + y];
          }
          coef[v * 8 + u] = (c(u) * c(v) * s) / 4;
        }
      }
      for (let i = 0; i < 64; i++) coef[i] = Math.round(coef[i] / qt[i]) * qt[i];
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          let s = 0;
          for (let u = 0; u < 8; u++) {
            for (let v = 0; v < 8; v++) s += c(u) * c(v) * coef[v * 8 + u] * cos[u * 8 + x] * cos[v * 8 + y];
          }
          const ty = by + y;
          const tx = bx + x;
          if (ty < height && tx < width) lum[ty * width + tx] = s / 4 + 128;
        }
      }
    }
  }
}
