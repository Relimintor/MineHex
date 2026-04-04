const THREE = window.THREE;

export const worldState = {
    selectedBlockIndex: 0,
    worldBlocks: new Map(),
    loadedChunks: new Set(),
    simplex: new window.SimplexNoise()
};

export const inputState = {
    keys: {},
    isLocked: false,
    pitch: 0,
    yaw: 0,
    canJump: false,
    velocity: new THREE.Vector3()
};
