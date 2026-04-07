const THREE = window.THREE;

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();

let previewRoot = null;
let previewRenderer = null;
let previewScene = null;
let previewCamera = null;
let avatarGroup = null;

function loadTexture(path) {
    if (textureCache.has(path)) return textureCache.get(path);
    const texture = textureLoader.load(path);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    textureCache.set(path, texture);
    return texture;
}

function createHeadMaterials() {
    const top = loadTexture('assets/skin/head/top_head.png');
    const front = loadTexture('assets/skin/head/front_head.png');
    const right = loadTexture('assets/skin/head/side_right_head.png');
    const left = loadTexture('assets/skin/head/side_left_head.png');

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
    const front = loadTexture('assets/skin/arm/right_arm_front.png');
    const topShoulder = loadTexture('assets/skin/arm/right_top_shoulder.png');
    const hand = loadTexture('assets/skin/arm/hand.png');

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
    const front = loadTexture('assets/skin/leg/right_leg_front.png');
    const feet = loadTexture('assets/skin/leg/feet.png');

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
    const front = loadTexture('assets/skin/body/chest_front.png');
    const side = loadTexture('assets/skin/body/chest_right_side.png');
    const back = loadTexture('assets/skin/body/chest_back.png');

    return [
        new THREE.MeshLambertMaterial({ map: side }),
        new THREE.MeshLambertMaterial({ map: side }),
        new THREE.MeshLambertMaterial({ map: front }),
        new THREE.MeshLambertMaterial({ map: front }),
        new THREE.MeshLambertMaterial({ map: back }),
        new THREE.MeshLambertMaterial({ map: front })
    ];
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

    const avatar = new THREE.Group();

    const torso = new THREE.Mesh(new THREE.BoxGeometry(torsoWidth, torsoHeight, torsoDepth), createChestMaterials());
    torso.position.y = legHeight + (torsoHeight * 0.5);
    avatar.add(torso);

    const armOffset = (torsoWidth * 0.5) + (limbWidth * 0.5);
    const armY = legHeight + (torsoHeight * 0.5);

    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(limbWidth, torsoHeight, limbDepth), createArmMaterials());
    leftArm.position.set(-armOffset, armY, 0);
    avatar.add(leftArm);

    const rightArm = new THREE.Mesh(new THREE.BoxGeometry(limbWidth, torsoHeight, limbDepth), createArmMaterials());
    rightArm.position.set(armOffset, armY, 0);
    avatar.add(rightArm);

    const legOffset = limbWidth * 0.5;
    const legY = legHeight * 0.5;

    const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(limbWidth, legHeight, limbDepth), createLegMaterials());
    leftLeg.position.set(-legOffset, legY, 0);
    avatar.add(leftLeg);

    const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(limbWidth, legHeight, limbDepth), createLegMaterials());
    rightLeg.position.set(legOffset, legY, 0);
    avatar.add(rightLeg);

    const head = new THREE.Mesh(new THREE.BoxGeometry(headSize, headSize, headSize), createHeadMaterials());
    head.position.y = legHeight + torsoHeight + (headSize * 0.5);
    avatar.add(head);

    return avatar;
}

function resizePreviewRenderer() {
    if (!previewRoot || !previewRenderer || !previewCamera) return;
    const width = Math.max(1, previewRoot.clientWidth);
    const height = Math.max(1, previewRoot.clientHeight);
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

    resizePreviewRenderer();
    window.addEventListener('resize', resizePreviewRenderer);
}

export function renderInventoryAvatarPreview(timeSeconds) {
    if (!previewRenderer || !previewScene || !previewCamera || !avatarGroup) return;

    const inventoryScreen = document.getElementById('inventory-screen');
    if (!inventoryScreen || !inventoryScreen.classList.contains('visible')) return;

    avatarGroup.rotation.y = timeSeconds * 0.55;
    avatarGroup.position.y = Math.sin(timeSeconds * 1.8) * 0.04;
    previewRenderer.render(previewScene, previewCamera);
}
