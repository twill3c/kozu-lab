// F-02 の続き —— 合成透視図の生成器。**このファイルだけが真値を知っている**(G-03)。
//
// 消失点の真値は解析的に出る。方向 d(世界座標)の消失点は同次座標で
//
//     v = K · R · d
//
// であり、カメラの引数だけから決まる。**画像から読み戻さない。**
// 床平面 z = 0 の 2 方向 e1 = (1,0,0)、e2 = (0,1,0) に対しては、
// v1 と v2 はそれぞれ **K·R の第 1 列・第 2 列** そのものになる(SPEC §6)。
//
// 描くのは **床の市松模様**。セル境界がちょうど 3D 直線の投影になり、
// ステップエッジとして立つ —— L1 で較正した検出器はステップエッジ向けである(HC-100)。
// 細線で描くと線の両側にエッジが出て、消失点がぼやける。

import { createImage, toCenter, type RasterImage } from "./image";

/** 行優先の 3×3 行列 */
export type Mat3 = Float64Array;

export function mat3(...v: number[]): Mat3 {
  if (v.length !== 9) throw new Error("3×3 は 9 要素");
  return Float64Array.from(v);
}

export function matMul(a: Mat3, b: Mat3): Mat3 {
  const o = new Float64Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[i * 3 + k] * b[k * 3 + j];
      o[i * 3 + j] = s;
    }
  }
  return o as Mat3;
}

export function matApply(m: Mat3, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[1] * y + m[2] * z,
    m[3] * x + m[4] * y + m[5] * z,
    m[6] * x + m[7] * y + m[8] * z,
  ];
}

export function matInverse(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) throw new Error("特異行列は逆行列を持たない");
  const inv = 1 / det;
  return mat3(
    A * inv,
    -(b * i - c * h) * inv,
    (b * f - c * e) * inv,
    B * inv,
    (a * i - c * g) * inv,
    -(a * f - c * d) * inv,
    C * inv,
    -(a * h - b * g) * inv,
    (a * e - b * d) * inv,
  );
}

export type CameraOptions = {
  width: number;
  height: number;
  /** 焦点距離(px) */
  focal: number;
  /** 光軸まわりの向き。度 */
  yawDeg: number;
  /** 下向きを負にとる。度 */
  pitchDeg: number;
  /** 床からのカメラの高さ(世界単位) */
  height3d: number;
};

export type ImagePoint = { x: number; y: number };

export type Camera = {
  opts: CameraOptions;
  K: Mat3;
  R: Mat3;
  /** 像 ← 床平面 のホモグラフィ */
  H: Mat3;
  Hinv: Mat3;
  /** e1・e2 方向の消失点(中心原点の画素座標)。K·R の第 1 列・第 2 列から出す */
  vanishing: [ImagePoint, ImagePoint];
  /** 光軸が床と交わる点(床座標)。座標規約の確認に使う */
  principalFloor: { u: number; v: number };
  projectFloor(p: { u: number; v: number }): ImagePoint | null;
};

/**
 * カメラを組む。
 *
 * 世界は右手系で床が z = 0。カメラは高さ `height3d` にあり、
 * まず yaw(z 軸まわり)、次に pitch(カメラの x 軸まわり)で向きを決める。
 * 主点は画面中心にとる(K の平行移動成分は 0)—— 座標が中心原点だからである(SPEC §11.4)。
 */
export function makeCamera(opts: CameraOptions): Camera {
  const { focal: f, yawDeg, pitchDeg, height3d } = opts;
  const K = mat3(f, 0, 0, 0, f, 0, 0, 0, 1);

  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;

  // 世界 → カメラ。R = Rx(下向き) · R0 · Rz(−yaw)。
  //
  // R0 は「水平に +Y を向き、像の y が下向き」の基準姿勢:
  //   カメラ X軸 = 世界 +X / カメラ Y軸 = 世界 −Z(下)/ カメラ Z軸(光軸)= 世界 +Y
  // ここから カメラ x 軸まわりに pitchDown だけ回して見下ろす。
  // pitchDeg は下向きを負にとる約束なので、回転角は −pitchDeg になる。
  const cz = Math.cos(-yaw);
  const sz = Math.sin(-yaw);
  const Rz = mat3(cz, -sz, 0, sz, cz, 0, 0, 0, 1);
  const R0 = mat3(1, 0, 0, 0, 0, -1, 0, 1, 0);
  const down = -pitch;
  const cd = Math.cos(down);
  const sd = Math.sin(down);
  const Rx = mat3(1, 0, 0, 0, cd, -sd, 0, sd, cd);
  const R = matMul(Rx, matMul(R0, Rz));

  // カメラ中心は (0, 0, height3d)。t = −R·C
  const C: [number, number, number] = [0, 0, height3d];
  const RC = matApply(R, C[0], C[1], C[2]);
  const t: [number, number, number] = [-RC[0], -RC[1], -RC[2]];

  const KR = matMul(K, R);
  const toPoint = (v: [number, number, number]): ImagePoint => ({ x: v[0] / v[2], y: v[1] / v[2] });
  const v1 = toPoint([KR[0], KR[3], KR[6]]); // K·R の第 1 列
  const v2 = toPoint([KR[1], KR[4], KR[7]]); // 第 2 列

  // 像 ← 床平面: H = K · [r1 r2 t]
  const Kt = matApply(K, t[0], t[1], t[2]);
  const H = mat3(KR[0], KR[1], Kt[0], KR[3], KR[4], Kt[1], KR[6], KR[7], Kt[2]);
  const Hinv = matInverse(H);

  const projectFloor = (p: { u: number; v: number }): ImagePoint | null => {
    const [x, y, w] = matApply(H, p.u, p.v, 1);
    if (!(w > 0)) return null; // カメラの後ろ、または地平線上
    return { x: x / w, y: y / w };
  };

  // 光軸が床と交わる点。像の (0,0) を床へ引き戻す
  const [pu, pv, pw] = matApply(Hinv, 0, 0, 1);
  const principalFloor = { u: pu / pw, v: pv / pw };

  return { opts, K, R, H, Hinv, vanishing: [v1, v2], principalFloor, projectFloor };
}

export type CheckerOptions = {
  /** セルの一辺(世界単位) */
  cell: number;
  /** 明るい面 / 暗い面 / 空 の輝度 */
  light?: number;
  dark?: number;
  sky?: number;
  /** これより遠い床は空として塗る(世界単位)。地平線付近の無限の縞を止める */
  maxDepth?: number;
};

/**
 * 床の市松模様を描く。画素ごとに床座標へ引き戻し、セルの偶奇で塗り分ける。
 * **セル境界がちょうど 3D 直線の投影** になるので、ステップエッジとして立つ。
 */
export function renderFloorCheckerboard(cam: Camera, opt: CheckerOptions): RasterImage {
  const { width, height } = cam.opts;
  const light = opt.light ?? 232;
  const dark = opt.dark ?? 40;
  const sky = opt.sky ?? 232;
  const maxDepth = opt.maxDepth ?? 60;
  const img = createImage(width, height, sky);

  for (let py = 0; py < height; py++) {
    const iy = toCenter(py, height);
    for (let px = 0; px < width; px++) {
      const ix = toCenter(px, width);
      const [u, v, w] = matApply(cam.Hinv, ix, iy, 1);
      // w ≤ 0 は地平線より上(床が写らない)
      if (!(w > 0)) continue;
      const fu = u / w;
      const fv = v / w;
      if (!Number.isFinite(fu) || !Number.isFinite(fv)) continue;
      if (Math.hypot(fu, fv) > maxDepth) continue;
      const parity = (Math.floor(fu / opt.cell) + Math.floor(fv / opt.cell)) & 1;
      const val = parity ? dark : light;
      const i = (py * width + px) * 4;
      img.data[i] = val;
      img.data[i + 1] = val;
      img.data[i + 2] = val;
    }
  }
  return img;
}

export type AffineCheckerOptions = {
  width: number;
  height: number;
  /** 2 つの線束の向き(度) */
  angleADeg: number;
  angleBDeg: number;
  /** 縞の間隔(px) */
  cell: number;
  light?: number;
  dark?: number;
};

/**
 * **平行投影**の市松模様。消失点は無限遠にある。
 *
 * 透視のホモグラフィではなく、2 つの向きの縞の排他的論理和で描く ——
 * 同じ向きの線は像の上でも平行なままなので、交点が定義できない。
 * T-203 はここで推定器が「破綻」を返すことを見る。
 */
export function renderAffineCheckerboard(o: AffineCheckerOptions): RasterImage {
  const light = o.light ?? 232;
  const dark = o.dark ?? 40;
  const img = createImage(o.width, o.height, light);
  const ta = (o.angleADeg * Math.PI) / 180;
  const tb = (o.angleBDeg * Math.PI) / 180;
  const ca = Math.cos(ta);
  const sa = Math.sin(ta);
  const cb = Math.cos(tb);
  const sb = Math.sin(tb);
  for (let py = 0; py < o.height; py++) {
    const iy = toCenter(py, o.height);
    for (let px = 0; px < o.width; px++) {
      const ix = toCenter(px, o.width);
      const pa = Math.floor((ix * ca + iy * sa) / o.cell) & 1;
      const pb = Math.floor((ix * cb + iy * sb) / o.cell) & 1;
      const val = pa ^ pb ? dark : light;
      const i = (py * o.width + px) * 4;
      img.data[i] = val;
      img.data[i + 1] = val;
      img.data[i + 2] = val;
    }
  }
  return img;
}
