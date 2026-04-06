#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

rustup target add wasm32-unknown-unknown
cargo build --target wasm32-unknown-unknown --release --lib
mkdir -p pkg
wasm-bindgen target/wasm32-unknown-unknown/release/bevy_sky_gradient.wasm --out-dir pkg --target web

echo "Generated:"
ls -1 pkg/bevy_sky_gradient* || true
