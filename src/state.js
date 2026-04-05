const THREE = window.THREE;

export const worldState = {
    selectedBlockIndex: 0,
    worldBlocks: new Map(),
    worldBlockList: [],
    collidableBlockList: [],
    collidableBlocks: new Set(),
    blockCoordsByKey: new Map(),
    chunkBlocks: new Map(),
    chunkFaceQuads: new Map(),
    chunkMeta: new Map(),
    dirtyChunks: new Set(),
    permanentBlocks: new Map(),
    permanentBlocksByChunk: new Map(),
    topSolidHeightByColumn: new Map(),
    loadedChunks: new Set(),
    simplex: new window.SimplexNoise(),
    frame: 0,
    frameCameraAxial: { q: 0, r: 0, h: 0 }
};

export const inputState = {
    keys: new Uint8Array(256),
    isLocked: false,
    pitch: 0,
    yaw: 0,
    canJump: false,
    velocity: new THREE.Vector3()
};
