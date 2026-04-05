const THREE = window.THREE;

import { BLOCK_TYPES, CHUNK_SIZE } from './config.js';
import { axialToWorld } from './coords.js';
import { hexGeometry } from './geometry.js';
import { scene } from './scene.js';
import { worldState } from './state.js';
import { isSolidTypeIndex, updateTopSolidHeightOnAdd, updateTopSolidHeightOnRemove } from './rules.js';

const blockMaterials = BLOCK_TYPES.map((blockType) => new THREE.MeshLambertMaterial({
    color: blockType.color,
    transparent: blockType.transparent ?? false,
    opacity: blockType.opacity ?? 1,
    depthWrite: blockType.transparent ? false : true,
    // GPU backface culling layer:
    // triangles are rasterized only when their winding faces the camera
    // (equivalent to n·v < 0 for front-facing triangles).
    side: THREE.FrontSide
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
const FACE_DIRECTIONS = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1]
];


function parseBlockKey(key) {
    const cached = worldState.blockCoordsByKey.get(key);
    if (cached) return cached;
    const [q, r, h] = key.split(',').map(Number);
    const parsed = { q, r, h };
    worldState.blockCoordsByKey.set(key, parsed);
    return parsed;
}

function addMeshIndexes(mesh) {
    worldState.worldBlockList.push(mesh);
    mesh.userData.worldListIndex = worldState.worldBlockList.length - 1;
    if (isSolidTypeIndex(mesh.userData.typeIndex)) {
        worldState.collidableBlocks.add(mesh);
        worldState.collidableBlockList.push(mesh);
        mesh.userData.collidableListIndex = worldState.collidableBlockList.length - 1;
    }
}

function removeMeshIndexes(mesh) {
    const worldListIndex = mesh.userData.worldListIndex;
    if (worldListIndex !== undefined) {
        const last = worldState.worldBlockList.pop();
        if (worldListIndex < worldState.worldBlockList.length) {
            worldState.worldBlockList[worldListIndex] = last;
            last.userData.worldListIndex = worldListIndex;
        }
    }

    if (!worldState.collidableBlocks.has(mesh)) return;
    worldState.collidableBlocks.delete(mesh);
    const collidableIndex = mesh.userData.collidableListIndex;
    const lastCollidable = worldState.collidableBlockList.pop();
    if (collidableIndex !== undefined && collidableIndex < worldState.collidableBlockList.length) {
        worldState.collidableBlockList[collidableIndex] = lastCollidable;
        lastCollidable.userData.collidableListIndex = collidableIndex;
    }
}
const FACE_GEOMETRY = [
    {
        direction: [1, 0, 0],
        offsets: [
            [1, 0, 0],
            [1, 1, 0],
            [1, 1, 1],
            [1, 0, 1]
        ]
    },
    {
        direction: [-1, 0, 0],
        offsets: [
            [0, 0, 0],
            [0, 0, 1],
            [0, 1, 1],
            [0, 1, 0]
        ]
    },
    {
        direction: [0, 1, 0],
        offsets: [
            [0, 1, 0],
            [0, 1, 1],
            [1, 1, 1],
            [1, 1, 0]
        ]
    },
    {
        direction: [0, -1, 0],
        offsets: [
            [0, 0, 0],
            [1, 0, 0],
            [1, 0, 1],
            [0, 0, 1]
        ]
    },
    {
        direction: [0, 0, 1],
        offsets: [
            [0, 0, 1],
            [1, 0, 1],
            [1, 1, 1],
            [0, 1, 1]
        ]
    },
    {
        direction: [0, 0, -1],
        offsets: [
            [0, 0, 0],
            [0, 1, 0],
            [1, 1, 0],
            [1, 0, 0]
        ]
    }
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

function isSolidGlobal(q, r, h) {
    const blockKey = `${q},${r},${h}`;
    const chunkKey = getChunkKey(q, r);
    const chunkBlocks = worldState.chunkBlocks.get(chunkKey);

    // Chunk-boundary-aware lookup:
    // if i + d stays in this chunk we resolve locally via that chunk set;
    // otherwise we resolve via whichever neighbor chunk owns the coordinate.
    // getChunkKey(...) handles both cases from global coordinates.
    if (chunkBlocks?.has(blockKey)) return 1;
    return worldState.worldBlocks.has(blockKey) ? 1 : 0;
}

function isFaceVisible(q, r, h, [dq, dr, dh]) {
    // F(i, d) = O(i) * (1 - O(i + d))
    // A face belongs to the boundary only when current voxel is solid
    // and the neighboring voxel in direction d is empty.
    return isSolidGlobal(q, r, h) * (1 - isSolidGlobal(q + dq, r + dr, h + dh));
}

function getVisibleFaces(q, r, h) {
    const faces = [];
    for (const { direction, offsets } of FACE_GEOMETRY) {
        if (!isFaceVisible(q, r, h, direction)) continue;
        const vertices = offsets.map(([ox, oy, oz]) => [q + ox, r + oy, h + oz]);
        faces.push({ direction, vertices });
    }

    return faces;
}

function updateBlockVisibilityAt(q, r, h) {
    const key = `${q},${r},${h}`;
    const block = worldState.worldBlocks.get(key);
    if (!block) return;

    const visibleFaces = getVisibleFaces(q, r, h);
    block.visible = visibleFaces.length > 0;
    block.userData.visibleFaces = visibleFaces;
}

function updateVisibilityAround(q, r, h) {
    updateBlockVisibilityAt(q, r, h);
    for (const [dq, dr, dh] of FACE_DIRECTIONS) {
        updateBlockVisibilityAt(q + dq, r + dr, h + dh);
    }
}

function buildFaceCell(blockMesh, direction) {
    const { q, r, h, typeIndex } = blockMesh.userData;
    const [dx, dy, dz] = direction;

    if (dx !== 0) {
        return {
            plane: 'x',
            planeValue: q + (dx > 0 ? 1 : 0),
            u: r,
            v: h,
            direction,
            typeIndex
        };
    }

    if (dy !== 0) {
        return {
            plane: 'y',
            planeValue: r + (dy > 0 ? 1 : 0),
            u: q,
            v: h,
            direction,
            typeIndex
        };
    }

    return {
        plane: 'z',
        planeValue: h + (dz > 0 ? 1 : 0),
        u: q,
        v: r,
        direction,
        typeIndex
    };
}

function greedyMergeCells(cells, direction, plane, planeValue, typeIndex) {
    const byU = new Map();
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;

    for (const cell of cells) {
        if (!byU.has(cell.u)) byU.set(cell.u, new Set());
        byU.get(cell.u).add(cell.v);
        minU = Math.min(minU, cell.u);
        maxU = Math.max(maxU, cell.u);
        minV = Math.min(minV, cell.v);
        maxV = Math.max(maxV, cell.v);
    }

    const visited = new Set();
    const quads = [];
    const keyOf = (u, v) => `${u},${v}`;

    for (let u = minU; u <= maxU; u++) {
        for (let v = minV; v <= maxV; v++) {
            if (!byU.get(u)?.has(v)) continue;
            const startKey = keyOf(u, v);
            if (visited.has(startKey)) continue;

            let width = 1;
            while (byU.get(u + width)?.has(v) && !visited.has(keyOf(u + width, v))) width++;

            let height = 1;
            let canExtend = true;
            while (canExtend) {
                const nextV = v + height;
                for (let du = 0; du < width; du++) {
                    const testU = u + du;
                    if (!byU.get(testU)?.has(nextV) || visited.has(keyOf(testU, nextV))) {
                        canExtend = false;
                        break;
                    }
                }
                if (canExtend) height++;
            }

            for (let du = 0; du < width; du++) {
                for (let dv = 0; dv < height; dv++) {
                    visited.add(keyOf(u + du, v + dv));
                }
            }

            quads.push({
                direction,
                plane,
                planeValue,
                origin: [u, v],
                span: [width, height],
                typeIndex,
                uvRepeat: [width, height]
            });
        }
    }

    return quads;
}

export function recomputeChunkGreedyFaceQuads(chunkKey) {
    const chunkBlockKeys = worldState.chunkBlocks.get(chunkKey);
    if (!chunkBlockKeys || chunkBlockKeys.size === 0) {
        worldState.chunkFaceQuads.delete(chunkKey);
        return;
    }

    const faceGroups = new Map();

    for (const blockKey of chunkBlockKeys) {
        const blockMesh = worldState.worldBlocks.get(blockKey);
        if (!blockMesh || !Array.isArray(blockMesh.userData.visibleFaces)) continue;

        for (const face of blockMesh.userData.visibleFaces) {
            const cell = buildFaceCell(blockMesh, face.direction);
            const groupKey = `${cell.plane}:${cell.planeValue}:${cell.direction.join(',')}:${cell.typeIndex}`;
            if (!faceGroups.has(groupKey)) faceGroups.set(groupKey, []);
            faceGroups.get(groupKey).push(cell);
        }
    }

    const mergedQuads = [];
    for (const [groupKey, cells] of faceGroups) {
        if (cells.length === 0) continue;
        const [plane, planeValueRaw] = groupKey.split(':');
        const { direction, typeIndex } = cells[0];
        const planeValue = Number(planeValueRaw);
        const quads = greedyMergeCells(cells, direction, plane, planeValue, typeIndex);
        mergedQuads.push(...quads);
    }

    worldState.chunkFaceQuads.set(chunkKey, mergedQuads);
}

export function refreshBlockVisibilityForKeys(blockKeys) {
    const visited = new Set();

    for (const key of blockKeys) {
        const { q, r, h } = parseBlockKey(key);
        const targets = [[q, r, h], ...FACE_DIRECTIONS.map(([dq, dr, dh]) => [q + dq, r + dr, h + dh])];

        for (const [targetQ, targetR, targetH] of targets) {
            const targetKey = `${targetQ},${targetR},${targetH}`;
            if (visited.has(targetKey)) continue;
            visited.add(targetKey);
            updateBlockVisibilityAt(targetQ, targetR, targetH);
        }
    }
}

export function addBlock(q, r, h, typeIndex, isPermanent = false, trackDirty = true, refreshVisibility = true) {
    const key = `${q},${r},${h}`;
    if (worldState.worldBlocks.has(key)) return;

    const safeTypeIndex = blockMaterials[typeIndex] ? typeIndex : 0;
    const mesh = new THREE.Mesh(hexGeometry, blockMaterials[safeTypeIndex]);
    const pos = axialToWorld(q, r, h);
    mesh.position.copy(pos);
    mesh.userData = { q, r, h, key, isPermanent, typeIndex: safeTypeIndex };
    worldState.blockCoordsByKey.set(key, { q, r, h });

    scene.add(mesh);
    worldState.worldBlocks.set(key, mesh);
    addMeshIndexes(mesh);

    const chunkKey = getChunkKey(q, r);
    if (!worldState.chunkBlocks.has(chunkKey)) worldState.chunkBlocks.set(chunkKey, new Set());
    worldState.chunkBlocks.get(chunkKey).add(key);

    updateTopSolidHeightOnAdd(q, r, h, safeTypeIndex);

    if (trackDirty) {
        markChunkAndNeighborsDirty(q, r);
    }

    if (refreshVisibility) {
        updateVisibilityAround(q, r, h);
    }

    if (isPermanent) {
        worldState.permanentBlocks.set(key, { q, r, h, typeIndex: safeTypeIndex });
        const chunkKey = getChunkKey(q, r);
        if (!worldState.permanentBlocksByChunk.has(chunkKey)) worldState.permanentBlocksByChunk.set(chunkKey, new Set());
        worldState.permanentBlocksByChunk.get(chunkKey).add(key);
    }

    return mesh;
}

export function removeBlock(key, { preservePermanent = false, force = false, trackDirty = true, refreshVisibility = true } = {}) {
    const mesh = worldState.worldBlocks.get(key);
    if (mesh) {
        const blockType = BLOCK_TYPES[mesh.userData.typeIndex];
        if (blockType?.unbreakable && !force) return false;

        scene.remove(mesh);
        worldState.worldBlocks.delete(key);
        removeMeshIndexes(mesh);

        const chunkKey = getChunkKey(mesh.userData.q, mesh.userData.r);
        const chunkBlockSet = worldState.chunkBlocks.get(chunkKey);
        if (chunkBlockSet) {
            chunkBlockSet.delete(key);
            if (chunkBlockSet.size === 0) worldState.chunkBlocks.delete(chunkKey);
        }

        updateTopSolidHeightOnRemove(mesh.userData.q, mesh.userData.r, mesh.userData.h, mesh.userData.typeIndex);
        worldState.blockCoordsByKey.delete(key);

        if (trackDirty) {
            markChunkAndNeighborsDirty(mesh.userData.q, mesh.userData.r);
        }

        if (refreshVisibility) {
            updateVisibilityAround(mesh.userData.q, mesh.userData.r, mesh.userData.h);
        }

        if (mesh.userData.isPermanent && !preservePermanent) {
            worldState.permanentBlocks.delete(key);
            const chunkPermanentBlocks = worldState.permanentBlocksByChunk.get(chunkKey);
            if (chunkPermanentBlocks) {
                chunkPermanentBlocks.delete(key);
                if (chunkPermanentBlocks.size === 0) worldState.permanentBlocksByChunk.delete(chunkKey);
            }
        }
    }

    return true;
}


export function getBlockMaterial(typeIndex) {
    return blockMaterials[typeIndex] ?? blockMaterials[0];
}
