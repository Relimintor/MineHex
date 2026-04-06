import { renderer } from '../scene.js';
import {
    applyLookDelta,
    mineBlockFromCenter,
    placeBlockFromCenter,
    setKeyState,
    updateSelectedBlock
} from '../input.js';
import { inputState } from '../state.js';
import { toggleCameraPerspective } from '../playerView.js';

const LOOK_SENSITIVITY = 0.0018;
const INTERACTION_COOLDOWN_MS = 90;

let pendingLookX = 0;
let pendingLookY = 0;
let hasQueuedLookFrame = false;
let lastInteractionAt = 0;

function flushQueuedLookDelta() {
    hasQueuedLookFrame = false;
    if (!inputState.isLocked) {
        pendingLookX = 0;
        pendingLookY = 0;
        return;
    }

    if (pendingLookX === 0 && pendingLookY === 0) return;
    applyLookDelta(pendingLookX, pendingLookY, LOOK_SENSITIVITY);
    pendingLookX = 0;
    pendingLookY = 0;
}

function queueLookDelta(deltaX, deltaY) {
    pendingLookX += deltaX;
    pendingLookY += deltaY;
    if (hasQueuedLookFrame) return;
    hasQueuedLookFrame = true;
    requestAnimationFrame(flushQueuedLookDelta);
}

function canInteractNow() {
    const now = performance.now();
    if (now - lastInteractionAt < INTERACTION_COOLDOWN_MS) return false;
    lastInteractionAt = now;
    return true;
}

export function registerCeleronInputHandlers() {
    document.querySelectorAll('.slot').forEach((slot) => {
        slot.addEventListener('click', () => {
            const index = Number(slot.dataset.index);
            if (Number.isInteger(index)) updateSelectedBlock(index);
        });
    });

    document.addEventListener('keydown', (event) => {
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
        queueLookDelta(event.movementX, event.movementY);
    });

    window.addEventListener('mousedown', (event) => {
        if (!inputState.isLocked) return;
        if (!canInteractNow()) return;

        if (event.button === 0) {
            mineBlockFromCenter();
            return;
        }

        if (event.button === 2) placeBlockFromCenter();
    });

    window.addEventListener('contextmenu', (event) => event.preventDefault());
}
