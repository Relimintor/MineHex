export const HEX_RADIUS = 1;
export const HEX_HEIGHT = HEX_RADIUS * 1.6;

const runtimeNavigator = typeof navigator === 'undefined' ? null : navigator;
const isMobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(runtimeNavigator?.userAgent ?? '');
const hasLimitedCpu = (runtimeNavigator?.hardwareConcurrency ?? 8) <= 4;
const hasLimitedMemory = (runtimeNavigator?.deviceMemory ?? 8) <= 4;
const useLowEndChunkProfile = isMobileUserAgent || hasLimitedCpu || hasLimitedMemory;

// Chunking Goldilocks profile:
// - low-end/mobile: 8-ish footprint reduces remesh spikes.
// - desktop/high-end: 16-ish footprint lowers draw-call pressure.
export const CHUNK_SIZE = useLowEndChunkProfile ? 8 : 16;
export const RENDER_DIST = useLowEndChunkProfile ? 3 : 2;
export const CHUNK_CREATION_BUDGET = useLowEndChunkProfile ? 1 : 3;
export const NETHROCK_LEVEL_HEX = -40;
export const VOID_RESPAWN_BUFFER_HEX = 2;

export const BLOCK_TYPES = [
    { name: 'Grass', color: 0x4caf50 },
    { name: 'Dirt', color: 0x795548 },
    { name: 'Stone', color: 0x9e9e9e },
    { name: 'Cloud', color: 0xffffff },
    { name: 'Water', color: 0x2196f3, opacity: 0.6, transparent: true, isLiquid: true },
    { name: 'Nethrock', color: 0x3b1f1f, unbreakable: true },
    { name: 'Oak Wood', color: 0x8d6e63 },
    { name: 'Oak Leaves', color: 0x2e7d32, opacity: 0.9, transparent: true },
    { name: 'Snow', color: 0xf5f8ff },
    { name: 'Ice', color: 0xb3e5fc, opacity: 0.7, transparent: true }
];

export const PLAYER_HEIGHT_IN_HEXES = 1.8;
export const PLAYER_HEIGHT = HEX_HEIGHT * PLAYER_HEIGHT_IN_HEXES;

export const GRAVITY = -0.02;
export const JUMP_FORCE = 0.42;
export const MOVE_SPEED = 0.12;
export const MOVE_ACCELERATION = 0.35;
export const MOVE_FRICTION = 0.2;
export const SWIM_MOVE_SPEED = 0.06;
export const SWIM_UP_FORCE = 0.03;
export const SWIM_GRAVITY = -0.004;
