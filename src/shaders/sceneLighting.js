const THREE = window.THREE;

const SKY_COLOR = 0x87ceeb;

export function applySceneAtmosphere(scene) {
    scene.background = new THREE.Color(SKY_COLOR);
    scene.fog = new THREE.Fog(SKY_COLOR, 20, 60);
}

export function applySceneLighting(scene) {
    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(50, 100, 50);
    scene.add(sun);
}
