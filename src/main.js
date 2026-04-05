import { camera, renderer, scene } from './scene.js';
import { inputState } from './state.js';
import { registerDesktopInputHandlers } from './input.js';
import { registerMobileInputHandlers } from './mobile/mobile.js';
import { handlePhysics } from './physics.js';
import { runChunkOcclusionCulling, updateChunks } from './worldgen.js';
import { enforceSpawnOnSolidBlock } from './rules.js';

camera.position.set(0, 10, 0);

function chooseControlMode() {
    const modeScreen = document.getElementById('mode-select');
    if (!modeScreen) return Promise.resolve('pc');

    return new Promise((resolve) => {
        const buttons = modeScreen.querySelectorAll('[data-mode]');

        buttons.forEach((button) => {
            button.addEventListener('click', () => {
                const mode = button.dataset.mode;
                if (mode === 'console') {
                    const status = modeScreen.querySelector('#mode-status');
                    if (status) status.textContent = 'Console controls are coming next.';
                    return;
                }

                modeScreen.classList.add('hidden');
                resolve(mode);
            });
        });
    });
}

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
    runChunkOcclusionCulling();
}


chooseControlMode().then((mode) => {
    if (mode === 'mobile') {
        registerMobileInputHandlers();
    } else {
        registerDesktopInputHandlers();
    }

    updateChunks();
    enforceSpawnOnSolidBlock(0, 0);
    animate();
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
