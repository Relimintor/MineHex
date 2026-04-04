const THREE = window.THREE;

import { camera, renderer } from './scene.js';
import { worldToAxial } from './coords.js';
import { addBlock, removeBlock } from './blocks.js';
import { inputState, worldState } from './state.js';

const raycaster = new THREE.Raycaster();

function updateSelectedBlock(index) {
    worldState.selectedBlockIndex = index;
    document.querySelectorAll('.slot').forEach((slot, i) => slot.classList.toggle('active', i === index));
}

export function registerInputHandlers() {
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
        inputState.yaw -= event.movementX * 0.002;
        inputState.pitch -= event.movementY * 0.002;
        inputState.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, inputState.pitch));
    });

    window.addEventListener('mousedown', (event) => {
        if (!inputState.isLocked) return;
        raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
        const intersects = raycaster.intersectObjects(Array.from(worldState.worldBlocks.values()));

        if (intersects.length === 0) return;

        const intersect = intersects[0];
        if (event.button === 0) {
            if (!intersect.object.userData.isPermanent && !event.shiftKey) return;
            removeBlock(intersect.object.userData.key);
            return;
        }

        if (event.button === 2) {
            const normal = intersect.face.normal.clone();
            normal.transformDirection(intersect.object.matrixWorld);
            const placePos = intersect.point.clone().add(normal.multiplyScalar(0.5));
            const coords = worldToAxial(placePos);
            addBlock(coords.q, coords.r, coords.h, worldState.selectedBlockIndex, true);
        }
    });

    window.addEventListener('contextmenu', (event) => event.preventDefault());
}
