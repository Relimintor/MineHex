const THREE = window.THREE;

export function applySceneLighting(scene) {
    const ambient = new THREE.AmbientLight(0xdde7ff, 0.18);
    scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0xa9c9ff, 0x2a313a, 0.11);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff4d8, 1.0);
    sun.position.set(50, 100, 50);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 2;
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.02;
    sun.shadow.camera.near = 16;
    sun.shadow.camera.far = 420;
    sun.shadow.camera.left = -180;
    sun.shadow.camera.right = 180;
    sun.shadow.camera.top = 180;
    sun.shadow.camera.bottom = -180;
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
            sun.intensity = 0.08 + sunEnergy * 1.55;
            ambient.intensity = 0.05 + dayFactor * 0.2;
            hemi.intensity = 0.04 + dayFactor * 0.14;
            sun.color.setRGB(1.0, 0.88 + dayFactor * 0.1, 0.72 + dayFactor * 0.2);
            hemi.color.setRGB(0.62 + dayFactor * 0.32, 0.70 + dayFactor * 0.22, 0.84 + dayFactor * 0.12);
        },
    };
}
