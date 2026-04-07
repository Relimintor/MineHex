const THREE = window.THREE;

import { camera, renderer, scene, skyController } from './scene.js';
import { inputState } from './state.js';
import { registerDesktopInputHandlers } from './input.js';
import { registerMobileInputHandlers } from './mobile/mobile.js';
import { registerCeleronInputHandlers } from './celeron/celeronInput.js';
import { handlePhysics } from './physics.js';
import { runChunkOcclusionCulling, tickChunkApplyBudget, tickChunkStreaming, tickChunkVisibility, updateChunkBudgetGovernor } from './worldgen.js';
import { ENABLE_OCCLUSION_CULLING, MAX_DEVICE_PIXEL_RATIO, USE_ULTRA_LOW_PROFILE } from './config.js';
import { enforceSpawnOnSolidBlock } from './rules.js';
import { worldToAxial, worldToCube } from './coords.js';
import { worldState } from './state.js';
import { updateCameraPerspective } from './playerView.js';
import { initInventoryAvatarPreview, renderInventoryAvatarPreview } from './inventoryAvatar.js';

camera.position.set(0, 48, 0);

const PERFORMANCE_PROFILE_KEY = 'minehexPerformanceProfile';
const CONTROL_MODE_KEY = 'minehexControlMode';

function chooseControlMode() {
    const modeScreen = document.getElementById('mode-select');
    if (!modeScreen) return Promise.resolve('pc');
    const savedProfile = localStorage.getItem(PERFORMANCE_PROFILE_KEY);
    const savedMode = localStorage.getItem(CONTROL_MODE_KEY);
    return new Promise((resolve) => {
        const buttons = modeScreen.querySelectorAll('[data-mode]');
        if (savedMode) {
            for (const button of buttons) {
                button.classList.toggle('active', button.dataset.mode === savedMode);
            }
        }

        buttons.forEach((button) => {
            button.addEventListener('click', () => {
                const mode = button.dataset.mode;
                if (mode === 'console') {
                    const status = modeScreen.querySelector('#mode-status');
                    if (status) status.textContent = 'Console controls are coming next.';
                    return;
                }

                if (mode === 'celeron_cb') {
                    const isAlreadyCeleron = savedProfile === 'celeron_cb' && savedMode === 'celeron_cb';
                    localStorage.setItem(PERFORMANCE_PROFILE_KEY, 'celeron_cb');
                    localStorage.setItem(CONTROL_MODE_KEY, 'celeron_cb');

                    if (isAlreadyCeleron) {
                        modeScreen.classList.add('hidden');
                        resolve('celeron_cb');
                        return;
                    }

                    window.location.reload();
                    return;
                }

                const wasCeleronProfile = savedProfile === 'celeron_cb';
                localStorage.removeItem(PERFORMANCE_PROFILE_KEY);
                localStorage.setItem(CONTROL_MODE_KEY, mode);

                if (wasCeleronProfile) {
                    window.location.reload();
                    return;
                }

                modeScreen.classList.add('hidden');
                resolve(mode);
            });
        });
    });
}

const playerPosition = new THREE.Vector3().copy(camera.position);

let lastFrameTime = performance.now();
const OCCLUSION_CULLING_INTERVAL_FRAMES = 2;
const CHUNK_BUDGET_GOVERNOR_INTERVAL_FRAMES = USE_ULTRA_LOW_PROFILE ? 4 : 2;
const CHUNK_APPLY_INTERVAL_FRAMES = USE_ULTRA_LOW_PROFILE ? 4 : 2;
const CHUNK_STREAM_INTERVAL_FRAMES = USE_ULTRA_LOW_PROFILE ? 8 : 4;
const CHUNK_VISIBILITY_INTERVAL_FRAMES = USE_ULTRA_LOW_PROFILE ? 6 : 3;
const coordinatesHud = document.getElementById('coordinates');
let governorElapsedMs = 0;
let hasSpawnedInAllowedRange = false;
let coordinatesHudFrameInterval = 1;

function updateCoordinatesHud() {
    if (!coordinatesHud) return;
    const { q, r, h } = worldToAxial(playerPosition);
    const { x, y, z } = worldToCube(playerPosition);
    coordinatesHud.textContent = `Axial q:${q} r:${r} h:${h} | Cube x:${x} y:${y} z:${z}`;
}

function animate(now = performance.now()) {
    requestAnimationFrame(animate);
    const deltaTimeSeconds = Math.min(0.1, (now - lastFrameTime) / 1000);
    lastFrameTime = now;

    worldState.frame += 1;
    worldState.frameCameraAxial = worldToAxial(playerPosition);
    if ((worldState.frame % coordinatesHudFrameInterval) === 0) updateCoordinatesHud();

    if (inputState.isLocked) {
        camera.position.copy(playerPosition);
        governorElapsedMs += deltaTimeSeconds * 1000;
        if ((worldState.frame % CHUNK_BUDGET_GOVERNOR_INTERVAL_FRAMES) === 0) {
            updateChunkBudgetGovernor(governorElapsedMs);
            governorElapsedMs = 0;
        }
        if ((worldState.frame % CHUNK_APPLY_INTERVAL_FRAMES) === 0) tickChunkApplyBudget();
        if ((worldState.frame % CHUNK_STREAM_INTERVAL_FRAMES) === 0) tickChunkStreaming();
        if ((worldState.frame % CHUNK_VISIBILITY_INTERVAL_FRAMES) === 0) tickChunkVisibility();

        if (!hasSpawnedInAllowedRange) {
            hasSpawnedInAllowedRange = enforceSpawnOnSolidBlock(0, 0);
            if (!hasSpawnedInAllowedRange) {
                inputState.velocity.set(0, 0, 0);
            }
        }

        if (hasSpawnedInAllowedRange) {
            handlePhysics(deltaTimeSeconds);
        }

        playerPosition.copy(camera.position);
    }

    updateCameraPerspective(playerPosition, inputState.pitch, inputState.yaw);
    skyController?.update(now * 0.001, camera);
    renderer.render(scene, camera);
    renderInventoryAvatarPreview(now * 0.001);
    if (ENABLE_OCCLUSION_CULLING && (worldState.frame % OCCLUSION_CULLING_INTERVAL_FRAMES) === 0) {
        runChunkOcclusionCulling();
    }
}


chooseControlMode().then((mode) => {
    if (mode === 'mobile') {
        registerMobileInputHandlers();
    } else if (mode === 'celeron_cb') {
        registerCeleronInputHandlers();
        coordinatesHudFrameInterval = 8;
    } else {
        registerDesktopInputHandlers();
    }

    updateChunkBudgetGovernor(16.7);
    tickChunkStreaming();
    tickChunkApplyBudget();
    tickChunkVisibility();
    hasSpawnedInAllowedRange = enforceSpawnOnSolidBlock(0, 0);
    playerPosition.copy(camera.position);
    initInventoryAvatarPreview();
    animate();
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO));
    renderer.setSize(window.innerWidth, window.innerHeight);
});
