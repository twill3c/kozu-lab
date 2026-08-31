// C 群(破壊版)の生成。SPEC §8 の**最強の陰性対照**。
//
// 同じ絵から作るので画像統計はほぼ保たれ、**構図の格子との関係だけが崩れる**。
// ここで差が出なければ、当てはまりスコアは構図を測っていない(G-10)。
//
// 真値を参照しない(G-03)。すべて決定論。

import { createImage, type RasterImage } from "./image";

export const DESTROY_KINDS = ["trim", "rotate", "mirror"] as const;
export type DestroyKind = (typeof DESTROY_KINDS)[number];

/** トリムの割合(宣言値)。片側 10 %、面積で 64 % が残る */
export const TRIM_FRACTION = 0.2;
/** 回転角(度、宣言値)。90 度だと縦横が入れ替わるので中途半端な角にする */
export const ROTATE_DEG = 12;

export function destroy(img: RasterImage, kind: DestroyKind): RasterImage {
  switch (kind) {
    case "trim":
      return trim(img, TRIM_FRACTION);
    case "mirror":
      return mirror(img);
    case "rotate":
      return rotate(img, ROTATE_DEG);
  }
}

function trim(img: RasterImage, frac: number): RasterImage {
  const w = Math.round(img.width * (1 - frac));
  const h = Math.round(img.height * (1 - frac));
  const x0 = Math.round((img.width - w) / 2);
  const y0 = Math.round((img.height - h) / 2);
  const out = createImage(w, h, 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y + y0) * img.width + (x + x0)) * 4;
      const d = (y * w + x) * 4;
      out.data[d] = img.data[s];
      out.data[d + 1] = img.data[s + 1];
      out.data[d + 2] = img.data[s + 2];
      out.data[d + 3] = 255;
    }
  }
  return out;
}

function mirror(img: RasterImage): RasterImage {
  const out = createImage(img.width, img.height, 0);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + (img.width - 1 - x)) * 4;
      const d = (y * img.width + x) * 4;
      out.data[d] = img.data[s];
      out.data[d + 1] = img.data[s + 1];
      out.data[d + 2] = img.data[s + 2];
      out.data[d + 3] = img.data[s + 3];
    }
  }
  return out;
}

/** 画面中心まわりに回す。外へ出た画素は端の色で埋める(最近傍) */
function rotate(img: RasterImage, deg: number): RasterImage {
  const out = createImage(img.width, img.height, 0);
  const a = (deg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cx = img.width / 2;
  const cy = img.height / 2;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const sx = Math.min(img.width - 1, Math.max(0, Math.round(ca * dx + sa * dy + cx - 0.5)));
      const sy = Math.min(img.height - 1, Math.max(0, Math.round(-sa * dx + ca * dy + cy - 0.5)));
      const s = (sy * img.width + sx) * 4;
      const d = (y * img.width + x) * 4;
      out.data[d] = img.data[s];
      out.data[d + 1] = img.data[s + 1];
      out.data[d + 2] = img.data[s + 2];
      out.data[d + 3] = 255;
    }
  }
  return out;
}
