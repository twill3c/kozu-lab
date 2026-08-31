"""JPEG を生の RGBA バイト列に落とす。

**なぜ Python か。**Node には画像復号が無く、JS の復号器を足すと
「ブラウザの復号」「Node の復号」で経路が二つになる。Pillow は
フリートで既に使っている道具(manazashi-lab と同じ構え)なので、
復号はここに一本化し、TS 側は生バイトだけを読む。

出力: <out>.bin(RGBA を上から順に) と <out>.json(幅・高さ・出所)

実行: python scripts/decode_image.py <入力jpg> <出力の接頭辞> [--short 1024]
"""

import json
import sys
from pathlib import Path

from PIL import Image


def main(argv: list[str]) -> int:
    src = Path(argv[0])
    out = Path(argv[1])
    short = None
    if "--short" in argv:
        short = int(argv[argv.index("--short") + 1])

    with Image.open(src) as im:
        im = im.convert("RGB")
        w, h = im.size
        resized = False
        if short is not None and min(w, h) > short:
            # **拡大はしない。**足りないものを引き伸ばしても情報は増えず、
            # 補間のエッジが増えるだけである(SPEC §3.6)
            scale = short / min(w, h)
            w2 = max(1, round(w * scale))
            h2 = max(1, round(h * scale))
            im = im.resize((w2, h2), Image.LANCZOS)
            resized = True
            w, h = w2, h2
        im = im.convert("RGBA")
        out.with_suffix(".bin").write_bytes(im.tobytes())

    json.dump(
        {"width": w, "height": h, "source": str(src), "resized": resized, "targetShort": short},
        out.with_suffix(".json").open("w", encoding="utf-8"),
        ensure_ascii=False,
    )
    print(f"{out.name}: {w}x{h} 短辺{min(w, h)}{' (縮小)' if resized else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
