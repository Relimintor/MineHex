# MineHex FPS

MineHex FPS is a Minecraft-like prototype with a **first-person camera on a flat world**, where terrain uses connected **hexagonal columns** instead of square blocks.

## Highlights

- Flat hex world (not a planet).
- First-person controls with pointer lock + WASD movement.
- Right click places selected material.
- Left click breaks player-placed blocks.
- `Shift + Left click` breaks terrain blocks.
- Tile types live in `config.js` for easy extension (example: `wood`).

## Controls

- **Click viewport**: lock pointer
- **Mouse move**: look around
- **W/A/S/D**: move
- **Right click**: place selected material
- **Left click**: break player-placed blocks
- **Shift + Left click**: break terrain blocks

## Run

Open `index.html` in a modern browser (requires internet for Three.js CDN import).

Or serve locally:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.
