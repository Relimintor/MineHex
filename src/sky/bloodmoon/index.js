const THREE = window.THREE;

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

export function createBloodMoonTexture() {
    const bloodMoonTexture = new THREE.TextureLoader().load(new URL('../../../assets/sky/bloodmoon.png', import.meta.url).href);
    bloodMoonTexture.colorSpace = THREE.SRGBColorSpace;
    bloodMoonTexture.wrapS = THREE.ClampToEdgeWrapping;
    bloodMoonTexture.wrapT = THREE.ClampToEdgeWrapping;
    return bloodMoonTexture;
}

export function getBloodMoonUniforms(bloodMoonTexture) {
    return {
        uBloodMoonTex: { value: bloodMoonTexture },
        uBloodMoonBoost: { value: 0 },
    };
}

export function resolveBloodMoonBoost({ timeSeconds, sunDir, dayLengthSeconds }) {
    const dayCycle = timeSeconds / dayLengthSeconds;
    const dayIndex = Math.floor(dayCycle);
    const dayPhase = fract(dayCycle);
    const nightFactor = THREE.MathUtils.smoothstep(-sunDir.y, 0.05, 0.92);
    const midnightPulse = pulseAroundMidnight(dayPhase) * nightFactor;
    const bloodMoonNight = hash1(dayIndex * 1.137 + 9.31) > 0.975 ? 1 : 0;
    return bloodMoonNight * midnightPulse;
}
