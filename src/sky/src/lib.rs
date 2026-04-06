use wasm_bindgen::prelude::*;

const PI: f32 = core::f32::consts::PI;

#[derive(Clone, Copy, Debug)]
struct Vec3 {
    x: f32,
    y: f32,
    z: f32,
}

impl Vec3 {
    const fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }

    fn dot(self, rhs: Self) -> f32 {
        self.x * rhs.x + self.y * rhs.y + self.z * rhs.z
    }

    fn length(self) -> f32 {
        (self.x * self.x + self.y * self.y + self.z * self.z).sqrt()
    }

    fn normalize(self) -> Self {
        let len = self.length();
        if len <= 1.0e-5 {
            return Self::new(0.0, 1.0, 0.0);
        }
        self / len
    }

    fn clamp01(self) -> Self {
        Self::new(
            self.x.clamp(0.0, 1.0),
            self.y.clamp(0.0, 1.0),
            self.z.clamp(0.0, 1.0),
        )
    }
}

impl core::ops::Add for Vec3 {
    type Output = Self;

    fn add(self, rhs: Self) -> Self::Output {
        Self::new(self.x + rhs.x, self.y + rhs.y, self.z + rhs.z)
    }
}

impl core::ops::Sub for Vec3 {
    type Output = Self;

    fn sub(self, rhs: Self) -> Self::Output {
        Self::new(self.x - rhs.x, self.y - rhs.y, self.z - rhs.z)
    }
}

impl core::ops::Mul<f32> for Vec3 {
    type Output = Self;

    fn mul(self, rhs: f32) -> Self::Output {
        Self::new(self.x * rhs, self.y * rhs, self.z * rhs)
    }
}

impl core::ops::Div<f32> for Vec3 {
    type Output = Self;

    fn div(self, rhs: f32) -> Self::Output {
        Self::new(self.x / rhs, self.y / rhs, self.z / rhs)
    }
}

const DAWN: Vec3 = Vec3::new(0.99, 0.62, 0.43);
const DAY_ZENITH: Vec3 = Vec3::new(0.32, 0.58, 0.87);
const DAY_HORIZON: Vec3 = Vec3::new(0.66, 0.84, 0.97);
const DUSK: Vec3 = Vec3::new(0.97, 0.49, 0.29);
const NIGHT_ZENITH: Vec3 = Vec3::new(0.03, 0.06, 0.13);
const NIGHT_HORIZON: Vec3 = Vec3::new(0.07, 0.10, 0.20);
const STAR_COLOR: Vec3 = Vec3::new(0.85, 0.9, 1.0);
const AURORA_COLOR: Vec3 = Vec3::new(0.12, 0.9, 0.55);

/// Computes a smooth sky color and returns it as a packed 0xRRGGBB integer.
///
/// This helper samples the sky at zenith (`direction = up`) so existing JS call sites
/// can keep using a single color.
#[wasm_bindgen]
pub fn sky_color_hex(time_seconds: f32) -> u32 {
    sky_color_hex_for_direction(time_seconds, 0.0, 1.0, 0.0)
}

/// Direction-aware sky sampler for fullscreen shader usage.
///
/// Inputs:
/// - `time_seconds`: world time in seconds.
/// - `dir_*`: view direction vector components in world-space.
#[wasm_bindgen]
pub fn sky_color_hex_for_direction(time_seconds: f32, dir_x: f32, dir_y: f32, dir_z: f32) -> u32 {
    let direction = Vec3::new(dir_x, dir_y, dir_z).normalize();
    let params = sky_params_internal(time_seconds);
    let color = sample_sky(direction, params, time_seconds).clamp01();
    pack_hex(color)
}

/// Returns compact time uniforms for a fullscreen sky shader.
///
/// Layout:
/// `[sun_dir_x, sun_dir_y, sun_dir_z, sun_energy, day_factor, night_factor, aurora_factor]`
#[wasm_bindgen]
pub fn sky_uniforms(time_seconds: f32) -> Vec<f32> {
    let params = sky_params_internal(time_seconds);
    vec![
        params.sun_dir.x,
        params.sun_dir.y,
        params.sun_dir.z,
        params.sun_energy,
        params.day_factor,
        1.0 - params.day_factor,
        params.aurora_factor,
    ]
}

#[derive(Clone, Copy)]
struct SkyParams {
    sun_dir: Vec3,
    day_factor: f32,
    sun_energy: f32,
    aurora_factor: f32,
}

fn sky_params_internal(time_seconds: f32) -> SkyParams {
    let period_seconds = 120.0;
    let cycle = time_seconds.rem_euclid(period_seconds) / period_seconds;
    let angle = (cycle * 2.0 * PI) - (PI * 0.5);

    let sun_dir = Vec3::new(angle.cos(), angle.sin(), 0.15).normalize();
    let day_factor = smoothstep((sun_dir.y + 0.08) / 0.45);
    let sun_energy = smoothstep((sun_dir.y + 0.12) / 0.65);
    let aurora_factor = smoothstep((-sun_dir.y - 0.15) / 0.35);

    SkyParams {
        sun_dir,
        day_factor,
        sun_energy,
        aurora_factor,
    }
}

fn sample_sky(direction: Vec3, params: SkyParams, time_seconds: f32) -> Vec3 {
    let upness = ((direction.y + 1.0) * 0.5).clamp(0.0, 1.0);
    let horizon_factor = 1.0 - smoothstep(upness);

    let day_base = mix(DAY_ZENITH, DAY_HORIZON, horizon_factor);
    let twilight_base = mix(DAWN, DUSK, ((params.sun_dir.x + 1.0) * 0.5).clamp(0.0, 1.0));
    let night_base = mix(NIGHT_ZENITH, NIGHT_HORIZON, horizon_factor);

    let twilight_blend = 1.0 - (params.day_factor * (1.0 - params.aurora_factor));
    let atmospheric = mix(
        mix(night_base, twilight_base, twilight_blend),
        day_base,
        params.day_factor,
    );

    let sun_amount = direction.dot(params.sun_dir).clamp(0.0, 1.0);
    let sun_disk = sun_amount.powf(320.0) * (0.35 + params.sun_energy * 1.15);
    let sun_halo = sun_amount.powf(20.0) * 0.18 * params.sun_energy;
    let sun_color = Vec3::new(1.0, 0.93, 0.76) * (sun_disk + sun_halo);

    let stars = star_field(direction, time_seconds) * (1.0 - params.day_factor).powf(2.2);

    let aurora_wave = ((direction.x * 18.0) + (direction.z * 12.0) + (time_seconds * 0.35)).sin();
    let aurora_band = smoothstep(0.25 + 0.45 * aurora_wave - direction.y.abs());
    let aurora = AURORA_COLOR * (aurora_band * 0.22 * params.aurora_factor);

    atmospheric + sun_color + stars + aurora
}

fn star_field(direction: Vec3, time_seconds: f32) -> Vec3 {
    let twinkle = ((time_seconds * 0.8) + direction.x * 41.3 + direction.z * 23.7).sin() * 0.5 + 0.5;
    let noise = hash(direction.x * 317.1 + direction.y * 157.7 + direction.z * 419.2);
    let sparse = smoothstep((noise - 0.94) / 0.06);
    STAR_COLOR * (sparse * (0.15 + 0.35 * twinkle))
}

fn hash(v: f32) -> f32 {
    (v.sin() * 43_758.547).fract().abs()
}

fn smoothstep(x: f32) -> f32 {
    let x = x.clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

fn mix(a: Vec3, b: Vec3, t: f32) -> Vec3 {
    Vec3::new(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t))
}

fn pack_hex(color: Vec3) -> u32 {
    let r = (color.x.clamp(0.0, 1.0) * 255.0).round() as u32;
    let g = (color.y.clamp(0.0, 1.0) * 255.0).round() as u32;
    let b = (color.z.clamp(0.0, 1.0) * 255.0).round() as u32;
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

    #[test]
    fn uniforms_shape_is_stable() {
        let uniforms = sky_uniforms(12.5);
        assert_eq!(uniforms.len(), 7);
        assert!(uniforms[3].is_finite());
    }

    #[test]
    fn direction_changes_sampled_color() {
        let zenith = sky_color_hex_for_direction(60.0, 0.0, 1.0, 0.0);
        let horizon = sky_color_hex_for_direction(60.0, 1.0, 0.0, 0.0);
        assert_ne!(zenith, horizon);
    }
}
