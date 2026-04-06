const THREE = window.THREE;

import { camera, renderer } from './scene.js';
import { HEX_HEIGHT } from './config.js';
import { worldToAxial } from './coords.js';
import { addBlock, collectChunkRaycastCandidates, getIntersectedBlockKey, removeBlock } from './blocks.js';
import { inputState, worldState } from './state.js';
import { toggleCameraPerspective } from './playerView.js';

const raycaster = new THREE.Raycaster();
const CENTER_SCREEN = new THREE.Vector2(0, 0);
const placeNormal = new THREE.Vector3();
const placePos = new THREE.Vector3();
export const INTERACTION_RANGE = 8;
const inventoryScreen = document.getElementById('inventory-screen');
let isInventoryScreenOpen = false;
const localInteractionCandidates = [];
const INTERACTION_RAYCAST_CHUNK_RADIUS = 1;

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
    worldState.selectedBlockIndex = index;
    document.querySelectorAll('.slot').forEach((slot, i) => slot.classList.toggle('active', i === index));
}

export function toggleInventoryScreen() {
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
    collectChunkRaycastCandidates(cameraAxial.q, cameraAxial.r, INTERACTION_RAYCAST_CHUNK_RADIUS, localInteractionCandidates);
    if (localInteractionCandidates.length === 0) return null;
    raycaster.setFromCamera(CENTER_SCREEN, camera);
    raycaster.far = INTERACTION_RANGE;
    const intersects = raycaster.intersectObjects(localInteractionCandidates, false);
    return intersects[0] ?? null;
}

export function placeBlockFromCenter() {
    const intersect = getCenterIntersection();
    if (!intersect) return false;

    placeNormal.copy(intersect.face.normal).transformDirection(intersect.object.matrixWorld);
    placePos.copy(intersect.point).addScaledVector(placeNormal, HEX_HEIGHT * 0.6);
    const coords = worldToAxial(placePos);
    addBlock(coords.q, coords.r, coords.h, worldState.selectedBlockIndex, true);
    return true;
}

export function mineBlockFromCenter() {
    const intersect = getCenterIntersection();
    if (!intersect) return false;
    const blockKey = getIntersectedBlockKey(intersect);
    if (!blockKey) return false;
    removeBlock(blockKey);
    return true;
}

export function applyLookDelta(deltaX, deltaY, sensitivity = 0.002) {
    inputState.yaw -= deltaX * sensitivity;
    inputState.pitch -= deltaY * sensitivity;
    inputState.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, inputState.pitch));
}

export function registerDesktopInputHandlers() {
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
        if (!inputState.isLocked) renderer.domElement.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
        inputState.isLocked = document.pointerLockElement === renderer.domElement;
    });

    document.addEventListener('mousemove', (event) => {
        if (!inputState.isLocked) return;
        applyLookDelta(event.movementX, event.movementY);
    });

    window.addEventListener('mousedown', (event) => {
        if (!inputState.isLocked) return;
        if (event.button === 0) {
            mineBlockFromCenter();
            return;
        }

        if (event.button === 2) placeBlockFromCenter();
    });

    window.addEventListener('contextmenu', (event) => event.preventDefault());
}
