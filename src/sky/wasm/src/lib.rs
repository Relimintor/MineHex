use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct SkyParams {
    pub sun_height: f32,
    pub horizon_mix: f32,
    pub zenith_r: f32,
    pub zenith_g: f32,
    pub zenith_b: f32,
    pub horizon_r: f32,
    pub horizon_g: f32,
    pub horizon_b: f32,
}

impl Default for SkyParams {
    fn default() -> Self {
        Self {
            sun_height: 0.35,
            horizon_mix: 1.25,
            zenith_r: 0.17,
            zenith_g: 0.42,
            zenith_b: 0.88,
            horizon_r: 0.72,
            horizon_g: 0.82,
            horizon_b: 0.97,
        }
    }
}

#[wasm_bindgen]
pub fn default_params() -> JsValue {
    serde_wasm_bindgen::to_value(&SkyParams::default()).expect("serialize SkyParams")
}

#[wasm_bindgen]
pub fn sample_sky_color(view_y: f32, params: &JsValue) -> JsValue {
    let parsed = serde_wasm_bindgen::from_value::<SkyParams>(params.clone()).unwrap_or_default();
    let t = ((view_y.clamp(-1.0, 1.0) + 1.0) * 0.5).powf(parsed.horizon_mix.max(0.01));
    let day_factor = ((parsed.sun_height + 1.0) * 0.5).clamp(0.0, 1.0);

    let zenith = [
        parsed.zenith_r * day_factor,
        parsed.zenith_g * day_factor,
        parsed.zenith_b * day_factor,
    ];
    let horizon = [
        parsed.horizon_r * (0.4 + day_factor * 0.6),
        parsed.horizon_g * (0.4 + day_factor * 0.6),
        parsed.horizon_b * (0.4 + day_factor * 0.6),
    ];

    let color = [
        horizon[0] * (1.0 - t) + zenith[0] * t,
        horizon[1] * (1.0 - t) + zenith[1] * t,
        horizon[2] * (1.0 - t) + zenith[2] * t,
    ];

    serde_wasm_bindgen::to_value(&color).expect("serialize sampled color")
}
