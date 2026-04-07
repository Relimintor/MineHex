import { BLOCK_TYPES, CHUNK_SIZE } from './config.js';
import { AXIAL_NEIGHBOR_OFFSETS, axialToWorld } from './coords.js';
import { normalizeBlockKey, normalizeChunkKey, packBlockKey, packChunkKey, packColumnKey, unpackBlockKey } from './keys.js';
import { createBlockMaterials } from './shaders/materials.js';
import { worldState } from './state.js';
import { isSolidTypeIndex, updateTopSolidHeightOnAdd, updateTopSolidHeightOnRemove } from './rules.js';

const blockMaterials = createBlockMaterials(BLOCK_TYPES);
const getChunkCoords = (q, r) => ({
    cq: Math.round(q / CHUNK_SIZE),
    cr: Math.round(r / CHUNK_SIZE)
});

const getChunkKey = (q, r) => {
    const { cq, cr } = getChunkCoords(q, r);
    return packChunkKey(cq, cr);
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
const FACE_DIRECTIONS = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1]
];
const TOP_FACE_MASK = 1 << 4;


function parseBlockKey(key) {
    const normalizedKey = normalizeBlockKey(key);
    const cached = worldState.blockCoordsByKey.get(normalizedKey);
    if (cached) return cached;
    const parsed = unpackBlockKey(normalizedKey);
    worldState.blockCoordsByKey.set(normalizedKey, parsed);
    return parsed;
}

function createBlockRecord(q, r, h, key, typeIndex, isPermanent) {
    return {
        position: axialToWorld(q, r, h),
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
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
const FACE_INDEX_BY_DIRECTION = new Map(FACE_GEOMETRY.map((face, idx) => [face.direction.join(','), idx]));
const INITIAL_CHUNK_BLOCK_CAPACITY = 256;

function createChunkBlockData(capacity = INITIAL_CHUNK_BLOCK_CAPACITY) {
    return {
        count: 0,
        keys: new Array(capacity),
        keyToIndex: new Map(),
        typeByIndex: new Uint16Array(capacity),
        exposedFaceMaskByIndex: new Uint8Array(capacity),
        topSolidHeightDeltaByIndex: new Int16Array(capacity)
    };
}

function ensureChunkBlockData(chunkKey) {
    const normalizedChunkKey = normalizeChunkKey(chunkKey);
    if (worldState.chunkBlockData.has(normalizedChunkKey)) return worldState.chunkBlockData.get(normalizedChunkKey);
    const created = createChunkBlockData();
    worldState.chunkBlockData.set(normalizedChunkKey, created);
    return created;
}

function growChunkBlockData(chunkData) {
    const nextCapacity = chunkData.typeByIndex.length * 2;
    const nextType = new Uint16Array(nextCapacity);
    nextType.set(chunkData.typeByIndex);
    chunkData.typeByIndex = nextType;

    const nextFaceMask = new Uint8Array(nextCapacity);
    nextFaceMask.set(chunkData.exposedFaceMaskByIndex);
    chunkData.exposedFaceMaskByIndex = nextFaceMask;

    const nextTopDelta = new Int16Array(nextCapacity);
    nextTopDelta.set(chunkData.topSolidHeightDeltaByIndex);
    chunkData.topSolidHeightDeltaByIndex = nextTopDelta;
    chunkData.keys.length = nextCapacity;
}

function getTypeIndexAtKey(blockKey) {
    const indexRef = worldState.blockIndexByKey.get(blockKey);
    if (!indexRef) return -1;
    const chunkData = worldState.chunkBlockData.get(indexRef.chunkKey);
    if (!chunkData) return -1;
    return chunkData.typeByIndex[indexRef.index];
}

function getFaceMaskAtKey(blockKey) {
    const indexRef = worldState.blockIndexByKey.get(blockKey);
    if (!indexRef) return 0;
    const chunkData = worldState.chunkBlockData.get(indexRef.chunkKey);
    if (!chunkData) return 0;
    return chunkData.exposedFaceMaskByIndex[indexRef.index];
}

function setFaceMaskAtKey(blockKey, faceMask) {
    const indexRef = worldState.blockIndexByKey.get(blockKey);
    if (!indexRef) return;
    const chunkData = worldState.chunkBlockData.get(indexRef.chunkKey);
    if (!chunkData) return;
    chunkData.exposedFaceMaskByIndex[indexRef.index] = faceMask;
}

function setTopSolidDeltaAtKey(blockKey, delta) {
    const indexRef = worldState.blockIndexByKey.get(blockKey);
    if (!indexRef) return;
    const chunkData = worldState.chunkBlockData.get(indexRef.chunkKey);
    if (!chunkData) return;
    chunkData.topSolidHeightDeltaByIndex[indexRef.index] = Math.max(-32768, Math.min(32767, delta));
}

function getNeighborChunkKeys(cq, cr) {
    const chunk = worldState.chunkMeta.get(packChunkKey(cq, cr));
    if (chunk?.neighbors?.length) return chunk.neighbors;
    return NEIGHBOR_OFFSETS.map(([dq, dr]) => packChunkKey(cq + dq, cr + dr));
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

    const selfChunkKey = packChunkKey(cq, cr);
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

function upsertChunkSimBlock(chunkKey, blockKey, typeIndex) {
    const normalizedChunkKey = normalizeChunkKey(chunkKey);
    const chunkData = ensureChunkBlockData(normalizedChunkKey);
    const existingIndex = chunkData.keyToIndex.get(blockKey);
    if (existingIndex !== undefined) {
        chunkData.typeByIndex[existingIndex] = typeIndex;
        return existingIndex;
    }

    if (chunkData.count >= chunkData.typeByIndex.length) growChunkBlockData(chunkData);
    const index = chunkData.count++;
    chunkData.keys[index] = blockKey;
    chunkData.keyToIndex.set(blockKey, index);
    chunkData.typeByIndex[index] = typeIndex;
    chunkData.exposedFaceMaskByIndex[index] = 0;
    chunkData.topSolidHeightDeltaByIndex[index] = 0;
    worldState.blockIndexByKey.set(blockKey, { chunkKey: normalizedChunkKey, index });
    return index;
}

function removeChunkSimBlock(chunkKey, blockKey) {
    const normalizedChunkKey = normalizeChunkKey(chunkKey);
    const chunkData = worldState.chunkBlockData.get(normalizedChunkKey);
    if (!chunkData) return;
    const index = chunkData.keyToIndex.get(blockKey);
    if (index === undefined) return;

    const lastIndex = chunkData.count - 1;
    if (index !== lastIndex) {
        const movedKey = chunkData.keys[lastIndex];
        chunkData.keys[index] = movedKey;
        chunkData.typeByIndex[index] = chunkData.typeByIndex[lastIndex];
        chunkData.exposedFaceMaskByIndex[index] = chunkData.exposedFaceMaskByIndex[lastIndex];
        chunkData.topSolidHeightDeltaByIndex[index] = chunkData.topSolidHeightDeltaByIndex[lastIndex];
        chunkData.keyToIndex.set(movedKey, index);
        worldState.blockIndexByKey.set(movedKey, { chunkKey: normalizedChunkKey, index });
    }

    chunkData.keyToIndex.delete(blockKey);
    worldState.blockIndexByKey.delete(blockKey);
    chunkData.keys[lastIndex] = undefined;
    chunkData.count = lastIndex;

    if (chunkData.count === 0) {
        worldState.chunkBlockData.delete(normalizedChunkKey);
    }
}

function isFaceVisibleForTypes(currentTypeIndex, neighborTypeIndex) {
    const currentType = BLOCK_TYPES[currentTypeIndex] ?? {};
    const neighborType = neighborTypeIndex >= 0 ? (BLOCK_TYPES[neighborTypeIndex] ?? {}) : null;
    if (!neighborType) return true;
    if (currentType.isLiquid) {
        if (!neighborType.isLiquid) return true;
        if (neighborTypeIndex !== currentTypeIndex) return true;
        return false;
    }

    if (neighborType.isLiquid || neighborType.transparent) return true;
    return false;
}

function computeVisibleFaceMask(q, r, h, typeIndex) {
    let faceMask = 0;
    for (let faceIdx = 0; faceIdx < FACE_DIRECTIONS.length; faceIdx++) {
        const [dq, dr, dh] = FACE_DIRECTIONS[faceIdx];
        const neighborTypeIndex = getTypeIndexAtKey(packBlockKey(q + dq, r + dr, h + dh));
        if (isFaceVisibleForTypes(typeIndex, neighborTypeIndex)) {
            faceMask |= (1 << faceIdx);
        }
    }
    return faceMask;
}

function isFaceVisible(q, r, h, direction) {
    const key = packBlockKey(q, r, h);
    const mask = getFaceMaskAtKey(key);
    const idx = FACE_INDEX_BY_DIRECTION.get(direction.join(','));
    if (idx === undefined || idx < 0) return false;
    return (mask & (1 << idx)) !== 0;
}

function getVisibleFaces(q, r, h) {
    const key = packBlockKey(q, r, h);
    const mask = getFaceMaskAtKey(key);
    const faces = [];
    for (let faceIdx = 0; faceIdx < FACE_GEOMETRY.length; faceIdx++) {
        if ((mask & (1 << faceIdx)) === 0) continue;
        const { direction, offsets } = FACE_GEOMETRY[faceIdx];
        faces.push({
            direction,
            vertices: offsets.map(([ox, oy, oz]) => [q + ox, r + oy, h + oz])
        });
    }
    return faces;
}

function updateFaceMaskBit(blockKey, faceIdx, visible) {
    const currentMask = getFaceMaskAtKey(blockKey);
    const nextMask = visible ? (currentMask | (1 << faceIdx)) : (currentMask & ~(1 << faceIdx));
    if (nextMask !== currentMask) setFaceMaskAtKey(blockKey, nextMask);
}

function updateVisibilityPairAtFace(q, r, h, faceIdx) {
    const blockKey = packBlockKey(q, r, h);
    const selfTypeIndex = getTypeIndexAtKey(blockKey);
    const [dq, dr, dh] = FACE_DIRECTIONS[faceIdx];
    const neighborKey = packBlockKey(q + dq, r + dr, h + dh);
    const neighborTypeIndex = getTypeIndexAtKey(neighborKey);
    const oppositeFaceIdx = faceIdx ^ 1;

    if (selfTypeIndex < 0) {
        if (neighborTypeIndex >= 0) updateFaceMaskBit(neighborKey, oppositeFaceIdx, true);
        return;
    }

    updateFaceMaskBit(blockKey, faceIdx, isFaceVisibleForTypes(selfTypeIndex, neighborTypeIndex));

    if (neighborTypeIndex < 0) return;
    updateFaceMaskBit(neighborKey, oppositeFaceIdx, isFaceVisibleForTypes(neighborTypeIndex, selfTypeIndex));
}

function updateBlockVisibilityAt(q, r, h) {
    const key = packBlockKey(q, r, h);
    const typeIndex = getTypeIndexAtKey(key);
    if (typeIndex < 0) return;
    setFaceMaskAtKey(key, computeVisibleFaceMask(q, r, h, typeIndex));
}

function updateVisibilityAround(q, r, h) {
    for (let faceIdx = 0; faceIdx < FACE_DIRECTIONS.length; faceIdx++) {
        updateVisibilityPairAtFace(q, r, h, faceIdx);
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
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;

    for (const cell of cells) {
        minU = Math.min(minU, cell.u);
        maxU = Math.max(maxU, cell.u);
        minV = Math.min(minV, cell.v);
        maxV = Math.max(maxV, cell.v);
    }

    if (!Number.isFinite(minU) || !Number.isFinite(minV) || !Number.isFinite(maxU) || !Number.isFinite(maxV)) return [];

    const gridWidth = (maxU - minU) + 1;
    const gridHeight = (maxV - minV) + 1;
    const gridSize = gridWidth * gridHeight;
    const occupied = new Uint8Array(gridSize);
    const visited = new Uint8Array(gridSize);
    const quads = [];
    const toIndex = (u, v) => ((v - minV) * gridWidth) + (u - minU);

    for (const cell of cells) {
        occupied[toIndex(cell.u, cell.v)] = 1;
    }

    for (let v = minV; v <= maxV; v++) {
        for (let u = minU; u <= maxU; u++) {
            const startIndex = toIndex(u, v);
            if (occupied[startIndex] === 0 || visited[startIndex] === 1) continue;

            let width = 0;
            while ((u + width) <= maxU) {
                const idx = toIndex(u + width, v);
                if (occupied[idx] === 0 || visited[idx] === 1) break;
                width++;
            }

            let height = 1;
            while ((v + height) <= maxV) {
                let canExtend = true;
                for (let du = 0; du < width; du++) {
                    const idx = toIndex(u + du, v + height);
                    if (occupied[idx] === 0 || visited[idx] === 1) {
                        canExtend = false;
                        break;
                    }
                }
                if (!canExtend) break;
                height++;
            }

            for (let dv = 0; dv < height; dv++) {
                for (let du = 0; du < width; du++) {
                    visited[toIndex(u + du, v + dv)] = 1;
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
    const chunkData = worldState.chunkBlockData.get(chunkKey);
    if (!chunkBlockKeys || chunkBlockKeys.size === 0) {
        worldState.chunkFaceQuads.delete(chunkKey);
        worldState.chunkRenderBatches.delete(chunkKey);
        return;
    }
    if (!chunkData || chunkData.count === 0) {
        worldState.chunkFaceQuads.delete(chunkKey);
        worldState.chunkRenderBatches.delete(chunkKey);
        return;
    }

    const faceGroups = new Map();
    const perType = new Map();

    for (const blockKey of chunkBlockKeys) {
        const blockMesh = worldState.worldBlocks.get(blockKey);
        if (!blockMesh) continue;
        const typeIndex = getTypeIndexAtKey(blockKey);
        if (typeIndex < 0) continue;
        const faceMask = getFaceMaskAtKey(blockKey);
        if (faceMask === 0) continue;

        if (!perType.has(typeIndex)) {
            perType.set(typeIndex, {
                allPositions: [],
                allKeys: [],
                topPositions: [],
                topKeys: []
            });
        }
        const perTypeBucket = perType.get(typeIndex);
        const { x, y, z } = blockMesh.position;
        perTypeBucket.allPositions.push(x, y, z);
        perTypeBucket.allKeys.push(blockKey);

        if ((faceMask & TOP_FACE_MASK) !== 0) {
            perTypeBucket.topPositions.push(x, y, z);
            perTypeBucket.topKeys.push(blockKey);
        }

        for (let faceIdx = 0; faceIdx < FACE_GEOMETRY.length; faceIdx++) {
            if ((faceMask & (1 << faceIdx)) === 0) continue;
            const face = FACE_GEOMETRY[faceIdx];
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
    if (perType.size === 0) {
        worldState.chunkRenderBatches.delete(chunkKey);
        return;
    }

    const renderBatches = [];
    for (const [typeIndex, bucket] of perType) {
        renderBatches.push({
            typeIndex,
            allPositions: new Float32Array(bucket.allPositions),
            allKeys: bucket.allKeys,
            topPositions: new Float32Array(bucket.topPositions),
            topKeys: bucket.topKeys
        });
    }
    worldState.chunkRenderBatches.set(chunkKey, renderBatches);
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
    if (worldState.blockIndexByKey.has(key)) return;

    const safeTypeIndex = blockMaterials[typeIndex] ? typeIndex : 0;
    const mesh = createBlockRecord(q, r, h, key, safeTypeIndex, isPermanent);
    worldState.blockCoordsByKey.set(key, { q, r, h });

    const chunkKey = getChunkKey(q, r);
    upsertChunkSimBlock(chunkKey, key, safeTypeIndex);
    if (!worldState.chunkBlocks.has(chunkKey)) worldState.chunkBlocks.set(chunkKey, new Set());
    worldState.chunkBlocks.get(chunkKey).add(key);

    const columnKey = packColumnKey(q, r);
    const topBefore = worldState.topSolidHeightByColumn.get(columnKey) ?? (h - 1);
    updateTopSolidHeightOnAdd(q, r, h, safeTypeIndex);
    const topAfter = worldState.topSolidHeightByColumn.get(columnKey) ?? (h - 1);
    setTopSolidDeltaAtKey(key, topAfter - topBefore);

    worldState.worldBlocks.set(key, mesh);

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
    const normalizedKey = normalizeBlockKey(key);
    const mesh = worldState.worldBlocks.get(normalizedKey);
    if (mesh) {
        const simTypeIndex = getTypeIndexAtKey(normalizedKey);
        const blockType = BLOCK_TYPES[simTypeIndex >= 0 ? simTypeIndex : mesh.userData.typeIndex];
        if (blockType?.unbreakable && !force) return false;

        worldState.worldBlocks.delete(normalizedKey);

        const chunkKey = getChunkKey(mesh.userData.q, mesh.userData.r);
        const chunkBlockSet = worldState.chunkBlocks.get(chunkKey);
        if (chunkBlockSet) {
            chunkBlockSet.delete(normalizedKey);
            if (chunkBlockSet.size === 0) worldState.chunkBlocks.delete(chunkKey);
        }

        const columnKey = packColumnKey(mesh.userData.q, mesh.userData.r);
        const topBefore = worldState.topSolidHeightByColumn.get(columnKey) ?? mesh.userData.h;
        updateTopSolidHeightOnRemove(mesh.userData.q, mesh.userData.r, mesh.userData.h, simTypeIndex >= 0 ? simTypeIndex : mesh.userData.typeIndex);
        const topAfter = worldState.topSolidHeightByColumn.get(columnKey) ?? (mesh.userData.h - 1);
        setTopSolidDeltaAtKey(normalizedKey, topAfter - topBefore);
        removeChunkSimBlock(chunkKey, normalizedKey);
        worldState.blockCoordsByKey.delete(normalizedKey);

        if (trackDirty) {
            markChunkAndNeighborsDirty(mesh.userData.q, mesh.userData.r, 'remove', mesh.userData.h);
        }

        if (refreshVisibility) {
            updateVisibilityAround(mesh.userData.q, mesh.userData.r, mesh.userData.h);
        }

        if (mesh.userData.isPermanent && !preservePermanent) {
            worldState.permanentBlocks.delete(normalizedKey);
            const chunkPermanentBlocks = worldState.permanentBlocksByChunk.get(chunkKey);
            if (chunkPermanentBlocks) {
                chunkPermanentBlocks.delete(normalizedKey);
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

export function getBlockTypeIndexAt(q, r, h) {
    return getTypeIndexAtKey(packBlockKey(q, r, h));
}

const raycastCandidateCache = new Map();
const chunkAabbTestRay = new THREE.Ray();
const chunkAabbHitPoint = new THREE.Vector3();

function doesChunkBoundsIntersectRayRange(bounds, rayOrigin, rayDirection, rayNear, rayFar) {
    if (!bounds || !rayOrigin || !rayDirection) return true;
    chunkAabbTestRay.origin.copy(rayOrigin);
    chunkAabbTestRay.direction.copy(rayDirection);
    const hitPoint = chunkAabbTestRay.intersectBox(bounds, chunkAabbHitPoint);
    if (!hitPoint) return false;
    const hitDistance = rayOrigin.distanceTo(hitPoint);
    return hitDistance >= rayNear && hitDistance <= rayFar;
}

export function collectChunkRaycastCandidates(centerQ, centerR, chunkRadius, outCandidates, {
    collidableOnly = false,
    cacheKey = '',
    reuseFrames = 0,
    rayOrigin = null,
    rayDirection = null,
    rayNear = 0,
    rayFar = Number.POSITIVE_INFINITY
} = {}) {
    if (!Array.isArray(outCandidates)) return;
    outCandidates.length = 0;

    const { cq: centerChunkQ, cr: centerChunkR } = getChunkCoords(centerQ, centerR);
    const normalizedRayNear = Math.max(0, rayNear);
    const normalizedRayFar = Math.max(normalizedRayNear, rayFar);
    const nowFrame = worldState.frame ?? 0;
    if (cacheKey) {
        const cached = raycastCandidateCache.get(cacheKey);
        if (
            cached
            && cached.centerChunkQ === centerChunkQ
            && cached.centerChunkR === centerChunkR
            && cached.chunkRadius === chunkRadius
            && cached.collidableOnly === collidableOnly
            && (nowFrame - cached.frame) <= reuseFrames
        ) {
            outCandidates.push(...cached.candidates);
            return;
        }
    }

    for (let dq = -chunkRadius; dq <= chunkRadius; dq++) {
        for (let dr = -chunkRadius; dr <= chunkRadius; dr++) {
            const ds = -dq - dr;
            if (Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds)) > chunkRadius) continue;

            const chunkKey = packChunkKey(centerChunkQ + dq, centerChunkR + dr);
            const chunkMeta = worldState.chunkMeta.get(chunkKey);
            if (!chunkMeta) continue;
            if (!doesChunkBoundsIntersectRayRange(chunkMeta.bounds, rayOrigin, rayDirection, normalizedRayNear, normalizedRayFar)) continue;

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

    if (cacheKey) {
        raycastCandidateCache.set(cacheKey, {
            frame: nowFrame,
            centerChunkQ,
            centerChunkR,
            chunkRadius,
            collidableOnly,
            candidates: outCandidates.slice()
        });
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
