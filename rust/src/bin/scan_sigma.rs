//! SPEC §5.2 の宿題 —— **④ の結論を σ の関数として描く**。
//!
//! σ(当てはまりの許容幅)は宣言値にすぎない。動かせば結論が変わるかもしれない。
//! 変わるなら、それは「④ の答え」が σ の選び方に依存しているということで、
//! **その依存そのものを `/about` に出す**。
//!
//! A 群(実作品 200 件)の走査曲線を σ = 0.5 / 1 / 2 % で作り直し、
//! なだらかな傾向を引いた残差を、謳われた比の位置で比べる。
//!
//! 実行: cargo run --release --bin scan_sigma

use kozu::score::{raw_score, GridLine};
use std::fs;
use std::io::Write;

const POINTS_DIR: &str = "../data/points";
const OUT: &str = "../data/measurements/sigma.json";
const TRIALS: usize = 1000;
const SEED: u32 = 20260831;
const T_MIN: f64 = 0.05;
const T_STEP: f64 = 0.005;
const T_N: usize = 181;
/// 短辺に対する σ の比。既定は 1 %(SPEC §5.1)
const SIGMAS: [f64; 3] = [0.005, 0.01, 0.02];

/// 点集合と、それが載っていた画面の寸法
struct Points {
    width: f64,
    height: f64,
    pts: Vec<(f64, f64)>,
}

fn read_points(path: &std::path::Path) -> Option<Points> {
    let b = fs::read(path).ok()?;
    if b.len() < 8 {
        return None;
    }
    let w = i32::from_le_bytes(b[0..4].try_into().ok()?) as f64;
    let h = i32::from_le_bytes(b[4..8].try_into().ok()?) as f64;
    let n = (b.len() - 8) / 8;
    let mut pts = Vec::with_capacity(n);
    for i in 0..n {
        let o = 8 + i * 8;
        let x = f32::from_le_bytes(b[o..o + 4].try_into().ok()?) as f64;
        let y = f32::from_le_bytes(b[o + 4..o + 8].try_into().ok()?) as f64;
        pts.push((x, y));
    }
    Some(Points {
        width: w,
        height: h,
        pts,
    })
}

/// 縦線 1 本の走査。帰無は t に依存しないので 1 回
fn scan(points: &[(f64, f64)], extent: f64, sigma: f64) -> Vec<f64> {
    let mut rng = kozu::rng::Rng::new(SEED);
    let mut sum = 0.0;
    let mut sum_sq = 0.0;
    for _ in 0..TRIALS {
        let rho = (rng.next_f64() - 0.5) * extent;
        let v = raw_score(
            points,
            &[GridLine {
                cos: 1.0,
                sin: 0.0,
                rho,
            }],
            sigma,
        );
        sum += v;
        sum_sq += v * v;
    }
    let mean = sum / TRIALS as f64;
    let var =
        (sum_sq / TRIALS as f64 - mean * mean).max(0.0) * (TRIALS as f64 / (TRIALS as f64 - 1.0));
    let sd = var.sqrt();
    (0..T_N)
        .map(|i| {
            let t = T_MIN + i as f64 * T_STEP;
            let raw = raw_score(
                points,
                &[GridLine {
                    cos: 1.0,
                    sin: 0.0,
                    rho: (t - 0.5) * extent,
                }],
                sigma,
            );
            if sd == 0.0 {
                0.0
            } else {
                (raw - mean) / sd
            }
        })
        .collect()
}

/// なだらかな傾向を引く(窓 0.3 = 61 点)。experiment.ts の detrend と同じ規則
fn detrend(curve: &[f64], win: usize) -> Vec<f64> {
    let half = (win / 2).max(1);
    (0..curve.len())
        .map(|i| {
            let lo = i.saturating_sub(half);
            let hi = (i + half + 1).min(curve.len());
            let s: f64 = curve[lo..hi].iter().sum();
            curve[i] - s / (hi - lo) as f64
        })
        .collect()
}

fn main() {
    let mut files: Vec<_> = fs::read_dir(POINTS_DIR)
        .expect("data/points が無い")
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension().map(|x| x == "bin").unwrap_or(false)
                && p.file_name()
                    .map(|f| f.to_string_lossy().starts_with("A-"))
                    .unwrap_or(false)
        })
        .collect();
    files.sort();
    eprintln!("A 群 {} 件", files.len());

    let golden = (1.0 + 5.0_f64.sqrt()) / 2.0;
    let named: Vec<(&str, f64)> = vec![
        ("三分割 1/3", 1.0 / 3.0),
        ("三分割 2/3", 2.0 / 3.0),
        ("黄金 0.382", 1.0 - 1.0 / golden),
        ("黄金 0.618", 1.0 / golden),
        ("中央 0.5", 0.5),
    ];

    fs::create_dir_all("../data/measurements").ok();
    let mut out = fs::File::create(OUT).expect("出力を作れない");
    writeln!(out, "{{").unwrap();
    writeln!(
        out,
        r#" "question": "SPEC §5.2: sigma を動かすと ④ の結論は変わるか","#
    )
    .unwrap();
    writeln!(out, r#" "method": "A 群 200 件の縦走査を sigma = 0.5/1/2 % で作り直し、窓 0.3 で傾向を引いた残差を謳われた比の位置で比べる。帰無 1,000 枚・シード 20260831","#).unwrap();
    writeln!(out, r#" "measuredAt": "2026-09-01","#).unwrap();
    writeln!(out, r#" "n": {},"#, files.len()).unwrap();
    writeln!(out, r#" "rows": ["#).unwrap();

    let mut first = true;
    for (si, frac) in SIGMAS.iter().enumerate() {
        let mut acc = vec![0.0f64; T_N];
        let mut used = 0usize;
        for path in &files {
            let Some(p) = read_points(path) else { continue };
            if p.pts.len() < 50 {
                continue;
            }
            let sigma = p.width.min(p.height) * frac;
            let c = scan(&p.pts, p.width, sigma);
            for i in 0..T_N {
                acc[i] += c[i];
            }
            used += 1;
        }
        for v in acc.iter_mut() {
            *v /= used as f64;
        }
        let peak = acc
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
            .map(|(i, v)| (T_MIN + i as f64 * T_STEP, *v))
            .unwrap();
        let res = detrend(&acc, 61);
        let at = |t: f64| -> f64 {
            let i = ((t - T_MIN) / T_STEP).round().clamp(0.0, (T_N - 1) as f64) as usize;
            res[i]
        };
        if !first {
            writeln!(out, ",").unwrap();
        }
        first = false;
        write!(
            out,
            r#"  {{"sigmaPct": {}, "n": {}, "peakT": {:.4}, "peakZ": {:.4}, "residual": {{{}}}}}"#,
            frac * 100.0,
            used,
            peak.0,
            peak.1,
            named
                .iter()
                .map(|(k, t)| format!(r#""{k}": {:.4}"#, at(*t)))
                .collect::<Vec<_>>()
                .join(", ")
        )
        .unwrap();
        eprintln!(
            "  sigma {:.1} %: 頂点 t={:.3} z={:.3} / 残差 {}",
            frac * 100.0,
            peak.0,
            peak.1,
            named
                .iter()
                .map(|(k, t)| format!("{k} {:+.3}", at(*t)))
                .collect::<Vec<_>>()
                .join(" ")
        );
        let _ = si;
    }
    writeln!(out, "\n ]\n}}").unwrap();
    eprintln!("書いた: {OUT}");
}
