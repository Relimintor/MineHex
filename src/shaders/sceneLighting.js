const THREE = window.THREE;

export function applySceneLighting(scene) {
    const ambient = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff4d8, 0.85);
    sun.position.set(50, 100, 50);
    sun.castShadow = false;
    scene.add(sun);

    return {
        ambient,
        sun,
        syncSun(skyValues) {
            if (!skyValues) return;
            const { sunDir, sunEnergy, dayFactor } = skyValues;
            const posScale = 180;
            sun.position.set(sunDir.x * posScale, Math.max(10, sunDir.y * posScale), sunDir.z * posScale);
            sun.intensity = 0.1 + sunEnergy * 1.1;
            ambient.intensity = 0.22 + dayFactor * 0.48;
            sun.color.setRGB(1.0, 0.88 + dayFactor * 0.1, 0.72 + dayFactor * 0.2);
        },
    };
}
