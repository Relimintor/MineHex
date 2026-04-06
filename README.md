# MineHex FPS

MineHex FPS is a Minecraft-like prototype with a **first-person camera on a flat world**, where terrain uses connected **hexagonal columns** instead of square blocks.

## Highlights

- Flat hex world (not a planet).
- First-person controls with pointer lock + WASD movement.
- Right click places selected material.
- Left click breaks player-placed blocks.
- `Shift + Left click` breaks terrain blocks.
- Tile types live in `config.js` for easy extension (example: `wood`).
- Coordinates follow the common hex approach:
  - **Cube coordinates internally** (`x`, `y`, `z` with `x + y + z = 0`) for neighbors and distance math.
  - **Axial coordinates externally** (`q`, `r`) for APIs and block/chunk addressing.

## Controls

- **Click viewport**: lock pointer
- **Mouse move**: look around
- **W/A/S/D**: move
- **Right click**: place selected material
- **Left click**: break player-placed blocks
- **Shift + Left click**: break terrain blocks

## Build Rust/WASM sky module (optional but recommended)

The sky system can run with a JS fallback color, but to enable the Rust-powered sky gradient in browser builds:

1. Install Rust (via `rustup`) and `wasm-pack`.
2. Build the wasm-bindgen package:

```bash
cd src/sky
wasm-pack build --target web --release --out-dir pkg
```

This generates `src/sky/pkg/bevy_sky_gradient.js` + `.wasm`, which `src/sky/skyAtmosphere.js` will auto-load.

## Run

Open `index.html` in a modern browser (requires internet for Three.js CDN import).

Or serve locally:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.
