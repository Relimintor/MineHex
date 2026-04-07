import { HEX_RADIUS } from '../config.js';
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

function applyTopFaceTextureShader(material, topTexture, capTextureScale = 1) {
    material.onBeforeCompile = (shader) => {
        shader.uniforms.topFaceMap = { value: topTexture };
        shader.uniforms.topFaceScale = { value: capTextureScale };
        shader.vertexShader = shader.vertexShader
            .replace('void main() {', 'varying vec3 vLocalPos;\nvoid main() {')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvLocalPos = position;');

        shader.fragmentShader = shader.fragmentShader
            .replace(
                'void main() {',
                `varying vec3 vLocalPos;
uniform sampler2D topFaceMap;
uniform float topFaceScale;

vec2 snapToNearestHexCenter(vec2 xz) {
    float q = (${Math.sqrt(3) / 3} * xz.x - (1.0 / 3.0) * xz.y) / ${HEX_RADIUS};
    float r = ((2.0 / 3.0) * xz.y) / ${HEX_RADIUS};
    float x = q;
    float z = r;
    float y = -x - z;

    vec3 rounded = floor(vec3(x, y, z) + 0.5);
    vec3 diff = abs(rounded - vec3(x, y, z));

    if (diff.x > diff.y && diff.x > diff.z) {
        rounded.x = -rounded.y - rounded.z;
    } else if (diff.y > diff.z) {
        rounded.y = -rounded.x - rounded.z;
    } else {
        rounded.z = -rounded.x - rounded.y;
    }

    float centerX = ${HEX_RADIUS} * ${Math.sqrt(3)} * (rounded.x + rounded.z * 0.5);
    float centerZ = ${HEX_RADIUS} * 1.5 * rounded.z;
    return vec2(centerX, centerZ);
}
void main() {`
            )
            .replace(
                '#include <map_fragment>',
                `#include <map_fragment>
    vec2 nearestHexCenter = snapToNearestHexCenter(vLocalPos.xz);
    vec2 localHexPos = vLocalPos.xz - nearestHexCenter;
    vec2 topUv = vec2(localHexPos.x / (${HEX_RADIUS} * ${Math.sqrt(3)}), -localHexPos.y / (${HEX_RADIUS} * 2.0)) / max(topFaceScale, 0.01) + vec2(0.5);
    topUv = clamp(topUv, vec2(0.001), vec2(0.999));
    vec4 topFaceColor = texture2D(topFaceMap, topUv);
    vec3 localFaceNormal = normalize(cross(dFdx(vLocalPos), dFdy(vLocalPos)));
    float topBottomMask = smoothstep(0.96, 0.999, abs(localFaceNormal.y));
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
            if (topFaceTexture) applyTopFaceTextureShader(material, topFaceTexture, blockType.capTextureScale ?? 1);
            return material;
        }
        const material = new THREE.MeshStandardMaterial(materialParams);
        if (topFaceTexture) applyTopFaceTextureShader(material, topFaceTexture, blockType.capTextureScale ?? 1);
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
