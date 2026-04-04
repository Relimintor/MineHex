const THREE = window.THREE;

import { camera, renderer } from './scene.js';
import { HEX_HEIGHT } from './config.js';
import { worldToAxial } from './coords.js';
import { addBlock, removeBlock } from './blocks.js';
import { inputState, worldState } from './state.js';

const raycaster = new THREE.Raycaster();

export function updateSelectedBlock(index) {
    worldState.selectedBlockIndex = index;
    document.querySelectorAll('.slot').forEach((slot, i) => slot.classList.toggle('active', i === index));
}

function getCenterIntersection() {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = raycaster.intersectObjects(Array.from(worldState.worldBlocks.values()));
    return intersects[0] ?? null;
}

export function placeBlockFromCenter() {
    const intersect = getCenterIntersection();
    if (!intersect) return false;

    const normal = intersect.face.normal.clone();
    normal.transformDirection(intersect.object.matrixWorld);
    const placePos = intersect.point.clone().add(normal.multiplyScalar(HEX_HEIGHT * 0.6));
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
        inputState.keys[event.code] = true;
        if (event.key >= '1' && event.key <= '4') updateSelectedBlock(parseInt(event.key, 10) - 1);
    });

    document.addEventListener('keyup', (event) => {
        inputState.keys[event.code] = false;
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
