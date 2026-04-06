const THREE = window.THREE;

export const SKY_COLOR = 0x87ceeb;

export function applySkyAtmosphere(scene) {
    scene.background = new THREE.Color(SKY_COLOR);
    scene.fog = new THREE.Fog(SKY_COLOR, 20, 60);
}
