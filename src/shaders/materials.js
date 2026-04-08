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
    loaded.wrapS = THREE.ClampToEdgeWrapping;
    loaded.wrapT = THREE.ClampToEdgeWrapping;
    textureCache.set(texturePath, loaded);
    return loaded;
}

function applyTopFaceTextureShader(material, topTexture, capTextureScale = 1, capTextureOffset = { x: 0, y: 0 }) {
    material.onBeforeCompile = (shader) => {
        shader.uniforms.topFaceMap = { value: topTexture };
        shader.uniforms.topFaceScale = { value: capTextureScale };
        shader.uniforms.topFaceOffset = { value: new THREE.Vector2(capTextureOffset?.x ?? 0, capTextureOffset?.y ?? 0) };
        shader.vertexShader = shader.vertexShader
            .replace('void main() {', 'varying vec3 vLocalPos;\nvarying vec3 vLocalNormal;\nvoid main() {')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvLocalPos = position;\n\tvLocalNormal = normal;');

        shader.fragmentShader = shader.fragmentShader
            .replace('void main() {', 'varying vec3 vLocalPos;\nvarying vec3 vLocalNormal;\nuniform sampler2D topFaceMap;\nuniform float topFaceScale;\nuniform vec2 topFaceOffset;\nvoid main() {')
            .replace(
                '#include <map_fragment>',
                `#include <map_fragment>
    vec2 topUv = vec2(vLocalPos.x * 0.5, -vLocalPos.z * 0.5) / max(topFaceScale, 0.01) + vec2(0.5) + topFaceOffset;
    topUv = clamp(topUv, vec2(0.001), vec2(0.999));
    vec4 topFaceColor = texture2D(topFaceMap, topUv);
    float topBottomMask = smoothstep(0.96, 0.999, abs(normalize(vLocalNormal).y));
    diffuseColor.rgb = mix(diffuseColor.rgb, topFaceColor.rgb, topBottomMask);`
            );
    };
    material.needsUpdate = true;
}

export function createBlockMaterials(blockTypes) {
    return blockTypes.map((blockType) => {
        const transparent = blockType.transparent ?? false;
        const alphaTest = blockType.alphaTest ?? (transparent && (blockType.opacity ?? 1) >= 0.85 ? 0.35 : 0);
        const topFaceTexture = getTexture(blockType.capTexture);
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
            envMapIntensity: blockType.envMapIntensity ?? 1,
            dithering: transparent && alphaTest <= 0,
            side: THREE.FrontSide
        };
        if (Number.isFinite(blockType.transmission) || Number.isFinite(blockType.thickness)) {
            const material = new THREE.MeshPhysicalMaterial({
                ...materialParams,
                transmission: blockType.transmission ?? 0,
                thickness: blockType.thickness ?? 0,
                ior: blockType.ior ?? 1.5
            });
            if (topFaceTexture) applyTopFaceTextureShader(material, topFaceTexture, blockType.capTextureScale ?? 1, blockType.capTextureOffset);
            return material;
        }
        const material = new THREE.MeshStandardMaterial(materialParams);
        if (topFaceTexture) applyTopFaceTextureShader(material, topFaceTexture, blockType.capTextureScale ?? 1, blockType.capTextureOffset);
        return material;
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
