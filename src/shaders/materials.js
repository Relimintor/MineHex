const THREE = window.THREE;

const DEFAULT_BLOCK_ROUGHNESS = 0.9;
const DEFAULT_BLOCK_METALNESS = 0.0;
const DEFAULT_MEGA_HEX_ROUGHNESS = 0.85;
const DEFAULT_MEGA_HEX_METALNESS = 0.05;
const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();

function getTexture(texturePath) {
    if (!texturePath) return null;
    if (textureCache.has(texturePath)) return textureCache.get(texturePath);
    const loaded = textureLoader.load(texturePath);
    loaded.colorSpace = THREE.SRGBColorSpace;
    loaded.wrapS = THREE.RepeatWrapping;
    loaded.wrapT = THREE.RepeatWrapping;
    textureCache.set(texturePath, loaded);
    return loaded;
}

export function createBlockMaterials(blockTypes) {
    return blockTypes.map((blockType) => {
        const transparent = blockType.transparent ?? false;
        const alphaTest = blockType.alphaTest ?? (transparent && (blockType.opacity ?? 1) >= 0.85 ? 0.35 : 0);
        const map = getTexture(blockType.capTexture);
        const materialParams = {
            color: blockType.color,
            transparent,
            opacity: blockType.opacity ?? 1,
            alphaTest,
            depthWrite: transparent && alphaTest <= 0 ? false : true,
            roughness: blockType.roughness ?? DEFAULT_BLOCK_ROUGHNESS,
            metalness: blockType.metalness ?? DEFAULT_BLOCK_METALNESS,
            normalMap: blockType.normalMap ?? null,
            roughnessMap: blockType.roughnessMap ?? null,
            aoMap: blockType.aoMap ?? null,
            map,
            envMapIntensity: blockType.envMapIntensity ?? 1,
            dithering: transparent && alphaTest <= 0,
            side: THREE.FrontSide
        };
        if (Number.isFinite(blockType.transmission) || Number.isFinite(blockType.thickness)) {
            return new THREE.MeshPhysicalMaterial({
                ...materialParams,
                transmission: blockType.transmission ?? 0,
                thickness: blockType.thickness ?? 0,
                ior: blockType.ior ?? 1.5
            });
        }
        return new THREE.MeshStandardMaterial(materialParams);
    });
}

export function createOcclusionProxyMaterial() {
    return new THREE.MeshBasicMaterial({
        colorWrite: false,
        depthWrite: false
    });
}

export function createMegaHexMaterial() {
    return new THREE.MeshPhysicalMaterial({
        color: 0x6d8f5f,
        roughness: DEFAULT_MEGA_HEX_ROUGHNESS,
        metalness: DEFAULT_MEGA_HEX_METALNESS,
        clearcoat: 0.15,
        clearcoatRoughness: 0.6
    });
}
