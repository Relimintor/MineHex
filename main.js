import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HEX_TYPES, WORLD_CONFIG } from './config.js';

const mount = document.querySelector('#game');
const materialSelect = document.querySelector('#material');
const regenBtn = document.querySelector('#regen');
const status = document.querySelector('#status');

const state = {
  selectedType: 'grass',
  cells: [],
  planetGroup: new THREE.Group()
};

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(mount.clientWidth, mount.clientHeight);
mount.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(WORLD_CONFIG.skyColor);
scene.fog = new THREE.Fog(WORLD_CONFIG.fogColor, 10, 28);

const camera = new THREE.PerspectiveCamera(55, mount.clientWidth / mount.clientHeight, 0.1, 100);
camera.position.set(0, 5, 14);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 8;
controls.maxDistance = 22;

const ambient = new THREE.AmbientLight(0xffffff, 0.65);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(7, 8, 10);
scene.add(sun);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

scene.add(state.planetGroup);
initMaterialList();
buildPlanet();
setStatus('Welcome to MineHex 3D. Build with connected hexes.');
animate();

window.addEventListener('resize', onResize);
regenBtn.addEventListener('click', () => {
  buildPlanet();
  setStatus('Regenerated connected hex planet.');
});
materialSelect.addEventListener('change', () => {
  state.selectedType = materialSelect.value;
  setStatus(`Selected ${HEX_TYPES[state.selectedType].label}.`);
});
renderer.domElement.addEventListener('pointerdown', onPointerDown);

function initMaterialList() {
  Object.entries(HEX_TYPES).forEach(([key, meta]) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = meta.label;
    materialSelect.append(option);
  });
}

function buildPlanet() {
  for (const child of [...state.planetGroup.children]) {
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
    state.planetGroup.remove(child);
  }

  state.cells = [];

  const sphere = new THREE.IcosahedronGeometry(WORLD_CONFIG.sphereRadius, WORLD_CONFIG.radius);
  const pos = sphere.getAttribute('position');
  const dedup = new Map();

  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    const key = `${v.x.toFixed(4)}:${v.y.toFixed(4)}:${v.z.toFixed(4)}`;
    if (!dedup.has(key)) dedup.set(key, v);
  }

  const normals = [...dedup.values()];

  for (const normal of normals) {
    const type = randomType();
    const mesh = createCell(normal, type);
    state.cells.push({ normal, type, mesh });
    state.planetGroup.add(mesh);
  }

  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(WORLD_CONFIG.sphereRadius - 0.55, 36, 24),
    new THREE.MeshStandardMaterial({ color: 0x121b33, roughness: 0.95, metalness: 0.05 })
  );
  state.planetGroup.add(shell);

  sphere.dispose();
}

function createCell(normal, type) {
  const meta = HEX_TYPES[type];
  const height = WORLD_CONFIG.tileDepth + meta.height;

  const geometry = new THREE.CylinderGeometry(
    WORLD_CONFIG.tileRadius,
    WORLD_CONFIG.tileRadius,
    height,
    6,
    1,
    false
  );

  const material = new THREE.MeshStandardMaterial({
    color: meta.color,
    roughness: 0.88,
    metalness: 0.02
  });

  const mesh = new THREE.Mesh(geometry, material);

  const up = normal.clone();
  const tangent = Math.abs(up.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(tangent, up).normalize();
  const forward = new THREE.Vector3().crossVectors(up, side).normalize();
  const matrix = new THREE.Matrix4().makeBasis(side, up, forward);

  mesh.setRotationFromMatrix(matrix);
  mesh.position.copy(up.multiplyScalar(WORLD_CONFIG.sphereRadius + height / 2 - 0.16));
  mesh.userData.type = type;

  return mesh;
}

function randomType() {
  const roll = Math.random();
  if (roll < 0.1) return 'water';
  if (roll < 0.15) return 'lava';
  if (roll < 0.3) return 'stone';
  if (roll < 0.48) return 'dirt';
  if (roll < 0.66) return 'wood';
  if (roll < 0.82) return 'sand';
  return 'grass';
}

function onPointerDown(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObjects(state.planetGroup.children, false);
  const hit = intersects.find((entry) => entry.object.geometry?.type === 'CylinderGeometry');
  if (!hit) return;

  const mesh = hit.object;

  if (event.shiftKey) {
    applyType(mesh, 'grass');
    setStatus('Broke tile: reset to Grass.');
    return;
  }

  applyType(mesh, state.selectedType);
  setStatus(`Placed ${HEX_TYPES[state.selectedType].label}.`);
}

function applyType(mesh, type) {
  mesh.userData.type = type;
  mesh.material.color.set(HEX_TYPES[type].color);

  const normal = mesh.position.clone().normalize();
  const height = WORLD_CONFIG.tileDepth + HEX_TYPES[type].height;
  mesh.scale.set(1, height / (WORLD_CONFIG.tileDepth + 0.16), 1);
  mesh.position.copy(normal.multiplyScalar(WORLD_CONFIG.sphereRadius + height / 2 - 0.16));
}

function onResize() {
  camera.aspect = mount.clientWidth / mount.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(mount.clientWidth, mount.clientHeight);
}

function animate() {
  requestAnimationFrame(animate);
  state.planetGroup.rotation.y += 0.001;
  controls.update();
  renderer.render(scene, camera);
}

function setStatus(text) {
  status.textContent = text;
}
