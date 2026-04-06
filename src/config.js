export const HEX_RADIUS = 1;
export const HEX_HEIGHT = HEX_RADIUS * 1.6;

const runtimeNavigator = typeof navigator === 'undefined' ? null : navigator;
const runtimeStorage = typeof localStorage === 'undefined' ? null : localStorage;
const runtimeUserAgent = runtimeNavigator?.userAgent ?? '';
const isMobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(runtimeUserAgent);
const isChromebook = /CrOS/i.test(runtimeUserAgent);
const isCeleronUserAgent = /Celeron/i.test(runtimeUserAgent);
const controlModeOverride = runtimeStorage?.getItem('minehexControlMode');
const performanceProfileOverride = runtimeStorage?.getItem('minehexPerformanceProfile');
const isCeleronOverride = performanceProfileOverride === 'celeron_cb';
const isMobileOverride = controlModeOverride === 'mobile';
const isPcOverride = controlModeOverride === 'pc';
const hasLimitedCpu = (runtimeNavigator?.hardwareConcurrency ?? 8) <= 4;
const hasLimitedMemory = (runtimeNavigator?.deviceMemory ?? 8) <= 4;
const useUltraLowChunkProfile = isCeleronOverride || (!controlModeOverride && isChromebook && (isCeleronUserAgent || hasLimitedCpu || hasLimitedMemory));
const useLowEndChunkProfile = useUltraLowChunkProfile || isMobileOverride || (!isPcOverride && !controlModeOverride && (isMobileUserAgent || hasLimitedCpu || hasLimitedMemory));
const useStrictLowEndRendering = useLowEndChunkProfile || isCeleronOverride;

const isCeleronChunkProfile = useUltraLowChunkProfile;
const isMobileChunkProfile = !isCeleronChunkProfile && (isMobileOverride || (!isPcOverride && !controlModeOverride && isMobileUserAgent));

export const USE_ULTRA_LOW_PROFILE = useUltraLowChunkProfile;
export const USE_LOW_END_PROFILE = useLowEndChunkProfile;
export const USE_STRICT_LOW_END_RENDERING = useStrictLowEndRendering;
export const ENABLE_ANTIALIAS = !useStrictLowEndRendering;
export const ENABLE_SHADOW_MAP = false;
export const MAX_DEVICE_PIXEL_RATIO = useStrictLowEndRendering ? 1 : 2;

// Chunk profile alignment:
// - celeron + mobile share the same budgets/features for stable low-end behavior.
// - mobile gets slightly bigger chunks and +1 render distance compared to celeron.
export const CHUNK_SIZE = isCeleronChunkProfile ? 4 : (isMobileChunkProfile ? 6 : (useLowEndChunkProfile ? 8 : 16));
export const RENDER_DIST = isCeleronChunkProfile ? 1 : (isMobileChunkProfile ? 2 : (useLowEndChunkProfile ? 2 : 4));
export const CHUNK_CREATION_BUDGET = (isCeleronChunkProfile || isMobileChunkProfile) ? 1 : 2;
export const CHUNK_APPLY_BUDGET = (isCeleronChunkProfile || isMobileChunkProfile) ? 1 : 2;
export const ENABLE_OCCLUSION_CULLING = !(useLowEndChunkProfile || isMobileChunkProfile);
export const ENABLE_COMPLEX_LOD = !(useLowEndChunkProfile || isMobileChunkProfile);
export const ENABLE_WORLDGEN_WORKER = true;
export const MAX_WORLDGEN_IN_FLIGHT = (isCeleronChunkProfile || isMobileChunkProfile) ? 1 : 2;
export const FORCE_BATCHED_CHUNK_RENDERING = isCeleronChunkProfile || isMobileChunkProfile;
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
    { name: 'Ice', color: 0xb3e5fc, opacity: 0.7, transparent: true },
    { name: 'Sand', color: 0xdcc38b },
    { name: 'Sandstone', color: 0xcaa472 }
];

export const PLAYER_HEIGHT_IN_HEXES = 1.8;
export const PLAYER_HEIGHT = HEX_HEIGHT * PLAYER_HEIGHT_IN_HEXES;

export const GRAVITY = -0.02;
// Target jump apex: about 1.5 hexes (~2.4 world units) from takeoff.
export const JUMP_FORCE = 0.31;
export const MOVE_SPEED = 0.12;
export const MOVE_ACCELERATION = 0.35;
export const MOVE_FRICTION = 0.2;
export const SWIM_MOVE_SPEED = 0.06;
export const SWIM_UP_FORCE = 0.03;
export const SWIM_GRAVITY = -0.004;
