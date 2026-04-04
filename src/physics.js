const THREE = window.THREE;

import { GRAVITY, JUMP_FORCE, PLAYER_HEIGHT } from './config.js';
import { camera } from './scene.js';
import { inputState, worldState } from './state.js';

const GROUND_STICK_DISTANCE = 0.08;
const DOWN = new THREE.Vector3(0, -1, 0);
const groundRaycaster = new THREE.Raycaster();

function getGroundHit() {
    groundRaycaster.set(camera.position, DOWN);
    groundRaycaster.far = PLAYER_HEIGHT + 1;
    const intersections = groundRaycaster.intersectObjects(Array.from(worldState.worldBlocks.values()), false);
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

export function handlePhysics() {
    const moveDir = new THREE.Vector3();
    if (inputState.keys.KeyW) moveDir.z -= 1;
    if (inputState.keys.KeyS) moveDir.z += 1;
    if (inputState.keys.KeyA) moveDir.x -= 1;
    if (inputState.keys.KeyD) moveDir.x += 1;

    moveDir.applyEuler(new THREE.Euler(0, inputState.yaw, 0, 'YXZ')).normalize();
    inputState.velocity.x = moveDir.x * 0.12;
    inputState.velocity.z = moveDir.z * 0.12;

    if (inputState.keys.Space && inputState.canJump) {
        inputState.velocity.y = JUMP_FORCE;
        inputState.canJump = false;
    } else {
        inputState.velocity.y += GRAVITY;
    }

    camera.position.x += inputState.velocity.x;
    camera.position.z += inputState.velocity.z;
    camera.position.y += inputState.velocity.y;

    resolveGroundCollision();

    if (camera.position.y < -20) {
        camera.position.y = 10;
        inputState.velocity.y = 0;
    }
}
