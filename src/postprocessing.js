const THREE = window.THREE;

import {
    ENABLE_POST_BLOOM,
    ENABLE_POST_COLOR_GRADING,
    ENABLE_POST_DOF,
    ENABLE_POST_PROCESSING,
    ENABLE_POST_SSAO,
    ENABLE_POST_VIGNETTE_GRAIN
} from './config.js';

const BLOOM_STRENGTH = 0.22;
const BLOOM_RADIUS = 0.35;
const BLOOM_THRESHOLD = 0.88;

const LUT_LIFT = new THREE.Vector3(0.0, -0.004, -0.012);
const LUT_GAMMA = new THREE.Vector3(1.0, 1.02, 1.05);
const LUT_GAIN = new THREE.Vector3(1.02, 1.01, 0.98);
const LUT_TINT = new THREE.Vector3(1.02, 1.0, 0.97);

const COLOR_GRADING_SHADER = {
    uniforms: {
        tDiffuse: { value: null },
        lift: { value: LUT_LIFT.clone() },
        gamma: { value: LUT_GAMMA.clone() },
        gain: { value: LUT_GAIN.clone() },
        tint: { value: LUT_TINT.clone() }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec3 lift;
        uniform vec3 gamma;
        uniform vec3 gain;
        uniform vec3 tint;
        varying vec2 vUv;

        void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            vec3 graded = max((texel.rgb + lift) * gain, vec3(0.0));
            graded = pow(graded, 1.0 / max(gamma, vec3(0.001)));
            graded *= tint;
            gl_FragColor = vec4(graded, texel.a);
        }
    `
};

const VIGNETTE_GRAIN_SHADER = {
    uniforms: {
        tDiffuse: { value: null },
        time: { value: 0 },
        resolution: { value: new THREE.Vector2(1, 1) },
        vignetteStrength: { value: 0.12 },
        grainAmount: { value: 0.017 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float time;
        uniform vec2 resolution;
        uniform float vignetteStrength;
        uniform float grainAmount;
        varying vec2 vUv;

        float rand(vec2 co) {
            return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            vec2 centered = vUv - 0.5;
            float vignette = smoothstep(0.9, 0.2, length(centered));
            float grain = (rand(vUv * resolution.xy + time * 60.0) - 0.5) * grainAmount;
            color.rgb *= mix(1.0, vignette, vignetteStrength);
            color.rgb += grain;
            gl_FragColor = color;
        }
    `
};

function canUsePostStack() {
    if (!ENABLE_POST_PROCESSING) return false;
    return Boolean(
        THREE?.EffectComposer
        && THREE?.RenderPass
        && THREE?.ShaderPass
    );
}

export function createPostProcessor(renderer, scene, camera) {
    if (!canUsePostStack()) return null;

    const composer = new THREE.EffectComposer(renderer);
    const renderPass = new THREE.RenderPass(scene, camera);
    composer.addPass(renderPass);

    let ssaoPass = null;
    if (ENABLE_POST_SSAO && THREE.SSAOPass) {
        ssaoPass = new THREE.SSAOPass(scene, camera, window.innerWidth, window.innerHeight);
        ssaoPass.kernelRadius = 9;
        ssaoPass.minDistance = 0.003;
        ssaoPass.maxDistance = 0.08;
        composer.addPass(ssaoPass);
    }

    if (ENABLE_POST_BLOOM && THREE.UnrealBloomPass) {
        const bloomPass = new THREE.UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            BLOOM_STRENGTH,
            BLOOM_RADIUS,
            BLOOM_THRESHOLD
        );
        composer.addPass(bloomPass);
    }

    if (ENABLE_POST_COLOR_GRADING) {
        composer.addPass(new THREE.ShaderPass(COLOR_GRADING_SHADER));
    }

    let vignetteGrainPass = null;
    if (ENABLE_POST_VIGNETTE_GRAIN) {
        vignetteGrainPass = new THREE.ShaderPass(VIGNETTE_GRAIN_SHADER);
        vignetteGrainPass.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
        composer.addPass(vignetteGrainPass);
    }

    let dofPass = null;
    if (ENABLE_POST_DOF && THREE.BokehPass) {
        dofPass = new THREE.BokehPass(scene, camera, {
            focus: 12.0,
            aperture: 0.00004,
            maxblur: 0.0025,
            width: window.innerWidth,
            height: window.innerHeight
        });
        dofPass.enabled = false;
        composer.addPass(dofPass);
    }

    return {
        render(nowSeconds = 0) {
            if (vignetteGrainPass) {
                vignetteGrainPass.uniforms.time.value = nowSeconds;
            }
            composer.render();
        },
        resize(width, height) {
            composer.setSize(width, height);
            ssaoPass?.setSize(width, height);
            if (vignetteGrainPass) {
                vignetteGrainPass.uniforms.resolution.value.set(width, height);
            }
            if (dofPass?.materialBokeh?.uniforms?.aspect) {
                dofPass.materialBokeh.uniforms.aspect.value = width / Math.max(1, height);
            }
        },
        setPhotoMode(enabled) {
            if (dofPass) dofPass.enabled = Boolean(enabled);
        }
    };
}
