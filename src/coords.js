const THREE = window.THREE;

import { HEX_HEIGHT, HEX_RADIUS } from './config.js';

export function axialToWorld(q, r, h) {
    const x = HEX_RADIUS * Math.sqrt(3) * (q + r / 2);
    const z = HEX_RADIUS * (3 / 2) * r;
    const y = h * HEX_HEIGHT;
    return new THREE.Vector3(x, y, z);
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
