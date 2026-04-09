const THREE = window.THREE;
import { updateAtmosphericMaterialResponse } from '../shaders/materials.js';
import { createBloodMoonSmokeController, createBloodMoonTexture, getBloodMoonUniforms, resolveBloodMoonBoost } from './bloodmoon/index.js';

export const SKY_COLOR = 0x87ceeb;
const DAY_LENGTH_SECONDS = 480.0;

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
uniform sampler2D uBloodMoonTex;
uniform float uBloodMoonBoost;
uniform float uCometShower;
uniform vec3 uCometHeadDir;
uniform float uThunderFlash;
uniform float uAuroraStrength;


float hash3(vec3 p) {
    return fract(sin(dot(p, vec3(12.3, 45.6, 78.9))) * 43758.5);
}



float value_noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    float a = hash3(vec3(i, 0.0));
    float b = hash3(vec3(i + vec2(1.0, 0.0), 0.0));
    float c = hash3(vec3(i + vec2(0.0, 1.0), 0.0));
    float d = hash3(vec3(i + vec2(1.0, 1.0), 0.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float cloud_map(vec2 uv) {
    float n0 = value_noise(uv * 1.9);
    float n1 = value_noise(uv * 3.8 + vec2(11.3, 7.7));
    float n2 = value_noise(uv * 7.6 + vec2(23.1, 5.2));
    float detail = value_noise(uv * 14.0 + vec2(5.3, 19.1));
    float combined = (n0 * 0.52) + (n1 * 0.28) + (n2 * 0.14) + (detail * 0.06);
    return smoothstep(0.54, 0.69, combined);
}

vec2 star_uv(vec3 dir) {
    float u = atan(dir.z, dir.x) * 0.15915494 + 0.5;
    float v = asin(clamp(dir.y, -1.0, 1.0)) * 0.31830989 + 0.5;
    return vec2(fract(u), clamp(v, 0.0, 1.0));
}

float stars(vec3 dir, float night) {
    vec2 uv = star_uv(dir);
    float major = value_noise(uv * 360.0 + vec2(12.4, 3.7));
    float minor = value_noise(uv * 760.0 + vec2(41.0, 19.6));
    float starField = smoothstep(0.90, 0.985, major * 0.74 + minor * 0.26);
    return starField * night;
}

float sun_disc(vec3 dir, vec3 sunDir) {
    float d = dot(dir, sunDir);
    return smoothstep(0.999, 1.0, d);
}

vec3 atmospheric_scatter(vec3 viewDir, vec3 sunDir, float dayFactor, float nightFactor) {
    float sunAmount = max(dot(viewDir, sunDir), 0.0);
    float up = clamp(viewDir.y * 0.5 + 0.5, 0.0, 1.0);

    vec3 rayleighBlue = vec3(0.18, 0.42, 0.95);
    vec3 rayleigh = rayleighBlue * (0.25 + 0.75 * up);

    float miePhase = pow(sunAmount, 10.0);
    vec3 mie = vec3(1.0, 0.63, 0.36) * miePhase * (0.30 + 0.70 * dayFactor);

    float horizon = pow(1.0 - up, 2.1);
    vec3 haze = vec3(0.95, 0.74, 0.58) * horizon * (0.18 + 0.45 * (1.0 - dayFactor));

    float lowSun = 1.0 - smoothstep(0.0, 0.48, abs(sunDir.y));
    vec3 sunset = vec3(1.0, 0.42, 0.30) * lowSun * horizon * 0.65;

    vec3 nightBase = vec3(0.02, 0.03, 0.07) * (0.35 + 0.65 * up);
    vec3 dayBase = rayleigh + haze + mie + sunset;
    return mix(nightBase, dayBase, dayFactor) * (0.90 + 0.10 * (1.0 - nightFactor));
}



vec3 moon_color(vec3 dir, vec3 sunDir, float time) {
    float cycle = (time / ${DAY_LENGTH_SECONDS.toFixed(1)}) * 6.2831853 + 1.5707963;
    float moonAngle = cycle * 1.6;
    vec3 moonDir = normalize(vec3(cos(moonAngle), sin(moonAngle), 0.05));

    float moonDisc = smoothstep(0.99925, 1.0, dot(dir, moonDir));

    vec3 upAxis = vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(upAxis, moonDir) + vec3(1.0e-5, 0.0, 0.0));
    vec3 moonUp = normalize(cross(moonDir, right));
    vec2 local = vec2(dot(dir, right), dot(dir, moonUp));
    vec2 uv = local * 22.0 + 0.5;
    vec4 tex = texture2D(uBloodMoonTex, uv);

    float opposite = smoothstep(0.985, 1.0, -dot(sunDir, moonDir));
    vec3 moonBase = mix(vec3(0.88, 0.90, 0.96), vec3(0.9, 0.1, 0.08), opposite);
    moonBase = mix(moonBase, vec3(0.98, 0.06, 0.04), uBloodMoonBoost);
    vec3 moonLit = mix(moonBase, tex.rgb, tex.a * 0.9);
    return moonLit * moonDisc * (0.55 + 0.45 * (1.0 - smoothstep(0.0, 0.2, sunDir.y))) * (1.0 + uBloodMoonBoost * 0.45);
}

vec3 comet_shower(vec3 dir, vec3 headDir, float strength, float time) {
    if (strength <= 0.001) return vec3(0.0);
    vec3 axis = normalize(cross(headDir, vec3(0.0, 1.0, 0.0)) + vec3(0.01, 0.0, 0.0));
    vec3 axisUp = normalize(cross(headDir, axis));
    vec3 outColor = vec3(0.0);

    for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float laneOffset = fi * 0.17 + value_noise(vec2(fi * 3.1, floor(time * 0.035)));
        vec3 laneDir = normalize(headDir + axis * (laneOffset - 0.24) * 0.22 + axisUp * (0.14 - laneOffset) * 0.06);
        float streak = smoothstep(0.985 - fi * 0.002, 1.0, dot(dir, laneDir));
        float speed = 0.35 + fi * 0.19;
        float phase = fract(time * speed + fi * 0.31 + value_noise(vec2(fi * 0.4, floor(time * 0.07))));
        float tail = smoothstep(0.0, 0.16, phase) * (1.0 - smoothstep(0.16, 0.75, phase));
        vec3 tint = mix(vec3(0.7, 0.82, 1.0), vec3(1.0, 0.88, 0.62), fi * 0.23);
        outColor += tint * streak * tail;
    }

    return outColor * strength * 1.45;
}

vec3 aurora_color(vec3 dir, float strength, float time) {
    if (strength <= 0.001) return vec3(0.0);
    float aboveHorizon = smoothstep(-0.03, 0.28, dir.y) * (1.0 - smoothstep(0.45, 0.85, dir.y));
    vec2 uv = vec2(atan(dir.z, dir.x), dir.y);
    float waveA = sin(uv.x * 4.2 + time * 0.21);
    float waveB = sin(uv.x * 8.8 - time * 0.13 + uv.y * 12.0);
    float ribbon = smoothstep(0.25, 0.85, waveA * 0.55 + waveB * 0.45);
    float striation = value_noise(vec2(uv.x * 9.0 + time * 0.04, uv.y * 26.0 - time * 0.18));
    float column = smoothstep(0.3, 0.92, striation);
    vec3 auroraTint = mix(vec3(0.12, 0.95, 0.56), vec3(0.45, 0.62, 1.0), 0.45 + 0.35 * sin(time * 0.03 + uv.x * 1.7));
    return auroraTint * ribbon * column * aboveHorizon * strength * 0.85;
}
vec3 render_sky(vec3 dir, vec3 sunDir, float time) {
    float dayFactor = smoothstep(0.0, 1.0, (sunDir.y + 0.12) / 0.62);
    float nightFactor = 1.0 - dayFactor;
    float sunEnergy = smoothstep(0.0, 1.0, (sunDir.y + 0.08) / 0.52);

    vec3 sky = atmospheric_scatter(dir, sunDir, dayFactor, nightFactor);

    vec3 sunTint = vec3(1.0, 0.93, 0.78);
    float disc = sun_disc(dir, sunDir);
    float sunVal = disc * (0.95 + 0.05 * sunEnergy);

    float night = smoothstep(0.1, 0.9, nightFactor);
    float starVal = stars(dir, night);

    vec2 cloudUV = (dir.xz / max(0.18, dir.y + 0.45)) * 1.1 + vec2(time * 0.0035, time * 0.0014);
    float cloudMask = cloud_map(cloudUV);
    float cloudVerticalFade = smoothstep(-0.2, 0.4, dir.y);
    float cloudDistanceFade = 1.0 - smoothstep(3.0, 6.0, length(cloudUV));
    float cloudFade = cloudVerticalFade * cloudDistanceFade;
    float cloudNightVisibility = 0.22 + (0.78 * dayFactor);
    float cloudShade = mix(0.56, 1.05, max(dot(normalize(vec3(dir.x, 0.35, dir.z)), sunDir), 0.0));
    vec3 cloudColor = vec3(0.92, 0.95, 0.99) * cloudMask * cloudFade * cloudNightVisibility * cloudShade;

    sky += sunTint * sunVal * 1.6;
    sky += moon_color(dir, sunDir, time);
    sky += vec3(1.0) * starVal;
    sky += comet_shower(dir, normalize(uCometHeadDir), uCometShower * night, time);
    sky += aurora_color(dir, uAuroraStrength * night, time);
    sky += vec3(0.9, 0.94, 1.0) * uThunderFlash * smoothstep(-0.2, 0.2, dir.y) * (1.0 - smoothstep(0.2, 0.8, dir.y));
    sky = mix(sky, cloudColor + sky, cloudMask * cloudFade * cloudNightVisibility * 0.68);
    sky = mix(sky, sky + vec3(0.75, 0.82, 1.0), uThunderFlash * 0.25);
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
    const period = DAY_LENGTH_SECONDS;
    const cycle = ((timeSeconds % period) + period) % period / period;
    const angle = cycle * Math.PI * 2.0 + Math.PI * 0.5;
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

function fract(value) {
    return value - Math.floor(value);
}

function hash1(value) {
    return fract(Math.sin(value * 12.9898 + 78.233) * 43758.5453);
}

function pulseAroundMidnight(dayPhase) {
    const wrapped = Math.abs(dayPhase - 0.5);
    return 1 - THREE.MathUtils.smoothstep(wrapped, 0.19, 0.46);
}

function resolveEventMoments(timeSeconds, sunDir) {
    const dayCycle = timeSeconds / DAY_LENGTH_SECONDS;
    const dayIndex = Math.floor(dayCycle);
    const dayPhase = fract(dayCycle);
    const nightFactor = THREE.MathUtils.smoothstep(-sunDir.y, 0.05, 0.92);
    const midnightPulse = pulseAroundMidnight(dayPhase) * nightFactor;

    const bloodMoonBoost = resolveBloodMoonBoost({
        timeSeconds,
        sunDir,
        dayLengthSeconds: DAY_LENGTH_SECONDS,
    });

    const auroraNight = hash1(dayIndex * 0.719 + 41.8) > 0.93 ? 1 : 0;
    const auroraPhase = 0.55 + 0.45 * Math.sin(timeSeconds * 0.047 + dayIndex * 0.31);
    const auroraStrength = auroraNight * midnightPulse * auroraPhase;

    const showerStartWindow = 0.18;
    const showerToday = hash1(dayIndex * 0.413 + 18.7) > 0.965 && dayPhase < showerStartWindow
        ? 1 - (dayPhase / showerStartWindow)
        : 0;
    const prevDayPhase = dayPhase + (1 - showerStartWindow);
    const showerYesterday = hash1((dayIndex - 1) * 0.413 + 18.7) > 0.965 && dayPhase > (1 - showerStartWindow)
        ? 1 - (prevDayPhase / showerStartWindow)
        : 0;
    const cometShower = Math.max(showerToday, showerYesterday) * nightFactor;
    const cometHeadingAngle = (dayCycle * 0.29 + hash1(dayIndex * 2.03 + 7.9)) * Math.PI * 2;
    const cometHeadDir = new THREE.Vector3(
        Math.cos(cometHeadingAngle),
        0.42 + 0.2 * Math.sin(dayCycle * 0.7 + 1.1),
        Math.sin(cometHeadingAngle)
    ).normalize();

    const thunderNight = hash1(dayIndex * 2.173 + 3.2) > 0.9 ? 1 : 0;
    const flashTick = Math.floor(timeSeconds * 0.85);
    const flashSeed = hash1(flashTick * 7.71 + dayIndex * 13.57);
    const flashImpulse = flashSeed > 0.983 ? (flashSeed - 0.983) / 0.017 : 0;
    const flashTail = 1 - fract(timeSeconds * 0.85);
    const thunderFlash = thunderNight * nightFactor * flashImpulse * flashTail;

    return { bloodMoonBoost, auroraStrength, cometShower, cometHeadDir, thunderFlash };
}

function deriveLightingInputs(sunDir) {
    const dayFactor = THREE.MathUtils.smoothstep((sunDir.y + 0.12) / 0.62, 0, 1);
    const sunEnergy = THREE.MathUtils.smoothstep((sunDir.y + 0.08) / 0.52, 0, 1);
    return { sunDir, dayFactor, sunEnergy };
}

function deriveAtmosphereInputs(timeSeconds, skyValues) {
    const dayFactor = THREE.MathUtils.clamp(skyValues?.dayFactor ?? 1, 0, 1);
    const cloudPulse = 0.5 + 0.5 * Math.sin(timeSeconds * 0.021 + 1.3);
    const cloudDrift = 0.5 + 0.5 * Math.sin(timeSeconds * 0.008 - 0.6);
    const weatherFactor = THREE.MathUtils.clamp((cloudPulse * 0.62) + (cloudDrift * 0.38), 0, 1);
    return { dayFactor, weatherFactor };
}


function resolveFogColor(timeSeconds) {
    if (!wasmSkyModule || typeof wasmSkyModule.sky_color_hex_for_direction !== 'function') {
        return null;
    }
    return wasmSkyModule.sky_color_hex_for_direction(timeSeconds, 0.0, 0.15, 1.0);
}

export function applySkyAtmosphere(scene, lightingBridge) {
    const bloodMoonTexture = createBloodMoonTexture();

    const uniforms = {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        ...getBloodMoonUniforms(bloodMoonTexture),
        uCometShower: { value: 0 },
        uCometHeadDir: { value: new THREE.Vector3(0.4, 0.6, 0.2).normalize() },
        uThunderFlash: { value: 0 },
        uAuroraStrength: { value: 0 },
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
    const bloodMoonSmoke = createBloodMoonSmokeController(scene);

    const initialColor = new THREE.Color(SKY_COLOR);
    scene.background = initialColor;
    scene.fog = new THREE.Fog(initialColor.getHex(), 20, 80);

    ensureWasmSkyLoaded();

    return {
        update(timeSeconds, camera) {
            uniforms.uTime.value = timeSeconds;

            const skyValues = resolveSkyUniformValues(timeSeconds);
            uniforms.uSunDir.value.copy(skyValues.sunDir);
            const eventMoments = resolveEventMoments(timeSeconds, skyValues.sunDir);
            uniforms.uBloodMoonBoost.value = eventMoments.bloodMoonBoost;
            uniforms.uCometShower.value = eventMoments.cometShower;
            uniforms.uCometHeadDir.value.copy(eventMoments.cometHeadDir);
            uniforms.uThunderFlash.value = eventMoments.thunderFlash;
            uniforms.uAuroraStrength.value = eventMoments.auroraStrength;

            if (camera) mesh.position.copy(camera.position);
            bloodMoonSmoke.update(timeSeconds, camera?.position ?? null, eventMoments.bloodMoonBoost);

            lightingBridge?.syncSun?.({
                ...deriveLightingInputs(skyValues.sunDir),
                eventMoments,
            });

            const fogHex = resolveFogColor(timeSeconds);
            if (fogHex !== null) {
                scene.background.setHex(fogHex);
                scene.fog.color.setHex(fogHex);
            }
            if (eventMoments.thunderFlash > 0.001 && scene.fog?.color) {
                const flashFog = new THREE.Color(0xd7e5ff);
                scene.fog.color.lerp(flashFog, Math.min(0.7, eventMoments.thunderFlash));
                scene.background.copy(scene.fog.color);
            }

            const atmospheric = deriveAtmosphereInputs(timeSeconds, skyValues);
            updateAtmosphericMaterialResponse({
                fogColor: scene.fog?.color ?? null,
                sunDir: skyValues.sunDir,
                dayFactor: atmospheric.dayFactor,
                weatherFactor: atmospheric.weatherFactor,
                timeSeconds
            });
        },
    };
}
