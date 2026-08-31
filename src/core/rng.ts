// シード付き PRNG — mulberry32(フリート共通実装)。
// core 内で Math.random() を使わない。決定論(SPEC G-04)はここに依存する。
// hanshoku-atlas / nanpure-forge の Rust 実装とビット単位で同じ仕様なので、
// L2 の二実装照合(F-10)でそのまま突き合わせられる。

export type Rng = () => number;

/** [0, 1) の一様乱数を返す決定論的 PRNG を作る */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** [0, n) の整数 */
export function randInt(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}

/** 標準正規乱数(Box–Muller)。劣化器のノイズに使う */
export function randNormal(rng: Rng): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
