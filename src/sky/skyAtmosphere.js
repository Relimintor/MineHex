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

uniform vec3 uSunDir;
uniform float uSunEnergy;
uniform float uDayFactor;
uniform float uNightFactor;
uniform float uAuroraFactor;

float sun_disc(vec3 dir, vec3 sunDir) {
    float d = dot(dir, sunDir);
    return smoothstep(0.999, 1.0, d);
}

float sun_glow(vec3 dir, vec3 sunDir) {
    float d = max(dot(dir, sunDir), 0.0);
    return smoothstep(0.94, 1.0, d);
}

void main() {
    vec3 dir = normalize(vWorldDir);
    vec3 sunDir = normalize(uSunDir);
    float height = smoothstep(0.0, 1.0, dir.y * 0.5 + 0.5);

    vec3 dayTop = vec3(0.20, 0.50, 1.0);
    vec3 dayHorizon = vec3(0.72, 0.86, 1.0);
    vec3 nightTop = vec3(0.02, 0.02, 0.05);
    vec3 nightHorizon = vec3(0.05, 0.07, 0.14);

    vec3 dayGradient = mix(dayHorizon, dayTop, height);
    vec3 nightGradient = mix(nightHorizon, nightTop, height);

    vec3 baseSky = mix(nightGradient, dayGradient, uDayFactor);

    vec3 sunTint = mix(vec3(1.0, 0.92, 0.72), dayGradient, 0.35);
    float disc = sun_disc(dir, sunDir);
    float glow = sun_glow(dir, sunDir);
    vec3 sunColor = sunTint * ((disc * (0.85 + 0.15 * uSunEnergy)) + (glow * 0.35 * uSunEnergy));

    float nightLift = 0.85 + 0.15 * uNightFactor;
    vec3 finalSky = (baseSky * (0.35 + 0.65 * height) * nightLift) + sunColor;

    gl_FragColor = vec4(clamp(finalSky, 0.0, 1.0), 1.0);
}
`

function makeFallbackUniforms(timeSeconds) {
    const period = 120.0;
    const cycle = ((timeSeconds % period) + period) % period / period;
    const angle = cycle * Math.PI * 2.0 - Math.PI * 0.5;
    const sunDir = new THREE.Vector3(Math.cos(angle), Math.max(0, Math.sin(angle)), 0.2).normalize();
    const skyTint = THREE.MathUtils.smoothstep((Math.sin(angle) + 0.12) / 0.62, 0, 1);
    const day = skyTint;
    const aurora = Math.pow(1 - day, 1.4);
    const energy = THREE.MathUtils.smoothstep((sunDir.y + 0.08) / 0.52, 0, 1);
    return {
        timeOfDay: cycle,
        sunAngle: angle,
        skyTint,
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
        auroraFactor: Math.pow(1 - skyTint, 1.4),
    };
}

function resolveSkyUniformValues(timeSeconds) {
    const backbone = resolveTimeBackbone(timeSeconds);
    if (!wasmSkyModule || typeof wasmSkyModule.sky_uniforms !== 'function') {
        return backbone;
    }
    const u = wasmSkyModule.sky_uniforms(timeSeconds);
    if (!Array.isArray(u) || u.length < 8) {
        return backbone;
    }
    return {
        ...backbone,
        sunDir: new THREE.Vector3(u[0], u[1], u[2]).normalize(),
        sunEnergy: u[3],
        dayFactor: u[4],
        nightFactor: u[5],
        auroraFactor: u[6],
        skyTint: u[7],
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
