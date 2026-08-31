//! mulberry32。TS 実装(src/core/rng.ts)とビット単位で同じ仕様。
//! 整数演算だけで書かれているので **言語間で完全一致する**(SPEC §11.1)。

pub struct Rng(u32);

impl Rng {
    pub fn new(seed: u32) -> Self {
        Rng(seed)
    }
    /// [0, 1) の一様乱数。`Iterator::next` とは無関係なので名前で区別する
    pub fn next_f64(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 期待値の出所: **TS 実装を同じシードで回した実測値**(2026-08-31)。
    //   node -e "…createRng(20260831)… 5 回"
    // mulberry32 は整数演算だけなので言語間で完全一致する(SPEC §11.1)。
    #[test]
    fn matches_typescript_mulberry32() {
        let mut r = Rng::new(20260831);
        let got: Vec<f64> = (0..5).map(|_| r.next_f64()).collect();
        let want = [
            0.7661943407729268,
            0.04301688657142222,
            0.94434784213081,
            0.46616961108520627,
            0.5633264742791653,
        ];
        assert_eq!(got, want, "TS の mulberry32 と一致しない");
    }

    // 陽性対照: シードが違えば一致しない(検査が働いていることの確認)
    #[test]
    fn different_seed_differs() {
        let mut a = Rng::new(20260831);
        let mut b = Rng::new(20260832);
        assert_ne!(a.next_f64(), b.next_f64());
    }
}
