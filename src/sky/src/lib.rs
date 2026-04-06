use wasm_bindgen::prelude::*;

const DAWN: (f32, f32, f32) = (0.99, 0.62, 0.43);
const DAY: (f32, f32, f32) = (0.53, 0.81, 0.92);
const DUSK: (f32, f32, f32) = (0.97, 0.49, 0.29);
const NIGHT: (f32, f32, f32) = (0.03, 0.06, 0.13);

/// Computes a smooth sky color and returns it as a packed 0xRRGGBB integer.
#[wasm_bindgen]
pub fn sky_color_hex(time_seconds: f32) -> u32 {
    let period_seconds = 120.0;
    let t = (time_seconds.rem_euclid(period_seconds)) / period_seconds;

    let color = if t < 0.20 {
        let local = t / 0.20;
        lerp_rgb(NIGHT, DAWN, smoothstep(local))
    } else if t < 0.40 {
        let local = (t - 0.20) / 0.20;
        lerp_rgb(DAWN, DAY, smoothstep(local))
    } else if t < 0.70 {
        DAY
    } else if t < 0.85 {
        let local = (t - 0.70) / 0.15;
        lerp_rgb(DAY, DUSK, smoothstep(local))
    } else {
        let local = (t - 0.85) / 0.15;
        lerp_rgb(DUSK, NIGHT, smoothstep(local))
    };

    pack_hex(color)
}

fn smoothstep(x: f32) -> f32 {
    let x = x.clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

fn lerp_rgb(a: (f32, f32, f32), b: (f32, f32, f32), t: f32) -> (f32, f32, f32) {
    (lerp(a.0, b.0, t), lerp(a.1, b.1, t), lerp(a.2, b.2, t))
}

fn pack_hex(color: (f32, f32, f32)) -> u32 {
    let r = (color.0.clamp(0.0, 1.0) * 255.0).round() as u32;
    let g = (color.1.clamp(0.0, 1.0) * 255.0).round() as u32;
    let b = (color.2.clamp(0.0, 1.0) * 255.0).round() as u32;
    (r << 16) | (g << 8) | b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn color_is_24_bit_hex() {
        let value = sky_color_hex(42.0);
        assert!(value <= 0xFF_FF_FF);
    }

    #[test]
    fn cycle_wraps_for_negative_time() {
        assert_eq!(sky_color_hex(-5.0), sky_color_hex(115.0));
    }
}
