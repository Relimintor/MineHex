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

function applyTopFaceTextureShader(material, topTexture) {
    material.onBeforeCompile = (shader) => {
        shader.uniforms.topFaceMap = { value: topTexture };
        shader.vertexShader = shader.vertexShader
            .replace('void main() {', 'varying vec3 vLocalPos;\nvoid main() {')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvLocalPos = position;');

        shader.fragmentShader = shader.fragmentShader
            .replace('void main() {', 'varying vec3 vLocalPos;\nuniform sampler2D topFaceMap;\nvoid main() {')
            .replace(
                '#include <map_fragment>',
                `#include <map_fragment>
    vec2 topUv = clamp(vec2(vLocalPos.x * 0.5 + 0.5, 1.0 - (vLocalPos.z * 0.5 + 0.5)), vec2(0.001), vec2(0.999));
    vec4 topFaceColor = texture2D(topFaceMap, topUv);
    float topMask = smoothstep(0.92, 0.99, normalize(vNormal).y);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * topFaceColor.rgb, topMask);`
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
            if (topFaceTexture) applyTopFaceTextureShader(material, topFaceTexture);
            return material;
        }
        const material = new THREE.MeshStandardMaterial(materialParams);
        if (topFaceTexture) applyTopFaceTextureShader(material, topFaceTexture);
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
