# MineHex 3D

MineHex 3D is a Minecraft-inspired sandbox prototype where the world is wrapped into a connected football-like planet made from hex-style tiles.

## What changed

- Moved tile/type definitions into `config.js` so adding new types (like `wood`) is simple.
- Switched from a flat 2D map to a 3D rotatable globe.
- Each surface cell is generated from a sphere graph so tiles are connected across the planet.
- Click to place selected material, `Shift + Click` to break/reset a tile.

## Controls

- **Drag**: rotate planet
- **Mouse wheel**: zoom
- **Click**: place selected type
- **Shift + Click**: break (reset to grass)

## Run

Open `index.html` in a modern browser (internet required for Three.js CDN import).

Or serve locally:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.
