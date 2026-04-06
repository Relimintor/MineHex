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
        new THREE.MeshLambertMaterial({ map: front }),
        new THREE.MeshLambertMaterial({ map: top })
    ];
}

function createAvatarMesh() {
    const legHeight = PLAYER_HEIGHT * 0.36;
    const torsoHeight = PLAYER_HEIGHT * 0.34;
    const headSize = PLAYER_HEIGHT * 0.28;

    const torsoWidth = PLAYER_HEIGHT * 0.24;
    const limbWidth = torsoWidth * 0.45;

    const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0x3f6db6 });
    const limbMaterial = new THREE.MeshLambertMaterial({ color: 0x2e4d8f });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(torsoWidth, torsoHeight, torsoWidth * 0.6), bodyMaterial);
    torso.position.y = legHeight + (torsoHeight * 0.5);
    avatarRoot.add(torso);

    const armOffset = (torsoWidth * 0.5) + (limbWidth * 0.65);
    const armY = legHeight + (torsoHeight * 0.58);
    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(limbWidth, torsoHeight * 0.92, limbWidth), limbMaterial);
    leftArm.position.set(-armOffset, armY, 0);
    avatarRoot.add(leftArm);

    const rightArm = new THREE.Mesh(new THREE.BoxGeometry(limbWidth, torsoHeight * 0.92, limbWidth), limbMaterial);
    rightArm.position.set(armOffset, armY, 0);
    avatarRoot.add(rightArm);

    const legOffset = limbWidth * 0.75;
    const legY = legHeight * 0.5;
    const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(limbWidth, legHeight, limbWidth), limbMaterial);
    leftLeg.position.set(-legOffset, legY, 0);
    avatarRoot.add(leftLeg);

    const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(limbWidth, legHeight, limbWidth), limbMaterial);
    rightLeg.position.set(legOffset, legY, 0);
    avatarRoot.add(rightLeg);

    const head = new THREE.Mesh(new THREE.BoxGeometry(headSize, headSize, headSize), createHeadMaterials());
    head.position.y = legHeight + torsoHeight + (headSize * 0.5);
    avatarRoot.add(head);
}

createAvatarMesh();

export function toggleCameraPerspective() {
    currentPerspective = currentPerspective === CAMERA_PERSPECTIVES.FIRST_PERSON
        ? CAMERA_PERSPECTIVES.THIRD_PERSON
        : CAMERA_PERSPECTIVES.FIRST_PERSON;
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

    cameraOffset.set(0, PLAYER_HEIGHT * 0.32, PLAYER_HEIGHT * 2.4);
    cameraEuler.set(pitch * 0.75, yaw, 0);
    cameraOffset.applyEuler(cameraEuler);

    camera.position.copy(cameraTarget).add(cameraOffset);
    camera.lookAt(cameraTarget);
}
