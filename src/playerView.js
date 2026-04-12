const THREE = window.THREE;

import { PLAYER_HEIGHT } from './config.js';
import { camera, scene } from './scene.js';
import { inputState } from './state.js';
import { worldToAxial } from './coords.js';
import { collectChunkRaycastCandidates } from './blocks.js';
import { applyBoxFaceUvMap, getSkinUvLayout } from './skinUv.js';
import { subscribeToSkinTexture } from './skinTexture.js';

const cameraTarget = new THREE.Vector3();
const cameraOffset = new THREE.Vector3();
const desiredCameraPosition = new THREE.Vector3();
const cameraCollisionDirection = new THREE.Vector3();
const cameraCollisionRay = new THREE.Raycaster();
const cameraCollisionCandidates = [];
const cameraEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const firstPersonArmOffset = new THREE.Vector3(0.43, -0.37, -0.48);
const baseArmScale = 0.45;

const ARM_ANIMATION = {
    idlePitch: -0.38,
    idleYaw: -0.16,
    idleRoll: 0.16,
    walkPitch: 0.03,
    walkRoll: 0.02,
    walkBobY: 0.018,
    walkBobZ: 0.012,
    walkFrequency: 7.8,
    swingDuration: 0.22,
    swingPitch: -1.0,
    swingYaw: 0.12,
    swingForwardZ: 0.06,
    swingDownY: 0.03,
    maxWalkSpeed: 0.22
};
const CAMERA_MOTION = {
    bobFrequency: 8.2,
    bobAmountY: 0.026,
    bobAmountX: 0.011,
    bobSmoothing: 0.18,
    inertiaSmoothing: 0.14,
    inertiaTilt: 0.035,
    inertiaShift: 0.055,
    sprintFovBoost: 8.5,
    airFovBoost: 2.2,
    fovSmoothing: 0.08,
    thirdIdleYaw: 0.045,
    thirdIdlePitch: 0.028,
    thirdIdleRoll: 0.015,
    thirdIdleFrequency: 0.22,
    shakeDecay: 2.3,
    cameraCollisionPadding: 0.25,
    cameraCollisionMinDistance: 0.85
};

let firstPersonArmRoot = null;
let firstPersonArmSwingUntil = 0;
let walkCycleTime = 0;
let lastPerspectiveUpdateTime = performance.now();
let smoothedBobY = 0;
let smoothedBobX = 0;
let inertiaOffsetX = 0;
let inertiaOffsetY = 0;
let targetFov = camera.fov;
let cameraShake = 0;
let cameraShakeSeed = 0;

export const CAMERA_PERSPECTIVES = {
    FIRST_PERSON: 'first_person',
    SECOND_PERSON: 'second_person',
    THIRD_PERSON: 'third_person'
};

let currentPerspective = CAMERA_PERSPECTIVES.FIRST_PERSON;

const avatarRoot = new THREE.Group();
avatarRoot.visible = false;
scene.add(avatarRoot);

let activeSkinTexture = null;
const avatarSkinMaterials = [];

function createSkinMaterial() {
    const material = new THREE.MeshLambertMaterial({ map: activeSkinTexture });
    avatarSkinMaterials.push(material);
    return material;
}

function applySkinTextureToAvatar(texture) {
    activeSkinTexture = texture;
    const textureSize = activeSkinTexture?.image?.width || 64;
    avatarRoot.traverse((child) => {
        if (!child.isMesh || !child.geometry || !child.userData?.skinPart) return;
        applyBoxFaceUvMap(child.geometry, getSkinUvLayout(textureSize)[child.userData.skinPart], textureSize);
    });
    for (const material of avatarSkinMaterials) {
        material.map = texture;
        material.needsUpdate = true;
    }
}

function createMappedBoxGeometry(width, height, depth, partName, textureSize) {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const layout = getSkinUvLayout(textureSize);
    applyBoxFaceUvMap(geometry, layout[partName], textureSize);
    return geometry;
}

function createFirstPersonArm() {
    if (!THREE.GLTFLoader) return;

    const loader = new THREE.GLTFLoader();
    loader.load(
        'assets/skin/fp/model.glb',
        (gltf) => {
            firstPersonArmRoot = gltf.scene;
            firstPersonArmRoot.visible = false;
            firstPersonArmRoot.scale.setScalar(baseArmScale);
            firstPersonArmRoot.rotation.set(0, Math.PI, 0);

            firstPersonArmRoot.traverse((child) => {
                if (!child.isMesh) return;
                child.castShadow = false;
                child.receiveShadow = false;
            });

            scene.add(firstPersonArmRoot);
        },
        undefined,
        (error) => {
            console.warn('Failed to load first-person arm model.', error);
        }
    );
}

function createAvatarMesh() {
    // Minecraft body proportions in "pixels":
    // head 8x8x8, torso 8x12x4, arm 4x12x4, leg 4x12x4, total height 32.
    const unit = PLAYER_HEIGHT / 32;
    const legHeight = 12 * unit;
    const torsoHeight = 12 * unit;
    const headSize = 8 * unit;
    const torsoWidth = 8 * unit;
    const torsoDepth = 4 * unit;
    const limbWidth = 4 * unit;
    const limbDepth = 4 * unit;

    const textureSize = activeSkinTexture?.image?.width || 64;

    const torso = new THREE.Mesh(createMappedBoxGeometry(torsoWidth, torsoHeight, torsoDepth, 'body', textureSize), createSkinMaterial());
    torso.userData.skinPart = 'body';
    torso.position.y = legHeight + (torsoHeight * 0.5);
    avatarRoot.add(torso);

    const armOffset = (torsoWidth * 0.5) + (limbWidth * 0.5);
    const armY = legHeight + (torsoHeight * 0.5);
    const leftArm = new THREE.Mesh(createMappedBoxGeometry(limbWidth, torsoHeight, limbDepth, 'arm', textureSize), createSkinMaterial());
    leftArm.userData.skinPart = 'arm';
    leftArm.position.set(-armOffset, armY, 0);
    avatarRoot.add(leftArm);

    const rightArm = new THREE.Mesh(createMappedBoxGeometry(limbWidth, torsoHeight, limbDepth, 'arm', textureSize), createSkinMaterial());
    rightArm.userData.skinPart = 'arm';
    rightArm.position.set(armOffset, armY, 0);
    avatarRoot.add(rightArm);

    const legOffset = limbWidth * 0.5;
    const legY = legHeight * 0.5;
    const leftLeg = new THREE.Mesh(createMappedBoxGeometry(limbWidth, legHeight, limbDepth, 'leg', textureSize), createSkinMaterial());
    leftLeg.userData.skinPart = 'leg';
    leftLeg.position.set(-legOffset, legY, 0);
    avatarRoot.add(leftLeg);

    const rightLeg = new THREE.Mesh(createMappedBoxGeometry(limbWidth, legHeight, limbDepth, 'leg', textureSize), createSkinMaterial());
    rightLeg.userData.skinPart = 'leg';
    rightLeg.position.set(legOffset, legY, 0);
    avatarRoot.add(rightLeg);

    const head = new THREE.Mesh(createMappedBoxGeometry(headSize, headSize, headSize, 'head', textureSize), createSkinMaterial());
    head.userData.skinPart = 'head';
    head.position.y = legHeight + torsoHeight + (headSize * 0.5);
    avatarRoot.add(head);
}

createAvatarMesh();
createFirstPersonArm();
subscribeToSkinTexture((texture) => {
    applySkinTextureToAvatar(texture);
});

export function toggleCameraPerspective() {
    if (currentPerspective === CAMERA_PERSPECTIVES.FIRST_PERSON) {
        currentPerspective = CAMERA_PERSPECTIVES.SECOND_PERSON;
        return;
    }

    if (currentPerspective === CAMERA_PERSPECTIVES.SECOND_PERSON) {
        currentPerspective = CAMERA_PERSPECTIVES.THIRD_PERSON;
        return;
    }

    currentPerspective = CAMERA_PERSPECTIVES.FIRST_PERSON;
}

export function updateCameraPerspective(playerPosition, pitch, yaw) {
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0, (now - lastPerspectiveUpdateTime) / 1000));
    lastPerspectiveUpdateTime = now;

    const feetY = playerPosition.y - PLAYER_HEIGHT;
    avatarRoot.position.set(playerPosition.x, feetY, playerPosition.z);
    avatarRoot.rotation.set(0, yaw, 0);

    if (currentPerspective === CAMERA_PERSPECTIVES.FIRST_PERSON) {
        avatarRoot.visible = false;
        const horizontalSpeed = Math.hypot(inputState.velocity.x, inputState.velocity.z);
        const movementNorm = Math.min(1, horizontalSpeed / Math.max(0.001, ARM_ANIMATION.maxWalkSpeed));
        walkCycleTime += dt * CAMERA_MOTION.bobFrequency * (0.35 + movementNorm);
        const bobWave = Math.sin(walkCycleTime * Math.PI * 2);
        const bobWaveCos = Math.cos(walkCycleTime * Math.PI * 2);
        const bobTargetY = bobWave * CAMERA_MOTION.bobAmountY * movementNorm;
        const bobTargetX = bobWaveCos * CAMERA_MOTION.bobAmountX * movementNorm;
        smoothedBobY += (bobTargetY - smoothedBobY) * (1 - Math.pow(1 - CAMERA_MOTION.bobSmoothing, dt * 60));
        smoothedBobX += (bobTargetX - smoothedBobX) * (1 - Math.pow(1 - CAMERA_MOTION.bobSmoothing, dt * 60));

        const inertiaTargetX = THREE.MathUtils.clamp(inputState.velocity.x * -CAMERA_MOTION.inertiaShift, -0.085, 0.085);
        const inertiaTargetY = THREE.MathUtils.clamp(inputState.velocity.z * CAMERA_MOTION.inertiaTilt, -0.06, 0.06);
        inertiaOffsetX += (inertiaTargetX - inertiaOffsetX) * (1 - Math.pow(1 - CAMERA_MOTION.inertiaSmoothing, dt * 60));
        inertiaOffsetY += (inertiaTargetY - inertiaOffsetY) * (1 - Math.pow(1 - CAMERA_MOTION.inertiaSmoothing, dt * 60));

        cameraShake = Math.max(0, cameraShake - (CAMERA_MOTION.shakeDecay * dt));
        cameraShakeSeed += dt * (18 + cameraShake * 10);
        const shakeYaw = Math.sin(cameraShakeSeed * 1.9) * 0.01 * cameraShake;
        const shakePitch = Math.cos(cameraShakeSeed * 2.3) * 0.008 * cameraShake;

        camera.position.copy(playerPosition);
        camera.position.x += smoothedBobX + inertiaOffsetX;
        camera.position.y += smoothedBobY + Math.abs(inertiaOffsetY) * 0.15;
        camera.rotation.set(pitch + shakePitch + inertiaOffsetY, yaw + shakeYaw, 0, 'YXZ');

        const sprintFactor = inputState.isSprinting ? 1 : 0;
        const jumpFactor = inputState.canJump ? 0 : THREE.MathUtils.clamp(inputState.velocity.y * 0.08, -0.15, 1);
        targetFov = 75 + (CAMERA_MOTION.sprintFovBoost * sprintFactor) + (CAMERA_MOTION.airFovBoost * Math.max(0, jumpFactor));
        camera.fov += (targetFov - camera.fov) * (1 - Math.pow(1 - CAMERA_MOTION.fovSmoothing, dt * 60));
        camera.updateProjectionMatrix();

        if (firstPersonArmRoot) {
            firstPersonArmRoot.visible = true;
            const walkStrength = Math.min(1, horizontalSpeed / ARM_ANIMATION.maxWalkSpeed);
            walkCycleTime += dt * ARM_ANIMATION.walkFrequency * walkStrength;
            const walkWave = Math.sin(walkCycleTime * Math.PI * 2);

            const swingProgress = 1 - Math.max(0, (firstPersonArmSwingUntil - now) / (ARM_ANIMATION.swingDuration * 1000));
            const swingEase = firstPersonArmSwingUntil > now
                ? Math.sin(Math.min(1, swingProgress) * Math.PI)
                : 0;

            const animatedOffset = firstPersonArmOffset.clone();
            animatedOffset.y += walkWave * ARM_ANIMATION.walkBobY * walkStrength;
            animatedOffset.z += Math.abs(walkWave) * ARM_ANIMATION.walkBobZ * walkStrength;
            animatedOffset.y -= swingEase * ARM_ANIMATION.swingDownY;
            animatedOffset.z -= swingEase * ARM_ANIMATION.swingForwardZ;

            const worldOffset = animatedOffset.applyEuler(camera.rotation);
            firstPersonArmRoot.position.copy(playerPosition).add(worldOffset);

            firstPersonArmRoot.rotation.set(
                camera.rotation.x + ARM_ANIMATION.idlePitch + (walkWave * ARM_ANIMATION.walkPitch * walkStrength) + (swingEase * ARM_ANIMATION.swingPitch),
                camera.rotation.y + ARM_ANIMATION.idleYaw + (swingEase * ARM_ANIMATION.swingYaw),
                camera.rotation.z + ARM_ANIMATION.idleRoll + (walkWave * ARM_ANIMATION.walkRoll * walkStrength),
                'YXZ'
            );
        }
        return;
    }

    if (firstPersonArmRoot) firstPersonArmRoot.visible = false;
    avatarRoot.visible = true;
    cameraShake = Math.max(0, cameraShake - (CAMERA_MOTION.shakeDecay * dt * 0.6));
    cameraShakeSeed += dt * (12 + cameraShake * 6);
    cameraTarget.copy(playerPosition);

    const horizontalDistance = PLAYER_HEIGHT * 2.4;
    const verticalOffset = PLAYER_HEIGHT * 0.32;
    const isSecondPerson = currentPerspective === CAMERA_PERSPECTIVES.SECOND_PERSON;
    const forwardOrBehindDistance = isSecondPerson ? -horizontalDistance : horizontalDistance;
    cameraOffset.set(0, verticalOffset, forwardOrBehindDistance);
    const horizontalSpeed = Math.hypot(inputState.velocity.x, inputState.velocity.z);
    const idleAmount = 1.0 - Math.min(1, horizontalSpeed / 0.08);
    const idleTime = now * 0.001 * CAMERA_MOTION.thirdIdleFrequency;
    const idleYaw = Math.sin(idleTime * 1.7) * CAMERA_MOTION.thirdIdleYaw * idleAmount;
    const idlePitch = Math.cos(idleTime * 1.3) * CAMERA_MOTION.thirdIdlePitch * idleAmount;
    const idleRoll = Math.sin(idleTime * 1.1) * CAMERA_MOTION.thirdIdleRoll * idleAmount;
    const shakeYaw = Math.sin(cameraShakeSeed * 1.9) * 0.008 * cameraShake;
    const shakePitch = Math.cos(cameraShakeSeed * 2.3) * 0.006 * cameraShake;
    cameraEuler.set((pitch * 0.75) + idlePitch + shakePitch, yaw + idleYaw + shakeYaw, idleRoll);
    cameraOffset.applyEuler(cameraEuler);

    desiredCameraPosition.copy(cameraTarget).add(cameraOffset);
    cameraCollisionDirection.copy(desiredCameraPosition).sub(cameraTarget);
    const desiredDistance = cameraCollisionDirection.length();
    if (desiredDistance > 0.0001) {
        cameraCollisionDirection.multiplyScalar(1 / desiredDistance);
        const cameraAxial = worldToAxial(cameraTarget);
        collectChunkRaycastCandidates(cameraAxial.q, cameraAxial.r, 2, cameraCollisionCandidates, {
            collidableOnly: true,
            cacheKey: 'player_camera_collision',
            reuseFrames: 0,
            rayOrigin: cameraTarget,
            rayDirection: cameraCollisionDirection,
            rayNear: 0,
            rayFar: desiredDistance
        });
        cameraCollisionRay.set(cameraTarget, cameraCollisionDirection);
        cameraCollisionRay.near = 0.05;
        cameraCollisionRay.far = desiredDistance;
        const cameraHits = cameraCollisionRay.intersectObjects(cameraCollisionCandidates, false);
        if (cameraHits.length > 0) {
            const closestHit = cameraHits[0];
            const safeDistance = THREE.MathUtils.clamp(
                closestHit.distance - CAMERA_MOTION.cameraCollisionPadding,
                CAMERA_MOTION.cameraCollisionMinDistance,
                desiredDistance
            );
            camera.position.copy(cameraTarget).addScaledVector(cameraCollisionDirection, safeDistance);
        } else {
            camera.position.copy(desiredCameraPosition);
        }
    } else {
        camera.position.copy(desiredCameraPosition);
    }
    camera.lookAt(cameraTarget);
    targetFov = 70 + (cameraShake * 1.5);
    camera.fov += (targetFov - camera.fov) * (1 - Math.pow(1 - CAMERA_MOTION.fovSmoothing, dt * 60));
    camera.updateProjectionMatrix();
}

export function triggerFirstPersonArmSwing() {
    firstPersonArmSwingUntil = performance.now() + (ARM_ANIMATION.swingDuration * 1000);
}

export function triggerCameraImpulse(amount = 0.2) {
    cameraShake = Math.min(1.5, cameraShake + Math.max(0, amount));
}
