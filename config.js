export const HEX_TYPES = {
  grass: {
    label: 'Grass',
    color: '#4d9b4a',
    walkable: true,
    height: 0.16
  },
  dirt: {
    label: 'Dirt',
    color: '#866448',
    walkable: true,
    height: 0.12
  },
  stone: {
    label: 'Stone',
    color: '#8a8e97',
    walkable: true,
    height: 0.2
  },
  sand: {
    label: 'Sand',
    color: '#d7c38f',
    walkable: true,
    height: 0.1
  },
  water: {
    label: 'Water',
    color: '#347ec7',
    walkable: false,
    height: 0.06
  },
  lava: {
    label: 'Lava',
    color: '#d1562f',
    walkable: false,
    height: 0.08
  },
  wood: {
    label: 'Wood',
    color: '#7a4d2b',
    walkable: true,
    height: 0.18
  }
};

export const WORLD_CONFIG = {
  radius: 7,
  sphereRadius: 6,
  tileRadius: 0.58,
  tileDepth: 0.5,
  skyColor: 0x0b1020,
  fogColor: 0x0f1630
};
