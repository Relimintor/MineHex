import { CHUNK_SIZE, RENDER_DIST } from './config.js';
import { worldToAxial } from './coords.js';
import { camera } from './scene.js';
import { worldState } from './state.js';
import { addBlock, removeBlock } from './blocks.js';

const SEA_LEVEL = 0;
const CONTINENT_AMPLITUDE = 50;
const CONTINENT_FREQUENCY = 0.001;
const CONTINENT_OFFSET = 20;
const TERRAIN_AMPLITUDE = 8;
const TERRAIN_FREQUENCY = 0.02;

function getHeight(q, r) {
    const continent = CONTINENT_AMPLITUDE * worldState.simplex.noise2D(q * CONTINENT_FREQUENCY, r * CONTINENT_FREQUENCY) - CONTINENT_OFFSET;
    const terrain = TERRAIN_AMPLITUDE * worldState.simplex.noise2D(q * TERRAIN_FREQUENCY, r * TERRAIN_FREQUENCY);
    return Math.floor(continent + terrain);
}

export function generateChunk(cq, cr) {
    const chunkKey = `${cq},${cr}`;
    if (worldState.loadedChunks.has(chunkKey)) return;
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

                const height = getHeight(absQ, absR);
                const topKey = `${absQ},${absR},${height}`;
                const lowerKey = `${absQ},${absR},${height - 1}`;

                const topBlockType = height < SEA_LEVEL ? 1 : 0;
                if (!worldState.permanentBlocks.has(topKey)) addBlock(absQ, absR, height, topBlockType);
                if (!worldState.permanentBlocks.has(lowerKey)) addBlock(absQ, absR, height - 1, 1);
                if (worldState.worldBlocks.has(topKey)) chunkBlockKeys.add(topKey);
                if (worldState.worldBlocks.has(lowerKey)) chunkBlockKeys.add(lowerKey);

                if (height < SEA_LEVEL) {
                    const waterKey = `${absQ},${absR},${SEA_LEVEL}`;
                    if (!worldState.permanentBlocks.has(waterKey)) addBlock(absQ, absR, SEA_LEVEL, 4);
                    if (worldState.worldBlocks.has(waterKey)) chunkBlockKeys.add(waterKey);
                }
            }
        }
    }

    const permanentChunkKeys = worldState.permanentBlocksByChunk.get(chunkKey) ?? new Set();
    for (const key of permanentChunkKeys) {
        const permanentBlock = worldState.permanentBlocks.get(key);
        if (!permanentBlock) continue;

        addBlock(permanentBlock.q, permanentBlock.r, permanentBlock.h, permanentBlock.typeIndex, true);
        chunkBlockKeys.add(key);
    }
}

export function unloadChunk(cq, cr) {
    const chunkKey = `${cq},${cr}`;
    if (!worldState.loadedChunks.has(chunkKey)) return;

    const chunkBlockKeys = worldState.chunkBlocks.get(chunkKey) ?? new Set();
    for (const key of chunkBlockKeys) {
        removeBlock(key, { preservePermanent: true });
    }

    worldState.chunkBlocks.delete(chunkKey);
    worldState.loadedChunks.delete(chunkKey);
}


export function updateChunks() {
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
}
