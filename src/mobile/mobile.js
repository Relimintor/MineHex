import { inputState } from '../state.js';
import { applyLookDelta, mineBlockFromCenter, placeBlockFromCenter, updateSelectedBlock } from '../input.js';

const HOLD_TO_MINE_DELAY_MS = 320;
const MINE_REPEAT_MS = 120;
const LOOK_SENSITIVITY = 0.003;
const JOYSTICK_DEADZONE = 0.14;
const JOYSTICK_MAX_RADIUS = 48;

function createMobileControls() {
    const container = document.createElement('div');
    container.id = 'mobile-controls';

    container.innerHTML = `
        <div id="joystick" aria-label="Movement joystick">
            <img id="joystick-base" src="assets/mobile/controls/joystick_off.png" alt="Joystick base">
            <img id="joystick-center" src="assets/mobile/controls/joystick_center.png" alt="Joystick center">
        </div>
        <button id="jump-btn" type="button" aria-label="Jump">
            <img src="assets/mobile/controls/jump_btn.png" alt="Jump">
        </button>
    `;

    document.body.appendChild(container);
    document.body.classList.add('mobile-mode');

    return {
        joystick: container.querySelector('#joystick'),
        joystickBase: container.querySelector('#joystick-base'),
        joystickCenter: container.querySelector('#joystick-center'),
        jumpButton: container.querySelector('#jump-btn')
    };
}

export function registerMobileInputHandlers() {
    inputState.isLocked = true;

    const { joystick, joystickBase, joystickCenter, jumpButton } = createMobileControls();
    const activeTouches = new Map();
    const touchStartPositions = new Map();

    let movementTouchId = null;
    let lookTouchId = null;
    let mineTimeout = null;
    let mineInterval = null;

    function clearMiningTimers() {
        if (mineTimeout) {
            clearTimeout(mineTimeout);
            mineTimeout = null;
        }

        if (mineInterval) {
            clearInterval(mineInterval);
            mineInterval = null;
        }
    }

    function resetJoystick() {
        joystickBase.src = 'assets/mobile/controls/joystick_off.png';
        joystickCenter.style.opacity = '0';
        joystickCenter.style.transform = 'translate(-50%, -50%)';
        inputState.keys.KeyW = false;
        inputState.keys.KeyS = false;
        inputState.keys.KeyA = false;
        inputState.keys.KeyD = false;
    }

    function updateMovementFromJoystick(deltaX, deltaY) {
        const distance = Math.min(JOYSTICK_MAX_RADIUS, Math.hypot(deltaX, deltaY));
        const angle = Math.atan2(deltaY, deltaX);
        const normalizedX = (Math.cos(angle) * distance) / JOYSTICK_MAX_RADIUS;
        const normalizedY = (Math.sin(angle) * distance) / JOYSTICK_MAX_RADIUS;

        joystickCenter.style.opacity = '1';
        joystickCenter.style.transform = `translate(calc(-50% + ${normalizedX * JOYSTICK_MAX_RADIUS}px), calc(-50% + ${normalizedY * JOYSTICK_MAX_RADIUS}px))`;

        inputState.keys.KeyW = normalizedY < -JOYSTICK_DEADZONE;
        inputState.keys.KeyS = normalizedY > JOYSTICK_DEADZONE;
        inputState.keys.KeyA = normalizedX < -JOYSTICK_DEADZONE;
        inputState.keys.KeyD = normalizedX > JOYSTICK_DEADZONE;
    }

    function updateLookTouch(touchId, x, y) {
        const previous = activeTouches.get(touchId);
        if (!previous) return;

        applyLookDelta(x - previous.x, y - previous.y, LOOK_SENSITIVITY);
        activeTouches.set(touchId, { x, y });
    }

    function startMiningHold() {
        clearMiningTimers();
        mineTimeout = window.setTimeout(() => {
            mineBlockFromCenter();
            mineInterval = window.setInterval(() => mineBlockFromCenter(), MINE_REPEAT_MS);
        }, HOLD_TO_MINE_DELAY_MS);
    }

    function handleCanvasTap() {
        placeBlockFromCenter();
    }

    function handleTouchStart(event) {
        event.preventDefault();
        for (const touch of event.changedTouches) {
            const target = touch.target;
            const touchPoint = { x: touch.clientX, y: touch.clientY };
            activeTouches.set(touch.identifier, touchPoint);
            touchStartPositions.set(touch.identifier, touchPoint);

            if (joystick.contains(target) && movementTouchId === null) {
                movementTouchId = touch.identifier;
                joystickBase.src = 'assets/mobile/controls/joystick_bg.png';
                const bounds = joystick.getBoundingClientRect();
                updateMovementFromJoystick(
                    touch.clientX - (bounds.left + bounds.width / 2),
                    touch.clientY - (bounds.top + bounds.height / 2)
                );
                continue;
            }

            if (jumpButton.contains(target)) {
                inputState.keys.Space = true;
                continue;
            }

            const slot = target.closest('.slot');
            if (slot) {
                const index = Number(slot.dataset.index);
                if (Number.isInteger(index)) updateSelectedBlock(index);
                continue;
            }

            if (lookTouchId === null) {
                lookTouchId = touch.identifier;
                startMiningHold();
            }
        }
    }

    function handleTouchMove(event) {
        event.preventDefault();
        for (const touch of event.changedTouches) {
            if (touch.identifier === movementTouchId) {
                const bounds = joystick.getBoundingClientRect();
                updateMovementFromJoystick(
                    touch.clientX - (bounds.left + bounds.width / 2),
                    touch.clientY - (bounds.top + bounds.height / 2)
                );
                activeTouches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
                continue;
            }

            if (touch.identifier === lookTouchId) {
                updateLookTouch(touch.identifier, touch.clientX, touch.clientY);
            }
        }
    }

    function handleTouchEnd(event) {
        event.preventDefault();
        for (const touch of event.changedTouches) {
            const wasLookTouch = touch.identifier === lookTouchId;

            if (touch.identifier === movementTouchId) {
                movementTouchId = null;
                resetJoystick();
            }

            if (touch.identifier === lookTouchId) {
                lookTouchId = null;
                const moved = (() => {
                    const start = touchStartPositions.get(touch.identifier);
                    if (!start) return 0;
                    return Math.hypot(touch.clientX - start.x, touch.clientY - start.y);
                })();

                if (moved < 10) handleCanvasTap();
                clearMiningTimers();
            }

            if (jumpButton.contains(touch.target)) {
                inputState.keys.Space = false;
            }

            activeTouches.delete(touch.identifier);
            touchStartPositions.delete(touch.identifier);

            if (wasLookTouch) clearMiningTimers();
        }
    }

    document.addEventListener('touchstart', handleTouchStart, { passive: false });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd, { passive: false });
    document.addEventListener('touchcancel', handleTouchEnd, { passive: false });

    document.querySelectorAll('.slot').forEach((slot) => {
        slot.addEventListener('click', () => {
            const index = Number(slot.dataset.index);
            if (Number.isInteger(index)) updateSelectedBlock(index);
        });
    });

    resetJoystick();
}
