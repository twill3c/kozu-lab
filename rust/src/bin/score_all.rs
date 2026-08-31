//! ④ の事前計算(第 2 段)。点集合と格子から **スコアを全部計算する**。
//!
//! TS で回すと 1 時間かかる規模なので Rust に回している(SPEC N-05 の射程内 —— z 正規化)。
//! **比の定数は持たない。**格子は `data/points/grids.json` から与えられる線の集合として扱う
//! (規範層は grids.ts にだけ置く / T-310)。
//!
//! 出す数:
//!   - 格子 9 種それぞれの z(M0)
//!   - 分割比 t の走査曲線(縦・横、各 181 点)
//!   - 自由度の会計(M0 / M1 / M3 / M5)—— 三分割と黄金分割について
//!
//! 実行: cargo run --release --bin score_all

use kozu::score::{raw_score, GridLine};
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;

const POINTS_DIR: &str = "../data/points";
const OUT: &str = "../data/scores/works.json";
const TRIALS: usize = 1000;
const SEED: u32 = 20260831;
const T_MIN: f64 = 0.05;
const T_MAX: f64 = 0.95;
const T_STEP: f64 = 0.005;
/// 自由度の会計を当てる格子(規範層の名前で指定する)
const DF_GRIDS: [&str; 2] = ["thirds", "golden"];

struct Work {
    key: String,
    width: f64,
    height: f64,
    points: Vec<(f64, f64)>,
}

fn read_points(path: &std::path::Path) -> Option<Work> {
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
    let key = path.file_stem()?.to_string_lossy().to_string();
    Some(Work {
        key,
        width: w,
        height: h,
        points: pts,
    })
}

/// 帰無分布。与えられた格子と **同じ本数・同じ角度分布** のランダム格子から作る
fn null_for(points: &[(f64, f64)], lines: &[GridLine], w: f64, h: f64, sigma: f64) -> (f64, f64) {
    let mut rng = kozu::rng::Rng::new(SEED);
    let mut sum = 0.0;
    let mut sum_sq = 0.0;
    for _ in 0..TRIALS {
        let g: Vec<GridLine> = lines
            .iter()
            .map(|l| {
                let support = w / 2.0 * l.cos.abs() + h / 2.0 * l.sin.abs();
                GridLine {
                    cos: l.cos,
                    sin: l.sin,
                    rho: (rng.next_f64() * 2.0 - 1.0) * support,
                }
            })
            .collect();
        let v = raw_score(points, &g, sigma);
        sum += v;
        sum_sq += v * v;
    }
    let mean = sum / TRIALS as f64;
    let var =
        (sum_sq / TRIALS as f64 - mean * mean).max(0.0) * (TRIALS as f64 / (TRIALS as f64 - 1.0));
    (mean, var.sqrt())
}

fn z_of(points: &[(f64, f64)], lines: &[GridLine], mean: f64, sd: f64, sigma: f64) -> f64 {
    if sd == 0.0 {
        return 0.0;
    }
    (raw_score(points, lines, sigma) - mean) / sd
}

/// 格子に相似変換(平行移動・拡大・回転・鏡像)をかける
fn transform(
    lines: &[GridLine],
    dx: f64,
    dy: f64,
    scale: f64,
    rot: f64,
    mirror: bool,
) -> Vec<GridLine> {
    let (cr, sr) = (rot.cos(), rot.sin());
    lines
        .iter()
        .map(|l| {
            // 法線を回し、鏡像なら x 成分を反転する。
            // 鏡像は ρ を変えない —— 画面中心まわりの反転なので、
            // 法線の向きだけが変わる
            let nx = if mirror { -l.cos } else { l.cos };
            let ny = l.sin;
            let (rx, ry) = (nx * cr - ny * sr, nx * sr + ny * cr);
            // 平行移動: 法線方向の成分だけ ρ が動く
            let rho = l.rho * scale + rx * dx + ry * dy;
            GridLine {
                cos: rx,
                sin: ry,
                rho,
            }
        })
        .collect()
}

/// 自由度を上げたときの最良 z。M1 は比、M3 は + 平行移動と拡大、M5 は + 回転と鏡像
fn df_ladder(
    points: &[(f64, f64)],
    lines: &[GridLine],
    w: f64,
    h: f64,
    sigma: f64,
    mean: f64,
    sd: f64,
) -> [f64; 4] {
    let m0 = z_of(points, lines, mean, sd, sigma);

    // M1: 全体を一様に拡大縮小するだけ(比を 1 自由度で動かす)
    let mut m1: f64 = m0;
    for i in 0..41 {
        let s = 0.6 + 0.02 * i as f64;
        let g = transform(lines, 0.0, 0.0, s, 0.0, false);
        m1 = m1.max(z_of(points, &g, mean, sd, sigma));
    }

    // M3: + 平行移動
    let mut m3: f64 = m1;
    for si in 0..5 {
        let s = 0.8 + 0.1 * si as f64;
        for xi in 0..7 {
            let dx = (xi as f64 - 3.0) / 3.0 * 0.15 * w;
            for yi in 0..7 {
                let dy = (yi as f64 - 3.0) / 3.0 * 0.15 * h;
                let g = transform(lines, dx, dy, s, 0.0, false);
                m3 = m3.max(z_of(points, &g, mean, sd, sigma));
            }
        }
    }

    // M5: + 回転と鏡像
    let mut m5: f64 = m3;
    for &mirror in &[false, true] {
        for ri in 0..7 {
            let rot = (ri as f64 - 3.0) * 4.0_f64.to_radians();
            for si in 0..5 {
                let s = 0.8 + 0.1 * si as f64;
                for xi in 0..5 {
                    let dx = (xi as f64 - 2.0) / 2.0 * 0.15 * w;
                    for yi in 0..5 {
                        let dy = (yi as f64 - 2.0) / 2.0 * 0.15 * h;
                        let g = transform(lines, dx, dy, s, rot, mirror);
                        m5 = m5.max(z_of(points, &g, mean, sd, sigma));
                    }
                }
            }
        }
    }
    [m0, m1, m3, m5]
}

/// 分割比 t の走査。帰無は t に依存しないので向きごとに 1 回
fn scan(points: &[(f64, f64)], vertical: bool, extent: f64, sigma: f64) -> Vec<f64> {
    let (cos, sin) = if vertical { (1.0, 0.0) } else { (0.0, 1.0) };
    let mut rng = kozu::rng::Rng::new(SEED);
    let mut sum = 0.0;
    let mut sum_sq = 0.0;
    for _ in 0..TRIALS {
        let rho = (rng.next_f64() - 0.5) * extent;
        let v = raw_score(points, &[GridLine { cos, sin, rho }], sigma);
        sum += v;
        sum_sq += v * v;
    }
    let mean = sum / TRIALS as f64;
    let var =
        (sum_sq / TRIALS as f64 - mean * mean).max(0.0) * (TRIALS as f64 / (TRIALS as f64 - 1.0));
    let sd = var.sqrt();

    let n = ((T_MAX - T_MIN) / T_STEP).round() as usize + 1;
    (0..n)
        .map(|i| {
            let t = T_MIN + i as f64 * T_STEP;
            let rho = (t - 0.5) * extent;
            let raw = raw_score(points, &[GridLine { cos, sin, rho }], sigma);
            if sd == 0.0 {
                0.0
            } else {
                (raw - mean) / sd
            }
        })
        .collect()
}

/// grids.json の最低限の読み取り(外部依存ゼロなので手で解く)
fn parse_grids(src: &str) -> BTreeMap<String, BTreeMap<String, Vec<(f64, f64)>>> {
    let mut out: BTreeMap<String, BTreeMap<String, Vec<(f64, f64)>>> = BTreeMap::new();
    let body = match src.find("\"bySize\":") {
        Some(i) => &src[i + 9..],
        None => return out,
    };
    let bytes = body.as_bytes();
    let mut i = 0usize;
    let mut size_key: Option<String> = None;
    let mut kind_key: Option<String> = None;
    let mut depth = 0i32;
    while i < bytes.len() {
        match bytes[i] {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 1 {
                    size_key = None;
                }
                if depth == 0 {
                    break;
                }
            }
            b'"' => {
                let start = i + 1;
                let mut j = start;
                while j < bytes.len() && bytes[j] != b'"' {
                    j += 1;
                }
                let s = &body[start..j];
                if depth == 1 {
                    size_key = Some(s.to_string());
                    out.entry(s.to_string()).or_default();
                } else if depth == 2 {
                    kind_key = Some(s.to_string());
                }
                i = j;
            }
            b'[' if depth == 2 => {
                // 線の配列。"theta":x,"rho":y の並びを拾う
                let mut j = i;
                let mut d2 = 0;
                while j < bytes.len() {
                    if bytes[j] == b'[' {
                        d2 += 1;
                    } else if bytes[j] == b']' {
                        d2 -= 1;
                        if d2 == 0 {
                            break;
                        }
                    }
                    j += 1;
                }
                let seg = &body[i..=j];
                let mut lines = Vec::new();
                for part in seg.split("{\"theta\":").skip(1) {
                    let theta: f64 = part
                        .split(',')
                        .next()
                        .and_then(|v| v.trim().parse().ok())
                        .unwrap_or(0.0);
                    let rho: f64 = part
                        .split("\"rho\":")
                        .nth(1)
                        .and_then(|v| v.split('}').next())
                        .and_then(|v| v.trim().parse().ok())
                        .unwrap_or(0.0);
                    lines.push((theta, rho));
                }
                if let (Some(sk), Some(kk)) = (size_key.clone(), kind_key.clone()) {
                    out.entry(sk).or_default().insert(kk, lines);
                }
                i = j;
            }
            _ => {}
        }
        i += 1;
    }
    out
}

fn main() {
    let grids_src =
        fs::read_to_string(format!("{POINTS_DIR}/grids.json")).expect("grids.json が無い");
    let grids = parse_grids(&grids_src);
    let kinds: Vec<String> = grids
        .values()
        .next()
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default();
    eprintln!("格子: {} 通りの寸法 × {} 種", grids.len(), kinds.len());

    let mut files: Vec<_> = fs::read_dir(POINTS_DIR)
        .expect("data/points が無い")
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|x| x == "bin").unwrap_or(false))
        .collect();
    files.sort();
    eprintln!("点集合: {} 件", files.len());

    fs::create_dir_all("../data/scores").ok();
    let mut out = fs::File::create(OUT).expect("出力を作れない");
    writeln!(out, "{{").unwrap();
    writeln!(out, " \"trials\": {TRIALS}, \"seed\": {SEED},").unwrap();
    writeln!(
        out,
        " \"tMin\": {T_MIN}, \"tMax\": {T_MAX}, \"tStep\": {T_STEP},"
    )
    .unwrap();
    writeln!(
        out,
        " \"kinds\": [{}],",
        kinds
            .iter()
            .map(|k| format!("\"{k}\""))
            .collect::<Vec<_>>()
            .join(",")
    )
    .unwrap();
    writeln!(
        out,
        " \"dfGrids\": [{}],",
        DF_GRIDS
            .iter()
            .map(|k| format!("\"{k}\""))
            .collect::<Vec<_>>()
            .join(",")
    )
    .unwrap();
    writeln!(out, " \"works\": [").unwrap();

    let mut first = true;
    for (n, path) in files.iter().enumerate() {
        let Some(w) = read_points(path) else { continue };
        if w.points.len() < 50 {
            eprintln!("  {} は点が {} 個しかない。飛ばす", w.key, w.points.len());
            continue;
        }
        let sigma = w.width.min(w.height) * 0.01;
        let size = format!("{}x{}", w.width as i64, w.height as i64);
        let Some(gset) = grids.get(&size) else {
            eprintln!("  {} の寸法 {} に対応する格子が無い。飛ばす", w.key, size);
            continue;
        };

        let mut zs: Vec<(String, f64)> = Vec::new();
        let mut ladders: Vec<(String, [f64; 4])> = Vec::new();
        for k in &kinds {
            let Some(polar) = gset.get(k) else { continue };
            let lines: Vec<GridLine> = polar
                .iter()
                .map(|&(t, r)| GridLine {
                    cos: t.cos(),
                    sin: t.sin(),
                    rho: r,
                })
                .collect();
            let (mean, sd) = null_for(&w.points, &lines, w.width, w.height, sigma);
            zs.push((k.clone(), z_of(&w.points, &lines, mean, sd, sigma)));
            if DF_GRIDS.contains(&k.as_str()) {
                ladders.push((
                    k.clone(),
                    df_ladder(&w.points, &lines, w.width, w.height, sigma, mean, sd),
                ));
            }
        }
        let sv = scan(&w.points, true, w.width, sigma);
        let sh = scan(&w.points, false, w.height, sigma);

        if !first {
            writeln!(out, ",").unwrap();
        }
        first = false;
        write!(
            out,
            "  {{\"key\":\"{}\",\"width\":{},\"height\":{},\"points\":{}",
            w.key,
            w.width,
            w.height,
            w.points.len()
        )
        .unwrap();
        write!(
            out,
            ",\"z\":{{{}}}",
            zs.iter()
                .map(|(k, v)| format!("\"{k}\":{v:.6}"))
                .collect::<Vec<_>>()
                .join(",")
        )
        .unwrap();
        write!(
            out,
            ",\"df\":{{{}}}",
            ladders
                .iter()
                .map(|(k, v)| format!(
                    "\"{k}\":[{}]",
                    v.iter()
                        .map(|x| format!("{x:.6}"))
                        .collect::<Vec<_>>()
                        .join(",")
                ))
                .collect::<Vec<_>>()
                .join(",")
        )
        .unwrap();
        write!(
            out,
            ",\"scanV\":[{}]",
            sv.iter()
                .map(|x| format!("{x:.4}"))
                .collect::<Vec<_>>()
                .join(",")
        )
        .unwrap();
        write!(
            out,
            ",\"scanH\":[{}]}}",
            sh.iter()
                .map(|x| format!("{x:.4}"))
                .collect::<Vec<_>>()
                .join(",")
        )
        .unwrap();

        if (n + 1) % 50 == 0 {
            eprintln!("  {}/{}", n + 1, files.len());
        }
    }
    writeln!(out, "\n ]\n}}").unwrap();
    eprintln!("書いた: {OUT}");
}
