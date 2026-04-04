import { camera, renderer, scene } from './scene.js';
import { inputState } from './state.js';
import { registerInputHandlers } from './input.js';
import { handlePhysics } from './physics.js';
import { updateChunks } from './worldgen.js';

camera.position.set(0, 10, 0);
registerInputHandlers();

function animate() {
    requestAnimationFrame(animate);

    if (inputState.isLocked) {
        handlePhysics();
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
