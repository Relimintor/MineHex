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


float hash3(vec3 p) {
    return fract(sin(dot(p, vec3(12.3, 45.6, 78.9))) * 43758.5);
}

float stars(vec3 dir, float night, float t) {
    float angle = t * 0.0004;
    float c = cos(angle);
    float s = sin(angle);
    vec3 rotated = vec3((dir.x * c) - (dir.z * s), dir.y, (dir.x * s) + (dir.z * c));
    float n = hash3(rotated * 1000.0);
    float star = step(0.99833, n);
    float twinkle = 0.94 + 0.06 * sin(t * 0.03 + rotated.x * 61.0 + rotated.z * 37.0);
    return star * night * twinkle;
}

float sun_disc(vec3 dir, vec3 sunDir) {
    float d = dot(dir, sunDir);
    return smoothstep(0.999, 1.0, d);
}

float sun_glow(vec3 dir, vec3 sunDir) {
    float d = max(dot(dir, sunDir), 0.0);
    return smoothstep(0.94, 1.0, d);
}

vec3 sky_color(vec3 dir, vec3 sunDir, float height, float dayFactor, float nightFactor) {
    vec3 dayTop = vec3(0.20, 0.50, 1.0);
    vec3 dayHorizon = vec3(0.72, 0.86, 1.0);
    vec3 nightTop = vec3(0.02, 0.02, 0.05);
    vec3 nightHorizon = vec3(0.05, 0.07, 0.14);

    vec3 dayGradient = mix(dayHorizon, dayTop, height);
    vec3 nightGradient = mix(nightHorizon, nightTop, height);
    vec3 baseSky = mix(nightGradient, dayGradient, dayFactor);

    vec3 dawnTint = vec3(1.0, 0.56, 0.28);
    vec3 duskTint = vec3(1.0, 0.45, 0.68);
    vec3 twilightTint = mix(dawnTint, duskTint, step(0.0, sunDir.x));
    float twilightBand = 1.0 - smoothstep(0.0, 0.45, abs(sunDir.y));
    float twilightTime = 1.0 - smoothstep(0.05, 0.85, dayFactor);
    float horizonBlend = (1.0 - height) * 0.8;
    float twilightStrength = twilightBand * twilightTime * horizonBlend;
    baseSky = mix(baseSky, twilightTint, twilightStrength);

    float nightLift = 0.85 + 0.15 * nightFactor;
    return baseSky * (0.35 + 0.65 * height) * nightLift;
}

vec3 render_sky(vec3 dir, vec3 sunDir, float time) {
    float height = smoothstep(0.0, 1.0, dir.y * 0.5 + 0.5);
    float dayFactor = smoothstep(0.0, 1.0, (sunDir.y + 0.12) / 0.62);
    float nightFactor = 1.0 - dayFactor;
    float sunEnergy = smoothstep(0.0, 1.0, (sunDir.y + 0.08) / 0.52);

    vec3 sky = sky_color(dir, sunDir, height, dayFactor, nightFactor);

    vec3 dayGradient = mix(vec3(0.72, 0.86, 1.0), vec3(0.20, 0.50, 1.0), height);
    vec3 sunTint = mix(vec3(1.0, 0.92, 0.72), dayGradient, 0.35);
    float disc = sun_disc(dir, sunDir);
    float glow = sun_glow(dir, sunDir);
    float sunVal = (disc * (0.85 + 0.15 * sunEnergy)) + (glow * 0.35 * sunEnergy);

    float night = smoothstep(0.1, 0.9, nightFactor);
    float starVal = stars(dir, night, time);
    sky += sunTint * sunVal;
    sky += vec3(1.0) * starVal;
    return sky;
}

void main() {
    vec3 dir = normalize(vWorldDir);
    vec3 sunDir = normalize(uSunDir);
    vec3 finalSky = render_sky(dir, sunDir, uTime);
    gl_FragColor = vec4(clamp(finalSky, 0.0, 1.0), 1.0);
}
`

function makeFallbackUniforms(timeSeconds) {
    const period = 120.0;
    const cycle = ((timeSeconds % period) + period) % period / period;
    const angle = cycle * Math.PI * 2.0 - Math.PI * 0.5;
    const sunDir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0.05).normalize();
    const skyTint = THREE.MathUtils.smoothstep((Math.sin(angle) + 0.12) / 0.62, 0, 1);
    const day = skyTint;
    const energy = THREE.MathUtils.smoothstep((sunDir.y + 0.08) / 0.52, 0, 1);
    return {
        timeOfDay: cycle,
        sunAngle: angle,
        skyTint,
        sunDir,
        sunEnergy: energy,
        dayFactor: day,
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


function resolveTimeBackbone(timeSeconds) {
    if (!wasmSkyModule || typeof wasmSkyModule.sky_time_state !== 'function') {
        return makeFallbackUniforms(timeSeconds);
    }
    const t = wasmSkyModule.sky_time_state(timeSeconds);
    if (!Array.isArray(t) || t.length < 6) {
        return makeFallbackUniforms(timeSeconds);
    }
    const sunDir = new THREE.Vector3(t[2], t[3], t[4]).normalize();
    const skyTint = t[5];
    return {
        timeOfDay: t[0],
        sunAngle: t[1],
        skyTint,
        sunDir,
        dayFactor: skyTint,
        nightFactor: 1 - skyTint,
        sunEnergy: THREE.MathUtils.smoothstep((sunDir.y + 0.08) / 0.52, 0, 1),
    };
}

function resolveSkyUniformValues(timeSeconds) {
    return resolveTimeBackbone(timeSeconds);
}

function deriveLightingInputs(sunDir) {
    const dayFactor = THREE.MathUtils.smoothstep((sunDir.y + 0.12) / 0.62, 0, 1);
    const sunEnergy = THREE.MathUtils.smoothstep((sunDir.y + 0.08) / 0.52, 0, 1);
    return { sunDir, dayFactor, sunEnergy };
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

            if (camera) mesh.position.copy(camera.position);

            lightingBridge?.syncSun?.(deriveLightingInputs(skyValues.sunDir));

            const fogHex = resolveFogColor(timeSeconds);
            if (fogHex !== null) {
                scene.background.setHex(fogHex);
                scene.fog.color.setHex(fogHex);
            }
        },
    };
}
