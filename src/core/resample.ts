// 解析解像度の正規化(SPEC §3.6)。
//
// 出典が違えば元の解像度が違う —— Wikimedia の既定は短辺 1082–1490 px、
// Met の web-large は短辺 419 px(いずれも実測 2026-08-31)。
// **Hough が拾う直線の本数は解像度の関数である。**揃えずに群を比べると、
// 測っているのが構図ではなく出典になる。
//
// **拡大はしない。**足りないものを引き伸ばしても情報は増えず、補間のエッジが増えるだけである。
// 届かなかったことは reachedTarget で持ち回り、黙って落とさない。

import type { RasterImage } from "./image";

export type NormalizedImage = RasterImage & { reachedTarget: boolean; scale: number };

export function normalizeShortSide(img: RasterImage, target: number): NormalizedImage {
  const short = Math.min(img.width, img.height);
  if (short <= target) {
    return { ...img, data: new Uint8ClampedArray(img.data), reachedTarget: false, scale: 1 };
  }
  const scale = target / short;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const out = new Uint8ClampedArray(w * h * 4);
  // 面積平均(ボックスフィルタ)。縮小に最近傍を使うとエイリアスが偽のエッジを作る
  const sx = img.width / w;
  const sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.min(img.height, Math.max(y0 + 1, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(img.width, Math.max(x0 + 1, Math.ceil((x + 1) * sx)));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4;
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
          n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h, reachedTarget: true, scale };
}
