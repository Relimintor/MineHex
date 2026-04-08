const THREE = window.THREE;

import { camera, renderer, scene, skyController } from './scene.js';
import { inputState } from './state.js';
import { registerDesktopInputHandlers } from './input.js';
import { registerMobileInputHandlers } from './mobile/mobile.js';
import { registerCeleronInputHandlers } from './celeron/celeronInput.js';
import { handlePhysics } from './physics.js';
import { runChunkOcclusionCulling, tickChunkApplyBudget, tickChunkStreaming, tickChunkVisibility, updateChunkBudgetGovernor } from './worldgen.js';
import { ENABLE_OCCLUSION_CULLING, MAX_DEVICE_PIXEL_RATIO, TARGET_FPS, USE_ULTRA_LOW_PROFILE } from './config.js';
import { enforceSpawnOnSolidBlock } from './rules.js';
import { worldToAxial, worldToCube } from './coords.js';
import { getProfilerSnapshot, profilerBeginFrame, profilerEndFrame, profilerRecord, toggleProfilerEnabled, worldState } from './state.js';
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
        const secretControlToggle = modeScreen.querySelector('#secret-control-toggle');
        const youtubeControl = modeScreen.querySelector('#youtube-control');
        const status = modeScreen.querySelector('#mode-status');

        if (secretControlToggle && youtubeControl) {
            secretControlToggle.addEventListener('dblclick', () => {
                youtubeControl.classList.add('revealed');
                youtubeControl.setAttribute('aria-hidden', 'false');
                if (status) status.textContent = 'Hidden control unlocked: YouTube.';
            });

            youtubeControl.addEventListener('click', () => {
                if (status) status.textContent = 'YouTube control selected.';
            });
        }

        if (savedMode) {
            for (const button of buttons) {
                button.classList.toggle('active', button.dataset.mode === savedMode);
            }
        }

        buttons.forEach((button) => {
            button.addEventListener('click', () => {
                const mode = button.dataset.mode;
                if (mode === 'console') {
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
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
const OCCLUSION_CULLING_INTERVAL_FRAMES = 2;
const CHUNK_BUDGET_GOVERNOR_INTERVAL_FRAMES = USE_ULTRA_LOW_PROFILE ? 4 : 2;
const CHUNK_APPLY_INTERVAL_FRAMES = USE_ULTRA_LOW_PROFILE ? 4 : 2;
const CHUNK_STREAM_INTERVAL_FRAMES = USE_ULTRA_LOW_PROFILE ? 8 : 4;
const CHUNK_VISIBILITY_INTERVAL_FRAMES = USE_ULTRA_LOW_PROFILE ? 6 : 3;
const coordinatesHud = document.getElementById('coordinates');
let governorElapsedMs = 0;
let hasSpawnedInAllowedRange = false;
let coordinatesHudFrameInterval = 1;
let profilerOverlay = null;
let lastProfilerOverlayUpdate = 0;
const PROFILER_OVERLAY_UPDATE_MS = 250;

function ensureProfilerOverlay() {
    if (profilerOverlay) return profilerOverlay;
    profilerOverlay = document.createElement('div');
    profilerOverlay.id = 'profiler-overlay';
    profilerOverlay.classList.add('hidden');
    document.body.appendChild(profilerOverlay);
    return profilerOverlay;
}

function fmtMs(value) {
    return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

function updateProfilerOverlay(nowMs = performance.now()) {
    const overlay = ensureProfilerOverlay();
    if (!worldState.profiler.enabled) {
        overlay.classList.add('hidden');
        return;
    }
    overlay.classList.remove('hidden');
    if ((nowMs - lastProfilerOverlayUpdate) < PROFILER_OVERLAY_UPDATE_MS) return;
    lastProfilerOverlayUpdate = nowMs;

    const snapshot = getProfilerSnapshot();
    const rows = [
        ['physics', 'physics'],
        ['stream queue+gen', 'stream_total'],
        ['stream queue rebuild', 'stream_rebuild_queue'],
        ['dirty apply', 'dirty_apply'],
        ['visibility/lod', 'visibility_lod'],
        ['occlusion results', 'occlusion_results'],
        ['occlusion setup', 'occlusion_setup'],
        ['render', 'render'],
        ['frame total', 'frame_total'],
        ['profiler overhead', 'profiler_overhead']
    ];

    const lines = ['Profiler (F6 toggle)', 'metric | p50 | p95 | p99'];
    for (const [label, key] of rows) {
        const metric = snapshot[key];
        if (!metric) continue;
        lines.push(`${label}: ${fmtMs(metric.p50)} | ${fmtMs(metric.p95)} | ${fmtMs(metric.p99)} ms`);
    }
    overlay.textContent = lines.join('\n');
}

function updateCoordinatesHud() {
    if (!coordinatesHud) return;
    const { q, r, h } = worldToAxial(playerPosition);
    const { x, y, z } = worldToCube(playerPosition);
    coordinatesHud.textContent = `Axial q:${q} r:${r} h:${h} | Cube x:${x} y:${y} z:${z}`;
}

function animate(now = performance.now()) {
    requestAnimationFrame(animate);
    const elapsedMs = now - lastFrameTime;
    if (elapsedMs < FRAME_INTERVAL_MS) return;
    let profilerOverheadMs = 0;
    const profilerBeginStart = performance.now();
    profilerBeginFrame(now);
    profilerOverheadMs += performance.now() - profilerBeginStart;
    const deltaTimeSeconds = Math.min(0.1, elapsedMs / 1000);
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
    const renderStart = performance.now();
    renderer.render(scene, camera);
    const renderDuration = performance.now() - renderStart;
    const renderRecordStart = performance.now();
    profilerRecord('render', renderDuration);
    profilerOverheadMs += performance.now() - renderRecordStart;
    renderInventoryAvatarPreview(now * 0.001);
    if (ENABLE_OCCLUSION_CULLING && (worldState.frame % OCCLUSION_CULLING_INTERVAL_FRAMES) === 0) {
        runChunkOcclusionCulling();
    }
    const overlayStart = performance.now();
    updateProfilerOverlay(now);
    profilerOverheadMs += performance.now() - overlayStart;
    const profilerEndStart = performance.now();
    profilerEndFrame(performance.now(), profilerOverheadMs);
    profilerOverheadMs += performance.now() - profilerEndStart;
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
    ensureProfilerOverlay();
    animate();
});

window.addEventListener('keydown', (event) => {
    if (event.code !== 'F6') return;
    toggleProfilerEnabled();
    updateProfilerOverlay(performance.now());
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO));
    renderer.setSize(window.innerWidth, window.innerHeight);
});
