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
const BIOME_GRADES = {
    neutral: {
        lift: new THREE.Vector3(0.0, -0.004, -0.012),
        gamma: new THREE.Vector3(1.0, 1.02, 1.05),
        gain: new THREE.Vector3(1.02, 1.01, 0.98),
        tint: new THREE.Vector3(1.02, 1.0, 0.97),
    },
    forest: {
        // lush green mids + warm highlights
        lift: new THREE.Vector3(-0.008, -0.004, -0.014),
        gamma: new THREE.Vector3(1.02, 0.98, 1.05),
        gain: new THREE.Vector3(1.03, 1.08, 0.97),
        tint: new THREE.Vector3(1.03, 1.06, 0.95),
    },
    snow: {
        // cool shadows + sparkle pop
        lift: new THREE.Vector3(-0.006, -0.009, 0.005),
        gamma: new THREE.Vector3(1.06, 1.04, 0.95),
        gain: new THREE.Vector3(1.0, 1.02, 1.1),
        tint: new THREE.Vector3(0.95, 1.0, 1.09),
    },
    desert: {
        // warm haze + compressed highlights
        lift: new THREE.Vector3(0.012, -0.002, -0.018),
        gamma: new THREE.Vector3(0.95, 0.98, 1.1),
        gain: new THREE.Vector3(1.06, 1.01, 0.92),
        tint: new THREE.Vector3(1.08, 1.01, 0.9),
    },
};

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
        ssaoPass.enabled = true;
        composer.addPass(ssaoPass);
    }

    let bloomPass = null;
    if (ENABLE_POST_BLOOM && THREE.UnrealBloomPass) {
        bloomPass = new THREE.UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            BLOOM_STRENGTH,
            BLOOM_RADIUS,
            BLOOM_THRESHOLD
        );
        bloomPass.enabled = true;
        composer.addPass(bloomPass);
    }

    let colorGradingPass = null;
    if (ENABLE_POST_COLOR_GRADING) {
        colorGradingPass = new THREE.ShaderPass(COLOR_GRADING_SHADER);
        colorGradingPass.enabled = true;
        composer.addPass(colorGradingPass);
    }

    let vignetteGrainPass = null;
    if (ENABLE_POST_VIGNETTE_GRAIN) {
        vignetteGrainPass = new THREE.ShaderPass(VIGNETTE_GRAIN_SHADER);
        vignetteGrainPass.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
        vignetteGrainPass.enabled = true;
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

    const options = {
        enabled: true,
        bloom: Boolean(bloomPass),
        ssao: Boolean(ssaoPass),
        colorGrading: Boolean(colorGradingPass),
        vignetteGrain: Boolean(vignetteGrainPass),
        dof: false
    };

    function applyOptions() {
        if (bloomPass) bloomPass.enabled = options.enabled && options.bloom;
        if (ssaoPass) ssaoPass.enabled = options.enabled && options.ssao;
        if (colorGradingPass) colorGradingPass.enabled = options.enabled && options.colorGrading;
        if (vignetteGrainPass) vignetteGrainPass.enabled = options.enabled && options.vignetteGrain;
        if (dofPass) dofPass.enabled = options.enabled && options.dof;
    }

    applyOptions();

    const biomeGradeCurrent = {
        lift: LUT_LIFT.clone(),
        gamma: LUT_GAMMA.clone(),
        gain: LUT_GAIN.clone(),
        tint: LUT_TINT.clone(),
    };
    const biomeGradeTarget = {
        lift: LUT_LIFT.clone(),
        gamma: LUT_GAMMA.clone(),
        gain: LUT_GAIN.clone(),
        tint: LUT_TINT.clone(),
    };

    function blendBiomeGrade(target, from, to, weight) {
        const w = THREE.MathUtils.clamp(weight, 0, 1);
        target.copy(from).lerp(to, w);
    }

    return {
        render(nowSeconds = 0) {
            if (vignetteGrainPass) {
                vignetteGrainPass.uniforms.time.value = nowSeconds;
            }
            if (colorGradingPass) {
                const uniforms = colorGradingPass.uniforms;
                biomeGradeCurrent.lift.lerp(biomeGradeTarget.lift, 0.065);
                biomeGradeCurrent.gamma.lerp(biomeGradeTarget.gamma, 0.065);
                biomeGradeCurrent.gain.lerp(biomeGradeTarget.gain, 0.065);
                biomeGradeCurrent.tint.lerp(biomeGradeTarget.tint, 0.065);
                uniforms.lift.value.copy(biomeGradeCurrent.lift);
                uniforms.gamma.value.copy(biomeGradeCurrent.gamma);
                uniforms.gain.value.copy(biomeGradeCurrent.gain);
                uniforms.tint.value.copy(biomeGradeCurrent.tint);
            }
            if (options.enabled) {
                composer.render();
                return;
            }
            renderer.render(scene, camera);
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
            options.dof = Boolean(enabled);
            applyOptions();
        },
        getOptions() {
            return { ...options };
        },
        setOptions(nextOptions = {}) {
            if (typeof nextOptions.enabled === 'boolean') options.enabled = nextOptions.enabled;
            if (typeof nextOptions.bloom === 'boolean') options.bloom = nextOptions.bloom;
            if (typeof nextOptions.ssao === 'boolean') options.ssao = nextOptions.ssao;
            if (typeof nextOptions.colorGrading === 'boolean') options.colorGrading = nextOptions.colorGrading;
            if (typeof nextOptions.vignetteGrain === 'boolean') options.vignetteGrain = nextOptions.vignetteGrain;
            if (typeof nextOptions.dof === 'boolean') options.dof = nextOptions.dof;
            applyOptions();
        },
        setBiomeGrade(gradeName = 'neutral', weight = 1) {
            const key = BIOME_GRADES[gradeName] ? gradeName : 'neutral';
            const grade = BIOME_GRADES[key];
            const base = BIOME_GRADES.neutral;
            blendBiomeGrade(biomeGradeTarget.lift, base.lift, grade.lift, weight);
            blendBiomeGrade(biomeGradeTarget.gamma, base.gamma, grade.gamma, weight);
            blendBiomeGrade(biomeGradeTarget.gain, base.gain, grade.gain, weight);
            blendBiomeGrade(biomeGradeTarget.tint, base.tint, grade.tint, weight);
        }
    };
}
