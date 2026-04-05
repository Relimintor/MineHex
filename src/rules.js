import { PLAYER_HEIGHT } from './config.js';
import { axialToWorld, worldToAxial } from './coords.js';
import { BLOCK_TYPES } from './config.js';
import { camera } from './scene.js';
import { worldState } from './state.js';

const SEARCH_RADIUS = 12;
const SEARCH_HEIGHT_TOP = 80;
const SEARCH_HEIGHT_BOTTOM = -80;

function getBlockAt(q, r, h) {
    return worldState.worldBlocks.get(`${q},${r},${h}`) ?? null;
}

export function isSolidTypeIndex(typeIndex) {
    const blockType = BLOCK_TYPES[typeIndex];
    if (!blockType) return false;
    return !blockType.isLiquid;
}

export function isSolidBlockAt(q, r, h) {
    const block = getBlockAt(q, r, h);
    if (!block) return false; // air is not a solid block
    return isSolidTypeIndex(block.userData.typeIndex);
}

export function isLiquidBlockAt(q, r, h) {
    const block = getBlockAt(q, r, h);
    if (!block) return false;
    const blockType = BLOCK_TYPES[block.userData.typeIndex];
    return Boolean(blockType?.isLiquid);
}

export function isCameraInLiquid() {
    const { q, r, h } = worldToAxial(camera.position);
    return isLiquidBlockAt(q, r, h) || isLiquidBlockAt(q, r, h - 1);
}

function findSpawnHeight(q, r) {
    for (let h = SEARCH_HEIGHT_TOP; h >= SEARCH_HEIGHT_BOTTOM; h--) {
        if (!isSolidBlockAt(q, r, h)) continue;
        if (!isSolidBlockAt(q, r, h + 1)) return h;
    }
    return null;
}

// Rule 1: you must always spawn on a solid block.
export function enforceSpawnOnSolidBlock(originQ = 0, originR = 0) {
    for (let radius = 0; radius <= SEARCH_RADIUS; radius++) {
        for (let dq = -radius; dq <= radius; dq++) {
            for (let dr = -radius; dr <= radius; dr++) {
                if (Math.abs(dq + dr) > radius) continue;
                const q = originQ + dq;
                const r = originR + dr;
                const spawnHeight = findSpawnHeight(q, r);
                if (spawnHeight === null) continue;

                const spawnPoint = axialToWorld(q, r, spawnHeight);
                camera.position.set(spawnPoint.x, spawnPoint.y + PLAYER_HEIGHT, spawnPoint.z);
                return true;
            }
        }
    }

    return false;
}
