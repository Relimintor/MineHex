const THREE = window.THREE;

export const SKY_COLOR = 0x87ceeb;

let wasmSkyModule;
let wasmSkyReady = false;
const WASM_BUNDLE_CANDIDATES = [
    { module: './pkg/bevy_sky_gradient.js', wasm: './pkg/bevy_sky_gradient_bg.wasm' },
    { module: './bevy_sky_gradient.js', wasm: './bevy_sky_gradient_bg.wasm' },
];

const SKY_VERTEX_SHADER = /* glsl */`
varying vec3 vWorldDir;

void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldDir = normalize(worldPos.xyz - cameraPosition);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const SKY_FRAGMENT_SHADER = /* glsl */`
precision mediump float;

varying vec3 vWorldDir;

uniform float uTime;
uniform vec3 uSunDir;
uniform float uSunEnergy;
uniform float uDayFactor;
uniform float uNightFactor;
uniform float uAuroraFactor;

float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}

float valueNoise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);

    float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
    float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash13(i + vec3(1.0, 1.0, 1.0));

    float nx00 = mix(n000, n100, u.x);
    float nx10 = mix(n010, n110, u.x);
    float nx01 = mix(n001, n101, u.x);
    float nx11 = mix(n011, n111, u.x);
    float nxy0 = mix(nx00, nx10, u.y);
    float nxy1 = mix(nx01, nx11, u.y);
    return mix(nxy0, nxy1, u.z);
}

float fbm(vec3 p) {
    float value = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 3; i++) {
        value += valueNoise3(p) * amp;
        p *= 2.03;
        amp *= 0.5;
    }
    return value;
}

vec3 computeAtmosphere(vec3 dir, float horizon) {
    vec3 dayZenith = vec3(0.27, 0.57, 0.88);
    vec3 dayHorizon = vec3(0.70, 0.86, 0.98);
    vec3 dusk = vec3(0.98, 0.53, 0.34);
    vec3 dawn = vec3(0.99, 0.66, 0.42);
    vec3 nightZenith = vec3(0.03, 0.06, 0.13);
    vec3 nightHorizon = vec3(0.07, 0.11, 0.22);

    float duskShift = clamp((uSunDir.x + 1.0) * 0.5, 0.0, 1.0);
    vec3 twilight = mix(dawn, dusk, duskShift);

    vec3 dayBase = mix(dayZenith, dayHorizon, horizon);
    vec3 nightBase = mix(nightZenith, nightHorizon, horizon);
    vec3 nightToTwilight = mix(nightBase, twilight, 1.0 - uDayFactor);
    return mix(nightToTwilight, dayBase, uDayFactor);
}

void main() {
    vec3 dir = normalize(vWorldDir);
    float upness = clamp((dir.y + 1.0) * 0.5, 0.0, 1.0);
    float horizon = 1.0 - smoothstep(0.0, 1.0, upness);

    vec3 sky = computeAtmosphere(dir, horizon);

    float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
    float sunDisk = pow(sunDot, 320.0) * (0.25 + 1.2 * uSunEnergy);
    float sunHalo = pow(sunDot, 20.0) * 0.22 * uSunEnergy;
    sky += vec3(1.0, 0.93, 0.76) * (sunDisk + sunHalo);

    vec3 starsPos = dir * 190.0 + vec3(0.0, uTime * 0.03, 0.0);
    float stars = smoothstep(0.975, 1.0, valueNoise3(starsPos));
    float twinkle = 0.4 + 0.6 * sin((uTime * 0.8) + dir.x * 41.0 + dir.z * 23.0);
    sky += vec3(0.84, 0.90, 1.0) * stars * twinkle * pow(uNightFactor, 2.0);

    vec3 auroraP = vec3(dir.x * 6.0, dir.z * 6.0, uTime * 0.1);
    float auroraNoise = fbm(auroraP);
    float auroraMask = smoothstep(0.25, 0.75, auroraNoise) * smoothstep(0.1, -0.5, dir.y);
    sky += vec3(0.12, 0.9, 0.55) * auroraMask * 0.28 * uAuroraFactor;

    gl_FragColor = vec4(clamp(sky, 0.0, 1.0), 1.0);
}
`;

function makeFallbackUniforms(timeSeconds) {
    const period = 120.0;
    const cycle = ((timeSeconds % period) + period) % period / period;
    const angle = cycle * Math.PI * 2.0 - Math.PI * 0.5;
    const sunDir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0.15).normalize();
    const day = THREE.MathUtils.smoothstep((sunDir.y + 0.08) / 0.45, 0, 1);
    const aurora = THREE.MathUtils.smoothstep((-sunDir.y - 0.15) / 0.35, 0, 1);
    const energy = THREE.MathUtils.smoothstep((sunDir.y + 0.12) / 0.65, 0, 1);
    return {
        sunDir,
        sunEnergy: energy,
        dayFactor: day,
        nightFactor: 1 - day,
        auroraFactor: aurora,
    };
}

async function findWasmBundleUrls() {
    for (const candidate of WASM_BUNDLE_CANDIDATES) {
        const moduleUrl = new URL(candidate.module, import.meta.url);
        const wasmUrl = new URL(candidate.wasm, import.meta.url);
        try {
            const [moduleResponse, wasmResponse] = await Promise.all([
                fetch(moduleUrl, { method: 'GET', cache: 'no-store' }),
                fetch(wasmUrl, { method: 'GET', cache: 'no-store' }),
            ]);
            if (moduleResponse.ok && wasmResponse.ok) {
                return {
                    moduleUrl: moduleUrl.href,
                    wasmUrl: wasmUrl.href,
                };
            }
        } catch (_error) {
            // keep trying next candidate
        }
    }
    return null;
}

async function ensureWasmSkyLoaded() {
    if (wasmSkyReady) return wasmSkyModule;
    try {
        const bundle = await findWasmBundleUrls();
        if (!bundle) {
            wasmSkyReady = true;
            wasmSkyModule = null;
            return null;
        }
        const module = await import(bundle.moduleUrl);
        if (typeof module.default === 'function') {
            await module.default(bundle.wasmUrl);
        }
        wasmSkyModule = module;
        wasmSkyReady = true;
        return wasmSkyModule;
    } catch (_error) {
        wasmSkyReady = true;
        wasmSkyModule = null;
        return null;
    }
}

function resolveSkyUniformValues(timeSeconds) {
    if (!wasmSkyModule || typeof wasmSkyModule.sky_uniforms !== 'function') {
        return makeFallbackUniforms(timeSeconds);
    }
    const u = wasmSkyModule.sky_uniforms(timeSeconds);
    if (!Array.isArray(u) || u.length < 7) {
        return makeFallbackUniforms(timeSeconds);
    }
    return {
        sunDir: new THREE.Vector3(u[0], u[1], u[2]).normalize(),
        sunEnergy: u[3],
        dayFactor: u[4],
        nightFactor: u[5],
        auroraFactor: u[6],
    };
}

function resolveFogColor(timeSeconds) {
    if (!wasmSkyModule || typeof wasmSkyModule.sky_color_hex_for_direction !== 'function') {
        return null;
    }
    return wasmSkyModule.sky_color_hex_for_direction(timeSeconds, 0.0, 0.15, 1.0);
}

export function applySkyAtmosphere(scene, lightingBridge) {
    const uniforms = {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunEnergy: { value: 1 },
        uDayFactor: { value: 1 },
        uNightFactor: { value: 0 },
        uAuroraFactor: { value: 0 },
    };

    const material = new THREE.ShaderMaterial({
        vertexShader: SKY_VERTEX_SHADER,
        fragmentShader: SKY_FRAGMENT_SHADER,
        uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
    });

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 18), material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1000;

    scene.add(mesh);

    const initialColor = new THREE.Color(SKY_COLOR);
    scene.background = initialColor;
    scene.fog = new THREE.Fog(initialColor.getHex(), 20, 80);

    ensureWasmSkyLoaded();

    return {
        update(timeSeconds, camera) {
            uniforms.uTime.value = timeSeconds;

            const skyValues = resolveSkyUniformValues(timeSeconds);
            uniforms.uSunDir.value.copy(skyValues.sunDir);
            uniforms.uSunEnergy.value = skyValues.sunEnergy;
            uniforms.uDayFactor.value = skyValues.dayFactor;
            uniforms.uNightFactor.value = skyValues.nightFactor;
            uniforms.uAuroraFactor.value = skyValues.auroraFactor;

            if (camera) mesh.position.copy(camera.position);

            lightingBridge?.syncSun?.(skyValues);

            const fogHex = resolveFogColor(timeSeconds);
            if (fogHex !== null) {
                scene.background.setHex(fogHex);
                scene.fog.color.setHex(fogHex);
            }
        },
    };
}
