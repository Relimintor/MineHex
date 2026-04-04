const THREE = window.THREE;

import { BLOCK_TYPES } from './config.js';
import { axialToWorld } from './coords.js';
import { hexGeometry } from './geometry.js';
import { scene } from './scene.js';
import { worldState } from './state.js';

export function addBlock(q, r, h, typeIndex, isPermanent = false) {
    const key = `${q},${r},${h}`;
    if (worldState.worldBlocks.has(key)) return;

    const material = new THREE.MeshLambertMaterial({ color: BLOCK_TYPES[typeIndex].color });
    const mesh = new THREE.Mesh(hexGeometry, material);
    const pos = axialToWorld(q, r, h);
    mesh.position.copy(pos);
    mesh.userData = { q, r, h, key, isPermanent };

    scene.add(mesh);
    worldState.worldBlocks.set(key, mesh);
    return mesh;
}

export function removeBlock(key) {
    const mesh = worldState.worldBlocks.get(key);
    if (mesh) {
        scene.remove(mesh);
        worldState.worldBlocks.delete(key);
    }
}
