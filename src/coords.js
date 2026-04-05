const THREE = window.THREE;

import { HEX_HEIGHT, HEX_RADIUS } from './config.js';

export const CUBE_NEIGHBOR_OFFSETS = Object.freeze([
    Object.freeze({ x: 1, y: -1, z: 0 }),
    Object.freeze({ x: 1, y: 0, z: -1 }),
    Object.freeze({ x: 0, y: 1, z: -1 }),
    Object.freeze({ x: -1, y: 1, z: 0 }),
    Object.freeze({ x: -1, y: 0, z: 1 }),
    Object.freeze({ x: 0, y: -1, z: 1 })
]);

export const AXIAL_NEIGHBOR_OFFSETS = Object.freeze(
    CUBE_NEIGHBOR_OFFSETS.map(({ x, z }) => Object.freeze({ q: x, r: z }))
);

export function axialToWorld(q, r, h) {
    const x = HEX_RADIUS * Math.sqrt(3) * (q + r / 2);
    const z = HEX_RADIUS * (3 / 2) * r;
    const y = h * HEX_HEIGHT;
    return new THREE.Vector3(x, y, z);
}

export function axialToCube(q, r) {
    return { x: q, y: -q - r, z: r };
}

export function cubeToAxial(x, y, z) {
    const correctedY = -x - z;
    return { q: x, r: z, y: Number.isFinite(y) ? y : correctedY };
}

export function cubeNeighbors({ x, y, z }) {
    return CUBE_NEIGHBOR_OFFSETS.map((offset) => ({
        x: x + offset.x,
        y: y + offset.y,
        z: z + offset.z
    }));
}

export function cubeDistance(a, b) {
    return Math.max(
        Math.abs(a.x - b.x),
        Math.abs(a.y - b.y),
        Math.abs(a.z - b.z)
    );
}

export function axialDistance(qA, rA, qB, rB) {
    const a = axialToCube(qA, rA);
    const b = axialToCube(qB, rB);
    return cubeDistance(a, b);
}

export function worldToAxial(point) {
    const q = (Math.sqrt(3)/3 * point.x - 1/3 * point.z) / HEX_RADIUS;
    const r = (2/3 * point.z) / HEX_RADIUS;
    const h = Math.round(point.y / HEX_HEIGHT);

    let x = q;
    let z = r;
    let y = -x - z;
    let rx = Math.round(x);
    let ry = Math.round(y);
    let rz = Math.round(z);

    const xDiff = Math.abs(rx - x);
    const yDiff = Math.abs(ry - y);
    const zDiff = Math.abs(rz - z);

    if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz;
    else if (yDiff > zDiff) ry = -rx - rz;
    else rz = -rx - ry;

    return { q: rx, r: rz, h };
}

export function worldToCube(point) {
    const { q, r, h } = worldToAxial(point);
    return { ...axialToCube(q, r), h };
}
