# Sky WASM package artifacts

This folder is used by `src/sky/skyAtmosphere.js` to load:

- `bevy_sky_gradient.js`
- `bevy_sky_gradient_bg.wasm`

The `.wasm` binary is **not committed** in this repository workflow because binary diffs are not supported.

To regenerate artifacts locally:

```bash
cd src/sky
./build_wasm_pkg.sh
```

Then deploy the generated files in `src/sky/pkg/` with your site build.
