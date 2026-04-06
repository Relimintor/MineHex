import { BLOCK_TYPES, CHUNK_SIZE } from './config.js';
import { AXIAL_NEIGHBOR_OFFSETS, axialToWorld } from './coords.js';
import { createBlockMaterials } from './shaders/materials.js';
import { worldState } from './state.js';
import { isSolidTypeIndex, updateTopSolidHeightOnAdd, updateTopSolidHeightOnRemove } from './rules.js';
import { packBlockKey, unpackBlockKey } from './blockKey.js';

const blockMaterials = createBlockMaterials(BLOCK_TYPES);
const getChunkCoords = (q, r) => ({
    cq: Math.round(q / CHUNK_SIZE),
    cr: Math.round(r / CHUNK_SIZE)
});

const getChunkKey = (q, r) => {
    const { cq, cr } = getChunkCoords(q, r);
    return `${cq},${cr}`;
};

function trackRemovedBlock(q, r, h) {
    const key = packBlockKey(q, r, h);
    worldState.removedBlocks.add(key);
    const chunkKey = getChunkKey(q, r);
    if (!worldState.removedBlocksByChunk.has(chunkKey)) worldState.removedBlocksByChunk.set(chunkKey, new Set());
    worldState.removedBlocksByChunk.get(chunkKey).add(key);
}

function clearRemovedBlockMark(q, r, h) {
    const key = packBlockKey(q, r, h);
    if (!worldState.removedBlocks.has(key)) return;
    worldState.removedBlocks.delete(key);
    const chunkKey = getChunkKey(q, r);
    const removedChunkKeys = worldState.removedBlocksByChunk.get(chunkKey);
    if (!removedChunkKeys) return;
    removedChunkKeys.delete(key);
    if (removedChunkKeys.size === 0) worldState.removedBlocksByChunk.delete(chunkKey);
}

const NEIGHBOR_OFFSETS = AXIAL_NEIGHBOR_OFFSETS.map(({ q, r }) => [q, r]);
const AXIAL_SIDE_DIRECTIONS = AXIAL_NEIGHBOR_OFFSETS.map(({ q, r }) => [q, r, 0]);
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
    const { q, r, h } = unpackBlockKey(key);
    const parsed = { q, r, h };
    worldState.blockCoordsByKey.set(key, parsed);
    return parsed;
}

function createBlockRecord(q, r, h, key, typeIndex, isPermanent) {
    return {
        position: axialToWorld(q, r, h),
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        visible: true,
        userData: { q, r, h, key, isPermanent, typeIndex }
    };
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



function recordDirtyChunkOp(chunkKey, op, h) {
    if (!worldState.dirtyChunkOps.has(chunkKey)) {
        worldState.dirtyChunkOps.set(chunkKey, {
            addedHeights: new Set(),
            removedHeights: new Set(),
        });
    }
    const entry = worldState.dirtyChunkOps.get(chunkKey);
    if (op === 'add') entry.addedHeights.add(h);
    if (op === 'remove') entry.removedHeights.add(h);
}
function markChunkAndNeighborsDirty(q, r, op = null, h = null) {
    const { cq, cr } = getChunkCoords(q, r);

    const selfChunkKey = `${cq},${cr}`;
    worldState.dirtyChunks.add(selfChunkKey);
    const selfChunk = worldState.chunkMeta.get(selfChunkKey);
    if (selfChunk) selfChunk.dirty = true;
    if (op && Number.isFinite(h)) recordDirtyChunkOp(selfChunkKey, op, h);

    for (const neighborChunkKey of getNeighborChunkKeys(cq, cr)) {
        worldState.dirtyChunks.add(neighborChunkKey);

        const neighborChunk = worldState.chunkMeta.get(neighborChunkKey);
        if (neighborChunk) neighborChunk.dirty = true;
    }
}

function getBlockAt(q, r, h) {
    return worldState.worldBlocks.get(packBlockKey(q, r, h)) ?? null;
}

function isFaceVisible(q, r, h, [dq, dr, dh]) {
    const current = getBlockAt(q, r, h);
    if (!current) return false;

    const neighbor = getBlockAt(q + dq, r + dr, h + dh);
    if (!neighbor) return true;

    const currentType = BLOCK_TYPES[current.userData.typeIndex] ?? {};
    const neighborType = BLOCK_TYPES[neighbor.userData.typeIndex] ?? {};

    if (currentType.isLiquid) {
        // Liquids keep boundary faces when touching air, transparent blocks,
        // or any different material/liquid rule set.
        if (!neighborType.isLiquid) return true;
        if (neighbor.userData.typeIndex !== current.userData.typeIndex) return true;

        // Same liquid type next to this face => internal face culled.
        // (Top face still appears naturally when no liquid above.)
        return false;
    }

    if (neighborType.isLiquid || neighborType.transparent) return true;
    return false;
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
    const key = packBlockKey(q, r, h);
    const block = worldState.worldBlocks.get(key);
    if (!block) return;

    const visibleFaces = getVisibleFaces(q, r, h);
    const hasTopOrBottomExposure = isFaceVisible(q, r, h, [0, 0, 1]) || isFaceVisible(q, r, h, [0, 0, -1]);
    const hasSideExposure = AXIAL_SIDE_DIRECTIONS.some((direction) => isFaceVisible(q, r, h, direction));
    block.userData.hasExposedFace = hasTopOrBottomExposure || hasSideExposure;
    block.visible = block.userData.hasExposedFace;
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
            const targetKey = packBlockKey(targetQ, targetR, targetH);
            if (visited.has(targetKey)) continue;
            visited.add(targetKey);
            updateBlockVisibilityAt(targetQ, targetR, targetH);
        }
    }
}

export function addBlock(q, r, h, typeIndex, isPermanent = false, trackDirty = true, refreshVisibility = true) {
    const key = packBlockKey(q, r, h);
    if (worldState.worldBlocks.has(key)) return;

    const safeTypeIndex = blockMaterials[typeIndex] ? typeIndex : 0;
    const mesh = createBlockRecord(q, r, h, key, safeTypeIndex, isPermanent);
    worldState.blockCoordsByKey.set(key, { q, r, h });

    worldState.worldBlocks.set(key, mesh);

    const chunkKey = getChunkKey(q, r);
    if (!worldState.chunkBlocks.has(chunkKey)) worldState.chunkBlocks.set(chunkKey, new Set());
    worldState.chunkBlocks.get(chunkKey).add(key);

    updateTopSolidHeightOnAdd(q, r, h, safeTypeIndex);

    if (trackDirty) {
        markChunkAndNeighborsDirty(q, r, 'add', h);
    }

    if (refreshVisibility) {
        updateVisibilityAround(q, r, h);
    }

    if (isPermanent) {
        clearRemovedBlockMark(q, r, h);
        worldState.permanentBlocks.set(key, { q, r, h, typeIndex: safeTypeIndex });
        const chunkKey = getChunkKey(q, r);
        if (!worldState.permanentBlocksByChunk.has(chunkKey)) worldState.permanentBlocksByChunk.set(chunkKey, new Set());
        worldState.permanentBlocksByChunk.get(chunkKey).add(key);
    }

    return mesh;
}

export function removeBlock(key, { preservePermanent = false, force = false, trackDirty = true, refreshVisibility = true, trackRemoval = true } = {}) {
    const mesh = worldState.worldBlocks.get(key);
    if (mesh) {
        const blockType = BLOCK_TYPES[mesh.userData.typeIndex];
        if (blockType?.unbreakable && !force) return false;

        worldState.worldBlocks.delete(key);

        const chunkKey = getChunkKey(mesh.userData.q, mesh.userData.r);
        const chunkBlockSet = worldState.chunkBlocks.get(chunkKey);
        if (chunkBlockSet) {
            chunkBlockSet.delete(key);
            if (chunkBlockSet.size === 0) worldState.chunkBlocks.delete(chunkKey);
        }

        updateTopSolidHeightOnRemove(mesh.userData.q, mesh.userData.r, mesh.userData.h, mesh.userData.typeIndex);
        worldState.blockCoordsByKey.delete(key);

        if (trackDirty) {
            markChunkAndNeighborsDirty(mesh.userData.q, mesh.userData.r, 'remove', mesh.userData.h);
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

        if (!mesh.userData.isPermanent && trackRemoval) {
            trackRemovedBlock(mesh.userData.q, mesh.userData.r, mesh.userData.h);
        }
    }

    return true;
}


export function getBlockMaterial(typeIndex) {
    return blockMaterials[typeIndex] ?? blockMaterials[0];
}

export function collectChunkRaycastCandidates(centerQ, centerR, chunkRadius, outCandidates, { collidableOnly = false } = {}) {
    if (!Array.isArray(outCandidates)) return;
    outCandidates.length = 0;

    const { cq: centerChunkQ, cr: centerChunkR } = getChunkCoords(centerQ, centerR);
    for (let dq = -chunkRadius; dq <= chunkRadius; dq++) {
        for (let dr = -chunkRadius; dr <= chunkRadius; dr++) {
            const ds = -dq - dr;
            if (Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds)) > chunkRadius) continue;

            const chunkKey = `${centerChunkQ + dq},${centerChunkR + dr}`;
            const chunkMeta = worldState.chunkMeta.get(chunkKey);
            if (!chunkMeta) continue;

            const chunkMeshes = chunkMeta.lodLevel === 1
                ? (chunkMeta.instancedLodMeshes ?? [])
                : (chunkMeta.detailedChunkMeshes ?? []);

            for (const mesh of chunkMeshes) {
                if (!mesh?.visible) continue;
                if (collidableOnly && !isSolidTypeIndex(mesh.userData.typeIndex ?? 0)) continue;
                outCandidates.push(mesh);
            }
        }
    }
}

export function getIntersectedBlockKey(intersection) {
    const object = intersection?.object;
    if (!object) return null;

    const { instanceId } = intersection;
    if (typeof instanceId === 'number' && Array.isArray(object.userData?.instanceKeys)) {
        return object.userData.instanceKeys[instanceId] ?? null;
    }

    return object.userData?.key ?? null;
}
