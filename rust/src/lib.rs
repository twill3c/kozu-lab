//! kozu-lab の Rust 実装。SPEC N-05 の射程 —— Hough 投票・極大抽出・z 正規化。
//! Canny は二重実装しない(合成オラクルで足りる)。

pub mod hough;
pub mod rng;
pub mod score;

// wasm へは生の関数として出す(wasm-bindgen を使わない = 外部依存ゼロ)。
// 線形メモリのやり取りは呼び出し側が行う。
#[no_mangle]
pub extern "C" fn kozu_alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// 投票平面を out に書く。edges は (x, y) の u32 対が len_edges 組。
///
/// # Safety
/// 呼び出し側が確保した領域を指すポインタであること。
#[no_mangle]
pub unsafe extern "C" fn kozu_hough(
    edges: *const u32,
    len_edges: usize,
    width: usize,
    height: usize,
    cos_t: *const f64,
    sin_t: *const f64,
    theta_steps: usize,
    rho_scale: f64,
    out: *mut i32,
    out_len: usize,
) -> usize {
    let e = std::slice::from_raw_parts(edges, len_edges * 2);
    let pts: Vec<(u32, u32)> = e.chunks_exact(2).map(|c| (c[0], c[1])).collect();
    let c = std::slice::from_raw_parts(cos_t, theta_steps);
    let s = std::slice::from_raw_parts(sin_t, theta_steps);
    let h = hough::accumulate(&pts, width, height, c, s, rho_scale);
    let n = h.acc.len().min(out_len);
    std::ptr::copy_nonoverlapping(h.acc.as_ptr(), out, n);
    n
}
