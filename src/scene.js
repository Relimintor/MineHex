import { ENABLE_ANTIALIAS, ENABLE_SHADOW_MAP, MAX_DEVICE_PIXEL_RATIO, USE_STRICT_LOW_END_RENDERING } from './config.js';
import { applySceneAtmosphere, applySceneLighting } from './shaders/sceneLighting.js';
const THREE = window.THREE;

export const scene = new THREE.Scene();
applySceneAtmosphere(scene);

// Separate scene for occlusion proxy boxes so queries can run after the main depth pass.
export const occlusionScene = new THREE.Scene();

export const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

export const renderer = new THREE.WebGLRenderer({ antialias: ENABLE_ANTIALIAS, powerPreference: USE_STRICT_LOW_END_RENDERING ? 'low-power' : 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = ENABLE_SHADOW_MAP;
document.body.appendChild(renderer.domElement);

applySceneLighting(scene);
