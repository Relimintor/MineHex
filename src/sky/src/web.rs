use wasm_bindgen::prelude::*;

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t.clamp(0.0, 1.0)
}

/// Returns a packed 0xRRGGBB sky color for a given normalized time value.
///
/// `time_seconds` is interpreted as real-time seconds. The function maps it
/// into a simple day/night cycle and returns an RGB color that JavaScript can
/// apply directly to Three.js scene background/fog.
#[wasm_bindgen]
pub fn sky_color_hex(time_seconds: f32) -> u32 {
    let cycle = (time_seconds * 0.03).sin() * 0.5 + 0.5;

    // night -> day gradient
    let night = (0.02, 0.04, 0.10);
    let day = (0.53, 0.81, 0.92);

    let r = (lerp(night.0, day.0, cycle) * 255.0).round() as u32;
    let g = (lerp(night.1, day.1, cycle) * 255.0).round() as u32;
    let b = (lerp(night.2, day.2, cycle) * 255.0).round() as u32;

    (r << 16) | (g << 8) | b
}
