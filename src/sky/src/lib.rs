use wasm_bindgen::prelude::*;

const PI: f32 = core::f32::consts::PI;
const DAY_LENGTH_SECONDS: f32 = 480.0;

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
    let color = render_sky(direction, params.sun_dir, params, time_seconds).clamp01();
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
        0.0,
        params.sky_tint,
    ]
}

fn time_state(time_seconds: f32) -> TimeState {
    let time_of_day = time_seconds.rem_euclid(DAY_LENGTH_SECONDS) / DAY_LENGTH_SECONDS;
    let sun_angle = time_of_day * 2.0 * PI + (PI * 0.5);
    let sun_dir = Vec3::new(sun_angle.cos(), sun_angle.sin(), 0.05).normalize();
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

fn atmospheric_scatter(view_dir: Vec3, sun_dir: Vec3, day_factor: f32, night_factor: f32) -> Vec3 {
    let sun_amount = view_dir.dot(sun_dir).clamp(0.0, 1.0);
    let up = (view_dir.y * 0.5 + 0.5).clamp(0.0, 1.0);

    let rayleigh = Vec3::new(0.18, 0.42, 0.95) * (0.25 + 0.75 * up);
    let mie = Vec3::new(1.0, 0.63, 0.36) * (sun_amount.powf(10.0) * (0.30 + 0.70 * day_factor));
    let horizon = (1.0 - up).powf(2.1);
    let haze = Vec3::new(0.95, 0.74, 0.58) * (horizon * (0.18 + 0.45 * (1.0 - day_factor)));

    let low_sun = 1.0 - smoothstep(sun_dir.y.abs() / 0.48);
    let sunset = Vec3::new(1.0, 0.42, 0.30) * (low_sun * horizon * 0.65);

    let night_base = Vec3::new(0.02, 0.03, 0.07) * (0.35 + 0.65 * up);
    let day_base = rayleigh + haze + mie + sunset;
    mix(night_base, day_base, day_factor) * (0.90 + 0.10 * (1.0 - night_factor))
}

fn sun_value(direction: Vec3, sun_dir: Vec3, params: SkyParams) -> Vec3 {
    let sun_tint = Vec3::new(1.0, 0.93, 0.78);
    let sun_dot = direction.dot(sun_dir).clamp(0.0, 1.0);
    let disc = smoothstep((sun_dot - 0.999) / 0.001);
    let sun_val = disc * (0.95 + 0.05 * params.sun_energy);
    sun_tint * (sun_val * 1.6)
}

/// Final composition: gradient + sun + stars + aurora.
fn render_sky(direction: Vec3, sun_dir: Vec3, params: SkyParams, time_seconds: f32) -> Vec3 {
    let night_factor = 1.0 - params.day_factor;
    let mut sky = atmospheric_scatter(direction, sun_dir, params.day_factor, night_factor);

    let night = smoothstep((night_factor - 0.1) / 0.8);
    let star_val = stars_mask(direction, night, time_seconds);
    sky = sky + sun_value(direction, sun_dir, params);
    sky = sky + moon_color(direction, sun_dir, time_seconds);
    sky + (Vec3::new(1.0, 1.0, 1.0) * star_val)
}




fn moon_color(direction: Vec3, sun_dir: Vec3, time_seconds: f32) -> Vec3 {
    let cycle = (time_seconds / DAY_LENGTH_SECONDS) * (2.0 * PI) + (PI * 0.5);
    let moon_angle = cycle * 1.6;
    let moon_dir = Vec3::new(moon_angle.cos(), moon_angle.sin(), 0.05).normalize();

    let moon_disc = smoothstep((direction.dot(moon_dir).clamp(0.0, 1.0) - 0.99925) / 0.00075);
    let opposite = smoothstep((-sun_dir.dot(moon_dir) - 0.985) / 0.015);

    let normal_moon = Vec3::new(0.88, 0.90, 0.96);
    let blood_moon = Vec3::new(0.90, 0.10, 0.08);
    let tint = mix(normal_moon, blood_moon, opposite);
    let night_boost = 0.55 + 0.45 * (1.0 - smoothstep(sun_dir.y / 0.2));

    tint * moon_disc * night_boost
}

fn hash3(v: Vec3) -> f32 {
    ((v.x * 12.3 + v.y * 45.6 + v.z * 78.9).sin() * 43_758.5).fract().abs()
}

fn stars_mask(direction: Vec3, night: f32, time_seconds: f32) -> f32 {
    let angle = time_seconds * 0.0004;
    let c = angle.cos();
    let s = angle.sin();
    let rotated = Vec3::new((direction.x * c) - (direction.z * s), direction.y, (direction.x * s) + (direction.z * c));
    let n = hash3(rotated * 1000.0);
    let star = smoothstep((n - 0.99833) / 0.00167);
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
        assert_eq!(sky_color_hex(-5.0), sky_color_hex(DAY_LENGTH_SECONDS - 5.0));
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
