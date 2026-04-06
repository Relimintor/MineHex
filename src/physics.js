const THREE = window.THREE;

import {
    GRAVITY,
    HEX_HEIGHT,
    JUMP_FORCE,
    MOVE_ACCELERATION,
    MOVE_FRICTION,
    MOVE_SPEED,
    NETHROCK_LEVEL_HEX,
    PLAYER_HEIGHT,
    SWIM_GRAVITY,
    SWIM_MOVE_SPEED,
    SWIM_UP_FORCE,
    VOID_RESPAWN_BUFFER_HEX
} from './config.js';
import { collectChunkRaycastCandidates } from './blocks.js';
import { worldToAxial } from './coords.js';
import { camera } from './scene.js';
import { enforceSpawnOnSolidBlock, isCameraInLiquid, isSolidBlockAt } from './rules.js';
import { inputState, worldState } from './state.js';
import { isKeyDown } from './input.js';

const GROUND_STICK_DISTANCE = 0.08;
const DOWN = new THREE.Vector3(0, -1, 0);
const groundRaycaster = new THREE.Raycaster();
const moveDir = new THREE.Vector3();
const moveEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const localGroundCandidates = [];
const GROUND_RAYCAST_CHUNK_RADIUS = 1;
const collisionProbePoint = new THREE.Vector3();
const PLAYER_HEAD_OFFSET = 0.1;
const PLAYER_TORSO_OFFSET = PLAYER_HEIGHT * 0.5;
const MAX_FALLBACK_SNAP_UP = HEX_HEIGHT * 1.1;

function isSolidAtWorldPosition(x, y, z) {
    collisionProbePoint.set(x, y, z);
    const { q, r, h } = worldToAxial(collisionProbePoint);
    return isSolidBlockAt(q, r, h);
}

function collidesAtCameraPosition(x, y, z) {
    if (isSolidAtWorldPosition(x, y - PLAYER_HEAD_OFFSET, z)) return true;
    return isSolidAtWorldPosition(x, y - PLAYER_TORSO_OFFSET, z);
}

function getFallbackGroundDistanceFromTopSolidColumn() {
    const { q, r } = worldState.frameCameraAxial ?? worldToAxial(camera.position);
    const topSolidH = worldState.topSolidHeightByColumn.get(`${q},${r}`);
    if (topSolidH === undefined) return null;
    if (!isSolidBlockAt(q, r, topSolidH)) return null;
    return camera.position.y - (topSolidH * HEX_HEIGHT);
}

function getGroundHit() {
    const cameraAxial = worldState.frameCameraAxial ?? worldToAxial(camera.position);
    collectChunkRaycastCandidates(cameraAxial.q, cameraAxial.r, GROUND_RAYCAST_CHUNK_RADIUS, localGroundCandidates, { collidableOnly: true });
    if (localGroundCandidates.length === 0) return null;
    groundRaycaster.set(camera.position, DOWN);
    groundRaycaster.far = PLAYER_HEIGHT + 1;
    const intersections = groundRaycaster.intersectObjects(localGroundCandidates, false);
    return intersections[0] ?? null;
}

function resolveGroundCollision() {
    const groundHit = getGroundHit();
    const fallbackDistanceToGround = groundHit ? null : getFallbackGroundDistanceFromTopSolidColumn();
    if (!groundHit && fallbackDistanceToGround === null) {
        inputState.canJump = false;
        return;
    }

    const standingDistance = PLAYER_HEIGHT;
    const distanceToGround = groundHit ? groundHit.distance : fallbackDistanceToGround;
    const usingFallbackDistance = !groundHit;
    if (usingFallbackDistance && distanceToGround < standingDistance - MAX_FALLBACK_SNAP_UP) {
        inputState.canJump = false;
        return;
    }
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

    moveDir.set(0, 0, 0);
    if (isKeyDown('KeyW')) moveDir.z -= 1;
    if (isKeyDown('KeyS')) moveDir.z += 1;
    if (isKeyDown('KeyA')) moveDir.x -= 1;
    if (isKeyDown('KeyD')) moveDir.x += 1;

    const hasMovementInput = moveDir.lengthSq() > 0;
    if (hasMovementInput) {
        moveEuler.y = inputState.yaw;
        moveDir.applyEuler(moveEuler).normalize();
    }

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
        if (isKeyDown('Space')) {
            inputState.velocity.y += SWIM_UP_FORCE * frameScale;
        }
        if (isKeyDown('ShiftLeft') || isKeyDown('ShiftRight')) {
            inputState.velocity.y -= SWIM_UP_FORCE * frameScale;
        }
        inputState.velocity.y += SWIM_GRAVITY * frameScale;
        inputState.velocity.y *= 0.92;
        inputState.canJump = false;
    } else if (isKeyDown('Space') && inputState.canJump) {
        inputState.velocity.y = JUMP_FORCE;
        inputState.canJump = false;
    } else {
        inputState.velocity.y += GRAVITY * frameScale;
    }

    const nextX = camera.position.x + (inputState.velocity.x * frameScale);
    if (!collidesAtCameraPosition(nextX, camera.position.y, camera.position.z)) {
        camera.position.x = nextX;
    } else {
        inputState.velocity.x = 0;
    }

    const nextZ = camera.position.z + (inputState.velocity.z * frameScale);
    if (!collidesAtCameraPosition(camera.position.x, camera.position.y, nextZ)) {
        camera.position.z = nextZ;
    } else {
        inputState.velocity.z = 0;
    }

    camera.position.y += inputState.velocity.y * frameScale;

    resolveGroundCollision();

    const worldEndY = (NETHROCK_LEVEL_HEX - VOID_RESPAWN_BUFFER_HEX) * HEX_HEIGHT;
    if (camera.position.y < worldEndY) {
        const currentAxial = worldState.frameCameraAxial ?? worldToAxial(camera.position);
        const didRespawnNearby = enforceSpawnOnSolidBlock(currentAxial.q, currentAxial.r);
        if (!didRespawnNearby) enforceSpawnOnSolidBlock(0, 0);
        inputState.velocity.y = 0;
    }
}
