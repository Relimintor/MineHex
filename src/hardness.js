import { BLOCK_TYPES } from './config.js';

const DEFAULT_MINING_SECONDS = 0.1;

const MINING_SECONDS_BY_TYPE = Object.freeze({
    0: 0.09, // Grass
    1: 0.08, // Dirt
    2: 0.16, // Stone
    3: 0.06, // Cloud
    4: 0.04, // Water
    5: Number.POSITIVE_INFINITY, // Nethrock (unbreakable)
    6: 0.14, // Oak Wood
    7: 0.07, // Oak Leaves
    8: 0.09, // Snow
    9: 0.11, // Ice
    10: 0.08, // Sand
    11: 0.12 // Sandstone
});

export function getMiningDurationMsForType(typeIndex) {
    if (!Number.isInteger(typeIndex) || typeIndex < 0 || typeIndex >= BLOCK_TYPES.length) {
        return DEFAULT_MINING_SECONDS * 1000;
    }

    if (BLOCK_TYPES[typeIndex]?.unbreakable) return Number.POSITIVE_INFINITY;
    const seconds = MINING_SECONDS_BY_TYPE[typeIndex] ?? DEFAULT_MINING_SECONDS;
    return Math.max(0, seconds) * 1000;
}
