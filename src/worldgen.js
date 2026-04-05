const THREE = window.THREE;

import { CHUNK_SIZE, HEX_HEIGHT, RENDER_DIST, NETHROCK_LEVEL_HEX } from './config.js';
import { axialToWorld, worldToAxial } from './coords.js';
import { camera } from './scene.js';
import { worldState } from './state.js';
import { addBlock, recomputeChunkGreedyFaceQuads, refreshBlockVisibilityForKeys, removeBlock } from './blocks.js';

const SEA_LEVEL = 0;
const CONTINENT_AMPLITUDE = 50;
const CONTINENT_FREQUENCY = 0.001;
const CONTINENT_OFFSET = 20;
const TERRAIN_MID_AMPLITUDE = 20;
const TERRAIN_MID_FREQUENCY = 0.01;
const TERRAIN_DETAIL_AMPLITUDE = 5;
const TERRAIN_DETAIL_FREQUENCY = 0.05;
const TEMPERATURE_FREQUENCY = 0.0005;
const MOISTURE_FREQUENCY = 0.0005;
const MOISTURE_OFFSET = 100;

const BLOCK_INDEX = {
    grass: 0,
    dirt: 1,
    stone: 2,
    water: 4,
    nethrock: 5,
    oakWood: 6,
    oakLeaves: 7,
    snow: 8,
    ice: 9
};

const CHUNK_NEIGHBOR_OFFSETS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, -1],
    [-1, 1]
];

function ensureChunkMeta(cq, cr) {
    const chunkKey = `${cq},${cr}`;
    if (worldState.chunkMeta.has(chunkKey)) return;

    const neighbors = CHUNK_NEIGHBOR_OFFSETS.map(([dq, dr]) => `${cq + dq},${cr + dr}`);
    worldState.chunkMeta.set(chunkKey, {
        dirty: false,
        neighbors,
        frustumVisible: true,
        bounds: null
    });
}

function recomputeChunkBounds(chunkKey) {
    const chunkBlockKeys = worldState.chunkBlocks.get(chunkKey);
    if (!chunkBlockKeys || chunkBlockKeys.size === 0) return null;

    const [cq, cr] = chunkKey.split(',').map(Number);
    const center = axialToWorld(cq * CHUNK_SIZE, cr * CHUNK_SIZE, 0);

    const rimSamples = [
        axialToWorld((cq * CHUNK_SIZE) + CHUNK_SIZE, cr * CHUNK_SIZE, 0),
        axialToWorld((cq * CHUNK_SIZE) - CHUNK_SIZE, cr * CHUNK_SIZE, 0),
        axialToWorld(cq * CHUNK_SIZE, (cr * CHUNK_SIZE) + CHUNK_SIZE, 0),
        axialToWorld(cq * CHUNK_SIZE, (cr * CHUNK_SIZE) - CHUNK_SIZE, 0),
        axialToWorld((cq * CHUNK_SIZE) + CHUNK_SIZE, (cr * CHUNK_SIZE) - CHUNK_SIZE, 0),
        axialToWorld((cq * CHUNK_SIZE) - CHUNK_SIZE, (cr * CHUNK_SIZE) + CHUNK_SIZE, 0)
    ];

    let planarRadius = 0;
    for (const sample of rimSamples) {
        const dx = sample.x - center.x;
        const dz = sample.z - center.z;
        planarRadius = Math.max(planarRadius, Math.hypot(dx, dz));
    }

    let minH = Infinity;
    let maxH = -Infinity;
    for (const blockKey of chunkBlockKeys) {
        const mesh = worldState.worldBlocks.get(blockKey);
        if (!mesh) continue;
        minH = Math.min(minH, mesh.userData.h);
        maxH = Math.max(maxH, mesh.userData.h);
    }

    if (!Number.isFinite(minH) || !Number.isFinite(maxH)) return null;
    const verticalRadius = ((maxH - minH + 1) * HEX_HEIGHT) / 2;
    const radius = Math.hypot(planarRadius, verticalRadius) + HEX_HEIGHT;

    return {
        center: center.clone().setY(((minH + maxH + 1) * HEX_HEIGHT) / 2),
        radius
    };
}

function applyChunkFrustumCulling() {
    const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(viewProjection);

    for (const chunkKey of worldState.loadedChunks) {
        const chunkMeta = worldState.chunkMeta.get(chunkKey);
        if (!chunkMeta) continue;

        if (!chunkMeta.bounds) chunkMeta.bounds = recomputeChunkBounds(chunkKey);
        const bounds = chunkMeta.bounds;
        const isVisible = bounds ? frustum.intersectsSphere(new THREE.Sphere(bounds.center, bounds.radius)) : true;

        if (chunkMeta.frustumVisible === isVisible) continue;
        chunkMeta.frustumVisible = isVisible;

        const chunkBlockKeys = worldState.chunkBlocks.get(chunkKey) ?? new Set();
        for (const blockKey of chunkBlockKeys) {
            const mesh = worldState.worldBlocks.get(blockKey);
            if (!mesh) continue;

            const hasVisibleFaces = !Array.isArray(mesh.userData.visibleFaces) || mesh.userData.visibleFaces.length > 0;
            mesh.visible = isVisible && hasVisibleFaces;
        }
    }
}

function getHeight(q, r) {
    const continent = CONTINENT_AMPLITUDE * worldState.simplex.noise2D(q * CONTINENT_FREQUENCY, r * CONTINENT_FREQUENCY) - CONTINENT_OFFSET;
    const terrain = (TERRAIN_MID_AMPLITUDE * worldState.simplex.noise2D(q * TERRAIN_MID_FREQUENCY, r * TERRAIN_MID_FREQUENCY))
        + (TERRAIN_DETAIL_AMPLITUDE * worldState.simplex.noise2D(q * TERRAIN_DETAIL_FREQUENCY, r * TERRAIN_DETAIL_FREQUENCY));
    return Math.floor(continent + terrain);
}

function smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - (2 * t));
}

function getSmoothedHeight(rawHeight) {
    const coastBlend = smoothstep(SEA_LEVEL - 3, SEA_LEVEL + 3, rawHeight);
    return Math.round((rawHeight * coastBlend) + (SEA_LEVEL * (1 - coastBlend)));
}

function getClimate(q, r) {
    return {
        temp: worldState.simplex.noise2D(q * TEMPERATURE_FREQUENCY, r * TEMPERATURE_FREQUENCY),
        moist: worldState.simplex.noise2D((q * MOISTURE_FREQUENCY) + MOISTURE_OFFSET, (r * MOISTURE_FREQUENCY) + MOISTURE_OFFSET)
    };
}

function normalizeWeights(weights) {
    const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
    if (total <= 0) return weights;

    const normalized = {};
    Object.entries(weights).forEach(([biome, value]) => {
        normalized[biome] = value / total;
    });
    return normalized;
}

function getBiomeWeights(temp, moist) {
    const cold = 1 - smoothstep(-0.3, 0.2, temp);
    const freezing = 1 - smoothstep(-0.75, -0.45, temp);
    const wet = smoothstep(-0.1, 0.15, moist);
    const dry = 1 - wet;
    const mountainness = smoothstep(-0.65, -0.45, -moist) * smoothstep(0.05, 0.3, temp);

    return normalizeWeights({
        plains: dry * (1 - cold) * (1 - mountainness),
        forest: wet * (1 - cold),
        snowy_plains: dry * cold * (1 - freezing),
        snowy_forest: wet * cold * (1 - freezing),
        arctic: freezing,
        mountains: mountainness * (1 - freezing)
    });
}

function getDominantBiome(biomeWeights) {
    let selected = 'plains';
    let bestWeight = -1;
    Object.entries(biomeWeights).forEach(([biome, weight]) => {
        if (weight > bestWeight) {
            selected = biome;
            bestWeight = weight;
        }
    });
    return selected;
}

function biomeHeightModifier(biomeWeights, q, r, baseHeight) {
    const mountainModifier = 30 * worldState.simplex.noise2D(q * 0.02, r * 0.02) * (biomeWeights.mountains ?? 0);
    const plainsModifier = -0.5 * baseHeight * (biomeWeights.plains ?? 0);
    return mountainModifier + plainsModifier;
}

function getBiomeAt(climateBiome, height) {
    if (height < SEA_LEVEL) return 'ocean';
    if (height < SEA_LEVEL + 2) return 'beach';
    return climateBiome;
}

function addGeneratedBlock(chunkBlockKeys, q, r, h, typeIndex) {
    const key = `${q},${r},${h}`;
    if (!worldState.permanentBlocks.has(key)) addBlock(q, r, h, typeIndex, false, false, false);
    if (worldState.worldBlocks.has(key)) chunkBlockKeys.add(key);
}

function applyDirtyChunks() {
    if (worldState.dirtyChunks.size === 0) return;

    const rebuiltChunkBlocks = new Map();
    for (const chunkKey of worldState.dirtyChunks) {
        if (!worldState.loadedChunks.has(chunkKey)) {
            worldState.chunkBlocks.delete(chunkKey);
            continue;
        }

        rebuiltChunkBlocks.set(chunkKey, new Set());
    }

    for (const [blockKey, mesh] of worldState.worldBlocks) {
        const chunkKey = `${Math.round(mesh.userData.q / CHUNK_SIZE)},${Math.round(mesh.userData.r / CHUNK_SIZE)}`;
        if (!rebuiltChunkBlocks.has(chunkKey)) continue;

        rebuiltChunkBlocks.get(chunkKey).add(blockKey);
    }

    for (const [chunkKey, chunkBlockKeys] of rebuiltChunkBlocks) {
        worldState.chunkBlocks.set(chunkKey, chunkBlockKeys);
        recomputeChunkGreedyFaceQuads(chunkKey);
        const chunk = worldState.chunkMeta.get(chunkKey);
        if (chunk) {
            chunk.dirty = false;
            chunk.bounds = recomputeChunkBounds(chunkKey);
        }
    }

    for (const chunkKey of worldState.dirtyChunks) {
        const chunk = worldState.chunkMeta.get(chunkKey);
        if (chunk) chunk.dirty = false;
    }

    worldState.dirtyChunks.clear();
}

function maybeAddTree(chunkBlockKeys, q, r, groundHeight, biome) {
    if (!(biome === 'forest' || biome === 'snowy_forest')) return;
    if (groundHeight <= SEA_LEVEL) return;

    const treeNoise = worldState.simplex.noise2D((q * 0.13) + 200, (r * 0.13) + 200);
    if (treeNoise < 0.72) return;

    addGeneratedBlock(chunkBlockKeys, q, r, groundHeight + 1, BLOCK_INDEX.oakWood);
    addGeneratedBlock(chunkBlockKeys, q, r, groundHeight + 2, BLOCK_INDEX.oakWood);
    addGeneratedBlock(chunkBlockKeys, q, r, groundHeight + 3, BLOCK_INDEX.oakLeaves);
    addGeneratedBlock(chunkBlockKeys, q + 1, r, groundHeight + 2, BLOCK_INDEX.oakLeaves);
    addGeneratedBlock(chunkBlockKeys, q - 1, r, groundHeight + 2, BLOCK_INDEX.oakLeaves);
    addGeneratedBlock(chunkBlockKeys, q, r + 1, groundHeight + 2, BLOCK_INDEX.oakLeaves);
    addGeneratedBlock(chunkBlockKeys, q, r - 1, groundHeight + 2, BLOCK_INDEX.oakLeaves);
}

export function generateChunk(cq, cr) {
    const chunkKey = `${cq},${cr}`;
    if (worldState.loadedChunks.has(chunkKey)) return;
    ensureChunkMeta(cq, cr);
    worldState.loadedChunks.add(chunkKey);
    worldState.chunkBlocks.set(chunkKey, new Set());
    const chunkBlockKeys = worldState.chunkBlocks.get(chunkKey);

    const centerQ = cq * CHUNK_SIZE;
    const centerR = cr * CHUNK_SIZE;

    for (let q = -CHUNK_SIZE; q <= CHUNK_SIZE; q++) {
        for (let r = -CHUNK_SIZE; r <= CHUNK_SIZE; r++) {
            if (Math.abs(q + r) <= CHUNK_SIZE) {
                const absQ = centerQ + q;
                const absR = centerR + r;

                const climate = getClimate(absQ, absR);
                const biomeWeights = getBiomeWeights(climate.temp, climate.moist);
                const climateBiome = getDominantBiome(biomeWeights);
                const baseHeight = getHeight(absQ, absR);
                const heightWithBiome = baseHeight + biomeHeightModifier(biomeWeights, absQ, absR, baseHeight);
                const height = getSmoothedHeight(heightWithBiome);
                const biome = getBiomeAt(climateBiome, height);
                const isSnowBiome = biome === 'snowy_plains' || biome === 'snowy_forest' || biome === 'arctic';
                const topBlockType = biome === 'beach'
                    ? BLOCK_INDEX.dirt
                    : (height < SEA_LEVEL ? BLOCK_INDEX.dirt : (isSnowBiome ? BLOCK_INDEX.snow : BLOCK_INDEX.grass));

                // Fill terrain columns with stone core + dirt/surface cap to avoid floating arches.
                for (let h = NETHROCK_LEVEL_HEX + 1; h <= height; h++) {
                    const blockKey = `${absQ},${absR},${h}`;
                    let blockType = BLOCK_INDEX.stone;
                    if (h === height) blockType = topBlockType;
                    else if (h >= height - 2) blockType = BLOCK_INDEX.dirt;

                    if (!worldState.permanentBlocks.has(blockKey)) addBlock(absQ, absR, h, blockType, false, false, false);
                    if (worldState.worldBlocks.has(blockKey)) chunkBlockKeys.add(blockKey);
                }

                const nethrockKey = `${absQ},${absR},${NETHROCK_LEVEL_HEX}`;
                if (!worldState.permanentBlocks.has(nethrockKey)) addBlock(absQ, absR, NETHROCK_LEVEL_HEX, BLOCK_INDEX.nethrock, false, false, false);
                if (worldState.worldBlocks.has(nethrockKey)) chunkBlockKeys.add(nethrockKey);

                if (biome === 'ocean') {
                    const waterKey = `${absQ},${absR},${SEA_LEVEL}`;
                    const surfaceFluidType = climate.temp < -0.6 ? BLOCK_INDEX.ice : BLOCK_INDEX.water;
                    if (!worldState.permanentBlocks.has(waterKey)) addBlock(absQ, absR, SEA_LEVEL, surfaceFluidType, false, false, false);
                    if (worldState.worldBlocks.has(waterKey)) chunkBlockKeys.add(waterKey);
                }

                maybeAddTree(chunkBlockKeys, absQ, absR, height, biome);
            }
        }
    }

    const permanentChunkKeys = worldState.permanentBlocksByChunk.get(chunkKey) ?? new Set();
    for (const key of permanentChunkKeys) {
        const permanentBlock = worldState.permanentBlocks.get(key);
        if (!permanentBlock) continue;

        addBlock(permanentBlock.q, permanentBlock.r, permanentBlock.h, permanentBlock.typeIndex, true, false, false);
        chunkBlockKeys.add(key);
    }

    refreshBlockVisibilityForKeys(chunkBlockKeys);
    recomputeChunkGreedyFaceQuads(chunkKey);
    const chunk = worldState.chunkMeta.get(chunkKey);
    if (chunk) chunk.bounds = recomputeChunkBounds(chunkKey);
}

export function unloadChunk(cq, cr) {
    const chunkKey = `${cq},${cr}`;
    if (!worldState.loadedChunks.has(chunkKey)) return;

    const chunkBlockKeys = worldState.chunkBlocks.get(chunkKey) ?? new Set();
    for (const key of chunkBlockKeys) {
        removeBlock(key, { preservePermanent: true, force: true, trackDirty: false });
    }

    worldState.chunkBlocks.delete(chunkKey);
    worldState.chunkFaceQuads.delete(chunkKey);
    worldState.loadedChunks.delete(chunkKey);
    worldState.dirtyChunks.delete(chunkKey);

    const chunk = worldState.chunkMeta.get(chunkKey);
    if (chunk) {
        chunk.dirty = false;
        chunk.bounds = null;
        chunk.frustumVisible = false;
    }
}


export function updateChunks() {
    applyDirtyChunks();

    const current = worldToAxial(camera.position);
    const cq = Math.round(current.q / CHUNK_SIZE);
    const cr = Math.round(current.r / CHUNK_SIZE);
    const visibleChunkKeys = new Set();

    for (let i = -RENDER_DIST; i <= RENDER_DIST; i++) {
        for (let j = -RENDER_DIST; j <= RENDER_DIST; j++) {
            const visibleCq = cq + i;
            const visibleCr = cr + j;
            visibleChunkKeys.add(`${visibleCq},${visibleCr}`);
            generateChunk(visibleCq, visibleCr);
        }
    }

    for (const chunkKey of Array.from(worldState.loadedChunks)) {
        if (visibleChunkKeys.has(chunkKey)) continue;

        const [chunkQ, chunkR] = chunkKey.split(',').map(Number);
        unloadChunk(chunkQ, chunkR);
    }

    applyChunkFrustumCulling();
}
