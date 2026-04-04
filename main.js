import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { HEX_TYPES, WORLD_CONFIG } from './config.js';

const mount = document.querySelector('#game');
const materialSelect = document.querySelector('#material');
const regenBtn = document.querySelector('#regen');
const status = document.querySelector('#status');

const state = {
  selectedType: 'grass',
  cellsByKey: new Map(),
  keysDown: new Set()
};

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(mount.clientWidth, mount.clientHeight);
mount.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(WORLD_CONFIG.skyColor);
scene.fog = new THREE.Fog(WORLD_CONFIG.skyColor, 25, 90);

const camera = new THREE.PerspectiveCamera(70, mount.clientWidth / mount.clientHeight, 0.1, 200);
camera.position.set(0, WORLD_CONFIG.cameraEyeHeight + 3, 7);

const controls = new PointerLockControls(camera, renderer.domElement);
scene.add(controls.getObject());

const hemi = new THREE.HemisphereLight(0xffffff, WORLD_CONFIG.groundColor, 0.95);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 0.7);
sun.position.set(22, 35, 12);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(300, 300),
  new THREE.MeshStandardMaterial({ color: 0x6c8a56, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.02;
scene.add(ground);

const raycaster = new THREE.Raycaster();
const clock = new THREE.Clock();

initMaterialList();
generateHexWorld();
setStatus('Click world to lock pointer. WASD to move.');
animate();

mount.addEventListener('click', () => {
  if (!controls.isLocked) controls.lock();
});

window.addEventListener('resize', onResize);
window.addEventListener('keydown', (event) => state.keysDown.add(event.key.toLowerCase()));
window.addEventListener('keyup', (event) => state.keysDown.delete(event.key.toLowerCase()));
renderer.domElement.addEventListener('mousedown', onMouseDown);
regenBtn.addEventListener('click', () => {
  generateHexWorld();
  setStatus('Regenerated flat connected hex world.');
});
materialSelect.addEventListener('change', () => {
  state.selectedType = materialSelect.value;
  setStatus(`Selected ${HEX_TYPES[state.selectedType].label}.`);
});

function initMaterialList() {
  Object.entries(HEX_TYPES).forEach(([key, meta]) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = meta.label;
    materialSelect.append(option);
  });
}

function generateHexWorld() {
  for (const cell of state.cellsByKey.values()) {
    if (cell.mesh.geometry) cell.mesh.geometry.dispose();
    if (cell.mesh.material) cell.mesh.material.dispose();
    scene.remove(cell.mesh);
  }
  state.cellsByKey.clear();

  for (let q = -WORLD_CONFIG.worldRadius; q <= WORLD_CONFIG.worldRadius; q++) {
    const r1 = Math.max(-WORLD_CONFIG.worldRadius, -q - WORLD_CONFIG.worldRadius);
    const r2 = Math.min(WORLD_CONFIG.worldRadius, -q + WORLD_CONFIG.worldRadius);

    for (let r = r1; r <= r2; r++) {
      const type = randomType();
      addCell(q, r, type);
    }
  }
}

function addCell(q, r, type) {
  const meta = HEX_TYPES[type];
  const h = meta.height + WORLD_CONFIG.baseDepth;

  const geometry = new THREE.CylinderGeometry(
    WORLD_CONFIG.tileRadius,
    WORLD_CONFIG.tileRadius,
    h,
    6,
    1,
    false
  );

  const material = new THREE.MeshStandardMaterial({
    color: meta.color,
    roughness: 0.9,
    metalness: 0.02
  });

  const mesh = new THREE.Mesh(geometry, material);
  const { x, z } = axialToWorld(q, r);
  mesh.position.set(x, h / 2, z);
  mesh.userData = { q, r, type };

  state.cellsByKey.set(keyFor(q, r), { q, r, type, mesh });
  scene.add(mesh);
}

function onMouseDown(event) {
  if (event.button !== 0 || !controls.isLocked) return;

  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const meshes = [...state.cellsByKey.values()].map((cell) => cell.mesh);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  if (!hit) return;

  const mesh = hit.object;
  const { q, r } = mesh.userData;

  if (event.shiftKey) {
    setCellType(q, r, 'grass');
    setStatus(`Broke tile at (${q}, ${r}) -> Grass.`);
    return;
  }

  setCellType(q, r, state.selectedType);
  setStatus(`Placed ${HEX_TYPES[state.selectedType].label} at (${q}, ${r}).`);
}

function setCellType(q, r, type) {
  const cell = state.cellsByKey.get(keyFor(q, r));
  if (!cell) return;

  cell.type = type;
  cell.mesh.userData.type = type;
  cell.mesh.material.color.set(HEX_TYPES[type].color);

  const newHeight = HEX_TYPES[type].height + WORLD_CONFIG.baseDepth;
  const currentHeight = cell.mesh.geometry.parameters.height;
  const scaleY = newHeight / currentHeight;
  cell.mesh.scale.y = scaleY;
  cell.mesh.position.y = newHeight / 2;
}

function updateMovement(dt) {
  if (!controls.isLocked) return;

  const move = WORLD_CONFIG.moveSpeed * dt;
  const dir = new THREE.Vector3();

  if (state.keysDown.has('w')) dir.z -= 1;
  if (state.keysDown.has('s')) dir.z += 1;
  if (state.keysDown.has('a')) dir.x -= 1;
  if (state.keysDown.has('d')) dir.x += 1;
  if (dir.lengthSq() === 0) return;

  dir.normalize();
  controls.moveRight(dir.x * move);
  controls.moveForward(dir.z * move);

  const pos = controls.getObject().position;
  const cell = nearestCellAt(pos.x, pos.z);
  const walkable = !cell || HEX_TYPES[cell.type].walkable;

  if (!walkable) {
    controls.moveRight(-dir.x * move);
    controls.moveForward(-dir.z * move);
    setStatus(`Blocked by ${HEX_TYPES[cell.type].label}.`);
  }

  controls.getObject().position.y = WORLD_CONFIG.cameraEyeHeight + terrainHeightAt(controls.getObject().position.x, controls.getObject().position.z);
}

function terrainHeightAt(x, z) {
  const cell = nearestCellAt(x, z);
  if (!cell) return 0;
  return HEX_TYPES[cell.type].height + WORLD_CONFIG.baseDepth;
}

function nearestCellAt(x, z) {
  const axial = worldToAxial(x, z);
  return state.cellsByKey.get(keyFor(axial.q, axial.r)) || null;
}

function axialToWorld(q, r) {
  const x = WORLD_CONFIG.tileRadius * 1.5 * q;
  const z = WORLD_CONFIG.tileRadius * Math.sqrt(3) * (r + q / 2);
  return { x, z };
}

function worldToAxial(x, z) {
  const q = (2 / 3) * (x / WORLD_CONFIG.tileRadius);
  const r = ((-1 / 3) * x + (Math.sqrt(3) / 3) * z) / WORLD_CONFIG.tileRadius;
  return axialRound(q, r);
}

function axialRound(q, r) {
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

function randomType() {
  const roll = Math.random();
  if (roll < 0.1) return 'water';
  if (roll < 0.14) return 'lava';
  if (roll < 0.33) return 'stone';
  if (roll < 0.52) return 'dirt';
  if (roll < 0.7) return 'wood';
  if (roll < 0.84) return 'sand';
  return 'grass';
}

function keyFor(q, r) {
  return `${q},${r}`;
}

function onResize() {
  camera.aspect = mount.clientWidth / mount.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(mount.clientWidth, mount.clientHeight);
}

function animate() {
  requestAnimationFrame(animate);
  updateMovement(clock.getDelta());
  renderer.render(scene, camera);
}

function setStatus(text) {
  status.textContent = text;
}
