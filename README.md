# MineHex FPS

MineHex FPS is a Minecraft-like prototype with a **first-person camera on a flat world**, where terrain uses connected **hexagonal columns** instead of square blocks.

## Highlights

- Flat hex world (not a planet).
- First-person controls with pointer lock + WASD movement.
- Left click places selected material.
- `Shift + Left click` breaks tile (resets to grass).
- Tile types live in `config.js` for easy extension (example: `wood`).

## Controls

- **Click viewport**: lock pointer
- **Mouse move**: look around
- **W/A/S/D**: move
- **Left click**: place selected material
- **Shift + Left click**: break/reset tile

## Run

Open `index.html` in a modern browser (requires internet for Three.js CDN import).

Or serve locally:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.
