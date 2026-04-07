const THREE = window.THREE;

import { syncShaderLighting } from './materials.js';

export function applySceneLighting(scene) {
    const ambient = new THREE.AmbientLight(0xdde7ff, 0.32);
    scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0xa9c9ff, 0x2a313a, 0.2);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff4d8, 0.85);
    sun.position.set(50, 100, 50);
    sun.castShadow = false;
    scene.add(sun);

    return {
        ambient,
        hemi,
        sun,
        syncSun(skyValues) {
            if (!skyValues) return;
            const { sunDir, sunEnergy, dayFactor } = skyValues;
            const posScale = 180;
            sun.position.set(sunDir.x * posScale, Math.max(10, sunDir.y * posScale), sunDir.z * posScale);
            sun.intensity = 0.06 + sunEnergy * 1.35;
            ambient.intensity = 0.12 + dayFactor * 0.34;
            hemi.intensity = 0.08 + dayFactor * 0.26;
            sun.color.setRGB(1.0, 0.88 + dayFactor * 0.1, 0.72 + dayFactor * 0.2);
            hemi.color.setRGB(0.62 + dayFactor * 0.32, 0.70 + dayFactor * 0.22, 0.84 + dayFactor * 0.12);

            syncShaderLighting(skyValues);
        },
    };
}
