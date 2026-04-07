const THREE = window.THREE;

export function createBlockMaterials(blockTypes) {
    return blockTypes.map((blockType) => new THREE.MeshLambertMaterial({
        color: blockType.color,
        transparent: blockType.transparent ?? false,
        opacity: blockType.opacity ?? 1,
        depthWrite: blockType.transparent ? false : true,
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
    return new THREE.MeshLambertMaterial({ color: 0x6d8f5f });
}
