import { camera, renderer, scene } from './scene.js';
import { inputState } from './state.js';
import { registerDesktopInputHandlers } from './input.js';
import { registerMobileInputHandlers } from './mobile/mobile.js';
import { handlePhysics } from './physics.js';
import { runChunkOcclusionCulling, tickChunkApplyBudget, tickChunkStreaming, tickChunkVisibility, updateChunkBudgetGovernor } from './worldgen.js';
import { ENABLE_OCCLUSION_CULLING } from './config.js';
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
let frameAccumulatorSeconds = 0;
let smoothedFrameTimeSeconds = 1 / 60;
const FIXED_TICK_SECONDS = 1 / 60;
const MAX_TICKS_PER_FRAME = 3;
const FRAME_TIME_SMOOTHING_ALPHA = 0.15;
const OCCLUSION_CULLING_INTERVAL_FRAMES = 2;
const CHUNK_STREAM_INTERVAL_FRAMES = 3;
const CHUNK_VISIBILITY_INTERVAL_FRAMES = 2;

function animate(now = performance.now()) {
    requestAnimationFrame(animate);
    const deltaTimeSeconds = Math.min(0.1, (now - lastFrameTime) / 1000);
    lastFrameTime = now;
    smoothedFrameTimeSeconds += (deltaTimeSeconds - smoothedFrameTimeSeconds) * FRAME_TIME_SMOOTHING_ALPHA;
    frameAccumulatorSeconds += deltaTimeSeconds;

    let tickCount = 0;
    while (frameAccumulatorSeconds >= FIXED_TICK_SECONDS && tickCount < MAX_TICKS_PER_FRAME) {
        worldState.frame += 1;
        worldState.frameCameraAxial = worldToAxial(camera.position);

        if (inputState.isLocked) {
            handlePhysics(FIXED_TICK_SECONDS);
            updateChunkBudgetGovernor(smoothedFrameTimeSeconds * 1000);
            tickChunkApplyBudget();
            if ((worldState.frame % CHUNK_STREAM_INTERVAL_FRAMES) === 0) tickChunkStreaming();
            if ((worldState.frame % CHUNK_VISIBILITY_INTERVAL_FRAMES) === 0) tickChunkVisibility();
        }

        frameAccumulatorSeconds -= FIXED_TICK_SECONDS;
        tickCount += 1;
    }

    if (tickCount === MAX_TICKS_PER_FRAME && frameAccumulatorSeconds > FIXED_TICK_SECONDS) {
        frameAccumulatorSeconds = FIXED_TICK_SECONDS * 0.5;
    }

    camera.rotation.set(inputState.pitch, inputState.yaw, 0, 'YXZ');
    renderer.render(scene, camera);
    if (ENABLE_OCCLUSION_CULLING && (worldState.frame % OCCLUSION_CULLING_INTERVAL_FRAMES) === 0) {
        runChunkOcclusionCulling();
    }
}


chooseControlMode().then((mode) => {
    if (mode === 'mobile') {
        registerMobileInputHandlers();
    } else {
        registerDesktopInputHandlers();
    }

    updateChunkBudgetGovernor(16.7);
    tickChunkStreaming();
    tickChunkApplyBudget();
    tickChunkVisibility();
    enforceSpawnOnSolidBlock(0, 0);
    animate();
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
