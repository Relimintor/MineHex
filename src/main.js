import { camera, renderer, scene } from './scene.js';
import { inputState } from './state.js';
import { registerInputHandlers } from './input.js';
import { handlePhysics } from './physics.js';
import { updateChunks } from './worldgen.js';

camera.position.set(0, 10, 0);
registerInputHandlers();
let lastFrameTime = performance.now();

function animate(now = performance.now()) {
    requestAnimationFrame(animate);
    const deltaTimeSeconds = Math.min(0.1, (now - lastFrameTime) / 1000);
    lastFrameTime = now;

    if (inputState.isLocked) {
        handlePhysics(deltaTimeSeconds);
        updateChunks();
    }

    camera.rotation.set(inputState.pitch, inputState.yaw, 0, 'YXZ');
    renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
