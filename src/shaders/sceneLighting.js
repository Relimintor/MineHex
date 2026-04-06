const THREE = window.THREE;

export function applySceneLighting(scene) {
    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(50, 100, 50);
    scene.add(sun);
}
