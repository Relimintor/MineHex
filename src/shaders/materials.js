const THREE = window.THREE;

const DEFAULT_BLOCK_ROUGHNESS = 0.9;
const DEFAULT_BLOCK_METALNESS = 0.0;
const DEFAULT_MEGA_HEX_ROUGHNESS = 0.85;
const DEFAULT_MEGA_HEX_METALNESS = 0.05;

export function createBlockMaterials(blockTypes) {
    return blockTypes.map((blockType) => new THREE.MeshStandardMaterial({
        color: blockType.color,
        transparent: blockType.transparent ?? false,
        opacity: blockType.opacity ?? 1,
        depthWrite: blockType.transparent ? false : true,
        roughness: blockType.roughness ?? DEFAULT_BLOCK_ROUGHNESS,
        metalness: blockType.metalness ?? DEFAULT_BLOCK_METALNESS,
        side: THREE.FrontSide
    }));
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
