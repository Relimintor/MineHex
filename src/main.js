import { camera, renderer, scene } from './scene.js';
import { inputState } from './state.js';
import { registerDesktopInputHandlers } from './input.js';
import { registerMobileInputHandlers } from './mobile/mobile.js';
import { handlePhysics } from './physics.js';
import { runChunkOcclusionCulling, updateChunks, updateDynamicChunkWorkload } from './worldgen.js';
import { ENABLE_OCCLUSION_CULLING, USE_LOW_END_PROFILE } from './config.js';
import { enforceSpawnOnSolidBlock } from './rules.js';
import { worldToAxial } from './coords.js';
import { worldState } from './state.js';

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
let appliedPixelRatio = null;

function updateDynamicQuality(deltaTimeSeconds) {
    const frameTimeMs = deltaTimeSeconds * 1000;
    worldState.performance.frameTimeEmaMs = (worldState.performance.frameTimeEmaMs * 0.9) + (frameTimeMs * 0.1);
    const ema = worldState.performance.frameTimeEmaMs;

    updateDynamicChunkWorkload(ema);

    const nativePixelRatio = window.devicePixelRatio || 1;
    const minimumScale = USE_LOW_END_PROFILE ? 0.6 : 0.72;
    const desiredScale = ema > 21
        ? minimumScale
        : (ema > 18 ? Math.max(minimumScale, 0.82) : 1);
    const nextPixelRatio = Number((nativePixelRatio * desiredScale).toFixed(2));

    if (appliedPixelRatio === nextPixelRatio) return;
    appliedPixelRatio = nextPixelRatio;
    renderer.setPixelRatio(appliedPixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate(now = performance.now()) {
    requestAnimationFrame(animate);
    const deltaTimeSeconds = Math.min(0.1, (now - lastFrameTime) / 1000);
    lastFrameTime = now;
    updateDynamicQuality(deltaTimeSeconds);

    worldState.frame += 1;
    worldState.frameCameraAxial = worldToAxial(camera.position);

    if (inputState.isLocked) {
        handlePhysics(deltaTimeSeconds);
        updateChunks();
    }

    camera.rotation.set(inputState.pitch, inputState.yaw, 0, 'YXZ');
    renderer.render(scene, camera);
    const occlusionInterval = worldState.performance.dynamicOcclusionIntervalFrames ?? 2;
    if (ENABLE_OCCLUSION_CULLING && (worldState.frame % occlusionInterval) === 0) {
        runChunkOcclusionCulling();
    }
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
