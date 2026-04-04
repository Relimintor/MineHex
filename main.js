const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
const materialSelect = document.querySelector('#material');
const regenBtn = document.querySelector('#regen');
const status = document.querySelector('#status');

const TILE_RADIUS = 24;
const SQRT3 = Math.sqrt(3);
const WORLD_RADIUS = 8;

const MATERIALS = {
  grass: { label: 'Grass', color: '#4d9b4a', walkable: true },
  dirt: { label: 'Dirt', color: '#866448', walkable: true },
  stone: { label: 'Stone', color: '#8a8e97', walkable: true },
  sand: { label: 'Sand', color: '#d7c38f', walkable: true },
  water: { label: 'Water', color: '#347ec7', walkable: false },
  lava: { label: 'Lava', color: '#d1562f', walkable: false },
  empty: { label: 'Empty', color: '#0a0e19', walkable: true }
};

const state = {
  tiles: [],
  player: { q: 0, r: 0 },
  selectedMaterial: 'grass'
};

for (const [key, meta] of Object.entries(MATERIALS)) {
  if (key === 'empty') continue;
  const option = document.createElement('option');
  option.value = key;
  option.textContent = meta.label;
  materialSelect.append(option);
}

materialSelect.addEventListener('change', () => {
  state.selectedMaterial = materialSelect.value;
  setStatus(`Selected ${MATERIALS[state.selectedMaterial].label}`);
});

regenBtn.addEventListener('click', () => {
  generateWorld();
  draw();
  setStatus('Regenerated a fresh hex world.');
});

window.addEventListener('keydown', (event) => {
  const keyMap = {
    w: [0, -1],
    s: [0, 1],
    a: [-1, 0],
    d: [1, 0]
  };
  const move = keyMap[event.key.toLowerCase()];
  if (!move) return;

  const next = { q: state.player.q + move[0], r: state.player.r + move[1] };
  const tile = getTile(next.q, next.r);
  if (!tile) {
    setStatus('Edge of world reached.');
    return;
  }
  if (!MATERIALS[tile.type].walkable) {
    setStatus(`Can't walk on ${MATERIALS[tile.type].label}.`);
    return;
  }

  state.player = next;
  draw();
  setStatus(`Moved to (${state.player.q}, ${state.player.r}).`);
});

canvas.addEventListener('click', (event) => {
  const pos = screenToHex(event.offsetX, event.offsetY);
  const tile = getTile(pos.q, pos.r);
  if (!tile) return;

  if (event.shiftKey) {
    tile.type = 'empty';
    setStatus(`Broke tile at (${tile.q}, ${tile.r}).`);
  } else {
    tile.type = state.selectedMaterial;
    setStatus(`Placed ${MATERIALS[state.selectedMaterial].label} at (${tile.q}, ${tile.r}).`);
  }

  draw();
});

function setStatus(text) {
  status.textContent = text;
}

function generateWorld() {
  state.tiles = [];
  for (let q = -WORLD_RADIUS; q <= WORLD_RADIUS; q++) {
    const r1 = Math.max(-WORLD_RADIUS, -q - WORLD_RADIUS);
    const r2 = Math.min(WORLD_RADIUS, -q + WORLD_RADIUS);

    for (let r = r1; r <= r2; r++) {
      const noise = Math.random();
      const type = noise < 0.1 ? 'water' : noise < 0.15 ? 'lava' : noise < 0.4 ? 'stone' : noise < 0.65 ? 'dirt' : noise < 0.82 ? 'sand' : 'grass';
      state.tiles.push({ q, r, type });
    }
  }

  const spawn = state.tiles.find((tile) => MATERIALS[tile.type].walkable) ?? state.tiles[0];
  state.player.q = spawn.q;
  state.player.r = spawn.r;
}

function hexToScreen(q, r) {
  const x = TILE_RADIUS * (1.5 * q);
  const y = TILE_RADIUS * (SQRT3 / 2 * q + SQRT3 * r);
  return {
    x: x + canvas.width / 2,
    y: y + canvas.height / 2
  };
}

function screenToHex(x, y) {
  const localX = x - canvas.width / 2;
  const localY = y - canvas.height / 2;

  const q = ((2 / 3) * localX) / TILE_RADIUS;
  const r = ((-1 / 3) * localX + (SQRT3 / 3) * localY) / TILE_RADIUS;
  return hexRound(q, r);
}

function hexRound(q, r) {
  let x = q;
  let z = r;
  let y = -x - z;

  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);

  const xDiff = Math.abs(rx - x);
  const yDiff = Math.abs(ry - y);
  const zDiff = Math.abs(rz - z);

  if (xDiff > yDiff && xDiff > zDiff) {
    rx = -ry - rz;
  } else if (yDiff > zDiff) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }

  return { q: rx, r: rz };
}

function getTile(q, r) {
  return state.tiles.find((tile) => tile.q === q && tile.r === r);
}

function drawHex(x, y, radius, fill) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    const px = x + radius * Math.cos(angle);
    const py = y + radius * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = '#121a2f';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const tile of state.tiles) {
    const { x, y } = hexToScreen(tile.q, tile.r);
    drawHex(x, y, TILE_RADIUS - 1, MATERIALS[tile.type].color);
  }

  const { x, y } = hexToScreen(state.player.q, state.player.r);
  ctx.beginPath();
  ctx.arc(x, y, TILE_RADIUS / 2.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#1f2b42';
  ctx.lineWidth = 2;
  ctx.stroke();
}

generateWorld();
draw();
setStatus('Welcome to MineHex. Build with hexes!');
