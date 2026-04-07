const THREE = window.THREE;

const shaderLightingMaterials = new Set();

const vertexShader = `
varying vec3 vNormalW;
varying vec3 vWorldPos;

void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vNormalW = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const fragmentShader = `
uniform vec3 uAlbedo;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform float uAmbient;
uniform float uRoughness;
uniform float uMetalness;
uniform float uOpacity;

varying vec3 vNormalW;
varying vec3 vWorldPos;

const float PI = 3.14159265359;

float distributionGGX(float NdotH, float roughness) {
    float a = roughness * roughness;
    float a2 = a * a;
    float denom = (NdotH * NdotH) * (a2 - 1.0) + 1.0;
    return a2 / (PI * denom * denom + 1e-6);
}

float geometrySchlickGGX(float NdotV, float roughness) {
    float r = roughness + 1.0;
    float k = (r * r) / 8.0;
    return NdotV / (NdotV * (1.0 - k) + k + 1e-6);
}

float geometrySmith(float NdotV, float NdotL, float roughness) {
    float ggx1 = geometrySchlickGGX(NdotV, roughness);
    float ggx2 = geometrySchlickGGX(NdotL, roughness);
    return ggx1 * ggx2;
}

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uSunDir);
    vec3 H = normalize(V + L);

    float NdotL = max(dot(N, L), 0.0);
    float NdotV = max(dot(N, V), 0.0);
    float NdotH = max(dot(N, H), 0.0);
    float HdotV = max(dot(H, V), 0.0);

    vec3 F0 = mix(vec3(0.04), uAlbedo, uMetalness);
    vec3 F = fresnelSchlick(HdotV, F0);
    float D = distributionGGX(NdotH, uRoughness);
    float G = geometrySmith(NdotV, NdotL, uRoughness);

    vec3 numerator = D * G * F;
    float denominator = max(4.0 * NdotV * NdotL, 1e-5);
    vec3 specular = numerator / denominator;

    vec3 kD = (vec3(1.0) - F) * (1.0 - uMetalness);
    vec3 diffuse = kD * uAlbedo / PI;

    vec3 radiance = uSunColor * uSunIntensity;
    vec3 direct = (diffuse + specular) * radiance * NdotL;
    vec3 ambient = uAlbedo * uAmbient;

    gl_FragColor = vec4(ambient + direct, uOpacity);
}
`;

function createPbrStarterMaterial({ color, transparent = false, opacity = 1, roughness = 0.85, metalness = 0.02 }) {
    const albedo = new THREE.Color(color);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uAlbedo: { value: new THREE.Vector3(albedo.r, albedo.g, albedo.b) },
            uSunDir: { value: new THREE.Vector3(0.48, 0.77, 0.41).normalize() },
            uSunColor: { value: new THREE.Vector3(1.0, 0.95, 0.86) },
            uSunIntensity: { value: 1.0 },
            uAmbient: { value: 0.24 },
            uRoughness: { value: roughness },
            uMetalness: { value: metalness },
            uOpacity: { value: opacity },
        },
        vertexShader,
        fragmentShader,
        transparent,
        depthWrite: transparent ? false : true,
        side: THREE.FrontSide,
    });

    shaderLightingMaterials.add(material);
    return material;
}

export function syncShaderLighting(skyValues) {
    if (!skyValues) return;
    const { sunDir, sunEnergy, dayFactor } = skyValues;
    shaderLightingMaterials.forEach((material) => {
        if (!material.uniforms) return;
        material.uniforms.uSunDir.value.set(sunDir.x, Math.max(0.02, sunDir.y), sunDir.z).normalize();
        material.uniforms.uSunIntensity.value = 0.12 + sunEnergy * 1.4;
        material.uniforms.uAmbient.value = 0.08 + dayFactor * 0.34;
        material.uniforms.uSunColor.value.set(1.0, 0.88 + dayFactor * 0.1, 0.72 + dayFactor * 0.2);
    });
}

export function createBlockMaterials(blockTypes) {
    return blockTypes.map((blockType) => createPbrStarterMaterial({
        color: blockType.color,
        transparent: blockType.transparent ?? false,
        opacity: blockType.opacity ?? 1,
        roughness: 0.9,
        metalness: 0.0,
    }));
}

export function createOcclusionProxyMaterial() {
    return new THREE.MeshBasicMaterial({
        colorWrite: false,
        depthWrite: false
    });
}

export function createMegaHexMaterial() {
    return createPbrStarterMaterial({ color: 0x6d8f5f, roughness: 0.82, metalness: 0.01 });
}
