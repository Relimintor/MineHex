const THREE = window.THREE;

const textureLoader = new THREE.TextureLoader();
const subscribers = new Set();
const DEFAULT_SKIN_TEXTURE_PATH = 'assets/skin/skin.png';

let activeSkinTexture = null;

function applyTextureDefaults(texture) {
    if (!texture) return;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
}

function notifySkinTextureUpdated() {
    if (!activeSkinTexture) return;
    for (const subscriber of subscribers) {
        subscriber(activeSkinTexture);
    }
}

function setActiveSkinTexture(texture) {
    applyTextureDefaults(texture);
    activeSkinTexture = texture;
    notifySkinTextureUpdated();
}

export function initializeSkinTexture() {
    if (activeSkinTexture) return;
    textureLoader.load(DEFAULT_SKIN_TEXTURE_PATH, (texture) => {
        setActiveSkinTexture(texture);
    });
}

export function setSkinTextureFromCanvas(sourceCanvas) {
    if (!sourceCanvas) return;
    const texture = new THREE.CanvasTexture(sourceCanvas);
    texture.flipY = true;
    setActiveSkinTexture(texture);
}

export function subscribeToSkinTexture(callback) {
    if (typeof callback !== 'function') return () => {};
    subscribers.add(callback);
    if (activeSkinTexture) callback(activeSkinTexture);
    return () => subscribers.delete(callback);
}

initializeSkinTexture();
