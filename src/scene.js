import { CAMERA_FAR_PLANE, ENABLE_ANTIALIAS, ENABLE_SHADOW_MAP, FOG_FAR_DISTANCE, FOG_NEAR_DISTANCE } from './config.js';
const THREE = window.THREE;

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, FOG_NEAR_DISTANCE, FOG_FAR_DISTANCE);

// Separate scene for occlusion proxy boxes so queries can run after the main depth pass.
export const occlusionScene = new THREE.Scene();

export const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, CAMERA_FAR_PLANE);

export const renderer = new THREE.WebGLRenderer({ antialias: ENABLE_ANTIALIAS });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = ENABLE_SHADOW_MAP;
document.body.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 0.6);
sunLight.position.set(50, 100, 50);
scene.add(sunLight);
