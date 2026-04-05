import { PLAYER_HEIGHT, BLOCK_TYPES } from './config.js';
import { axialToWorld, worldToAxial } from './coords.js';
import { camera } from './scene.js';
import { worldState } from './state.js';

const SEARCH_RADIUS = 12;
const SEARCH_HEIGHT_TOP = 80;
const SEARCH_HEIGHT_BOTTOM = -80;
const SOLID_TYPE_LOOKUP = BLOCK_TYPES.map((blockType) => !blockType?.isLiquid);
const WATER_TYPE_INDEX = BLOCK_TYPES.findIndex((blockType) => blockType?.name?.toLowerCase() === 'water');

function getBlockAt(q, r, h) {
    return worldState.worldBlocks.get(`${q},${r},${h}`) ?? null;
}

function getColumnKey(q, r) {
    return `${q},${r}`;
}

export function updateTopSolidHeightOnAdd(q, r, h, typeIndex) {
    if (!SOLID_TYPE_LOOKUP[typeIndex]) return;
    const columnKey = getColumnKey(q, r);
    const previous = worldState.topSolidHeightByColumn.get(columnKey);
    if (previous === undefined || h > previous) worldState.topSolidHeightByColumn.set(columnKey, h);
}

export function updateTopSolidHeightOnRemove(q, r, h, typeIndex) {
    if (!SOLID_TYPE_LOOKUP[typeIndex]) return;
    const columnKey = getColumnKey(q, r);
    const previous = worldState.topSolidHeightByColumn.get(columnKey);
    if (previous === undefined || previous !== h) return;

    for (let nextH = h - 1; nextH >= SEARCH_HEIGHT_BOTTOM; nextH--) {
        const block = getBlockAt(q, r, nextH);
        if (!block) continue;
        if (!SOLID_TYPE_LOOKUP[block.userData.typeIndex]) continue;
        worldState.topSolidHeightByColumn.set(columnKey, nextH);
        return;
    }

    worldState.topSolidHeightByColumn.delete(columnKey);
}

export function isSolidTypeIndex(typeIndex) {
    return Boolean(SOLID_TYPE_LOOKUP[typeIndex]);
}

export function isSolidBlockAt(q, r, h) {
    const block = getBlockAt(q, r, h);
    if (!block) return false;
    return isSolidTypeIndex(block.userData.typeIndex);
}

export function isLiquidBlockAt(q, r, h) {
    const block = getBlockAt(q, r, h);
    if (!block) return false;
    return !isSolidTypeIndex(block.userData.typeIndex);
}

function isWaterBlockAt(q, r, h) {
    if (WATER_TYPE_INDEX < 0) return false;
    const block = getBlockAt(q, r, h);
    if (!block) return false;
    return block.userData.typeIndex === WATER_TYPE_INDEX;
}

export function isCameraInLiquid() {
    const { q, r, h } = worldState.frameCameraAxial ?? worldToAxial(camera.position);
    return isLiquidBlockAt(q, r, h) || isLiquidBlockAt(q, r, h - 1);
}

function findSpawnHeight(q, r) {
    for (let h = SEARCH_HEIGHT_TOP; h >= SEARCH_HEIGHT_BOTTOM; h--) {
        if (!isSolidBlockAt(q, r, h)) continue;
        if (isWaterBlockAt(q, r, h)) continue;
        if (isLiquidBlockAt(q, r, h + 1)) continue;
        if (isLiquidBlockAt(q, r, h + 2)) continue;
        return h;
    }
    return null;
}

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
