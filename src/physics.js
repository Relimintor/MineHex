const THREE = window.THREE;

import { GRAVITY, HEX_HEIGHT, JUMP_FORCE, PLAYER_HEIGHT } from './config.js';
import { worldToAxial } from './coords.js';
import { camera } from './scene.js';
import { inputState, worldState } from './state.js';

export function handlePhysics() {
    const moveDir = new THREE.Vector3();
    if (inputState.keys.KeyW) moveDir.z -= 1;
    if (inputState.keys.KeyS) moveDir.z += 1;
    if (inputState.keys.KeyA) moveDir.x -= 1;
    if (inputState.keys.KeyD) moveDir.x += 1;

    moveDir.applyEuler(new THREE.Euler(0, inputState.yaw, 0, 'YXZ')).normalize();
    inputState.velocity.x = moveDir.x * 0.12;
    inputState.velocity.z = moveDir.z * 0.12;

    inputState.velocity.y += GRAVITY;

    const feetPos = camera.position.clone();
    feetPos.y += inputState.velocity.y;

    const axialAtFeet = worldToAxial(
        new THREE.Vector3(feetPos.x, feetPos.y - PLAYER_HEIGHT + 0.5, feetPos.z)
    );
    const groundBlock = worldState.worldBlocks.get(`${axialAtFeet.q},${axialAtFeet.r},${axialAtFeet.h}`);

    if (groundBlock && inputState.velocity.y < 0) {
        const groundY = groundBlock.position.y + (HEX_HEIGHT / 2) + PLAYER_HEIGHT;
        if (camera.position.y + inputState.velocity.y <= groundY) {
            camera.position.y = groundY;
            inputState.velocity.y = 0;
            inputState.canJump = true;
        }
    } else {
        inputState.canJump = false;
    }

    if (inputState.keys.Space && inputState.canJump) {
        inputState.velocity.y = JUMP_FORCE;
        inputState.canJump = false;
    }

    camera.position.x += inputState.velocity.x;
    camera.position.z += inputState.velocity.z;
    camera.position.y += inputState.velocity.y;

    if (camera.position.y < -20) camera.position.y = 10;
}
