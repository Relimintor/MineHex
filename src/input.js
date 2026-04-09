const THREE = window.THREE;

import { camera, renderer } from './scene.js';
import { BLOCK_TYPES, HEX_HEIGHT } from './config.js';
import { worldToAxial } from './coords.js';
import { unpackBlockKey } from './keys.js';
import { addBlock, collectChunkRaycastCandidates, getIntersectedBlockKey, removeBlock } from './blocks.js';
import { flushDirtyChunkAtWorld } from './worldgen.js';
import { inputState, worldState } from './state.js';
import { toggleCameraPerspective, triggerCameraImpulse, triggerFirstPersonArmSwing } from './playerView.js';

const raycaster = new THREE.Raycaster();
const CENTER_SCREEN = new THREE.Vector2(0, 0);
const placeNormal = new THREE.Vector3();
const placePos = new THREE.Vector3();
export const INTERACTION_RANGE = 8;
const inventoryScreen = document.getElementById('inventory-screen');
const heldItemNameEl = document.getElementById('held-item-name');
let isInventoryScreenOpen = false;
const localInteractionCandidates = [];
const INTERACTION_RAYCAST_CHUNK_RADIUS = 1;
const INTERACTION_CANDIDATE_CACHE_KEY = 'interaction';
const INTERACTION_CANDIDATE_CACHE_FRAMES = 6;
const INTERACTION_RAY_NEAR = 0.05;
const localInteractionIntersections = [];
const DESKTOP_MINE_REPEAT_MS = 35;
const DESKTOP_PLACE_REPEAT_MS = 55;
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

export function placeBlockFromCenter() {
    if (!Number.isInteger(worldState.selectedBlockIndex) || worldState.selectedBlockIndex < 0) return false;
    const intersect = getCenterIntersection();
    if (!intersect) return false;

    placeNormal.copy(intersect.face.normal).transformDirection(intersect.object.matrixWorld);
    placePos.copy(intersect.point).addScaledVector(placeNormal, HEX_HEIGHT * 0.6);
    const coords = worldToAxial(placePos);
    addBlock(coords.q, coords.r, coords.h, worldState.selectedBlockIndex, true);
    flushDirtyChunkAtWorld(coords.q, coords.r);
    return true;
}

export function mineBlockFromCenter() {
    triggerFirstPersonArmSwing();
    const intersect = getCenterIntersection();
    if (!intersect) return false;
    const blockKey = getIntersectedBlockKey(intersect);
    if (!blockKey) return false;
    const removed = removeBlock(blockKey);
    if (!removed) return false;
    const { q, r } = unpackBlockKey(blockKey);
    flushDirtyChunkAtWorld(q, r);
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
        }
        if (event.button === 2 && desktopPlacingIntervalId) {
            clearInterval(desktopPlacingIntervalId);
            desktopPlacingIntervalId = null;
        }
    });

    window.addEventListener('blur', () => {
        clearDesktopActionIntervals();
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
