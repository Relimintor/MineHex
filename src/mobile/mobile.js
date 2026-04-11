import { inputState } from '../state.js';
import { applyLookDelta, cancelMiningProgress, initInventoryUi, mineBlockFromCenter, placeBlockFromCenter, setKeyState, toggleInventoryScreen, updateSelectedBlock } from '../input.js';
import { toggleCameraPerspective } from '../playerView.js';

const MINE_REPEAT_MS = 90;
const MOBILE_MINE_HOLD_DELAY_MS = 170;
const LOOK_DRAG_CANCEL_MINE_PX = 12;
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
        <div id="mobile-top-buttons" aria-label="Mobile top controls">
            <button id="inventory-btn" type="button" aria-label="Toggle inventory">
                <img src="assets/mobile/controls/inventory_btn.png" alt="Inventory">
            </button>
            <button id="camera-btn" type="button" aria-label="Toggle camera perspective">
                <img src="assets/mobile/controls/camera_btn.png" alt="Camera perspective">
            </button>
        </div>
    `;

    document.body.appendChild(container);
    document.body.classList.add('mobile-mode');

    return {
        joystick: container.querySelector('#joystick'),
        joystickBase: container.querySelector('#joystick-base'),
        joystickCenter: container.querySelector('#joystick-center'),
        jumpButton: container.querySelector('#jump-btn'),
        inventoryButton: container.querySelector('#inventory-btn'),
        cameraButton: container.querySelector('#camera-btn')
    };
}

export function registerMobileInputHandlers() {
    inputState.isLocked = true;
    initInventoryUi();

    const { joystick, joystickBase, joystickCenter, jumpButton, inventoryButton, cameraButton } = createMobileControls();
    const inventoryScreen = document.getElementById('inventory-screen');
    const inventoryPanel = document.querySelector('.inventory-screen-panel');
    const activeTouches = new Map();
    const touchStartPositions = new Map();

    let movementTouchId = null;
    let lookTouchId = null;
    let mineInterval = null;
    let mineHoldTimeout = null;
    let isLookTouchDragging = false;

    function clearMiningTimers() {
        if (mineHoldTimeout) {
            clearTimeout(mineHoldTimeout);
            mineHoldTimeout = null;
        }
        if (mineInterval) {
            clearInterval(mineInterval);
            mineInterval = null;
        }
        cancelMiningProgress();
    }

    function resetJoystick() {
        joystickBase.src = 'assets/mobile/controls/joystick_off.png';
        joystickCenter.style.opacity = '0';
        joystickCenter.style.transform = 'translate(-50%, -50%)';
        setKeyState('KeyW', false);
        setKeyState('KeyS', false);
        setKeyState('KeyA', false);
        setKeyState('KeyD', false);
    }

    function updateMovementFromJoystick(deltaX, deltaY) {
        const distance = Math.min(JOYSTICK_MAX_RADIUS, Math.hypot(deltaX, deltaY));
        const angle = Math.atan2(deltaY, deltaX);
        const normalizedX = (Math.cos(angle) * distance) / JOYSTICK_MAX_RADIUS;
        const normalizedY = (Math.sin(angle) * distance) / JOYSTICK_MAX_RADIUS;

        joystickCenter.style.opacity = '1';
        joystickCenter.style.transform = `translate(calc(-50% + ${normalizedX * JOYSTICK_MAX_RADIUS}px), calc(-50% + ${normalizedY * JOYSTICK_MAX_RADIUS}px))`;

        setKeyState('KeyW', normalizedY < -JOYSTICK_DEADZONE);
        setKeyState('KeyS', normalizedY > JOYSTICK_DEADZONE);
        setKeyState('KeyA', normalizedX < -JOYSTICK_DEADZONE);
        setKeyState('KeyD', normalizedX > JOYSTICK_DEADZONE);
    }

    function updateLookTouch(touchId, x, y) {
        const previous = activeTouches.get(touchId);
        if (!previous) return;

        applyLookDelta(x - previous.x, y - previous.y, LOOK_SENSITIVITY);
        activeTouches.set(touchId, { x, y });
    }

    function startMiningHold() {
        clearMiningTimers();
        mineHoldTimeout = window.setTimeout(() => {
            mineHoldTimeout = null;
            if (lookTouchId === null || isLookTouchDragging) return;
            mineBlockFromCenter();
            mineInterval = window.setInterval(() => mineBlockFromCenter(), MINE_REPEAT_MS);
        }, MOBILE_MINE_HOLD_DELAY_MS);
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

            const isInventoryOpen = inventoryScreen?.classList.contains('visible');
            const tappedOutsideInventory = isInventoryOpen
                && inventoryPanel
                && !inventoryPanel.contains(target)
                && !inventoryButton.contains(target);
            if (tappedOutsideInventory) {
                toggleInventoryScreen();
                continue;
            }

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
                setKeyState('Space', true);
                continue;
            }

            if (inventoryButton.contains(target)) {
                toggleInventoryScreen();
                continue;
            }

            if (cameraButton.contains(target)) {
                toggleCameraPerspective();
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
                isLookTouchDragging = false;
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
                const start = touchStartPositions.get(touch.identifier);
                if (start) {
                    const moved = Math.hypot(touch.clientX - start.x, touch.clientY - start.y);
                    if (moved >= LOOK_DRAG_CANCEL_MINE_PX) {
                        isLookTouchDragging = true;
                        clearMiningTimers();
                    }
                }
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
                isLookTouchDragging = false;
            }

            if (jumpButton.contains(touch.target)) {
                setKeyState('Space', false);
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
