const THREE = window.THREE;

import { HEX_HEIGHT, HEX_RADIUS } from './config.js';

function createHexGeometry() {
    const shape = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i + (Math.PI / 6);
        const x = Math.cos(angle) * HEX_RADIUS;
        const y = Math.sin(angle) * HEX_RADIUS;
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
    }
    shape.closePath();

    const extrudeSettings = {
        depth: HEX_HEIGHT,
        bevelEnabled: false
    };

    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geometry.rotateX(Math.PI / 2);
    return geometry;
}

export const hexGeometry = createHexGeometry();
