//! 二実装照合の固定フィクスチャを書き出す(G-06a / G-06c)。
//!
//! **入力(エッジ座標・角度表)を固定して配る。**両実装がそれを読むことで、
//! 「アルゴリズムの差」と「libm の差」を分離できる(SPEC §11.1)。
//! 角度表は f64 のビットパターンで書く —— 十進で書くと往復で最終 ULP が落ちる。
//!
//! 実行: cargo run --release --bin oracle > tests/fixtures/rust_oracle.json

use kozu::hough::{accumulate, extract_peaks, PeakOptions};
use kozu::score::{null_distribution, raw_score, z_score, GridLine, NullParams};

// **奇数寸法にしてある。**偶数だと中心 cx = W/2 が整数になり、dx = x − cx も整数になって、
// ρ が負の半整数になる場面が一度も現れない。すると JS の Math.round(半整数を +∞ 方向)と
// Rust の f64::round(0 から遠い方)の違いを、この照合が区別できなくなる(HC-070)。
const W: usize = 97;
const H: usize = 73;
const THETA_STEPS: usize = 180;
const RHO_SCALE: f64 = 1.0;
const SIGMA: f64 = 0.73; // 短辺 73 の 1 %
const SEED: u32 = 20260831;
const TRIALS: usize = 500;

fn support(theta: f64) -> f64 {
    (W as f64 / 2.0) * theta.cos().abs() + (H as f64 / 2.0) * theta.sin().abs()
}

fn main() {
    // --- 入力その 1: エッジ座標 ---------------------------------------
    // 既知の (θ, ρ) から距離場 |x cosθ + y sinθ − ρ| ≤ 0.5 で引いた細線。
    // ここは **入力** なので、生成に三角関数を使ってよい(比べるのは後段である)。
    let truth: Vec<(f64, f64)> = vec![
        (0.0_f64.to_radians(), 0.30),
        (37.0_f64.to_radians(), -0.45),
        (118.0_f64.to_radians(), 0.20),
    ];
    let cx = W as f64 / 2.0;
    let cy = H as f64 / 2.0;
    let mut edges: Vec<(u32, u32)> = Vec::new();
    for y in 0..H {
        for x in 0..W {
            let dx = x as f64 + 0.5 - cx;
            let dy = y as f64 + 0.5 - cy;
            let hit = truth
                .iter()
                .any(|&(t, f)| (dx * t.cos() + dy * t.sin() - f * support(t)).abs() <= 0.5);
            if hit {
                edges.push((x as u32, y as u32));
            }
        }
    }

    // --- 入力その 2: 角度表 -------------------------------------------
    let mut cos_t = Vec::with_capacity(THETA_STEPS);
    let mut sin_t = Vec::with_capacity(THETA_STEPS);
    for t in 0..THETA_STEPS {
        let th = t as f64 * std::f64::consts::PI / THETA_STEPS as f64;
        cos_t.push(th.cos());
        sin_t.push(th.sin());
    }

    // --- 出力その 1: 投票平面と極大(整数と四則のみ → 完全一致を要求する) ---
    let h = accumulate(&edges, W, H, &cos_t, &sin_t, RHO_SCALE);
    let peaks = extract_peaks(
        &h,
        &PeakOptions {
            vote_ratio: 0.25,
            nms_theta: 3,
            nms_rho: 4,
            max_lines: 32,
        },
    );

    // --- 出力その 2: raw / z(exp を通る → 許容付きで比べる) --------------
    let points: Vec<(f64, f64)> = edges
        .iter()
        .map(|&(x, y)| (x as f64 + 0.5 - cx, y as f64 + 0.5 - cy))
        .collect();
    // 三分割格子。比の定数は規範層にだけ置く(SPEC §4)
    let grid_polar: Vec<(f64, f64)> = vec![
        (0.0, (1.0 / 3.0 - 0.5) * W as f64),
        (0.0, (2.0 / 3.0 - 0.5) * W as f64),
        (std::f64::consts::FRAC_PI_2, (1.0 / 3.0 - 0.5) * H as f64),
        (std::f64::consts::FRAC_PI_2, (2.0 / 3.0 - 0.5) * H as f64),
    ];
    let grid: Vec<GridLine> = grid_polar
        .iter()
        .map(|&(t, r)| GridLine {
            cos: t.cos(),
            sin: t.sin(),
            rho: r,
        })
        .collect();
    let dist = null_distribution(
        &points,
        &NullParams {
            line_count: grid.len(),
            width: W as f64,
            height: H as f64,
            sigma: SIGMA,
            seed: SEED,
            trials: TRIALS,
            angles: None,
        },
    );
    let raw = raw_score(&points, &grid, SIGMA);
    let z = z_score(&points, &grid, &dist, SIGMA);

    // --- 書き出し ------------------------------------------------------
    let bits = |v: &f64| format!("\"{:016x}\"", v.to_bits());
    let list = |v: &[f64]| v.iter().map(bits).collect::<Vec<_>>().join(",");
    println!("{{");
    println!("  \"note\": \"cargo run --release --bin oracle で再生成する。手で編集しない\",");
    println!("  \"width\": {}, \"height\": {},", W, H);
    println!(
        "  \"thetaSteps\": {}, \"rhoScale\": {}, \"rhoSteps\": {},",
        THETA_STEPS, RHO_SCALE, h.rho_steps
    );
    println!(
        "  \"sigmaBits\": {}, \"seed\": {}, \"trials\": {},",
        bits(&SIGMA),
        SEED,
        TRIALS
    );
    println!("  \"voteRatio\": 0.25, \"nmsTheta\": 3, \"nmsRho\": 4, \"maxLines\": 32,");
    println!(
        "  \"edges\": [{}],",
        edges
            .iter()
            .map(|&(x, y)| format!("[{},{}]", x, y))
            .collect::<Vec<_>>()
            .join(",")
    );
    println!("  \"cosBits\": [{}],", list(&cos_t));
    println!("  \"sinBits\": [{}],", list(&sin_t));
    println!(
        "  \"gridPolarBits\": [{}],",
        grid_polar
            .iter()
            .map(|&(t, r)| format!("[{},{}]", bits(&t), bits(&r)))
            .collect::<Vec<_>>()
            .join(",")
    );
    println!(
        "  \"votes\": [{}],",
        h.acc
            .iter()
            .map(|v| v.to_string())
            .collect::<Vec<_>>()
            .join(",")
    );
    println!(
        "  \"peaksBits\": [{}],",
        peaks
            .iter()
            .map(|p| format!("[{},{}]", bits(&p.theta), bits(&p.rho)))
            .collect::<Vec<_>>()
            .join(",")
    );
    println!("  \"rawBits\": {}, \"zBits\": {},", bits(&raw), bits(&z));
    println!(
        "  \"nullMeanBits\": {}, \"nullSdBits\": {}",
        bits(&dist.mean),
        bits(&dist.sd)
    );
    println!("}}");
}
