import { renderer } from '../scene.js';
import {
    applyLookDelta,
    cancelMiningProgress,
    mineBlockFromCenter,
    placeBlockFromCenter,
    setKeyState,
    toggleInventoryScreen,
    updateSelectedBlock
} from '../input.js';
import { inputState } from '../state.js';
import { toggleCameraPerspective } from '../playerView.js';

const LOOK_SENSITIVITY = 0.0018;
const INTERACTION_COOLDOWN_MS = 90;
const MINE_REPEAT_MS = 75;
const PLACE_REPEAT_MS = 75;

let pendingLookX = 0;
let pendingLookY = 0;
let hasQueuedLookFrame = false;
let lastInteractionAt = 0;
let miningIntervalId = null;
let placingIntervalId = null;

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
        if (!inputState.isLocked) {
            if (miningIntervalId) {
                clearInterval(miningIntervalId);
                miningIntervalId = null;
                cancelMiningProgress();
            }
            if (placingIntervalId) {
                clearInterval(placingIntervalId);
                placingIntervalId = null;
            }
        }
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
            if (miningIntervalId) clearInterval(miningIntervalId);
            miningIntervalId = window.setInterval(() => mineBlockFromCenter(), MINE_REPEAT_MS);
            return;
        }

        if (event.button === 2) {
            placeBlockFromCenter();
            if (placingIntervalId) clearInterval(placingIntervalId);
            placingIntervalId = window.setInterval(() => placeBlockFromCenter(), PLACE_REPEAT_MS);
        }
    });

    window.addEventListener('mouseup', (event) => {
        if (event.button === 0 && miningIntervalId) {
            clearInterval(miningIntervalId);
            miningIntervalId = null;
            cancelMiningProgress();
        }
        if (event.button === 2 && placingIntervalId) {
            clearInterval(placingIntervalId);
            placingIntervalId = null;
        }
    });

    window.addEventListener('blur', () => {
        if (miningIntervalId) {
            clearInterval(miningIntervalId);
            miningIntervalId = null;
            cancelMiningProgress();
        }
        if (placingIntervalId) {
            clearInterval(placingIntervalId);
            placingIntervalId = null;
        }
    });

    window.addEventListener('contextmenu', (event) => event.preventDefault());
}
