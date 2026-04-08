const THREE = window.THREE;

const DEFAULT_BLOCK_ROUGHNESS = 0.9;
const DEFAULT_BLOCK_METALNESS = 0.0;
const DEFAULT_MEGA_HEX_ROUGHNESS = 0.85;
const DEFAULT_MEGA_HEX_METALNESS = 0.05;
const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();
const dynamicWetMaterials = new Set();

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

function chainMaterialCompiler(material, patchShader, cacheKeySuffix) {
    const previousCompiler = material.onBeforeCompile;
    const previousCacheKey = material.customProgramCacheKey?.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
        if (typeof previousCompiler === 'function') previousCompiler(shader, renderer);
        patchShader(shader);
    };
    material.customProgramCacheKey = () => {
        const base = typeof previousCacheKey === 'function' ? previousCacheKey() : '';
        return `${base}|${cacheKeySuffix}`;
    };
    material.needsUpdate = true;
}

function applyTopFaceTextureShader(material, topTexture, capTextureScale = 1, capTextureOffset = { x: 0, y: 0 }) {
    chainMaterialCompiler(material, (shader) => {
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
    }, 'topface-v1');
}

function applyCinematicSurfaceShader(material, cinematicProfile = {}) {
    chainMaterialCompiler(material, (shader) => {
        shader.uniforms.uNightWetness = { value: 0 };
        shader.uniforms.uSurfaceSeed = { value: cinematicProfile.surfaceSeed ?? Math.random() * 17.0 };
        shader.uniforms.uMicroStrength = { value: cinematicProfile.microStrength ?? 0.04 };
        shader.uniforms.uBreakupStrength = { value: cinematicProfile.breakupStrength ?? 0.05 };
        shader.uniforms.uFresnelBoost = { value: cinematicProfile.fresnelBoost ?? 0.0 };

        material.userData.cinematicUniforms = shader.uniforms;

        shader.vertexShader = shader.vertexShader
            .replace(
                'void main() {',
                'varying vec3 vWorldPosCinematic;\nvarying vec3 vWorldNormalCinematic;\nvoid main() {'
            )
            .replace(
                '#include <beginnormal_vertex>',
                '#include <beginnormal_vertex>\n\tvWorldNormalCinematic = normalize(mat3(modelMatrix) * objectNormal);'
            )
            .replace(
                '#include <worldpos_vertex>',
                '#include <worldpos_vertex>\n\tvWorldPosCinematic = (modelMatrix * vec4(transformed, 1.0)).xyz;'
            );

        shader.fragmentShader = shader.fragmentShader
            .replace(
                'void main() {',
                `varying vec3 vWorldPosCinematic;
varying vec3 vWorldNormalCinematic;
uniform float uNightWetness;
uniform float uSurfaceSeed;
uniform float uMicroStrength;
uniform float uBreakupStrength;
uniform float uFresnelBoost;

float cinematicHash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

float cinematicNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = cinematicHash(i + vec3(0.0, 0.0, 0.0));
    float n100 = cinematicHash(i + vec3(1.0, 0.0, 0.0));
    float n010 = cinematicHash(i + vec3(0.0, 1.0, 0.0));
    float n110 = cinematicHash(i + vec3(1.0, 1.0, 0.0));
    float n001 = cinematicHash(i + vec3(0.0, 0.0, 1.0));
    float n101 = cinematicHash(i + vec3(1.0, 0.0, 1.0));
    float n011 = cinematicHash(i + vec3(0.0, 1.0, 1.0));
    float n111 = cinematicHash(i + vec3(1.0, 1.0, 1.0));
    float nx00 = mix(n000, n100, f.x);
    float nx10 = mix(n010, n110, f.x);
    float nx01 = mix(n001, n101, f.x);
    float nx11 = mix(n011, n111, f.x);
    float nxy0 = mix(nx00, nx10, f.y);
    float nxy1 = mix(nx01, nx11, f.y);
    return mix(nxy0, nxy1, f.z);
}

void main() {
    float triNoiseCinematic = 0.5;`
            )
            .replace(
                '#include <normal_fragment_maps>',
                `#include <normal_fragment_maps>
    vec3 norm = normalize(vWorldNormalCinematic);
    vec3 absNorm = abs(norm) + vec3(1.0e-4);
    vec3 triW = absNorm / (absNorm.x + absNorm.y + absNorm.z);
    float nX = cinematicNoise(vec3(vWorldPosCinematic.yz * 0.11, uSurfaceSeed));
    float nY = cinematicNoise(vec3(vWorldPosCinematic.xz * 0.11, uSurfaceSeed + 1.7));
    float nZ = cinematicNoise(vec3(vWorldPosCinematic.xy * 0.11, uSurfaceSeed + 3.4));
    triNoiseCinematic = nX * triW.x + nY * triW.y + nZ * triW.z;
    vec3 microNudge = normalize(vec3(nY - 0.5, nZ - 0.5, nX - 0.5));
    normal = normalize(mix(normal, normalize(normal + microNudge * uMicroStrength), 0.55));`
            )
            .replace(
                '#include <roughnessmap_fragment>',
                `#include <roughnessmap_fragment>
    float breakup = mix(1.0 - uBreakupStrength, 1.0 + uBreakupStrength, triNoiseCinematic);
    roughnessFactor = clamp(roughnessFactor * breakup, 0.02, 1.0);
    roughnessFactor = mix(roughnessFactor, max(0.03, roughnessFactor * 0.55), uNightWetness);`
            )
            .replace(
                '#include <emissivemap_fragment>',
                `#include <emissivemap_fragment>
    float fresnelTerm = pow(1.0 - clamp(dot(normalize(vViewPosition), normalize(normal)), 0.0, 1.0), 3.0);
    float fresnelWetBoost = fresnelTerm * (uNightWetness * 0.2 + uFresnelBoost * 0.35);
    totalEmissiveRadiance += vec3(0.38, 0.52, 0.72) * fresnelWetBoost;`
            );
    }, `cinematic-surface-${cinematicProfile.key ?? 'generic'}`);

    if (cinematicProfile.wetResponsive) {
        material.userData.baseRoughness = material.roughness ?? DEFAULT_BLOCK_ROUGHNESS;
        material.userData.baseEnvMapIntensity = material.envMapIntensity ?? 1;
        material.userData.baseClearcoat = material.clearcoat ?? 0;
        dynamicWetMaterials.add(material);
    }
}

export function updateCinematicMaterialResponse({ dayFactor = 1, rainStrength = 0 } = {}) {
    const night = 1 - THREE.MathUtils.clamp(dayFactor, 0, 1);
    const dew = THREE.MathUtils.smoothstep(night, 0.3, 1.0) * 0.65;
    const wetness = THREE.MathUtils.clamp(Math.max(dew, rainStrength), 0, 1);

    for (const material of dynamicWetMaterials) {
        if (!material || material.disposed) continue;
        const baseRoughness = material.userData.baseRoughness ?? material.roughness ?? DEFAULT_BLOCK_ROUGHNESS;
        const baseEnv = material.userData.baseEnvMapIntensity ?? material.envMapIntensity ?? 1;
        const baseClearcoat = material.userData.baseClearcoat ?? material.clearcoat ?? 0;
        material.roughness = THREE.MathUtils.lerp(baseRoughness, Math.max(0.03, baseRoughness * 0.55), wetness);
        material.envMapIntensity = THREE.MathUtils.lerp(baseEnv, baseEnv * 1.28, wetness);
        if ('clearcoat' in material) {
            material.clearcoat = THREE.MathUtils.lerp(baseClearcoat, Math.max(0.06, baseClearcoat + 0.2), wetness);
            material.clearcoatRoughness = THREE.MathUtils.lerp(material.clearcoatRoughness ?? 0.5, 0.22, wetness);
        }
        const uniforms = material.userData.cinematicUniforms;
        if (uniforms?.uNightWetness) uniforms.uNightWetness.value = wetness;
    }
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

        const cinematicProfile = {
            key: blockType.name ?? 'block',
            surfaceSeed: (blockType.color ?? 0xffffff) * 0.000001,
            microStrength: blockType.isLiquid ? 0.02 : 0.05,
            breakupStrength: blockType.isLiquid ? 0.02 : 0.07,
            fresnelBoost: (blockType.name === 'Water' || blockType.name === 'Ice') ? 1.0 : 0.0,
            wetResponsive: !!(blockType.isLiquid || blockType.name === 'Stone' || blockType.name === 'Dirt' || blockType.name === 'Grass' || blockType.name === 'Sandstone')
        };

        if (Number.isFinite(blockType.transmission) || Number.isFinite(blockType.thickness)) {
            const material = new THREE.MeshPhysicalMaterial({
                ...materialParams,
                transmission: blockType.transmission ?? 0,
                thickness: blockType.thickness ?? 0,
                ior: blockType.ior ?? 1.5
            });
            applyCinematicSurfaceShader(material, cinematicProfile);
            if (topFaceTexture) applyTopFaceTextureShader(material, topFaceTexture, blockType.capTextureScale ?? 1, blockType.capTextureOffset);
            return material;
        }
        const material = new THREE.MeshStandardMaterial(materialParams);
        applyCinematicSurfaceShader(material, cinematicProfile);
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
