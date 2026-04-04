export const HEX_TYPES = {
  grass: { label: 'Grass', color: '#4d9b4a', walkable: true, height: 1.1 },
  dirt: { label: 'Dirt', color: '#866448', walkable: true, height: 1.0 },
  stone: { label: 'Stone', color: '#8a8e97', walkable: true, height: 1.2 },
  sand: { label: 'Sand', color: '#d7c38f', walkable: true, height: 0.9 },
  water: { label: 'Water', color: '#347ec7', walkable: false, height: 0.45 },
  lava: { label: 'Lava', color: '#d1562f', walkable: false, height: 0.5 },
  wood: { label: 'Wood', color: '#7a4d2b', walkable: true, height: 1.35 }
};

export const WORLD_CONFIG = {
  worldRadius: 13,
  tileRadius: 1,
  baseDepth: 1,
  cameraEyeHeight: 1.68,
  skyColor: 0x9ec9ff,
  groundColor: 0x58704e,
  moveSpeed: 7
};
