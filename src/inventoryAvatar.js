const THREE = window.THREE;

import { applyBoxFaceUvMap, getSkinUvLayout } from './skinUv.js';
import { subscribeToSkinTexture } from './skinTexture.js';

let previewRoot = null;
let previewRenderer = null;
let previewScene = null;
let previewCamera = null;
let avatarGroup = null;
let previewWidth = 0;
let previewHeight = 0;
let activeSkinTexture = null;
const avatarSkinMaterials = [];

function createSkinMaterial() {
    const material = new THREE.MeshLambertMaterial({ map: activeSkinTexture });
    avatarSkinMaterials.push(material);
    return material;
}

function applySkinTextureToPreview(texture) {
    activeSkinTexture = texture;
    const textureSize = activeSkinTexture?.image?.width || 64;
    avatarGroup?.traverse((child) => {
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

function buildAvatar() {
    const unit = 0.095;
    const legHeight = 12 * unit;
    const torsoHeight = 12 * unit;
    const headSize = 8 * unit;
    const torsoWidth = 8 * unit;
    const torsoDepth = 4 * unit;
    const limbWidth = 4 * unit;
    const limbDepth = 4 * unit;
    const textureSize = activeSkinTexture?.image?.width || 64;

    const avatar = new THREE.Group();

    const torso = new THREE.Mesh(createMappedBoxGeometry(torsoWidth, torsoHeight, torsoDepth, 'body', textureSize), createSkinMaterial());
    torso.userData.skinPart = 'body';
    torso.position.y = legHeight + (torsoHeight * 0.5);
    avatar.add(torso);

    const armOffset = (torsoWidth * 0.5) + (limbWidth * 0.5);
    const armY = legHeight + (torsoHeight * 0.5);

    const leftArm = new THREE.Mesh(createMappedBoxGeometry(limbWidth, torsoHeight, limbDepth, 'arm', textureSize), createSkinMaterial());
    leftArm.userData.skinPart = 'arm';
    leftArm.position.set(-armOffset, armY, 0);
    avatar.add(leftArm);

    const rightArm = new THREE.Mesh(createMappedBoxGeometry(limbWidth, torsoHeight, limbDepth, 'arm', textureSize), createSkinMaterial());
    rightArm.userData.skinPart = 'arm';
    rightArm.position.set(armOffset, armY, 0);
    avatar.add(rightArm);

    const legOffset = limbWidth * 0.5;
    const legY = legHeight * 0.5;

    const leftLeg = new THREE.Mesh(createMappedBoxGeometry(limbWidth, legHeight, limbDepth, 'leg', textureSize), createSkinMaterial());
    leftLeg.userData.skinPart = 'leg';
    leftLeg.position.set(-legOffset, legY, 0);
    avatar.add(leftLeg);

    const rightLeg = new THREE.Mesh(createMappedBoxGeometry(limbWidth, legHeight, limbDepth, 'leg', textureSize), createSkinMaterial());
    rightLeg.userData.skinPart = 'leg';
    rightLeg.position.set(legOffset, legY, 0);
    avatar.add(rightLeg);

    const head = new THREE.Mesh(createMappedBoxGeometry(headSize, headSize, headSize, 'head', textureSize), createSkinMaterial());
    head.userData.skinPart = 'head';
    head.position.y = legHeight + torsoHeight + (headSize * 0.5);
    avatar.add(head);

    return avatar;
}

function resizePreviewRenderer() {
    if (!previewRoot || !previewRenderer || !previewCamera) return;
    const width = Math.max(1, previewRoot.clientWidth);
    const height = Math.max(1, previewRoot.clientHeight);
    if (width === previewWidth && height === previewHeight) return;
    previewWidth = width;
    previewHeight = height;
    previewRenderer.setSize(width, height, false);
    previewCamera.aspect = width / height;
    previewCamera.updateProjectionMatrix();
}

export function initInventoryAvatarPreview() {
    previewRoot = document.getElementById('inventory-avatar-viewport');
    if (!previewRoot) return;

    previewRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    previewRoot.appendChild(previewRenderer.domElement);

    previewScene = new THREE.Scene();
    previewCamera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    previewCamera.position.set(0, 1.8, 5.4);
    previewCamera.lookAt(0, 1.6, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    previewScene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
    keyLight.position.set(2.5, 4.8, 3.4);
    previewScene.add(keyLight);

    avatarGroup = buildAvatar();
    avatarGroup.position.set(0, 0, 0);
    previewScene.add(avatarGroup);

    subscribeToSkinTexture((texture) => {
        applySkinTextureToPreview(texture);
    });

    resizePreviewRenderer();
    window.addEventListener('resize', resizePreviewRenderer);
}

export function renderInventoryAvatarPreview(timeSeconds) {
    if (!previewRenderer || !previewScene || !previewCamera || !avatarGroup) return;

    const inventoryScreen = document.getElementById('inventory-screen');
    if (!inventoryScreen || !inventoryScreen.classList.contains('visible')) return;

    resizePreviewRenderer();
    avatarGroup.rotation.y = timeSeconds * 0.55;
    avatarGroup.position.y = Math.sin(timeSeconds * 1.8) * 0.04;
    previewRenderer.render(previewScene, previewCamera);
}
