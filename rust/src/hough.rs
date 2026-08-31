//! Hough 投票と極大抽出の Rust 実装。TS 実装(src/core/hough.ts)と突き合わせる。
//!
//! **この区間は整数と四則だけで書く。**三角関数は呼ばず、角度表を引数で受け取る ——
//! 実測(2026-08-31)で cos/sin は Rust と V8 で最終 ULP が食い違うため、
//! 自前で計算すると「アルゴリズムの差」と「libm の差」が分離できなくなる(SPEC §11.1)。

/// 投票平面。`acc[t * rho_steps + r]`
pub struct Hough {
    pub acc: Vec<i32>,
    pub theta_steps: usize,
    pub rho_steps: usize,
    pub rho_scale: f64,
}

/// エッジ座標(画像左上原点の整数)から投票平面を作る。
/// 原点は画像中心。`cos_t` / `sin_t` は呼び出し側が与える。
pub fn accumulate(
    edges: &[(u32, u32)],
    width: usize,
    height: usize,
    cos_t: &[f64],
    sin_t: &[f64],
    rho_scale: f64,
) -> Hough {
    let theta_steps = cos_t.len();
    assert_eq!(theta_steps, sin_t.len(), "角度表の長さが揃っていない");
    let cx = width as f64 / 2.0;
    let cy = height as f64 / 2.0;
    let r = (cx * cx + cy * cy).sqrt();
    let rho_steps = 2 * (r * rho_scale).ceil() as usize + 1;
    let half = (rho_steps >> 1) as i64;
    let mut acc = vec![0i32; theta_steps * rho_steps];
    for &(x, y) in edges {
        // 画素中心を使う(TS の image.ts::toCenter と同じ規約)
        let dx = x as f64 + 0.5 - cx;
        let dy = y as f64 + 0.5 - cy;
        for t in 0..theta_steps {
            let rho = dx * cos_t[t] + dy * sin_t[t];
            let r_bin = round_half_away(rho * rho_scale) + half;
            if r_bin >= 0 && (r_bin as usize) < rho_steps {
                acc[t * rho_steps + r_bin as usize] += 1;
            }
        }
    }
    Hough {
        acc,
        theta_steps,
        rho_steps,
        rho_scale,
    }
}

/// JavaScript の `Math.round` は **半整数を +∞ 方向へ丸める**(-0.5 → -0)。
/// Rust の `f64::round` は 0 から遠い方へ丸める(-0.5 → -1)。**負値で食い違う。**
/// TS 実装に合わせる。
pub fn round_half_away(v: f64) -> i64 {
    (v + 0.5).floor() as i64
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Line {
    pub theta: f64,
    pub rho: f64,
}

/// θ を [0, π) に畳む。畳むとき ρ の符号が反転する
pub fn normalize_line(mut theta: f64, mut rho: f64) -> Line {
    let pi = std::f64::consts::PI;
    while theta < 0.0 {
        theta += pi;
        rho = -rho;
    }
    while theta >= pi {
        theta -= pi;
        rho = -rho;
    }
    Line { theta, rho }
}

fn wrap(t: i64, r: i64, theta_steps: usize, rho_steps: usize) -> Option<(usize, usize)> {
    if r < 0 || r >= rho_steps as i64 {
        return None;
    }
    if t >= 0 && t < theta_steps as i64 {
        return Some((t as usize, r as usize));
    }
    let ts = theta_steps as i64;
    let tt = ((t % ts) + ts) % ts;
    let rr = rho_steps as i64 - 1 - r;
    Some((tt as usize, rr as usize))
}

fn circular_bin_distance(a: usize, b: usize, n: usize) -> usize {
    let d = if a > b { a - b } else { b - a };
    d.min(n - d)
}

pub struct PeakOptions {
    pub vote_ratio: f64,
    pub nms_theta: usize,
    pub nms_rho: usize,
    pub max_lines: usize,
}

/// 極大抽出。**PI の乗除しか使わないので TS と完全一致を要求できる**
pub fn extract_peaks(h: &Hough, opts: &PeakOptions) -> Vec<Line> {
    let (ts, rs) = (h.theta_steps, h.rho_steps);
    let max = h.acc.iter().copied().max().unwrap_or(0);
    if max == 0 {
        return Vec::new();
    }
    let min_votes = (max as f64 * opts.vote_ratio).max(1.0);

    let mut cand: Vec<(usize, usize, i32)> = Vec::new();
    for t in 0..ts {
        for r in 1..rs - 1 {
            let v = h.acc[t * rs + r];
            if (v as f64) < min_votes {
                continue;
            }
            let mut is_max = true;
            'outer: for dt in -1i64..=1 {
                for dr in -1i64..=1 {
                    if dt == 0 && dr == 0 {
                        continue;
                    }
                    if let Some((tt, rr)) = wrap(t as i64 + dt, r as i64 + dr, ts, rs) {
                        if h.acc[tt * rs + rr] > v {
                            is_max = false;
                            break 'outer;
                        }
                    }
                }
            }
            if is_max {
                cand.push((t, r, v));
            }
        }
    }
    cand.sort_by(|a, b| b.2.cmp(&a.2).then(a.0.cmp(&b.0)).then(a.1.cmp(&b.1)));

    let mut kept: Vec<(usize, usize, i32)> = Vec::new();
    for c in cand {
        if kept.len() >= opts.max_lines {
            break;
        }
        let near = kept.iter().any(|k| {
            let dt = circular_bin_distance(k.0, c.0, ts);
            let flipped = (k.0 as i64 - c.0 as i64).abs() > (ts / 2) as i64;
            let kr = if flipped { rs - 1 - k.1 } else { k.1 };
            dt <= opts.nms_theta && (kr as i64 - c.1 as i64).abs() <= opts.nms_rho as i64
        });
        if !near {
            kept.push(c);
        }
    }
    kept.into_iter().map(|k| refine(h, k.0, k.1)).collect()
}

fn refine(h: &Hough, t: usize, r: usize) -> Line {
    let (ts, rs) = (h.theta_steps, h.rho_steps);
    let mut wt = 0.0f64;
    let mut wr = 0.0f64;
    let mut sum = 0.0f64;
    for dt in -1i64..=1 {
        for dr in -1i64..=1 {
            if let Some((tt, rr)) = wrap(t as i64 + dt, r as i64 + dr, ts, rs) {
                let v = h.acc[tt * rs + rr] as f64;
                let flipped = t as i64 + dt < 0 || t as i64 + dt >= ts as i64;
                wt += v * dt as f64;
                wr += v * if flipped { -(dr as f64) } else { dr as f64 };
                sum += v;
            }
        }
    }
    let ft = if sum > 0.0 {
        t as f64 + wt / sum
    } else {
        t as f64
    };
    let fr = if sum > 0.0 {
        r as f64 + wr / sum
    } else {
        r as f64
    };
    let theta = ft * std::f64::consts::PI / ts as f64;
    let rho = (fr - (rs >> 1) as f64) / h.rho_scale;
    normalize_line(theta, rho)
}

#[cfg(test)]
mod tests {
    use super::*;

    // 期待値の出所: JS の `Math.round` の仕様(ECMA-262 —— 半整数は +∞ 方向へ丸める)。
    // Rust の `f64::round` は 0 から遠い方へ丸めるので **負の半整数で食い違う**。
    #[test]
    fn round_matches_javascript_math_round() {
        assert_eq!(round_half_away(0.5), 1);
        assert_eq!(round_half_away(1.5), 2);
        assert_eq!(round_half_away(-0.5), 0); // JS: Math.round(-0.5) === -0
        assert_eq!(round_half_away(-1.5), -1); // JS: Math.round(-1.5) === -1
        assert_eq!(round_half_away(-2.5), -2);
        // 陽性対照: f64::round はここで違う値を出す(検査が働いていることの確認)
        assert_ne!((-0.5f64).round() as i64, round_half_away(-0.5));
        assert_ne!((-1.5f64).round() as i64, round_half_away(-1.5));
    }

    #[test]
    fn normalize_folds_theta_into_half_turn() {
        let pi = std::f64::consts::PI;
        let a = normalize_line(pi + 0.3, 5.0);
        assert!((a.theta - 0.3).abs() < 1e-12);
        assert!((a.rho + 5.0).abs() < 1e-12);
        let b = normalize_line(-0.2, 5.0);
        assert!((b.theta - (pi - 0.2)).abs() < 1e-12);
        assert!((b.rho + 5.0).abs() < 1e-12);
    }

    #[test]
    fn uniform_input_yields_no_peaks() {
        // エッジが 1 つも無ければ極大も無い(分母 0 の縮退 — HC-097)
        let h = accumulate(&[], 32, 32, &[1.0], &[0.0], 1.0);
        let p = extract_peaks(
            &h,
            &PeakOptions {
                vote_ratio: 0.25,
                nms_theta: 3,
                nms_rho: 4,
                max_lines: 8,
            },
        );
        assert!(p.is_empty());
    }
}
