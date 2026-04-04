import { CHUNK_SIZE, RENDER_DIST } from './config.js';
import { worldToAxial } from './coords.js';
import { camera } from './scene.js';
import { worldState } from './state.js';
import { addBlock } from './blocks.js';

export function generateChunk(cq, cr) {
    const chunkKey = `${cq},${cr}`;
    if (worldState.loadedChunks.has(chunkKey)) return;
    worldState.loadedChunks.add(chunkKey);

    const centerQ = cq * CHUNK_SIZE;
    const centerR = cr * CHUNK_SIZE;

    for (let q = -CHUNK_SIZE; q <= CHUNK_SIZE; q++) {
        for (let r = -CHUNK_SIZE; r <= CHUNK_SIZE; r++) {
            if (Math.abs(q + r) <= CHUNK_SIZE) {
                const absQ = centerQ + q;
                const absR = centerR + r;

                const noise = worldState.simplex.noise2D(absQ * 0.05, absR * 0.05);
                const height = Math.floor(noise * 5);

                addBlock(absQ, absR, height, 0);
                addBlock(absQ, absR, height - 1, 1);
            }
        }
    }
}

export function updateChunks() {
    const current = worldToAxial(camera.position);
    const cq = Math.round(current.q / CHUNK_SIZE);
    const cr = Math.round(current.r / CHUNK_SIZE);

    for (let i = -RENDER_DIST; i <= RENDER_DIST; i++) {
        for (let j = -RENDER_DIST; j <= RENDER_DIST; j++) {
            generateChunk(cq + i, cr + j);
        }
    }
}
