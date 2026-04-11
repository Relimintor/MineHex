const THREE = window.THREE;

import { camera, renderer } from './scene.js';
import { BLOCK_TYPES, CHUNK_SIZE, HEX_HEIGHT, HEX_RADIUS, PLAYER_HEIGHT } from './config.js';
import { worldToAxial } from './coords.js';
import { addBlock, collectChunkRaycastCandidates, getIntersectedBlockKey, removeBlock } from './blocks.js';
import { getMiningDurationMsForType } from './hardness.js';
import { packBlockKey, unpackBlockKey } from './keys.js';
import { inputState, worldState } from './state.js';
import { toggleCameraPerspective, triggerCameraImpulse, triggerFirstPersonArmSwing } from './playerView.js';
import { flushDirtyChunksAroundBlock, flushEditedDirtyChunks } from './worldgen.js';

const raycaster = new THREE.Raycaster();
const CENTER_SCREEN = new THREE.Vector2(0, 0);
const placeNormal = new THREE.Vector3();
const placePos = new THREE.Vector3();
export const INTERACTION_RANGE = 8;
const inventoryScreen = document.getElementById('inventory-screen');
const heldItemNameEl = document.getElementById('held-item-name');
let isInventoryScreenOpen = false;
const localInteractionCandidates = [];
// Ensure the candidate chunk radius fully covers the interaction ray distance across all chunk-size profiles.
const INTERACTION_RAYCAST_CHUNK_RADIUS = Math.max(1, Math.ceil(INTERACTION_RANGE / Math.max(1, CHUNK_SIZE)) + 1);
const INTERACTION_CANDIDATE_CACHE_KEY = 'interaction';
// Keep mining/picking responsive while flicking the camera by rebuilding candidates each frame.
const INTERACTION_CANDIDATE_CACHE_FRAMES = 0;
const INTERACTION_RAY_NEAR = 0.05;
const localInteractionIntersections = [];
const INTERSECTION_BLOCK_HEIGHT_SCAN = Object.freeze([0, -1, 1, -2, 2]);
const INTERSECTION_SOLID_PULLBACK = Math.max(0.04, HEX_HEIGHT * 0.16);
const DESKTOP_MINE_REPEAT_MS = 75;
const DESKTOP_PLACE_REPEAT_MS = 75;
// Allow brief raycast misses on low FPS devices without resetting mining progress immediately.
const MINING_TARGET_LOSS_GRACE_MS = 260;
const TOTAL_HOTBAR_SLOTS = 9;
const BLOCK_PREVIEW_CLASS_BY_TYPE = [
    'block-preview-grass',
    'block-preview-dirt',
    'block-preview-stone',
    'block-preview-cloud',
    'block-preview-water',
    'block-preview-nethrock',
    'block-preview-oak-wood',
    'block-preview-oak-leaves',
    'block-preview-snow',
    'block-preview-ice',
    'block-preview-sand',
    'block-preview-sandstone'
];
const DRAG_DATA_MIME = 'text/minehex-slot';
const PLAYER_PLACE_COLLISION_HEIGHT_OFFSETS = Object.freeze([0.1, PLAYER_HEIGHT * 0.5, PLAYER_HEIGHT * 0.68]);
const PLAYER_PLACE_COLLISION_RING_RADIUS = HEX_RADIUS * 0.18;
const PLAYER_PLACE_COLLISION_RING_OFFSETS_XZ = Object.freeze([
    Object.freeze([0, 0]),
    Object.freeze([PLAYER_PLACE_COLLISION_RING_RADIUS, 0]),
    Object.freeze([-PLAYER_PLACE_COLLISION_RING_RADIUS, 0]),
    Object.freeze([0, PLAYER_PLACE_COLLISION_RING_RADIUS]),
    Object.freeze([0, -PLAYER_PLACE_COLLISION_RING_RADIUS])
]);

const inventoryItemsBySlotId = new Map();
const bottomHotbarSlotEls = new Map();
const inventoryHotbarSlotEls = new Map();
const extraInventorySlotEls = new Map();
let dragSourceSlotId = null;
let selectedHotbarSlotIndex = 0;
let inventoryUiInitialized = false;
let heldInventoryItemType = null;
let heldItemNameTimeoutId = null;
let desktopMiningIntervalId = null;
let desktopPlacingIntervalId = null;
let lastPointerUnlockAtMs = 0;
let miningTargetBlockKey = null;
let miningTargetLastSeenAtMs = 0;
// Minecraft-style continuous damage accumulation while holding on the same target.
let miningProgress01 = 0;
let miningLastTickAtMs = 0;

const KEY_CODE_TO_INDEX = {
    KeyW: 0,
    KeyA: 1,
    KeyS: 2,
    KeyD: 3,
    Space: 4,
    ShiftLeft: 5,
    ShiftRight: 6
};

export function setKeyState(code, isPressed) {
    const keyIndex = KEY_CODE_TO_INDEX[code];
    if (keyIndex === undefined) return;
    inputState.keys[keyIndex] = isPressed ? 1 : 0;
}

export function isKeyDown(code) {
    const keyIndex = KEY_CODE_TO_INDEX[code];
    if (keyIndex === undefined) return false;
    return inputState.keys[keyIndex] === 1;
}

export function updateSelectedBlock(index) {
    if (!inventoryUiInitialized) initInventoryUi();
    selectedHotbarSlotIndex = index;
    const selectedSlotId = `hotbar-${index}`;
    const selectedType = inventoryItemsBySlotId.get(selectedSlotId);
    worldState.selectedBlockIndex = Number.isInteger(selectedType) ? selectedType : -1;
    showHeldItemName(worldState.selectedBlockIndex);
    document.querySelectorAll('.slot').forEach((slot, i) => slot.classList.toggle('active', i === index));
    document
        .querySelectorAll('.inventory-hex-slot.is-hotbar')
        .forEach((slot) => slot.classList.toggle('active', Number(slot.dataset.slot) === index));
}

function showHeldItemName(blockTypeIndex) {
    if (!heldItemNameEl) return;
    if (!Number.isInteger(blockTypeIndex) || blockTypeIndex < 0 || blockTypeIndex >= BLOCK_TYPES.length) {
        heldItemNameEl.classList.remove('visible');
        if (heldItemNameTimeoutId) {
            clearTimeout(heldItemNameTimeoutId);
            heldItemNameTimeoutId = null;
        }
        return;
    }

    heldItemNameEl.textContent = BLOCK_TYPES[blockTypeIndex].name;
    heldItemNameEl.classList.add('visible');
    if (heldItemNameTimeoutId) clearTimeout(heldItemNameTimeoutId);
    heldItemNameTimeoutId = setTimeout(() => {
        heldItemNameEl.classList.remove('visible');
        heldItemNameTimeoutId = null;
    }, 2500);
}

export function toggleInventoryScreen() {
    if (!inventoryUiInitialized) initInventoryUi();
    if (!inventoryScreen) return;
    isInventoryScreenOpen = !isInventoryScreenOpen;
    inventoryScreen.classList.toggle('visible', isInventoryScreenOpen);
    inventoryScreen.setAttribute('aria-hidden', isInventoryScreenOpen ? 'false' : 'true');

    if (isInventoryScreenOpen) {
        inputState.keys.fill(0);
        if (document.pointerLockElement === renderer.domElement) {
            document.exitPointerLock();
        }
    }
}

function getCenterIntersection() {
    const cameraAxial = worldState.frameCameraAxial ?? worldToAxial(camera.position);
    raycaster.setFromCamera(CENTER_SCREEN, camera);
    raycaster.near = INTERACTION_RAY_NEAR;
    raycaster.far = INTERACTION_RANGE;
    collectChunkRaycastCandidates(cameraAxial.q, cameraAxial.r, INTERACTION_RAYCAST_CHUNK_RADIUS, localInteractionCandidates, {
        cacheKey: INTERACTION_CANDIDATE_CACHE_KEY,
        reuseFrames: INTERACTION_CANDIDATE_CACHE_FRAMES,
        rayOrigin: raycaster.ray.origin,
        rayDirection: raycaster.ray.direction,
        rayNear: raycaster.near,
        rayFar: raycaster.far
    });
    if (localInteractionCandidates.length === 0) return null;
    localInteractionIntersections.length = 0;
    raycaster.intersectObjects(localInteractionCandidates, false, localInteractionIntersections);
    return localInteractionIntersections[0] ?? null;
}

function clearDesktopActionIntervals() {
    if (desktopMiningIntervalId) {
        clearInterval(desktopMiningIntervalId);
        desktopMiningIntervalId = null;
    }
    if (desktopPlacingIntervalId) {
        clearInterval(desktopPlacingIntervalId);
        desktopPlacingIntervalId = null;
    }
}

export function cancelMiningProgress() {
    miningTargetBlockKey = null;
    miningTargetLastSeenAtMs = 0;
    miningProgress01 = 0;
    miningLastTickAtMs = 0;
}

function resolveBlockKeyFromIntersection(intersection) {
    const directBlockKey = getIntersectedBlockKey(intersection);
    // Ignore stale instanced-mesh keys that can linger briefly while chunk meshes rebuild.
    if (directBlockKey && worldState.worldBlocks.has(directBlockKey)) return directBlockKey;
    if (!intersection?.point) return null;

    placePos.copy(intersection.point);
    if (intersection.face?.normal) {
        placeNormal.copy(intersection.face.normal).transformDirection(intersection.object.matrixWorld);
        placePos.addScaledVector(placeNormal, -INTERSECTION_SOLID_PULLBACK);
    }

    const coords = worldToAxial(placePos);
    for (const deltaH of INTERSECTION_BLOCK_HEIGHT_SCAN) {
        const candidateBlockKey = packBlockKey(coords.q, coords.r, coords.h + deltaH);
        if (worldState.worldBlocks.has(candidateBlockKey)) return candidateBlockKey;
    }

    return null;
}

function doesPlayerOverlapBlockCell(targetQ, targetR, targetH) {
    for (const offsetY of PLAYER_PLACE_COLLISION_HEIGHT_OFFSETS) {
        const sampleY = camera.position.y - offsetY;
        for (const [offsetX, offsetZ] of PLAYER_PLACE_COLLISION_RING_OFFSETS_XZ) {
            placePos.set(camera.position.x + offsetX, sampleY, camera.position.z + offsetZ);
            const sample = worldToAxial(placePos);
            if (sample.q === targetQ && sample.r === targetR && sample.h === targetH) return true;
        }
    }
    return false;
}

export function placeBlockFromCenter() {
    cancelMiningProgress();
    if (!Number.isInteger(worldState.selectedBlockIndex) || worldState.selectedBlockIndex < 0) return false;
    const intersect = getCenterIntersection();
    if (!intersect) return false;

    placeNormal.copy(intersect.face.normal).transformDirection(intersect.object.matrixWorld);
    placePos.copy(intersect.point).addScaledVector(placeNormal, HEX_HEIGHT * 0.6);
    const coords = worldToAxial(placePos);
    if (doesPlayerOverlapBlockCell(coords.q, coords.r, coords.h)) return false;
    addBlock(coords.q, coords.r, coords.h, worldState.selectedBlockIndex, true);
    return true;
}

export function mineBlockFromCenter() {
    triggerFirstPersonArmSwing();
    const now = performance.now();
    const intersect = getCenterIntersection();
    if (!intersect && (!miningTargetBlockKey || (now - miningTargetLastSeenAtMs) > MINING_TARGET_LOSS_GRACE_MS)) {
        cancelMiningProgress();
        return false;
    }
    let blockKey = resolveBlockKeyFromIntersection(intersect);
    if (!blockKey && (!miningTargetBlockKey || (now - miningTargetLastSeenAtMs) > MINING_TARGET_LOSS_GRACE_MS)) {
        cancelMiningProgress();
        return false;
    }
    if (
        blockKey
        && miningTargetBlockKey
        && blockKey !== miningTargetBlockKey
        && (now - miningTargetLastSeenAtMs) <= MINING_TARGET_LOSS_GRACE_MS
    ) {
        // Prefer the existing target during brief intersection jitter so harder blocks
        // (like stone) don't keep resetting progress between neighboring keys.
        blockKey = miningTargetBlockKey;
    }
    if (blockKey) miningTargetLastSeenAtMs = now;
    const activeBlockKey = blockKey ?? miningTargetBlockKey;

    if (miningTargetBlockKey !== activeBlockKey) {
        miningTargetBlockKey = activeBlockKey;
        miningTargetLastSeenAtMs = now;
        miningProgress01 = 0;
        miningLastTickAtMs = now;
    }

    const blockMesh = worldState.worldBlocks.get(activeBlockKey);
    const typeIndex = blockMesh?.userData?.typeIndex;
    const miningDurationMs = getMiningDurationMsForType(typeIndex);
    if (!Number.isFinite(miningDurationMs)) {
        cancelMiningProgress();
        return false;
    }

    const deltaMs = Math.max(0, Math.min(200, now - (miningLastTickAtMs || now)));
    miningLastTickAtMs = now;
    const safeDurationMs = Math.max(1, miningDurationMs);
    miningProgress01 += deltaMs / safeDurationMs;
    if (miningProgress01 < 1) return false;

    const didRemove = removeBlock(activeBlockKey);
    cancelMiningProgress();
    if (!didRemove) return false;
    const { q, r } = unpackBlockKey(activeBlockKey);
    flushDirtyChunksAroundBlock(q, r);
    flushEditedDirtyChunks(Number.POSITIVE_INFINITY);
    triggerCameraImpulse(0.16);
    return true;
}

export function applyLookDelta(deltaX, deltaY, sensitivity = 0.002) {
    inputState.yaw -= deltaX * sensitivity;
    inputState.pitch -= deltaY * sensitivity;
    inputState.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, inputState.pitch));
}

export function registerDesktopInputHandlers() {
    initInventoryUi();

    document.querySelectorAll('.slot').forEach((slot) => {
        slot.addEventListener('click', () => {
            const index = Number(slot.dataset.index);
            if (Number.isInteger(index)) updateSelectedBlock(index);
        });
    });

    document.addEventListener('keydown', (event) => {
        if ((event.code === 'KeyI' || event.code === 'KeyY') && !event.repeat) {
            toggleInventoryScreen();
            event.preventDefault();
            return;
        }

        setKeyState(event.code, true);
        if (event.code === 'KeyC' && !event.repeat) {
            toggleCameraPerspective();
            return;
        }
        if (event.key >= '1' && event.key <= '9') updateSelectedBlock(parseInt(event.key, 10) - 1);
    });

    document.addEventListener('keyup', (event) => {
        setKeyState(event.code, false);
    });

    renderer.domElement.addEventListener('click', () => {
        if (inputState.isLocked) return;
        if ((performance.now() - lastPointerUnlockAtMs) < 220) return;
        const lockRequest = renderer.domElement.requestPointerLock();
        if (typeof lockRequest?.catch === 'function') {
            lockRequest.catch((error) => {
                if (error?.name !== 'SecurityError') {
                    console.warn('Pointer lock request failed:', error);
                }
            });
        }
    });

    document.addEventListener('pointerlockchange', () => {
        inputState.isLocked = document.pointerLockElement === renderer.domElement;
        if (!inputState.isLocked) {
            lastPointerUnlockAtMs = performance.now();
        }
    });

    document.addEventListener('mousemove', (event) => {
        if (!inputState.isLocked) return;
        applyLookDelta(event.movementX, event.movementY);
    });

    window.addEventListener('mousedown', (event) => {
        if (!inputState.isLocked) return;
        if (event.button === 0) {
            mineBlockFromCenter();
            if (desktopMiningIntervalId) clearInterval(desktopMiningIntervalId);
            desktopMiningIntervalId = window.setInterval(() => mineBlockFromCenter(), DESKTOP_MINE_REPEAT_MS);
            return;
        }

        if (event.button === 2) {
            placeBlockFromCenter();
            if (desktopPlacingIntervalId) clearInterval(desktopPlacingIntervalId);
            desktopPlacingIntervalId = window.setInterval(() => placeBlockFromCenter(), DESKTOP_PLACE_REPEAT_MS);
        }
    });

    window.addEventListener('mouseup', (event) => {
        if (event.button === 0 && desktopMiningIntervalId) {
            clearInterval(desktopMiningIntervalId);
            desktopMiningIntervalId = null;
            cancelMiningProgress();
        }
        if (event.button === 2 && desktopPlacingIntervalId) {
            clearInterval(desktopPlacingIntervalId);
            desktopPlacingIntervalId = null;
        }
    });

    window.addEventListener('blur', () => {
        clearDesktopActionIntervals();
        cancelMiningProgress();
    });

    window.addEventListener('contextmenu', (event) => event.preventDefault());
}

export function initInventoryUi() {
    if (inventoryUiInitialized) return;
    initializeInventorySlots();
    inventoryUiInitialized = true;
    renderInventorySlots();
}

function initializeInventorySlots() {
    if (inventoryItemsBySlotId.size > 0) return;

    document.querySelectorAll('.slot').forEach((slot) => {
        const index = Number(slot.dataset.index);
        if (!Number.isInteger(index)) return;
        const slotId = `hotbar-${index}`;
        bottomHotbarSlotEls.set(slotId, slot);
        if (index < TOTAL_HOTBAR_SLOTS) inventoryItemsBySlotId.set(slotId, index);
        registerInventorySlotDnD(slot, slotId);
    });

    document.querySelectorAll('.inventory-hex-slot.is-hotbar').forEach((slot) => {
        const index = Number(slot.dataset.slot);
        if (!Number.isInteger(index)) return;
        const slotId = `hotbar-${index}`;
        inventoryHotbarSlotEls.set(slotId, slot);
        registerInventorySlotDnD(slot, slotId);
    });

    document.querySelectorAll('.inventory-square-slot').forEach((slot) => {
        const slotNumber = Number(slot.dataset.topSlot);
        if (!Number.isInteger(slotNumber)) return;
        const slotId = `top-${slotNumber}`;
        extraInventorySlotEls.set(slotId, slot);
        inventoryItemsBySlotId.set(slotId, null);
        registerInventorySlotDnD(slot, slotId);
    });

    document.querySelectorAll('.inventory-hex-slot:not(.is-hotbar)').forEach((slot) => {
        const slotNumber = Number(slot.dataset.hiveSlot);
        if (!Number.isInteger(slotNumber)) return;
        const slotId = `hive-${slotNumber}`;
        extraInventorySlotEls.set(slotId, slot);
        inventoryItemsBySlotId.set(slotId, null);
        registerInventorySlotDnD(slot, slotId);
    });
}

function registerInventorySlotDnD(slotEl, slotId) {
    slotEl.setAttribute('draggable', 'true');

    slotEl.addEventListener('dragstart', (event) => {
        if (!inventoryItemsBySlotId.get(slotId) && inventoryItemsBySlotId.get(slotId) !== 0) {
            event.preventDefault();
            return;
        }
        dragSourceSlotId = slotId;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(DRAG_DATA_MIME, slotId);
    });

    slotEl.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    });

    slotEl.addEventListener('drop', (event) => {
        event.preventDefault();
        const sourceSlotId = event.dataTransfer.getData(DRAG_DATA_MIME) || dragSourceSlotId;
        transferInventoryItem(sourceSlotId, slotId);
    });

    slotEl.addEventListener('dragend', () => {
        dragSourceSlotId = null;
    });

    slotEl.addEventListener('touchend', (event) => {
        event.preventDefault();
        handleInventorySlotPickup(slotId);
    });

    slotEl.addEventListener('click', () => {
        handleInventorySlotPickup(slotId);
    });
}

function transferInventoryItem(sourceSlotId, targetSlotId) {
    if (!sourceSlotId || !targetSlotId || sourceSlotId === targetSlotId) return;
    if (!inventoryItemsBySlotId.has(sourceSlotId) || !inventoryItemsBySlotId.has(targetSlotId)) return;

    const sourceItem = inventoryItemsBySlotId.get(sourceSlotId);
    const targetItem = inventoryItemsBySlotId.get(targetSlotId);
    inventoryItemsBySlotId.set(targetSlotId, sourceItem ?? null);
    inventoryItemsBySlotId.set(sourceSlotId, targetItem ?? null);
    renderInventorySlots();
}

function renderInventorySlots() {
    for (const [slotId, slotEl] of bottomHotbarSlotEls.entries()) {
        const blockType = inventoryItemsBySlotId.get(slotId);
        renderSlotPreview(slotEl, blockType, true);
    }

    for (const [slotId, slotEl] of inventoryHotbarSlotEls.entries()) {
        const blockType = inventoryItemsBySlotId.get(slotId);
        renderSlotPreview(slotEl, blockType, false);
    }

    for (const [slotId, slotEl] of extraInventorySlotEls.entries()) {
        const blockType = inventoryItemsBySlotId.get(slotId);
        renderSlotPreview(slotEl, blockType, false);
    }

    updateSelectedBlock(Math.max(0, Math.min(TOTAL_HOTBAR_SLOTS - 1, selectedHotbarSlotIndex)));
}

function handleInventorySlotPickup(slotId) {
    if (!inventoryScreen || !inventoryScreen.classList.contains('visible')) return;
    if (!inventoryItemsBySlotId.has(slotId)) return;

    if (!Number.isInteger(heldInventoryItemType)) {
        const slotItem = inventoryItemsBySlotId.get(slotId);
        if (!Number.isInteger(slotItem)) return;
        heldInventoryItemType = slotItem;
        inventoryItemsBySlotId.set(slotId, null);
        renderInventorySlots();
        return;
    }

    const targetItem = inventoryItemsBySlotId.get(slotId);
    inventoryItemsBySlotId.set(slotId, heldInventoryItemType);
    heldInventoryItemType = Number.isInteger(targetItem) ? targetItem : null;
    renderInventorySlots();
}

function renderSlotPreview(slotEl, blockType, preserveInnerHtml) {
    const currentPreview = slotEl.querySelector('.block-preview');
    if (currentPreview) currentPreview.remove();

    if (!Number.isInteger(blockType) || blockType < 0 || blockType >= BLOCK_PREVIEW_CLASS_BY_TYPE.length) return;
    const previewEl = document.createElement('div');
    previewEl.className = `block-preview ${BLOCK_PREVIEW_CLASS_BY_TYPE[blockType]}`;

    if (preserveInnerHtml) {
        const label = slotEl.querySelector('.slot-label');
        if (label) slotEl.insertBefore(previewEl, label);
        else slotEl.appendChild(previewEl);
        return;
    }

    slotEl.appendChild(previewEl);
}
