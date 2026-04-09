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

function createSmokeTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0.0, 'rgba(255,120,120,0.9)');
    g.addColorStop(0.35, 'rgba(255,70,55,0.55)');
    g.addColorStop(0.75, 'rgba(150,20,20,0.2)');
    g.addColorStop(1.0, 'rgba(40,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
}

export function createBloodMoonSmokeController(scene) {
    const particleCount = 180;
    const offsets = new Float32Array(particleCount * 3);
    const seeds = new Float32Array(particleCount);
    const sizes = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 2.5 + Math.random() * 20;
        offsets[i * 3 + 0] = Math.cos(angle) * radius;
        offsets[i * 3 + 1] = Math.random() * 3.2;
        offsets[i * 3 + 2] = Math.sin(angle) * radius;
        seeds[i] = Math.random();
        sizes[i] = 22 + Math.random() * 34;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(offsets, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        uniforms: {
            uTime: { value: 0 },
            uStrength: { value: 0 },
            uCenter: { value: new THREE.Vector3() },
            uSmokeTex: { value: createSmokeTexture() },
        },
        vertexShader: /* glsl */`
attribute float aSeed;
attribute float aSize;
uniform float uTime;
uniform float uStrength;
uniform vec3 uCenter;
varying float vAlpha;

void main() {
    vec3 local = position;
    float t = fract(uTime * (0.065 + aSeed * 0.16) + aSeed);
    float swirl = sin((uTime * 0.7 + aSeed * 16.0) + local.x * 0.1) * (0.6 + aSeed);
    local.x += swirl;
    local.z += cos(uTime * 0.43 + aSeed * 21.0) * (0.4 + aSeed * 0.9);
    local.y += t * (4.5 + aSeed * 10.0);

    vec4 worldPos = vec4(uCenter + local, 1.0);
    vec4 mvPosition = modelViewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = aSize * (0.75 + uStrength * 0.85) * (300.0 / max(1.0, -mvPosition.z));
    vAlpha = (1.0 - t) * (0.4 + aSeed * 0.6) * uStrength;
}
`,
        fragmentShader: /* glsl */`
uniform sampler2D uSmokeTex;
varying float vAlpha;

void main() {
    vec2 uv = gl_PointCoord;
    vec4 smoke = texture2D(uSmokeTex, uv);
    float radial = 1.0 - smoothstep(0.1, 0.95, length(uv - 0.5) * 1.35);
    vec3 color = mix(vec3(0.55, 0.03, 0.03), vec3(1.0, 0.26, 0.14), uv.y);
    float alpha = smoke.a * radial * vAlpha;
    gl_FragColor = vec4(color * smoke.rgb, alpha);
}
`,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 10;
    points.visible = false;
    scene.add(points);

    return {
        update(timeSeconds, cameraPosition, bloodMoonStrength) {
            const strength = THREE.MathUtils.clamp(bloodMoonStrength ?? 0, 0, 1);
            points.visible = strength > 0.01;
            if (!points.visible || !cameraPosition) return;
            material.uniforms.uTime.value = timeSeconds;
            material.uniforms.uStrength.value = strength;
            material.uniforms.uCenter.value.set(
                cameraPosition.x,
                Math.max(0, cameraPosition.y - 2.2),
                cameraPosition.z
            );
        },
    };
}
