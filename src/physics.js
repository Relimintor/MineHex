const THREE = window.THREE;

import {
    AIR_CONTROL_MULTIPLIER,
    AIR_DRAG,
    CHUNK_SIZE,
    COYOTE_TIME_SECONDS,
    GRAVITY,
    HEX_HEIGHT,
    JUMP_FORCE,
    MOVE_DECELERATION,
    MOVE_DIRECTION_CHANGE_ACCELERATION,
    MOVE_INITIAL_ACCELERATION,
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
import { packChunkKey, packColumnKey } from './keys.js';
import { camera } from './scene.js';
import { enforceSpawnOnSolidBlock, isCameraInLiquid, isSolidBlockAt } from './rules.js';
import { inputState, profilerRecord, worldState } from './state.js';
import { isKeyDown } from './input.js';
import { triggerCameraImpulse } from './playerView.js';

const GROUND_STICK_DISTANCE = 0.08;
const DOWN = new THREE.Vector3(0, -1, 0);
const groundRaycaster = new THREE.Raycaster();
const moveDir = new THREE.Vector3();
const moveEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const localGroundCandidates = [];
const GROUND_RAYCAST_CHUNK_RADIUS = 1;
const GROUND_CANDIDATE_CACHE_KEY = 'ground';
const GROUND_CANDIDATE_CACHE_FRAMES = 6;
const GROUND_RAY_NEAR = 0.01;
const LOCAL_GROUND_INTERSECTIONS = [];
const collisionProbePoint = new THREE.Vector3();
const horizontalVelocity = new THREE.Vector2();
const horizontalTargetVelocity = new THREE.Vector2();
const horizontalCurrentDir = new THREE.Vector2();
const horizontalTargetDir = new THREE.Vector2();
const PLAYER_HEAD_OFFSET = 0.1;
const PLAYER_TORSO_OFFSET = PLAYER_HEIGHT * 0.5;
const MAX_FALLBACK_SNAP_UP = HEX_HEIGHT * 1.1;
const SPRINT_MULTIPLIER = 1.42;
const SPRINT_ACCEL_MULTIPLIER = 1.16;
const LANDING_IMPACT_THRESHOLD = -0.52;
const MIN_DIRECTION_EVAL_SPEED = 0.012;

function isSolidAtWorldPosition(x, y, z) {
    collisionProbePoint.set(x, y, z);
    const { q, r, h } = worldToAxial(collisionProbePoint);
    return isSolidBlockAt(q, r, h);
}

function collidesAtCameraPosition(x, y, z) {
    if (isSolidAtWorldPosition(x, y - PLAYER_HEAD_OFFSET, z)) return true;
    return isSolidAtWorldPosition(x, y - PLAYER_TORSO_OFFSET, z);
}

function isChunkLoadedAtWorldPosition(x, y, z) {
    collisionProbePoint.set(x, y, z);
    const { q, r } = worldToAxial(collisionProbePoint);
    const cq = Math.round(q / CHUNK_SIZE);
    const cr = Math.round(r / CHUNK_SIZE);
    return worldState.loadedChunks.has(packChunkKey(cq, cr));
}

function hasLoadedChunkInRadiusAtWorldPosition(x, y, z, chunkRadius = 1) {
    collisionProbePoint.set(x, y, z);
    const { q, r } = worldToAxial(collisionProbePoint);
    const centerCq = Math.round(q / CHUNK_SIZE);
    const centerCr = Math.round(r / CHUNK_SIZE);
    for (let dq = -chunkRadius; dq <= chunkRadius; dq += 1) {
        for (let dr = -chunkRadius; dr <= chunkRadius; dr += 1) {
            if (worldState.loadedChunks.has(packChunkKey(centerCq + dq, centerCr + dr))) return true;
        }
    }
    return false;
}

function getFallbackGroundDistanceFromTopSolidColumn() {
    const { q, r } = worldState.frameCameraAxial ?? worldToAxial(camera.position);
    const topSolidH = worldState.topSolidHeightByColumn.get(packColumnKey(q, r));
    if (topSolidH === undefined) return null;
    if (!isSolidBlockAt(q, r, topSolidH)) return null;
    return camera.position.y - (topSolidH * HEX_HEIGHT);
}

function getGroundHit() {
    const cameraAxial = worldState.frameCameraAxial ?? worldToAxial(camera.position);
    groundRaycaster.set(camera.position, DOWN);
    groundRaycaster.near = GROUND_RAY_NEAR;
    groundRaycaster.far = PLAYER_HEIGHT + 1;
    collectChunkRaycastCandidates(cameraAxial.q, cameraAxial.r, GROUND_RAYCAST_CHUNK_RADIUS, localGroundCandidates, {
        collidableOnly: true,
        cacheKey: GROUND_CANDIDATE_CACHE_KEY,
        reuseFrames: GROUND_CANDIDATE_CACHE_FRAMES,
        rayOrigin: groundRaycaster.ray.origin,
        rayDirection: groundRaycaster.ray.direction,
        rayNear: groundRaycaster.near,
        rayFar: groundRaycaster.far
    });
    if (localGroundCandidates.length === 0) return null;
    LOCAL_GROUND_INTERSECTIONS.length = 0;
    groundRaycaster.intersectObjects(localGroundCandidates, false, LOCAL_GROUND_INTERSECTIONS);
    return LOCAL_GROUND_INTERSECTIONS[0] ?? null;
}

function resolveGroundCollision() {
    const groundHit = getGroundHit();
    const fallbackDistanceToGround = groundHit ? null : getFallbackGroundDistanceFromTopSolidColumn();
    if (!groundHit && fallbackDistanceToGround === null) {
        inputState.canJump = false;
        return false;
    }

    const standingDistance = PLAYER_HEIGHT;
    const distanceToGround = groundHit ? groundHit.distance : fallbackDistanceToGround;
    const usingFallbackDistance = !groundHit;
    if (usingFallbackDistance && distanceToGround < standingDistance - MAX_FALLBACK_SNAP_UP) {
        inputState.canJump = false;
        return false;
    }
    const isInsideGround = distanceToGround < standingDistance;
    const shouldStickToGround = distanceToGround <= standingDistance + GROUND_STICK_DISTANCE && inputState.velocity.y <= 0;

    if (!isInsideGround && !shouldStickToGround) {
        inputState.canJump = false;
        return false;
    }

    camera.position.y += standingDistance - distanceToGround;
    inputState.velocity.y = 0;
    inputState.canJump = true;
    return true;
}

export function handlePhysics(deltaTimeSeconds = 1 / 60) {
    const physicsStart = performance.now();
    const frameScale = Math.min(3, Math.max(0, deltaTimeSeconds * 60));
    const isInLiquid = isCameraInLiquid();
    const jumpPressed = isKeyDown('Space');
    if (jumpPressed && !wasJumpPressed) jumpBufferAge = 0;
    wasJumpPressed = jumpPressed;
    if (jumpBufferAge !== Infinity) jumpBufferAge += deltaTimeSeconds;
    const hasBufferedJump = jumpBufferAge <= JUMP_BUFFER_SECONDS;
    const wasGrounded = inputState.canJump && !isInLiquid;
    if (!wasGrounded) timeSinceGrounded += deltaTimeSeconds;

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

    const wantsSprint = !isInLiquid && hasMovementInput && (isKeyDown('ShiftLeft') || isKeyDown('ShiftRight'));
    inputState.isSprinting = wantsSprint;
    const sprintBoost = wantsSprint ? SPRINT_MULTIPLIER : 1;
    const moveSpeed = (isInLiquid ? SWIM_MOVE_SPEED : MOVE_SPEED) * sprintBoost;
    const targetVelocityX = hasMovementInput ? moveDir.x * moveSpeed : 0;
    const targetVelocityZ = hasMovementInput ? moveDir.z * moveSpeed : 0;
    horizontalVelocity.set(inputState.velocity.x, inputState.velocity.z);
    horizontalTargetVelocity.set(targetVelocityX, targetVelocityZ);

    if (hasMovementInput) {
        let acceleration = MOVE_INITIAL_ACCELERATION;
        const currentSpeed = horizontalVelocity.length();
        if (currentSpeed > MIN_DIRECTION_EVAL_SPEED) {
            horizontalCurrentDir.copy(horizontalVelocity).multiplyScalar(1 / currentSpeed);
            horizontalTargetDir.copy(horizontalTargetVelocity).normalize();
            const alignment = horizontalCurrentDir.dot(horizontalTargetDir);
            if (alignment < 0.92) {
                acceleration = MOVE_DIRECTION_CHANGE_ACCELERATION;
            }
        }

        const accelerationFactor = 1 - Math.pow(1 - (acceleration * (wantsSprint ? SPRINT_ACCEL_MULTIPLIER : 1)), frameScale);
        inputState.velocity.x += (targetVelocityX - inputState.velocity.x) * accelerationFactor;
        inputState.velocity.z += (targetVelocityZ - inputState.velocity.z) * accelerationFactor;
    } else {
        const decelerationFactor = Math.pow(1 - MOVE_DECELERATION, frameScale);
        inputState.velocity.x *= decelerationFactor;
        inputState.velocity.z *= decelerationFactor;
        if (Math.abs(inputState.velocity.x) < 0.0005) inputState.velocity.x = 0;
        if (Math.abs(inputState.velocity.z) < 0.0005) inputState.velocity.z = 0;
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
    } else if (hasBufferedJump && (inputState.canJump || timeSinceGrounded <= COYOTE_TIME_SECONDS)) {
        inputState.velocity.y = JUMP_FORCE;
        inputState.canJump = false;
        jumpBufferAge = Infinity;
        timeSinceGrounded = Infinity;
        triggerCameraImpulse(0.1);
    } else {
        inputState.velocity.y += GRAVITY * frameScale;
    }

    const nextX = camera.position.x + (inputState.velocity.x * frameScale);
    const canMoveToNextX = isChunkLoadedAtWorldPosition(nextX, camera.position.y, camera.position.z)
        && !collidesAtCameraPosition(nextX, camera.position.y, camera.position.z);
    if (canMoveToNextX) {
        camera.position.x = nextX;
    } else {
        inputState.velocity.x = 0;
    }

    const nextZ = camera.position.z + (inputState.velocity.z * frameScale);
    const canMoveToNextZ = isChunkLoadedAtWorldPosition(camera.position.x, camera.position.y, nextZ)
        && !collidesAtCameraPosition(camera.position.x, camera.position.y, nextZ);
    if (canMoveToNextZ) {
        camera.position.z = nextZ;
    } else {
        inputState.velocity.z = 0;
    }

    const previousY = camera.position.y;
    camera.position.y += inputState.velocity.y * frameScale;

    const verticalVelocityBeforeCollision = inputState.velocity.y;
    const shouldResolveGroundCollision = isInLiquid || inputState.velocity.y <= 0;
    const isSupportedByGround = shouldResolveGroundCollision ? resolveGroundCollision() : false;
    if (isSupportedByGround) {
        timeSinceGrounded = 0;
        if (!isInLiquid && hasBufferedJump) {
            inputState.velocity.y = JUMP_FORCE;
            inputState.canJump = false;
            jumpBufferAge = Infinity;
            timeSinceGrounded = Infinity;
            triggerCameraImpulse(0.1);
        }
    }
    if (isSupportedByGround && verticalVelocityBeforeCollision < LANDING_IMPACT_THRESHOLD) {
        const landingStrength = THREE.MathUtils.clamp((-verticalVelocityBeforeCollision - Math.abs(LANDING_IMPACT_THRESHOLD)) * 0.42, 0.08, 0.95);
        triggerCameraImpulse(landingStrength);
    }
    if (!shouldResolveGroundCollision) {
        inputState.canJump = false;
    }
    if (
        !isSupportedByGround
        && inputState.velocity.y < 0
        && !hasLoadedChunkInRadiusAtWorldPosition(camera.position.x, previousY, camera.position.z)
    ) {
        camera.position.y = previousY;
        inputState.velocity.y = 0;
        inputState.canJump = true;
    }

    const worldEndY = (NETHROCK_LEVEL_HEX - VOID_RESPAWN_BUFFER_HEX) * HEX_HEIGHT;
    if (camera.position.y < worldEndY) {
        const currentAxial = worldState.frameCameraAxial ?? worldToAxial(camera.position);
        const didRespawnNearby = enforceSpawnOnSolidBlock(currentAxial.q, currentAxial.r);
        if (!didRespawnNearby) enforceSpawnOnSolidBlock(0, 0);
        inputState.velocity.y = 0;
        inputState.isSprinting = false;
        timeSinceGrounded = 0;
        jumpBufferAge = Infinity;
    }
    profilerRecord('physics', performance.now() - physicsStart);
}
