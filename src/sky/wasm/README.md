# MineHex Sky WASM Scaffold

This folder is the first step: making the sky code web-compatible with WebAssembly.
Engine-side wiring will happen in a later step.

## Build prerequisites
- Rust stable
- `wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`)
- `wasm-pack` (`cargo install wasm-pack`)

## Build for web
```bash
cd src/sky/wasm
wasm-pack build --target web --release --out-dir pkg
```

The build outputs `pkg/` JS glue and `.wasm` artifacts that can be imported by the browser.

## Exported API
- `default_params() -> JsValue`
- `sample_sky_color(view_y: f32, params: JsValue) -> JsValue`

These are placeholders/scaffold API points so we can later port/adapt the full Bevy sky logic while keeping a stable web boundary.
