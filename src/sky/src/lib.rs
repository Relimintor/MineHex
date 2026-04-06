use wasm_bindgen::prelude::*;

const PI: f32 = core::f32::consts::PI;
const DAY_LENGTH_SECONDS: f32 = 120.0;

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

#[derive(Clone, Copy)]
struct TimeState {
    time_of_day: f32,
    sun_angle: f32,
    sun_dir: Vec3,
    sky_tint: f32,
}

#[derive(Clone, Copy)]
struct SkyParams {
    sun_dir: Vec3,
    day_factor: f32,
    sun_energy: f32,
    sky_tint: f32,
}

#[wasm_bindgen]
pub fn sky_color_hex(time_seconds: f32) -> u32 {
    sky_color_hex_for_direction(time_seconds, 0.0, 1.0, 0.0)
}

#[wasm_bindgen]
pub fn sky_color_hex_for_direction(time_seconds: f32, dir_x: f32, dir_y: f32, dir_z: f32) -> u32 {
    let direction = Vec3::new(dir_x, dir_y, dir_z).normalize();
    let params = sky_params_internal(time_seconds);
    let color = sample_sky_gradient(direction, params).clamp01();
    pack_hex(color)
}

/// Layout: `[time_of_day, sun_angle, sun_dir_x, sun_dir_y, sun_dir_z, sky_tint]`
#[wasm_bindgen]
pub fn sky_time_state(time_seconds: f32) -> Vec<f32> {
    let s = time_state(time_seconds);
    vec![s.time_of_day, s.sun_angle, s.sun_dir.x, s.sun_dir.y, s.sun_dir.z, s.sky_tint]
}

/// Layout:
/// `[sun_dir_x, sun_dir_y, sun_dir_z, sun_energy, day_factor, night_factor, aurora_factor, sky_tint]`
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
        (1.0 - params.day_factor).powf(1.4),
        params.sky_tint,
    ]
}

fn time_state(time_seconds: f32) -> TimeState {
    let time_of_day = time_seconds.rem_euclid(DAY_LENGTH_SECONDS) / DAY_LENGTH_SECONDS;
    let sun_angle = time_of_day * 2.0 * PI;
    let sun_dir = Vec3::new(sun_angle.cos(), sun_angle.sin().max(0.0), 0.2).normalize();
    let sky_tint = smoothstep((sun_angle.sin() + 0.12) / 0.62);

    TimeState {
        time_of_day,
        sun_angle,
        sun_dir,
        sky_tint,
    }
}

fn sky_params_internal(time_seconds: f32) -> SkyParams {
    let state = time_state(time_seconds);
    SkyParams {
        sun_dir: state.sun_dir,
        day_factor: state.sky_tint,
        sun_energy: smoothstep((state.sun_dir.y + 0.08) / 0.52),
        sky_tint: state.sky_tint,
    }
}

/// Core gradient: branch-free, no texture lookups, based on dir/sun/height.
fn sample_sky_gradient(direction: Vec3, params: SkyParams) -> Vec3 {
    let height = smoothstep(direction.y * 0.5 + 0.5);
    let sun_dot = direction.dot(params.sun_dir).clamp(0.0, 1.0);

    let day_top = Vec3::new(0.20, 0.50, 1.00);
    let day_horizon = Vec3::new(0.72, 0.86, 1.00);
    let night_top = Vec3::new(0.02, 0.02, 0.05);
    let night_horizon = Vec3::new(0.05, 0.07, 0.14);

    let day_gradient = mix(day_horizon, day_top, height);
    let night_gradient = mix(night_horizon, night_top, height);
    let base = mix(night_gradient, day_gradient, params.day_factor);

    let sun_tint = mix(Vec3::new(1.0, 0.92, 0.72), day_gradient, 0.35);
    let disc = smoothstep((sun_dot - 0.999) / 0.001);
    let glow = smoothstep((sun_dot - 0.94) / 0.06);
    let sun_color = sun_tint * ((disc * (0.85 + 0.15 * params.sun_energy)) + (glow * 0.35 * params.sun_energy));

    let night = smoothstep((1.0 - params.day_factor - 0.1) / 0.8);
    let star_mask = stars_mask(direction, night, params.day_factor);
    let star_color = Vec3::new(0.88, 0.92, 1.0) * star_mask;

    (base * (0.35 + 0.65 * height * params.sky_tint)) + sun_color + star_color
}


fn hash3(v: Vec3) -> f32 {
    ((v.x * 12.3 + v.y * 45.6 + v.z * 78.9).sin() * 43_758.5).fract().abs()
}

fn stars_mask(direction: Vec3, night: f32, day_factor: f32) -> f32 {
    let n = hash3(direction * 1000.0 + Vec3::new(day_factor * 7.0, 0.0, 0.0));
    let star = smoothstep((n - 0.995) / 0.005);
    star * night
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
        assert_eq!(uniforms.len(), 8);
        assert!(uniforms[3].is_finite());
    }

    #[test]
    fn time_state_has_expected_shape() {
        let state = sky_time_state(7.0);
        assert_eq!(state.len(), 6);
        assert!((0.0..=1.0).contains(&state[0]));
        assert!((0.0..=1.0).contains(&state[5]));
    }

    #[test]
    fn direction_changes_sampled_color() {
        let zenith = sky_color_hex_for_direction(60.0, 0.0, 1.0, 0.0);
        let horizon = sky_color_hex_for_direction(60.0, 1.0, 0.0, 0.0);
        assert_ne!(zenith, horizon);
    }
}
