const THREE = window.THREE;

import { camera, renderer, scene, skyController } from './scene.js';
import { inputState } from './state.js';
import { registerDesktopInputHandlers, tickDroppedMiningItems } from './input.js';
import { registerMobileInputHandlers } from './mobile/mobile.js';
import { registerCeleronInputHandlers } from './celeron/celeronInput.js';
import { registerYoutubeInputHandlers } from './youtube.js';
import { handlePhysics } from './physics.js';
import { getBiomeAtWorldPosition, prewarmChunksAroundAxial, runChunkOcclusionCulling, tickChunkApplyBudget, tickChunkStreaming, tickChunkVisibility, updateChunkBudgetGovernor } from './worldgen.js';
import { CHUNK_SIZE, ENABLE_OCCLUSION_CULLING, MAX_DEVICE_PIXEL_RATIO, TARGET_FPS, USE_ULTRA_LOW_PROFILE } from './config.js';
import { enforceSpawnOnSolidBlock } from './rules.js';
import { worldToAxial, worldToCube, axialToWorld } from './coords.js';
import { getProfilerSnapshot, profilerBeginFrame, profilerEndFrame, profilerRecord, setWorldSeed, toggleProfilerEnabled, worldState } from './state.js';
import { normalizeBlockKey, packBlockKey, packChunkKey, packColumnKey, unpackBlockKey } from './keys.js';
import { updateCameraPerspective } from './playerView.js';
import { initInventoryAvatarPreview, renderInventoryAvatarPreview } from './inventoryAvatar.js';
import { createPostProcessor } from './postprocessing.js';
import { removeBlock } from './blocks.js';

camera.position.set(0, 48, 0);

const PERFORMANCE_PROFILE_KEY = 'minehexPerformanceProfile';
const CONTROL_MODE_KEY = 'minehexControlMode';
const WORLD_DB_NAME = 'minehex';
const WORLD_DB_VERSION = 1;
const WORLD_STORE = 'worlds';
const WORLD_AUTOSAVE_INTERVAL_MS = 5000;
const METEOR_SHOWER_SPAWN_INTERVAL_SECONDS = 0.85;
const METEOR_GIANT_3D_SPAWN_CHANCE = 0.01;
const METEOR_PREWARM_HEX_RADIUS = 70;
const METEOR_CRATER_RADIUS_HEX = 8;
const METEOR_MAX_ACTIVE_COUNT = 14;
const METEOR_TRAIL_MAX_POINTS = 20;
const METEOR_RELIC_FLOAT_HEIGHT = 4;
const METEOR_SKY_ALTITUDE_MIN = 190;
const METEOR_SKY_ALTITUDE_MAX = 250;
const METEOR_SKY_MAX_LIFETIME_SECONDS = 6.5;
const worldQuery = new URLSearchParams(window.location.search);
const activeWorldId = Number(worldQuery.get('worldId'));
const requestedGameMode = worldQuery.get('gameMode');
let activeWorldRecord = null;
let lastWorldAutosaveAt = 0;
let worldSaveInFlight = false;
let meteorTemplate = null;
const activeMeteors = [];
let lastMeteorNightIndex = -1;
let meteorSpawnCooldownSeconds = 0;

function normalizeGameMode(gameMode) {
    return gameMode === 'survival' ? 'survival' : 'creative';
}

function isNightTime(timeSeconds) {
    const angle = ((timeSeconds / 480) * Math.PI * 2) + Math.PI * 0.5;
    return Math.sin(angle) < -0.06;
}

function getNightIndex(timeSeconds) {
    return Math.floor((timeSeconds + 240) / 480);
}

function createFallbackMeteorMesh() {
    const meteor = new THREE.Mesh(
        new THREE.IcosahedronGeometry(3.2, 1),
        new THREE.MeshStandardMaterial({ color: 0xdba74b, emissive: 0x8a5a00, emissiveIntensity: 1.25, roughness: 0.6, metalness: 0.2 })
    );
    meteor.castShadow = false;
    meteor.receiveShadow = false;
    return meteor;
}

async function ensureMeteorTemplateLoaded() {
    if (meteorTemplate) return meteorTemplate;
    if (!THREE.GLTFLoader) return null;
    try {
        const loader = new THREE.GLTFLoader();
        const meteorUrl = new URL('../assets/meteor.glb', import.meta.url).href;
        const gltf = await loader.loadAsync(meteorUrl);
        meteorTemplate = gltf.scene || createFallbackMeteorMesh();
        meteorTemplate.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = false;
                child.receiveShadow = false;
                if (child.material?.isMeshStandardMaterial) {
                    child.material = child.material.clone();
                    child.material.color = new THREE.Color(0xe2b85f);
                    child.material.emissive = new THREE.Color(0x9a6600);
                    child.material.emissiveIntensity = 1.35;
                    child.material.roughness = Math.min(0.72, child.material.roughness ?? 0.72);
                    child.material.metalness = Math.max(0.18, child.material.metalness ?? 0.18);
                }
            }
        });
    } catch {
        meteorTemplate = null;
    }
    return meteorTemplate;
}

function cloneMeteorMesh() {
    if (meteorTemplate) {
        return meteorTemplate.clone(true);
    }
    return createFallbackMeteorMesh();
}

function createMeteorTrail(startPosition) {
    const positions = new Float32Array(METEOR_TRAIL_MAX_POINTS * 3);
    for (let i = 0; i < METEOR_TRAIL_MAX_POINTS; i++) {
        const offset = i * 3;
        positions[offset] = startPosition.x;
        positions[offset + 1] = startPosition.y;
        positions[offset + 2] = startPosition.z;
    }
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const trailMaterial = new THREE.LineBasicMaterial({
        color: 0xffd36b,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const trailLine = new THREE.Line(trailGeometry, trailMaterial);
    trailLine.frustumCulled = false;
    scene.add(trailLine);
    return { trailLine, trailGeometry, positions };
}

function updateMeteorTrail(meteor) {
    const { positions, trailGeometry } = meteor;
    for (let i = METEOR_TRAIL_MAX_POINTS - 1; i > 0; i--) {
        const toOffset = i * 3;
        const fromOffset = (i - 1) * 3;
        positions[toOffset] = positions[fromOffset];
        positions[toOffset + 1] = positions[fromOffset + 1];
        positions[toOffset + 2] = positions[fromOffset + 2];
    }
    positions[0] = meteor.mesh.position.x;
    positions[1] = meteor.mesh.position.y;
    positions[2] = meteor.mesh.position.z;
    trailGeometry.attributes.position.needsUpdate = true;
}

function disposeMeteorTrail(meteor) {
    if (!meteor.trailLine) return;
    scene.remove(meteor.trailLine);
    meteor.trailGeometry?.dispose();
    meteor.trailLine.material?.dispose();
    meteor.trailLine = null;
    meteor.trailGeometry = null;
}

function spawnMeteor() {
    if (activeMeteors.length >= METEOR_MAX_ACTIVE_COUNT) return;
    const spawnGiant3DMeteor = Math.random() < METEOR_GIANT_3D_SPAWN_CHANCE;
    let meteorMesh;
    let spawnWorld;
    let velocity;
    let canImpact = false;

    if (spawnGiant3DMeteor && meteorTemplate) {
        canImpact = true;
        spawnWorld = camera.position.clone().add(new THREE.Vector3(
            (Math.random() - 0.5) * 340,
            180 + Math.random() * 50,
            (Math.random() - 0.5) * 340
        ));
        const targetWorld = camera.position.clone().add(new THREE.Vector3(
            (Math.random() - 0.5) * 80,
            14 + Math.random() * 10,
            (Math.random() - 0.5) * 80
        ));
        velocity = targetWorld.sub(spawnWorld).normalize().multiplyScalar(72 + Math.random() * 16);
        meteorMesh = cloneMeteorMesh();
        meteorMesh.scale.setScalar(2.2 + Math.random() * 1.4);
        scene.add(meteorMesh);
    } else {
        const travelDirection = new THREE.Vector3(
            Math.random() - 0.5,
            (Math.random() - 0.5) * 0.05,
            Math.random() - 0.5
        ).normalize();
        const sideOffset = new THREE.Vector3(-travelDirection.z, 0, travelDirection.x).multiplyScalar((Math.random() - 0.5) * 190);
        spawnWorld = camera.position.clone()
            .addScaledVector(travelDirection, -240 - Math.random() * 110)
            .add(sideOffset);
        spawnWorld.y = METEOR_SKY_ALTITUDE_MIN + Math.random() * (METEOR_SKY_ALTITUDE_MAX - METEOR_SKY_ALTITUDE_MIN);
        velocity = travelDirection.multiplyScalar(95 + Math.random() * 28);
        meteorMesh = new THREE.Object3D();
    }

    meteorMesh.position.copy(spawnWorld);
    const trail = createMeteorTrail(spawnWorld);

    activeMeteors.push({
        mesh: meteorMesh,
        velocity,
        canImpact,
        ageSeconds: 0,
        ...trail,
        impactQ: null,
        impactR: null
    });
}

function carveMeteorCrater(centerQ, centerR) {
    for (let dq = -METEOR_CRATER_RADIUS_HEX; dq <= METEOR_CRATER_RADIUS_HEX; dq++) {
        for (let dr = -METEOR_CRATER_RADIUS_HEX; dr <= METEOR_CRATER_RADIUS_HEX; dr++) {
            const ds = -dq - dr;
            const dist = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
            if (dist > METEOR_CRATER_RADIUS_HEX) continue;
            const q = centerQ + dq;
            const r = centerR + dr;
            const columnKey = packColumnKey(q, r);
            const topH = worldState.topSolidHeightByColumn.get(columnKey);
            if (!Number.isFinite(topH)) continue;
            const depth = Math.max(2, Math.floor((METEOR_CRATER_RADIUS_HEX - dist) * 1.6));
            for (let h = topH; h >= topH - depth; h--) {
                const blockKey = packBlockKey(q, r, h);
                removeBlock(blockKey, { preservePermanent: false, force: true, trackDirty: true, trackRemoval: true });
            }
        }
    }
}

function updateMeteor(deltaTimeSeconds, timeSeconds) {
    const nightIndex = getNightIndex(timeSeconds);
    if (isNightTime(timeSeconds) && nightIndex !== lastMeteorNightIndex) {
        lastMeteorNightIndex = nightIndex;
        meteorSpawnCooldownSeconds = 0;
    }
    const nightTime = isNightTime(timeSeconds);
    if (nightTime) {
        meteorSpawnCooldownSeconds -= deltaTimeSeconds;
        while (meteorSpawnCooldownSeconds <= 0) {
            spawnMeteor();
            meteorSpawnCooldownSeconds += METEOR_SHOWER_SPAWN_INTERVAL_SECONDS * (0.6 + Math.random() * 0.95);
        }
    } else {
        meteorSpawnCooldownSeconds = 0;
    }

    for (let i = activeMeteors.length - 1; i >= 0; i--) {
        const meteor = activeMeteors[i];
        meteor.ageSeconds += deltaTimeSeconds;
        meteor.mesh.position.addScaledVector(meteor.velocity, deltaTimeSeconds);
        meteor.mesh.rotation.x += deltaTimeSeconds * 2.2;
        meteor.mesh.rotation.y += deltaTimeSeconds * 1.6;
        updateMeteorTrail(meteor);

        if (!meteor.canImpact) {
            if (meteor.ageSeconds >= METEOR_SKY_MAX_LIFETIME_SECONDS) {
                disposeMeteorTrail(meteor);
                activeMeteors.splice(i, 1);
            }
            continue;
        }

        const meteorAxial = worldToAxial(meteor.mesh.position);
        const playerAxial = worldState.frameCameraAxial ?? worldToAxial(camera.position);
        const meteorDistance = Math.max(Math.abs(meteorAxial.q - playerAxial.q), Math.abs(meteorAxial.r - playerAxial.r), Math.abs((-meteorAxial.q - meteorAxial.r) - (-playerAxial.q - playerAxial.r)));
        if (meteorDistance <= METEOR_PREWARM_HEX_RADIUS) {
            prewarmChunksAroundAxial(meteorAxial.q, meteorAxial.r, METEOR_PREWARM_HEX_RADIUS);
        }

        const impactTopH = worldState.topSolidHeightByColumn.get(packColumnKey(meteorAxial.q, meteorAxial.r));
        if (!Number.isFinite(impactTopH) || meteorAxial.h > impactTopH + 1) continue;
        meteor.impactQ = meteorAxial.q;
        meteor.impactR = meteorAxial.r;
        carveMeteorCrater(meteor.impactQ, meteor.impactR);
        meteor.mesh.position.copy(axialToWorld(meteor.impactQ, meteor.impactR, impactTopH + METEOR_RELIC_FLOAT_HEIGHT));
        meteor.velocity.set(0, 0, 0);
        disposeMeteorTrail(meteor);
        activeMeteors.splice(i, 1);
    }
}

function getChunkKeyFromAxial(q, r) {
    const cq = Math.round(q / CHUNK_SIZE);
    const cr = Math.round(r / CHUNK_SIZE);
    return packChunkKey(cq, cr);
}

function openWorldDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(WORLD_DB_NAME, WORLD_DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(WORLD_STORE)) {
                const store = db.createObjectStore(WORLD_STORE, { keyPath: 'id', autoIncrement: true });
                store.createIndex('name', 'name', { unique: true });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Unable to open world database.'));
    });
}

function getWorldById(worldId) {
    if (!Number.isFinite(worldId) || worldId <= 0) return Promise.resolve(null);
    return openWorldDb().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(WORLD_STORE, 'readonly');
        const store = tx.objectStore(WORLD_STORE);
        const request = store.get(worldId);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error || new Error('Unable to load world.'));
        tx.oncomplete = () => db.close();
    }));
}

function writeWorld(record) {
    return openWorldDb().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(WORLD_STORE, 'readwrite');
        const store = tx.objectStore(WORLD_STORE);
        const request = store.put(record);
        request.onsuccess = () => resolve(record);
        request.onerror = () => reject(request.error || new Error('Unable to save world.'));
        tx.oncomplete = () => db.close();
    }));
}

function applyWorldRecord(record) {
    const worldData = record?.data ?? {};
    worldState.gameMode = normalizeGameMode(requestedGameMode ?? record?.gameMode ?? worldData?.gameMode);
    setWorldSeed(worldData.seed ?? record?.id ?? Date.now());

    worldState.permanentBlocks.clear();
    worldState.permanentBlocksByChunk.clear();
    worldState.removedBlocks.clear();
    worldState.removedBlocksByChunk.clear();

    const permanentBlocks = Array.isArray(worldData.permanentBlocks) ? worldData.permanentBlocks : [];
    for (const block of permanentBlocks) {
        if (!block || !Number.isFinite(block.q) || !Number.isFinite(block.r) || !Number.isFinite(block.h) || !Number.isFinite(block.typeIndex)) continue;
        const chunkKey = getChunkKeyFromAxial(block.q, block.r);
        const blockKey = packBlockKey(block.q, block.r, block.h);
        worldState.permanentBlocks.set(blockKey, {
            q: block.q,
            r: block.r,
            h: block.h,
            typeIndex: block.typeIndex
        });
        if (!worldState.permanentBlocksByChunk.has(chunkKey)) worldState.permanentBlocksByChunk.set(chunkKey, new Set());
        worldState.permanentBlocksByChunk.get(chunkKey).add(blockKey);
    }

    const removedBlocks = Array.isArray(worldData.removedBlocks) ? worldData.removedBlocks : [];
    for (const storedKey of removedBlocks) {
        if (typeof storedKey !== 'string' || storedKey.length === 0) continue;
        const blockKey = normalizeBlockKey(storedKey);
        worldState.removedBlocks.add(blockKey);
        const parsed = unpackBlockKey(blockKey);
        const chunkKey = getChunkKeyFromAxial(parsed.q, parsed.r);
        if (!worldState.removedBlocksByChunk.has(chunkKey)) worldState.removedBlocksByChunk.set(chunkKey, new Set());
        worldState.removedBlocksByChunk.get(chunkKey).add(blockKey);
    }

    if (worldData.player && Number.isFinite(worldData.player.x) && Number.isFinite(worldData.player.y) && Number.isFinite(worldData.player.z)) {
        camera.position.set(worldData.player.x, worldData.player.y, worldData.player.z);
    }
}

function buildWorldDataSnapshot() {
    const baseData = activeWorldRecord?.data ?? {};
    const gameMode = normalizeGameMode(activeWorldRecord?.gameMode ?? baseData?.gameMode ?? worldState.gameMode);
    return {
        ...baseData,
        gameMode,
        seed: baseData.seed ?? activeWorldRecord?.id ?? Date.now(),
        player: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        permanentBlocks: Array.from(worldState.permanentBlocks.values()).map((block) => ({
            q: block.q,
            r: block.r,
            h: block.h,
            typeIndex: block.typeIndex
        })),
        removedBlocks: Array.from(worldState.removedBlocks).map((key) => {
            const coords = unpackBlockKey(key);
            return `${coords.q},${coords.r},${coords.h}`;
        })
    };
}

async function persistActiveWorld({ force = false } = {}) {
    if (!activeWorldRecord || !Number.isFinite(activeWorldRecord.id) || activeWorldRecord.id <= 0) return;
    if (worldSaveInFlight && !force) return;
    worldSaveInFlight = true;
    try {
        activeWorldRecord = {
            ...activeWorldRecord,
            gameMode: normalizeGameMode(activeWorldRecord?.gameMode ?? worldState.gameMode),
            updatedAt: new Date().toISOString(),
            data: buildWorldDataSnapshot()
        };
        await writeWorld(activeWorldRecord);
        lastWorldAutosaveAt = performance.now();
    } finally {
        worldSaveInFlight = false;
    }
}

async function initializeWorldFromQuery() {
    if (!Number.isFinite(activeWorldId) || activeWorldId <= 0) {
        worldState.gameMode = normalizeGameMode(requestedGameMode);
        setWorldSeed('default');
        return;
    }
    const world = await getWorldById(activeWorldId);
    if (!world) {
        worldState.gameMode = normalizeGameMode(requestedGameMode);
        setWorldSeed('default');
        return;
    }
    activeWorldRecord = world;
    applyWorldRecord(world);
}

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
                localStorage.setItem(PERFORMANCE_PROFILE_KEY, 'celeron_cb');
                localStorage.setItem(CONTROL_MODE_KEY, 'youtube');
                if (status) status.textContent = 'YouTube mode enabled. Reloading...';
                window.location.reload();
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
const postProcessor = createPostProcessor(renderer, scene, camera);
const POST_FX_PANEL_KEY = 'minehexPostFxPanelOpen';
const POST_FX_OPTIONS_KEY = 'minehexPostFxOptions';
let postFxPanel = null;
let currentControlMode = 'pc';
let lastBiomeGradeUpdate = 0;
const BIOME_GRADE_UPDATE_MS = 350;

function resolveBiomeGradeName(biome) {
    if (biome === 'forest' || biome === 'snowy_forest') return biome === 'forest' ? 'forest' : 'snow';
    if (biome === 'snowy_plains' || biome === 'arctic') return 'snow';
    if (biome === 'beach') return 'desert';
    return 'neutral';
}

function resolveBiomeGradeWeight(sample) {
    if (!sample) return 0;
    if (sample.biome === 'forest') return 0.9;
    if (sample.biome === 'snowy_forest') return 1.0;
    if (sample.biome === 'snowy_plains' || sample.biome === 'arctic') return 0.95;
    if (sample.biome === 'beach') return 0.85;
    return 0.35;
}

function loadSavedPostFxOptions() {
    if (!postProcessor) return;
    const raw = localStorage.getItem(POST_FX_OPTIONS_KEY);
    if (!raw) return;
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            postProcessor.setOptions(parsed);
        }
    } catch {
        localStorage.removeItem(POST_FX_OPTIONS_KEY);
    }
}

function persistPostFxOptions() {
    if (!postProcessor) return;
    localStorage.setItem(POST_FX_OPTIONS_KEY, JSON.stringify(postProcessor.getOptions()));
}

function ensurePostFxPanel() {
    if (currentControlMode === 'mobile') return null;
    if (postFxPanel) return postFxPanel;
    postFxPanel = document.createElement('div');
    postFxPanel.id = 'postfx-panel';
    postFxPanel.classList.add('hidden');
    postFxPanel.innerHTML = `
        <div class="postfx-panel-title">Post FX (Shift+7)</div>
        <label><input type="checkbox" data-postfx-option="enabled"> Enable post-processing</label>
        <label><input type="checkbox" data-postfx-option="bloom"> Bloom</label>
        <label><input type="checkbox" data-postfx-option="ssao"> SSAO</label>
        <label><input type="checkbox" data-postfx-option="colorGrading"> Color grading</label>
        <label><input type="checkbox" data-postfx-option="vignetteGrain"> Vignette + grain</label>
        <label><input type="checkbox" data-postfx-option="dof"> DOF (Shift+8)</label>
    `;
    document.body.appendChild(postFxPanel);

    if (!postProcessor) {
        postFxPanel.insertAdjacentHTML('beforeend', '<div class="postfx-panel-note">Post FX unavailable on this profile/device.</div>');
        return postFxPanel;
    }

    postFxPanel.querySelectorAll('input[data-postfx-option]').forEach((checkbox) => {
        checkbox.addEventListener('input', () => {
            const optionKey = checkbox.getAttribute('data-postfx-option');
            if (!optionKey) return;
            postProcessor.setOptions({ [optionKey]: checkbox.checked });
            persistPostFxOptions();
        });
    });

    return postFxPanel;
}

function syncPostFxPanel() {
    if (!postProcessor || !postFxPanel) return;
    const options = postProcessor.getOptions();
    postFxPanel.querySelectorAll('input[data-postfx-option]').forEach((checkbox) => {
        const optionKey = checkbox.getAttribute('data-postfx-option');
        if (!optionKey) return;
        checkbox.checked = Boolean(options[optionKey]);
    });
}

function togglePostFxPanel() {
    const panel = ensurePostFxPanel();
    if (!panel) return;
    const shouldShow = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !shouldShow);
    if (shouldShow) syncPostFxPanel();
    localStorage.setItem(POST_FX_PANEL_KEY, shouldShow ? '1' : '0');
}

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
    tickDroppedMiningItems(deltaTimeSeconds);
    updateMeteor(deltaTimeSeconds, now * 0.001);
    if (postProcessor && (now - lastBiomeGradeUpdate) >= BIOME_GRADE_UPDATE_MS) {
        const sample = getBiomeAtWorldPosition(playerPosition.x, playerPosition.z);
        postProcessor.setBiomeGrade(resolveBiomeGradeName(sample.biome), resolveBiomeGradeWeight(sample));
        lastBiomeGradeUpdate = now;
    }
    skyController?.update(now * 0.001, camera);
    const renderStart = performance.now();
    if (postProcessor) {
        postProcessor.render(now * 0.001);
    } else {
        renderer.render(scene, camera);
    }
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
    if (activeWorldRecord && (now - lastWorldAutosaveAt) >= WORLD_AUTOSAVE_INTERVAL_MS) {
        persistActiveWorld();
    }
    const profilerEndStart = performance.now();
    profilerEndFrame(performance.now(), profilerOverheadMs);
    profilerOverheadMs += performance.now() - profilerEndStart;
}


initializeWorldFromQuery().then(() => chooseControlMode()).then((mode) => {
    currentControlMode = mode;
    if (mode === 'mobile') {
        registerMobileInputHandlers();
    } else if (mode === 'celeron_cb') {
        registerCeleronInputHandlers();
        coordinatesHudFrameInterval = 8;
    } else if (mode === 'youtube') {
        registerYoutubeInputHandlers();
        coordinatesHudFrameInterval = 10;
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
    loadSavedPostFxOptions();
    if (mode !== 'mobile' && localStorage.getItem(POST_FX_PANEL_KEY) === '1') {
        ensurePostFxPanel();
        postFxPanel?.classList.remove('hidden');
        syncPostFxPanel();
    }
    animate();
});

ensureMeteorTemplateLoaded();

window.addEventListener('beforeunload', () => {
    persistActiveWorld({ force: true });
});

window.addEventListener('keydown', (event) => {
    if (event.code !== 'F6') return;
    toggleProfilerEnabled();
    updateProfilerOverlay(performance.now());
});

window.addEventListener('keydown', (event) => {
    if (currentControlMode === 'mobile') return;
    if (event.code === 'Digit7' && event.shiftKey) {
        event.preventDefault();
        togglePostFxPanel();
        return;
    }
    if (event.code !== 'Digit8' || !event.shiftKey) return;
    event.preventDefault();
    if (!postProcessor) return;
    const options = postProcessor.getOptions();
    postProcessor.setPhotoMode(!options.dof);
    persistPostFxOptions();
    syncPostFxPanel();
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO));
    renderer.setSize(window.innerWidth, window.innerHeight);
    postProcessor?.resize(window.innerWidth, window.innerHeight);
});
