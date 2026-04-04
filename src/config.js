export const HEX_RADIUS = 1;
export const HEX_HEIGHT = HEX_RADIUS * 2;
export const CHUNK_SIZE = 8;
export const RENDER_DIST = 3;

export const BLOCK_TYPES = [
    { name: 'Grass', color: 0x4caf50 },
    { name: 'Dirt', color: 0x795548 },
    { name: 'Stone', color: 0x9e9e9e },
    { name: 'Cloud', color: 0xffffff }
];

export const PLAYER_HEIGHT_IN_HEXES = 1.8;
export const PLAYER_HEIGHT = HEX_HEIGHT * PLAYER_HEIGHT_IN_HEXES;

export const GRAVITY = -0.02;
export const JUMP_FORCE = 0.42;
