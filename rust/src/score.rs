//! 当てはまりスコアの Rust 実装。TS 実装(src/core/score.ts)と突き合わせる。
//!
//! **この区間は `exp` を通るので完全一致を要求できない**(実測 2026-08-31: 187/2000 で食い違う)。
//! 比較は許容付きで行う(SPEC G-06c)。

pub struct GridLine {
    pub cos: f64,
    pub sin: f64,
    pub rho: f64,
}

pub fn raw_score(points: &[(f64, f64)], lines: &[GridLine], sigma: f64) -> f64 {
    if points.is_empty() || lines.is_empty() {
        return 0.0;
    }
    let denom = 2.0 * sigma * sigma;
    let mut sum = 0.0;
    for &(px, py) in points {
        let mut best = f64::INFINITY;
        for l in lines {
            let d = (px * l.cos + py * l.sin - l.rho).abs();
            if d < best {
                best = d;
            }
        }
        sum += (-(best * best) / denom).exp();
    }
    sum / points.len() as f64
}

pub struct NullDist {
    pub mean: f64,
    pub sd: f64,
    pub trials: usize,
}

/// 同じ本数・同じ角度分布のランダム格子から帰無分布を作る。
/// `angles` を与えると角度分布を保ち、与えなければ一様に引く。
pub struct NullParams<'a> {
    pub line_count: usize,
    pub width: f64,
    pub height: f64,
    pub sigma: f64,
    pub seed: u32,
    pub trials: usize,
    /// 与えると **その格子と同じ角度分布** を保つ。省くと一様に引く
    pub angles: Option<&'a [f64]>,
}

pub fn null_distribution(points: &[(f64, f64)], p: &NullParams) -> NullDist {
    let (line_count, width, height, sigma, seed, trials, angles) = (
        p.line_count,
        p.width,
        p.height,
        p.sigma,
        p.seed,
        p.trials,
        p.angles,
    );
    let mut rng = crate::rng::Rng::new(seed);
    let mut sum = 0.0;
    let mut sum_sq = 0.0;
    for _ in 0..trials {
        let mut lines = Vec::with_capacity(line_count);
        for i in 0..line_count {
            let theta = match angles {
                Some(a) => a[i % a.len()],
                None => rng.next_f64() * std::f64::consts::PI,
            };
            let (c, s) = (theta.cos(), theta.sin());
            let support = width / 2.0 * c.abs() + height / 2.0 * s.abs();
            let rho = (rng.next_f64() * 2.0 - 1.0) * support;
            lines.push(GridLine {
                cos: c,
                sin: s,
                rho,
            });
        }
        let v = raw_score(points, &lines, sigma);
        sum += v;
        sum_sq += v * v;
    }
    let mean = sum / trials as f64;
    let var =
        (sum_sq / trials as f64 - mean * mean).max(0.0) * (trials as f64 / (trials as f64 - 1.0));
    NullDist {
        mean,
        sd: var.sqrt(),
        trials,
    }
}

pub fn z_score(points: &[(f64, f64)], lines: &[GridLine], dist: &NullDist, sigma: f64) -> f64 {
    if dist.sd == 0.0 {
        return 0.0;
    }
    (raw_score(points, lines, sigma) - dist.mean) / dist.sd
}
