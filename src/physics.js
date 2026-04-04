const THREE = window.THREE;

import {
    BLOCK_TYPES,
    GRAVITY,
    JUMP_FORCE,
    MOVE_ACCELERATION,
    MOVE_FRICTION,
    MOVE_SPEED,
    PLAYER_HEIGHT,
    SWIM_GRAVITY,
    SWIM_MOVE_SPEED,
    SWIM_UP_FORCE
} from './config.js';
import { camera } from './scene.js';
import { isCameraInLiquid } from './rules.js';
import { inputState, worldState } from './state.js';

const GROUND_STICK_DISTANCE = 0.08;
const DOWN = new THREE.Vector3(0, -1, 0);
const groundRaycaster = new THREE.Raycaster();

function getGroundHit() {
    groundRaycaster.set(camera.position, DOWN);
    groundRaycaster.far = PLAYER_HEIGHT + 1;
    const collidableBlocks = Array.from(worldState.worldBlocks.values()).filter((mesh) => {
        const blockType = BLOCK_TYPES[mesh.userData.typeIndex];
        return !blockType?.isLiquid;
    });
    const intersections = groundRaycaster.intersectObjects(collidableBlocks, false);
    return intersections[0] ?? null;
}

function resolveGroundCollision() {
    const groundHit = getGroundHit();
    if (!groundHit) {
        inputState.canJump = false;
        return;
    }

    const standingDistance = PLAYER_HEIGHT;
    const distanceToGround = groundHit.distance;
    const isInsideGround = distanceToGround < standingDistance;
    const shouldStickToGround = distanceToGround <= standingDistance + GROUND_STICK_DISTANCE && inputState.velocity.y <= 0;

    if (!isInsideGround && !shouldStickToGround) {
        inputState.canJump = false;
        return;
    }

    camera.position.y += standingDistance - distanceToGround;
    inputState.velocity.y = 0;
    inputState.canJump = true;
}

export function handlePhysics(deltaTimeSeconds = 1 / 60) {
    const frameScale = Math.min(3, Math.max(0, deltaTimeSeconds * 60));
    const isInLiquid = isCameraInLiquid();
    const moveDir = new THREE.Vector3();
    if (inputState.keys.KeyW) moveDir.z -= 1;
    if (inputState.keys.KeyS) moveDir.z += 1;
    if (inputState.keys.KeyA) moveDir.x -= 1;
    if (inputState.keys.KeyD) moveDir.x += 1;

    const hasMovementInput = moveDir.lengthSq() > 0;
    if (hasMovementInput) moveDir.applyEuler(new THREE.Euler(0, inputState.yaw, 0, 'YXZ')).normalize();

    const moveSpeed = isInLiquid ? SWIM_MOVE_SPEED : MOVE_SPEED;
    const targetVelocityX = hasMovementInput ? moveDir.x * moveSpeed : 0;
    const targetVelocityZ = hasMovementInput ? moveDir.z * moveSpeed : 0;
    const accelerationFactor = 1 - Math.pow(1 - MOVE_ACCELERATION, frameScale);
    const frictionFactor = Math.pow(1 - MOVE_FRICTION, frameScale);

    inputState.velocity.x += (targetVelocityX - inputState.velocity.x) * accelerationFactor;
    inputState.velocity.z += (targetVelocityZ - inputState.velocity.z) * accelerationFactor;

    if (!hasMovementInput) {
        inputState.velocity.x *= frictionFactor;
        inputState.velocity.z *= frictionFactor;
    }

    if (isInLiquid) {
        if (inputState.keys.Space) {
            inputState.velocity.y += SWIM_UP_FORCE * frameScale;
        }
        if (inputState.keys.ShiftLeft || inputState.keys.ShiftRight) {
            inputState.velocity.y -= SWIM_UP_FORCE * frameScale;
        }
        inputState.velocity.y += SWIM_GRAVITY * frameScale;
        inputState.velocity.y *= 0.92;
        inputState.canJump = false;
    } else if (inputState.keys.Space && inputState.canJump) {
        inputState.velocity.y = JUMP_FORCE;
        inputState.canJump = false;
    } else {
        inputState.velocity.y += GRAVITY * frameScale;
    }

    camera.position.x += inputState.velocity.x * frameScale;
    camera.position.z += inputState.velocity.z * frameScale;
    camera.position.y += inputState.velocity.y * frameScale;

    resolveGroundCollision();

    if (camera.position.y < -20) {
        camera.position.y = 10;
        inputState.velocity.y = 0;
    }
}
