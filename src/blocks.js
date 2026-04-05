const THREE = window.THREE;

import { BLOCK_TYPES, CHUNK_SIZE } from './config.js';
import { axialToWorld } from './coords.js';
import { hexGeometry } from './geometry.js';
import { scene } from './scene.js';
import { worldState } from './state.js';

const blockMaterials = BLOCK_TYPES.map((blockType) => new THREE.MeshLambertMaterial({
    color: blockType.color,
    transparent: blockType.transparent ?? false,
    opacity: blockType.opacity ?? 1,
    depthWrite: blockType.transparent ? false : true
}));
const getChunkCoords = (q, r) => ({
    cq: Math.round(q / CHUNK_SIZE),
    cr: Math.round(r / CHUNK_SIZE)
});

const getChunkKey = (q, r) => {
    const { cq, cr } = getChunkCoords(q, r);
    return `${cq},${cr}`;
};

const NEIGHBOR_OFFSETS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, -1],
    [-1, 1]
];

function getNeighborChunkKeys(cq, cr) {
    const chunk = worldState.chunkMeta.get(`${cq},${cr}`);
    if (chunk?.neighbors?.length) return chunk.neighbors;
    return NEIGHBOR_OFFSETS.map(([dq, dr]) => `${cq + dq},${cr + dr}`);
}

function markChunkAndNeighborsDirty(q, r) {
    const { cq, cr } = getChunkCoords(q, r);

    const selfChunkKey = `${cq},${cr}`;
    worldState.dirtyChunks.add(selfChunkKey);
    const selfChunk = worldState.chunkMeta.get(selfChunkKey);
    if (selfChunk) selfChunk.dirty = true;

    for (const neighborChunkKey of getNeighborChunkKeys(cq, cr)) {
        worldState.dirtyChunks.add(neighborChunkKey);

        const neighborChunk = worldState.chunkMeta.get(neighborChunkKey);
        if (neighborChunk) neighborChunk.dirty = true;
    }
}

export function addBlock(q, r, h, typeIndex, isPermanent = false, trackDirty = true) {
    const key = `${q},${r},${h}`;
    if (worldState.worldBlocks.has(key)) return;

    const safeTypeIndex = blockMaterials[typeIndex] ? typeIndex : 0;
    const mesh = new THREE.Mesh(hexGeometry, blockMaterials[safeTypeIndex]);
    const pos = axialToWorld(q, r, h);
    mesh.position.copy(pos);
    mesh.userData = { q, r, h, key, isPermanent, typeIndex: safeTypeIndex };

    scene.add(mesh);
    worldState.worldBlocks.set(key, mesh);

    if (trackDirty) {
        markChunkAndNeighborsDirty(q, r);
    }

    if (isPermanent) {
        worldState.permanentBlocks.set(key, { q, r, h, typeIndex: safeTypeIndex });
        const chunkKey = getChunkKey(q, r);
        if (!worldState.permanentBlocksByChunk.has(chunkKey)) worldState.permanentBlocksByChunk.set(chunkKey, new Set());
        worldState.permanentBlocksByChunk.get(chunkKey).add(key);
    }

    return mesh;
}

export function removeBlock(key, { preservePermanent = false, force = false, trackDirty = true } = {}) {
    const mesh = worldState.worldBlocks.get(key);
    if (mesh) {
        const blockType = BLOCK_TYPES[mesh.userData.typeIndex];
        if (blockType?.unbreakable && !force) return false;

        scene.remove(mesh);
        worldState.worldBlocks.delete(key);

        if (trackDirty) {
            markChunkAndNeighborsDirty(mesh.userData.q, mesh.userData.r);
        }

        if (mesh.userData.isPermanent && !preservePermanent) {
            worldState.permanentBlocks.delete(key);
            const chunkKey = getChunkKey(mesh.userData.q, mesh.userData.r);
            const chunkPermanentBlocks = worldState.permanentBlocksByChunk.get(chunkKey);
            if (chunkPermanentBlocks) {
                chunkPermanentBlocks.delete(key);
                if (chunkPermanentBlocks.size === 0) worldState.permanentBlocksByChunk.delete(chunkKey);
            }
        }
    }

    return true;
}
