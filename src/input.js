const THREE = window.THREE;

import { camera, renderer } from './scene.js';
import { HEX_HEIGHT } from './config.js';
import { worldToAxial } from './coords.js';
import { addBlock, removeBlock } from './blocks.js';
import { inputState, worldState } from './state.js';

const raycaster = new THREE.Raycaster();
const CENTER_SCREEN = new THREE.Vector2(0, 0);
const placeNormal = new THREE.Vector3();
const placePos = new THREE.Vector3();
export const INTERACTION_RANGE = 8;

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

function getCenterIntersection() {
    raycaster.setFromCamera(CENTER_SCREEN, camera);
    raycaster.far = INTERACTION_RANGE;
    const intersects = raycaster.intersectObjects(worldState.worldBlockList, false);
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
    removeBlock(intersect.object.userData.key);
    return true;
}

export function applyLookDelta(deltaX, deltaY, sensitivity = 0.002) {
    inputState.yaw -= deltaX * sensitivity;
    inputState.pitch -= deltaY * sensitivity;
    inputState.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, inputState.pitch));
}

export function registerDesktopInputHandlers() {
    document.addEventListener('keydown', (event) => {
        setKeyState(event.code, true);
        if (event.key >= '1' && event.key <= '5') updateSelectedBlock(parseInt(event.key, 10) - 1);
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
