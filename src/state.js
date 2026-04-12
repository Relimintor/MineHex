const THREE = window.THREE;

const DEFAULT_PROFILER_WINDOW = 180;
const MIN_PROFILER_WINDOW = 120;
const MAX_PROFILER_WINDOW = 300;

function createProfilerStore(windowSize = DEFAULT_PROFILER_WINDOW) {
    const safeWindow = Math.max(MIN_PROFILER_WINDOW, Math.min(MAX_PROFILER_WINDOW, Math.round(windowSize)));
    return {
        enabled: false,
        windowSize: safeWindow,
        samples: new Map(),
        frame: 0,
        lastFrameStart: 0,
        lastFrameEnd: 0,
        overheadHistory: [],
        baselineHistory: []
    };
}

export const worldState = {
    selectedBlockIndex: 0,
    gameMode: 'creative',
    worldBlocks: new Map(),
    worldBlockList: [],
    collidableBlockList: [],
    collidableBlocks: new Set(),
    blockCoordsByKey: new Map(),
    chunkBlocks: new Map(),
    chunkBlockData: new Map(),
    blockIndexByKey: new Map(),
    chunkFaceQuads: new Map(),
    chunkRenderBatches: new Map(),
    chunkMeta: new Map(),
    dirtyChunks: new Set(),
    dirtyChunkOps: new Map(),
    permanentBlocks: new Map(),
    permanentBlocksByChunk: new Map(),
    removedBlocks: new Set(),
    removedBlocksByChunk: new Map(),
    topSolidHeightByColumn: new Map(),
    loadedChunks: new Set(),
    simplex: new window.SimplexNoise(),
    frame: 0,
    frameCameraAxial: { q: 0, r: 0, h: 0 },
    profiler: createProfilerStore()
};

export function setWorldSeed(seed) {
    const fallbackSeed = Date.now().toString();
    const normalizedSeed = (seed ?? fallbackSeed).toString();
    worldState.simplex = new window.SimplexNoise(normalizedSeed);
    return normalizedSeed;
}

function ensureMetricBuffer(metricName) {
    if (!metricName) return null;
    if (worldState.profiler.samples.has(metricName)) return worldState.profiler.samples.get(metricName);
    const buffer = new Float32Array(worldState.profiler.windowSize);
    const metric = {
        buffer,
        index: 0,
        count: 0,
        last: 0
    };
    worldState.profiler.samples.set(metricName, metric);
    return metric;
}

export function setProfilerEnabled(enabled) {
    worldState.profiler.enabled = !!enabled;
}

export function toggleProfilerEnabled() {
    worldState.profiler.enabled = !worldState.profiler.enabled;
    return worldState.profiler.enabled;
}

export function profilerBeginFrame(frameStartTime = performance.now()) {
    const profiler = worldState.profiler;
    profiler.frame += 1;
    profiler.lastFrameStart = frameStartTime;
}

export function profilerRecord(metricName, durationMs) {
    if (!worldState.profiler.enabled) return durationMs;
    if (!Number.isFinite(durationMs)) return durationMs;
    const metric = ensureMetricBuffer(metricName);
    if (!metric) return durationMs;
    metric.buffer[metric.index] = durationMs;
    metric.index = (metric.index + 1) % worldState.profiler.windowSize;
    metric.count = Math.min(metric.count + 1, worldState.profiler.windowSize);
    metric.last = durationMs;
    return durationMs;
}

export function profilerMeasure(metricName, fn) {
    const start = performance.now();
    const result = fn();
    profilerRecord(metricName, performance.now() - start);
    return result;
}

function quantileFromMetric(metric, q) {
    if (!metric || metric.count === 0) return 0;
    const sorted = Array.from(metric.buffer.slice(0, metric.count)).sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
    return sorted[idx];
}

export function getProfilerSnapshot() {
    const summary = {};
    for (const [name, metric] of worldState.profiler.samples.entries()) {
        if (metric.count === 0) continue;
        const p50 = quantileFromMetric(metric, 0.50);
        const p95 = quantileFromMetric(metric, 0.95);
        const p99 = quantileFromMetric(metric, 0.99);
        let sum = 0;
        for (let i = 0; i < metric.count; i++) sum += metric.buffer[i];
        summary[name] = {
            last: metric.last,
            avg: sum / metric.count,
            p50,
            p95,
            p99,
            count: metric.count
        };
    }
    return summary;
}

export function profilerEndFrame(frameEndTime = performance.now(), overheadMs = 0) {
    const profiler = worldState.profiler;
    profiler.lastFrameEnd = frameEndTime;
    if (!profiler.enabled) return;
    profilerRecord('frame_total', frameEndTime - profiler.lastFrameStart);
    profilerRecord('profiler_overhead', overheadMs);
}

export const inputState = {
    keys: new Uint8Array(256),
    isLocked: false,
    pitch: 0,
    yaw: 0,
    canJump: false,
    isSprinting: false,
    velocity: new THREE.Vector3()
};
