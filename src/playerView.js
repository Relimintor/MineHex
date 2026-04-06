const THREE = window.THREE;

import { PLAYER_HEIGHT } from './config.js';
import { camera, scene } from './scene.js';

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();
const cameraTarget = new THREE.Vector3();
const cameraOffset = new THREE.Vector3();
const cameraEuler = new THREE.Euler(0, 0, 0, 'YXZ');

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
    const feetY = playerPosition.y - PLAYER_HEIGHT;
    avatarRoot.position.set(playerPosition.x, feetY, playerPosition.z);
    avatarRoot.rotation.set(0, yaw, 0);

    if (currentPerspective === CAMERA_PERSPECTIVES.FIRST_PERSON) {
        avatarRoot.visible = false;
        camera.position.copy(playerPosition);
        camera.rotation.set(pitch, yaw, 0, 'YXZ');
        return;
    }

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
