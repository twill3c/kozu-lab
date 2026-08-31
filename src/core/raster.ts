// Python(Pillow)が落とした生バイトを RasterImage に直す。
//
// 復号は Python に一本化してある(scripts/decode_image.py の注記を参照)。
// TS 側は幅・高さと RGBA の並びだけを知っていればよい。

import type { RasterImage } from "./image";

export type RawMeta = { width: number; height: number };

export function fromRaw(bytes: Uint8Array, meta: RawMeta): RasterImage {
  const need = meta.width * meta.height * 4;
  if (bytes.length !== need) {
    throw new Error(
      `生バイトの長さが合わない: ${bytes.length} B、${meta.width}x${meta.height} なら ${need} B のはず`,
    );
  }
  return { data: new Uint8ClampedArray(bytes), width: meta.width, height: meta.height };
}
