const THREE = window.THREE;

import { PLAYER_HEIGHT } from './config.js';
import { camera, scene } from './scene.js';
import { inputState } from './state.js';

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();
const cameraTarget = new THREE.Vector3();
const cameraOffset = new THREE.Vector3();
const cameraEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const firstPersonArmOffset = new THREE.Vector3(0.43, -0.37, -0.58);
const baseArmScale = 0.39;

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

let firstPersonArmRoot = null;
let firstPersonArmSwingUntil = 0;
let walkCycleTime = 0;
let lastPerspectiveUpdateTime = performance.now();

export const CAMERA_PERSPECTIVES = {
    FIRST_PERSON: 'first_person',
    SECOND_PERSON: 'second_person',
    THIRD_PERSON: 'third_person'
};

let currentPerspective = CAMERA_PERSPECTIVES.FIRST_PERSON;

const avatarRoot = new THREE.Group();
avatarRoot.visible = false;
scene.add(avatarRoot);

function loadHeadTexture(path) {
    if (textureCache.has(path)) return textureCache.get(path);
    const texture = textureLoader.load(path);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    textureCache.set(path, texture);
    return texture;
}

function createHeadMaterials() {
    const top = loadHeadTexture('assets/skin/head/top_head.png');
    const front = loadHeadTexture('assets/skin/head/front_head.png');
    const right = loadHeadTexture('assets/skin/head/side_right_head.png');
    const left = loadHeadTexture('assets/skin/head/side_left_head.png');

    return [
        new THREE.MeshLambertMaterial({ map: right }),
        new THREE.MeshLambertMaterial({ map: left }),
        new THREE.MeshLambertMaterial({ map: top }),
        new THREE.MeshLambertMaterial({ map: top }),
        new THREE.MeshLambertMaterial({ map: top }),
        new THREE.MeshLambertMaterial({ map: front })
    ];
}

function createArmMaterials() {
    const front = loadHeadTexture('assets/skin/arm/right_arm_front.png');
    const topShoulder = loadHeadTexture('assets/skin/arm/right_top_shoulder.png');
    const hand = loadHeadTexture('assets/skin/arm/hand.png');

    return [
        new THREE.MeshLambertMaterial({ map: front }),
        new THREE.MeshLambertMaterial({ map: front }),
        new THREE.MeshLambertMaterial({ map: topShoulder }),
        new THREE.MeshLambertMaterial({ map: hand }),
        new THREE.MeshLambertMaterial({ map: front }),
        new THREE.MeshLambertMaterial({ map: front })
    ];
}

function createLegMaterials() {
    const front = loadHeadTexture('assets/skin/leg/right_leg_front.png');
    const feet = loadHeadTexture('assets/skin/leg/feet.png');

    return [
        new THREE.MeshLambertMaterial({ map: front }),
        new THREE.MeshLambertMaterial({ map: front }),
        new THREE.MeshLambertMaterial({ map: front }),
        new THREE.MeshLambertMaterial({ map: feet }),
        new THREE.MeshLambertMaterial({ map: front }),
        new THREE.MeshLambertMaterial({ map: front })
    ];
}

function createChestMaterials() {
    const front = loadHeadTexture('assets/skin/body/chest_front.png');
    const side = loadHeadTexture('assets/skin/body/chest_right_side.png');
    const back = loadHeadTexture('assets/skin/body/chest_back.png');
    return [
        new THREE.MeshLambertMaterial({ map: side }),
        new THREE.MeshLambertMaterial({ map: side }),
        new THREE.MeshLambertMaterial({ map: front }),
        new THREE.MeshLambertMaterial({ map: front }),
        new THREE.MeshLambertMaterial({ map: back }),
        new THREE.MeshLambertMaterial({ map: front })
    ];
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

    const armMaterials = createArmMaterials();
    const legMaterials = createLegMaterials();

    const torso = new THREE.Mesh(new THREE.BoxGeometry(torsoWidth, torsoHeight, torsoDepth), createChestMaterials());
    torso.position.y = legHeight + (torsoHeight * 0.5);
    avatarRoot.add(torso);

    const armOffset = (torsoWidth * 0.5) + (limbWidth * 0.5);
    const armY = legHeight + (torsoHeight * 0.5);
    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(limbWidth, torsoHeight, limbDepth), armMaterials);
    leftArm.position.set(-armOffset, armY, 0);
    avatarRoot.add(leftArm);

    const rightArm = new THREE.Mesh(new THREE.BoxGeometry(limbWidth, torsoHeight, limbDepth), armMaterials);
    rightArm.position.set(armOffset, armY, 0);
    avatarRoot.add(rightArm);

    const legOffset = limbWidth * 0.5;
    const legY = legHeight * 0.5;
    const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(limbWidth, legHeight, limbDepth), legMaterials);
    leftLeg.position.set(-legOffset, legY, 0);
    avatarRoot.add(leftLeg);

    const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(limbWidth, legHeight, limbDepth), legMaterials);
    rightLeg.position.set(legOffset, legY, 0);
    avatarRoot.add(rightLeg);

    const head = new THREE.Mesh(new THREE.BoxGeometry(headSize, headSize, headSize), createHeadMaterials());
    head.position.y = legHeight + torsoHeight + (headSize * 0.5);
    avatarRoot.add(head);
}

createAvatarMesh();
createFirstPersonArm();

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
        camera.position.copy(playerPosition);
        camera.rotation.set(pitch, yaw, 0, 'YXZ');

        if (firstPersonArmRoot) {
            firstPersonArmRoot.visible = true;
            const horizontalSpeed = Math.hypot(inputState.velocity.x, inputState.velocity.z);
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
    cameraTarget.copy(playerPosition);

    const horizontalDistance = PLAYER_HEIGHT * 2.4;
    const verticalOffset = PLAYER_HEIGHT * 0.32;
    const isSecondPerson = currentPerspective === CAMERA_PERSPECTIVES.SECOND_PERSON;
    const forwardOrBehindDistance = isSecondPerson ? -horizontalDistance : horizontalDistance;
    cameraOffset.set(0, verticalOffset, forwardOrBehindDistance);
    cameraEuler.set(pitch * 0.75, yaw, 0);
    cameraOffset.applyEuler(cameraEuler);

    camera.position.copy(cameraTarget).add(cameraOffset);
    camera.lookAt(cameraTarget);
}

export function triggerFirstPersonArmSwing() {
    firstPersonArmSwingUntil = performance.now() + (ARM_ANIMATION.swingDuration * 1000);
}
