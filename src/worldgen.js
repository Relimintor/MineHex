const THREE = window.THREE;

import { CHUNK_APPLY_BUDGET, CHUNK_CREATION_BUDGET, CHUNK_SIZE, ENABLE_COMPLEX_LOD, ENABLE_OCCLUSION_CULLING, ENABLE_WORLDGEN_WORKER, FORCE_BATCHED_CHUNK_RENDERING, HEX_HEIGHT, HEX_RADIUS, MAX_WORLDGEN_IN_FLIGHT, RENDER_DIST, NETHROCK_LEVEL_HEX } from './config.js';
import { AXIAL_NEIGHBOR_OFFSETS, axialDistance, axialToWorld, worldToAxial } from './coords.js';
import { camera, occlusionScene, renderer, scene } from './scene.js';
import { worldState } from './state.js';
import { addBlock, getBlockMaterial, recomputeChunkGreedyFaceQuads, refreshBlockVisibilityForKeys, removeBlock } from './blocks.js';
import { hexGeometry } from './geometry.js';

const SEA_LEVEL = 0;
const CONTINENT_AMPLITUDE = 50;
const CONTINENT_FREQUENCY = 0.001;
const CONTINENT_OFFSET = 20;
const TERRAIN_MID_AMPLITUDE = 20;
const TERRAIN_MID_FREQUENCY = 0.01;
const TERRAIN_DETAIL_AMPLITUDE = 5;
const TERRAIN_DETAIL_FREQUENCY = 0.05;
const TEMPERATURE_FREQUENCY = 0.0005;
const MOISTURE_FREQUENCY = 0.0005;
const MOISTURE_OFFSET = 100;

const BLOCK_INDEX = {
    grass: 0,
    dirt: 1,
    stone: 2,
    water: 4,
    nethrock: 5,
    oakWood: 6,
    oakLeaves: 7,
    snow: 8,
    ice: 9
};

const CHUNK_NEIGHBOR_OFFSETS = AXIAL_NEIGHBOR_OFFSETS.map(({ q, r }) => [q, r]);

const CHUNK_AABB_MARGIN = 0.08;

const occlusionProxyMaterial = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false
});

const OCCLUSION_QUERY_TARGET = 'ANY_SAMPLES_PASSED_CONSERVATIVE';

const frustumViewProjection = new THREE.Matrix4();
const frustumPlanes = Array.from({ length: 6 }, () => ({ nx: 0, ny: 0, nz: 0, d: 0 }));
const tmpBoundsSize = new THREE.Vector3();
const tmpBoundsCenter = new THREE.Vector3();
const occlusionProxiesToTest = [];

const FLAT_HEX_LOD_DISTANCE = Math.max(1, RENDER_DIST - 1);
const MEGA_HEX_LOD_DISTANCE = RENDER_DIST;
const megaHexMaterial = new THREE.MeshLambertMaterial({ color: 0x6d8f5f });

const pendingChunkGenerationQueue = [];
const pendingChunkGenerationSet = new Set();
const pendingChunkGenerationInFlight = new Set();
let lastStreamChunkKey = null;
const CHUNK_UNLOAD_BUDGET = 1;
const DIRTY_CHUNK_APPLY_BUDGET = 1;

const reusableOcclusionQueries = [];
const gpuVisibilityMask = new Map();
const chunkInstanceDummy = new THREE.Object3D();
const projectedChunkCenter = new THREE.Vector3();
const hizCenter = new THREE.Vector3();
const cameraForwardXZ = new THREE.Vector3();
const chunkPriorityVector = new THREE.Vector3();
const HIZ_SECTORS_X = 32;
const HIZ_SECTORS_Y = 18;
const hiZDepthSectors = new Float32Array(HIZ_SECTORS_X * HIZ_SECTORS_Y);
const pendingChunkUnloadQueue = [];
const pendingChunkUnloadSet = new Set();
const pendingChunkApplyQueue = [];
const pendingChunkApplySet = new Set();
const recycledChunkBlockSets = [];
let chunkGenerationWorker = null;

const FRAME_TIME_TARGET_MS = 16.7;
const FRAME_TIME_SPIKE_MS = 24;
const FRAME_TIME_STABLE_MS = 18;
const FRAME_TIME_EMA_ALPHA = 0.14;
const FRAME_TIME_RECOVERY_FRAMES = 18;
const adaptiveChunkBudget = {
    emaFrameTimeMs: FRAME_TIME_TARGET_MS,
    stableFrames: 0,
    createBudget: CHUNK_CREATION_BUDGET,
    applyBudget: CHUNK_APPLY_BUDGET,
    maxInFlight: MAX_WORLDGEN_IN_FLIGHT
};


const CHUNK_LOCAL_AXIALS = [];
for (let q = -CHUNK_SIZE; q <= CHUNK_SIZE; q++) {
    for (let r = -CHUNK_SIZE; r <= CHUNK_SIZE; r++) {
        if (Math.abs(q + r) > CHUNK_SIZE) continue;
        CHUNK_LOCAL_AXIALS.push([q, r]);
    }
}

const HEX_CORNER_OFFSETS_XZ = Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i + (Math.PI / 6);
    return {
        x: Math.cos(angle) * HEX_RADIUS,
        z: Math.sin(angle) * HEX_RADIUS
    };
});

function ensureChunkMeta(cq, cr) {
    const chunkKey = `${cq},${cr}`;
    if (worldState.chunkMeta.has(chunkKey)) return;

    const neighbors = CHUNK_NEIGHBOR_OFFSETS.map(([dq, dr]) => `${cq + dq},${cr + dr}`);
    worldState.chunkMeta.set(chunkKey, {
        cq,
        cr,
        dirty: false,
        neighbors,
        frustumVisible: true,
        occlusionVisible: true,
        occlusionQuery: null,
        occlusionProxy: null,
        lodLevel: 0,
        megaHexMesh: null,
        detailedChunkGroup: null,
        detailedChunkMeshes: [],
        instancedLodGroup: null,
        instancedLodMeshes: [],
        bounds: null
    });
}

function recomputeChunkBounds(chunkKey) {
    const chunkBlockKeys = worldState.chunkBlocks.get(chunkKey);
    if (!chunkBlockKeys || chunkBlockKeys.size === 0) return null;

    const chunkMeta = worldState.chunkMeta.get(chunkKey);
    const cq = chunkMeta?.cq ?? Number(chunkKey.split(',')[0]);
    const cr = chunkMeta?.cr ?? Number(chunkKey.split(',')[1]);
    const centerQ = cq * CHUNK_SIZE;
    const centerR = cr * CHUNK_SIZE;

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (const [q, r] of CHUNK_LOCAL_AXIALS) {
            const worldPos = axialToWorld(centerQ + q, centerR + r, 0);
            for (const offset of HEX_CORNER_OFFSETS_XZ) {
                const cornerX = worldPos.x + offset.x;
                const cornerZ = worldPos.z + offset.z;
                minX = Math.min(minX, cornerX);
                maxX = Math.max(maxX, cornerX);
                minZ = Math.min(minZ, cornerZ);
                maxZ = Math.max(maxZ, cornerZ);
            }
    }

    let minH = Infinity;
    let maxH = -Infinity;
    for (const blockKey of chunkBlockKeys) {
        const mesh = worldState.worldBlocks.get(blockKey);
        if (!mesh) continue;
        minH = Math.min(minH, mesh.userData.h);
        maxH = Math.max(maxH, mesh.userData.h);
    }

    if (!Number.isFinite(minH) || !Number.isFinite(maxH)) return null;

    return new THREE.Box3(
        new THREE.Vector3(minX - CHUNK_AABB_MARGIN, 0, minZ - CHUNK_AABB_MARGIN),
        new THREE.Vector3(maxX + CHUNK_AABB_MARGIN, ((maxH + 1) * HEX_HEIGHT) + CHUNK_AABB_MARGIN, maxZ + CHUNK_AABB_MARGIN)
    );
}

function getChunkLodLevel(cameraChunkQ, cameraChunkR, chunkQ, chunkR) {
    const dq = chunkQ - cameraChunkQ;
    const dr = chunkR - cameraChunkR;
    const ds = -dq - dr;
    const hexDistance = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));

    if (hexDistance >= MEGA_HEX_LOD_DISTANCE) return 2;
    if (hexDistance >= FLAT_HEX_LOD_DISTANCE) return 1;
    return 0;
}

function hasTopFace(mesh) {
    const faces = mesh.userData.visibleFaces;
    if (!Array.isArray(faces)) return false;
    return faces.some((face) => face.direction?.[0] === 0 && face.direction?.[1] === 0 && face.direction?.[2] === 1);
}

function ensureMegaHexMesh(chunkKey) {
    const chunkMeta = worldState.chunkMeta.get(chunkKey);
    if (!chunkMeta?.bounds) return null;
    if (chunkMeta.megaHexMesh) return chunkMeta.megaHexMesh;

    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.06, 6), megaHexMaterial);
    mesh.rotation.y = Math.PI / 6;
    mesh.visible = false;
    scene.add(mesh);
    chunkMeta.megaHexMesh = mesh;
    return mesh;
}

function disposeDetailedChunkMeshes(chunkMeta) {
    if (!chunkMeta?.detailedChunkGroup) return;
    scene.remove(chunkMeta.detailedChunkGroup);
    chunkMeta.detailedChunkMeshes = [];
    chunkMeta.detailedChunkGroup = null;
}

function rebuildChunkDetailedMeshes(chunkKey) {
    const chunkMeta = worldState.chunkMeta.get(chunkKey);
    if (!chunkMeta) return;

    disposeDetailedChunkMeshes(chunkMeta);

    const chunkBlockKeys = worldState.chunkBlocks.get(chunkKey);
    if (!chunkBlockKeys || chunkBlockKeys.size === 0) {
        chunkMeta.dirty = false;
        return;
    }

    const perTypeInstances = new Map();
    for (const blockKey of chunkBlockKeys) {
        const mesh = worldState.worldBlocks.get(blockKey);
        if (!mesh) continue;
        const visibleFaces = mesh.userData.visibleFaces;
        const hasVisibleFaces = !Array.isArray(visibleFaces) || visibleFaces.length > 0;
        if (!hasVisibleFaces) continue;

        const typeIndex = mesh.userData.typeIndex ?? 0;
        if (!perTypeInstances.has(typeIndex)) perTypeInstances.set(typeIndex, []);
        perTypeInstances.get(typeIndex).push(mesh);
    }

    if (perTypeInstances.size === 0) {
        chunkMeta.dirty = false;
        return;
    }

    const group = new THREE.Group();
    group.visible = false;
    const createdMeshes = [];

    for (const [typeIndex, sourceMeshes] of perTypeInstances) {
        const instanced = new THREE.InstancedMesh(hexGeometry, getBlockMaterial(typeIndex), sourceMeshes.length);

        for (let i = 0; i < sourceMeshes.length; i++) {
            const sourceMesh = sourceMeshes[i];
            chunkInstanceDummy.position.copy(sourceMesh.position);
            chunkInstanceDummy.rotation.set(0, 0, 0);
            chunkInstanceDummy.scale.set(1, 1, 1);
            chunkInstanceDummy.updateMatrix();
            instanced.setMatrixAt(i, chunkInstanceDummy.matrix);
        }

        instanced.instanceMatrix.needsUpdate = true;
        instanced.userData.typeIndex = typeIndex;
        instanced.userData.instanceKeys = sourceMeshes.map((mesh) => mesh.userData.key);
        group.add(instanced);
        createdMeshes.push(instanced);
    }

    scene.add(group);
    chunkMeta.detailedChunkGroup = group;
    chunkMeta.detailedChunkMeshes = createdMeshes;
    chunkMeta.dirty = false;
}

function disposeInstancedLodMeshes(chunkMeta) {
    if (!chunkMeta?.instancedLodGroup) return;
    scene.remove(chunkMeta.instancedLodGroup);
    chunkMeta.instancedLodMeshes = [];
    chunkMeta.instancedLodGroup = null;
}

function rebuildChunkInstancedLodMeshes(chunkKey) {
    const chunkMeta = worldState.chunkMeta.get(chunkKey);
    if (!chunkMeta) return;

    disposeInstancedLodMeshes(chunkMeta);

    const chunkBlockKeys = worldState.chunkBlocks.get(chunkKey);
    if (!chunkBlockKeys || chunkBlockKeys.size === 0) {
        chunkMeta.dirty = false;
        return;
    }

    const perTypeInstances = new Map();
    for (const blockKey of chunkBlockKeys) {
        const mesh = worldState.worldBlocks.get(blockKey);
        if (!mesh) continue;
        const visibleFaces = mesh.userData.visibleFaces;
        const hasVisibleFaces = !Array.isArray(visibleFaces) || visibleFaces.length > 0;
        if (!hasVisibleFaces || !hasTopFace(mesh)) continue;

        const typeIndex = mesh.userData.typeIndex ?? 0;
        if (!perTypeInstances.has(typeIndex)) perTypeInstances.set(typeIndex, []);
        perTypeInstances.get(typeIndex).push(mesh);
    }

    if (perTypeInstances.size === 0) {
        chunkMeta.dirty = false;
        return;
    }

    const group = new THREE.Group();
    group.visible = false;
    const createdMeshes = [];

    for (const [typeIndex, sourceMeshes] of perTypeInstances) {
        const instanced = new THREE.InstancedMesh(hexGeometry, getBlockMaterial(typeIndex), sourceMeshes.length);

        for (let i = 0; i < sourceMeshes.length; i++) {
            const sourceMesh = sourceMeshes[i];
            chunkInstanceDummy.position.copy(sourceMesh.position);
            chunkInstanceDummy.rotation.set(0, 0, 0);
            chunkInstanceDummy.scale.set(1, 1, 1);
            chunkInstanceDummy.updateMatrix();
            instanced.setMatrixAt(i, chunkInstanceDummy.matrix);
        }

        instanced.instanceMatrix.needsUpdate = true;
        instanced.userData.typeIndex = typeIndex;
        instanced.userData.instanceKeys = sourceMeshes.map((mesh) => mesh.userData.key);
        group.add(instanced);
        createdMeshes.push(instanced);
    }

    scene.add(group);
    chunkMeta.instancedLodGroup = group;
    chunkMeta.instancedLodMeshes = createdMeshes;
    chunkMeta.dirty = false;
}

function syncMegaHexTransform(chunkKey) {
    const chunkMeta = worldState.chunkMeta.get(chunkKey);
    if (!chunkMeta?.bounds) return;

    const mesh = ensureMegaHexMesh(chunkKey);
    if (!mesh) return;

    const size = chunkMeta.bounds.getSize(tmpBoundsSize);
    const center = chunkMeta.bounds.getCenter(tmpBoundsCenter);
    const radius = Math.max(size.x, size.z) / 2;
    mesh.position.set(center.x, chunkMeta.bounds.max.y + 0.02, center.z);
    mesh.scale.set(radius, 1, radius);
}

function updateChunkLodLevels(cameraChunkQ, cameraChunkR) {
    const changedChunkKeys = [];

    for (const chunkKey of worldState.loadedChunks) {
        const chunkMeta = worldState.chunkMeta.get(chunkKey);
        if (!chunkMeta) continue;

        const [chunkQ, chunkR] = chunkKey.split(',').map(Number);
        let nextLodLevel = ENABLE_COMPLEX_LOD
            ? getChunkLodLevel(cameraChunkQ, cameraChunkR, chunkQ, chunkR)
            : 0;

        if (FORCE_BATCHED_CHUNK_RENDERING) {
            // Celeron mode stays on chunk-batched instanced meshes only.
            // We avoid mega-hex proxy rendering here because it can produce large
            // flat green surfaces that look like broken terrain at close/mid range.
            nextLodLevel = 1;
        }

        if (nextLodLevel === chunkMeta.lodLevel) continue;
        chunkMeta.lodLevel = nextLodLevel;
        changedChunkKeys.push(chunkKey);
    }

    return changedChunkKeys;
}

function updateChunkMeshVisibility(chunkKey) {
    const chunkMeta = worldState.chunkMeta.get(chunkKey);
    if (!chunkMeta) return;

    const gpuVisible = gpuVisibilityMask.get(chunkKey);
    const chunkVisible = (gpuVisible ?? chunkMeta.frustumVisible) && chunkMeta.occlusionVisible;

    if (chunkMeta.instancedLodGroup) chunkMeta.instancedLodGroup.visible = false;
    if (chunkMeta.detailedChunkGroup) chunkMeta.detailedChunkGroup.visible = false;

    if (chunkMeta.lodLevel === 2 && chunkVisible) {
        syncMegaHexTransform(chunkKey);
        if (chunkMeta.megaHexMesh) chunkMeta.megaHexMesh.visible = true;
        return;
    }

    if (chunkMeta.megaHexMesh) chunkMeta.megaHexMesh.visible = false;

    if (chunkMeta.lodLevel === 1) {
        if (!chunkMeta.instancedLodGroup || chunkMeta.dirty) rebuildChunkInstancedLodMeshes(chunkKey);
        if (chunkMeta.instancedLodGroup) chunkMeta.instancedLodGroup.visible = chunkVisible;
        return;
    }

    if (!chunkMeta.detailedChunkGroup || chunkMeta.dirty) rebuildChunkDetailedMeshes(chunkKey);
    if (chunkMeta.detailedChunkGroup) chunkMeta.detailedChunkGroup.visible = chunkVisible;
}

function ensureOcclusionProxy(chunkKey) {
    if (!ENABLE_OCCLUSION_CULLING) return null;

    const chunkMeta = worldState.chunkMeta.get(chunkKey);
    if (!chunkMeta?.bounds) return null;
    if (chunkMeta.occlusionProxy) return chunkMeta.occlusionProxy;

    const proxy = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), occlusionProxyMaterial);
    proxy.matrixAutoUpdate = true;
    proxy.frustumCulled = false;
    proxy.visible = false;
    proxy.userData.chunkKey = chunkKey;
    proxy.onBeforeRender = () => {
        const query = proxy.userData.activeQuery;
        const target = proxy.userData.queryTarget;
        if (!query || !target) return;
        const gl = renderer.getContext();
        gl.beginQuery(target, query);
    };
    proxy.onAfterRender = () => {
        const target = proxy.userData.queryTarget;
        if (!target) return;
        const gl = renderer.getContext();
        gl.endQuery(target);
        proxy.userData.activeQuery = null;
    };
    occlusionScene.add(proxy);
    chunkMeta.occlusionProxy = proxy;
    return proxy;
}

function syncOcclusionProxyTransform(chunkKey) {
    if (!ENABLE_OCCLUSION_CULLING) return;

    const chunkMeta = worldState.chunkMeta.get(chunkKey);
    if (!chunkMeta?.bounds) return;

    const proxy = ensureOcclusionProxy(chunkKey);
    if (!proxy) return;

    const size = chunkMeta.bounds.getSize(tmpBoundsSize);
    const center = chunkMeta.bounds.getCenter(tmpBoundsCenter);
    proxy.position.copy(center);
    proxy.scale.set(size.x, size.y, size.z);
}

function disposeChunkOcclusionState(chunkMeta) {
    if (!chunkMeta) return;

    if (!ENABLE_OCCLUSION_CULLING) {
        disposeDetailedChunkMeshes(chunkMeta);
        disposeInstancedLodMeshes(chunkMeta);
        if (chunkMeta.megaHexMesh) {
            scene.remove(chunkMeta.megaHexMesh);
            chunkMeta.megaHexMesh.geometry.dispose();
            chunkMeta.megaHexMesh = null;
        }
        return;
    }

    if (chunkMeta.occlusionQuery) {
        reusableOcclusionQueries.push(chunkMeta.occlusionQuery);
        chunkMeta.occlusionQuery = null;
    }

    if (chunkMeta.occlusionProxy) {
        occlusionScene.remove(chunkMeta.occlusionProxy);
        chunkMeta.occlusionProxy.geometry.dispose();
        chunkMeta.occlusionProxy = null;
    }

    disposeInstancedLodMeshes(chunkMeta);
    disposeDetailedChunkMeshes(chunkMeta);

    if (chunkMeta.megaHexMesh) {
        scene.remove(chunkMeta.megaHexMesh);
        chunkMeta.megaHexMesh.geometry.dispose();
        chunkMeta.megaHexMesh = null;
    }
}

// For each frustum plane we evaluate max_{x in B}(n·x + d) using the positive vertex vp.
// If this maximum is still negative, the whole AABB is outside that plane.
function isChunkVisible(aabb, frustumPlanes) {
    for (const plane of frustumPlanes) {
        const vx = plane.nx > 0 ? aabb.max.x : aabb.min.x;
        const vy = plane.ny > 0 ? aabb.max.y : aabb.min.y;
        const vz = plane.nz > 0 ? aabb.max.z : aabb.min.z;

        const dist = (plane.nx * vx) + (plane.ny * vy) + (plane.nz * vz) + plane.d;
        if (dist < 0) return false;
    }

    return true;
}

// Runtime cost remains linear in loaded chunks for the culling pass,
// but only chunks passing visibility keep their meshes renderable.
function applyChunkFrustumCulling() {
    frustumViewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const elements = frustumViewProjection.elements;

    const setPlane = (index, nx, ny, nz, d) => {
        const invLength = 1 / Math.hypot(nx, ny, nz);
        const plane = frustumPlanes[index];
        plane.nx = nx * invLength;
        plane.ny = ny * invLength;
        plane.nz = nz * invLength;
        plane.d = d * invLength;
    };

    setPlane(0, elements[3] + elements[0], elements[7] + elements[4], elements[11] + elements[8], elements[15] + elements[12]);
    setPlane(1, elements[3] - elements[0], elements[7] - elements[4], elements[11] - elements[8], elements[15] - elements[12]);
    setPlane(2, elements[3] + elements[1], elements[7] + elements[5], elements[11] + elements[9], elements[15] + elements[13]);
    setPlane(3, elements[3] - elements[1], elements[7] - elements[5], elements[11] - elements[9], elements[15] - elements[13]);
    setPlane(4, elements[3] + elements[2], elements[7] + elements[6], elements[11] + elements[10], elements[15] + elements[14]);
    setPlane(5, elements[3] - elements[2], elements[7] - elements[6], elements[11] - elements[10], elements[15] - elements[14]);

    for (const chunkKey of worldState.loadedChunks) {
        const chunkMeta = worldState.chunkMeta.get(chunkKey);
        if (!chunkMeta) continue;

        if (!chunkMeta.bounds) chunkMeta.bounds = recomputeChunkBounds(chunkKey);
        const bounds = chunkMeta.bounds;

        const isVisible = bounds ? isChunkVisible(bounds, frustumPlanes) : true;
        gpuVisibilityMask.set(chunkKey, isVisible);

        if (chunkMeta.frustumVisible === isVisible) continue;
        chunkMeta.frustumVisible = isVisible;
        updateChunkMeshVisibility(chunkKey);
    }
}

function projectChunkToHiZSector(bounds) {
    bounds.getCenter(projectedChunkCenter);
    hizCenter.copy(projectedChunkCenter).project(camera);
    if (hizCenter.z < -1 || hizCenter.z > 1) return null;

    const sx = Math.max(0, Math.min(HIZ_SECTORS_X - 1, Math.floor(((hizCenter.x + 1) * 0.5) * HIZ_SECTORS_X)));
    const sy = Math.max(0, Math.min(HIZ_SECTORS_Y - 1, Math.floor((1 - ((hizCenter.y + 1) * 0.5)) * HIZ_SECTORS_Y)));
    const depth = (hizCenter.z + 1) * 0.5;
    return { sector: (sy * HIZ_SECTORS_X) + sx, depth };
}

function passHierarchicalZOcclusion(chunkMeta) {
    if (!chunkMeta?.bounds) return true;
    const projected = projectChunkToHiZSector(chunkMeta.bounds);
    if (!projected) return true;

    const nearestDepth = hiZDepthSectors[projected.sector];
    if (projected.depth > nearestDepth + 0.02) return false;

    hiZDepthSectors[projected.sector] = Math.min(nearestDepth, projected.depth);
    return true;
}

export function runChunkOcclusionCulling() {
    if (!ENABLE_OCCLUSION_CULLING) return;

    const gl = renderer.getContext();
    if (!(gl instanceof WebGL2RenderingContext)) return;

    const queryTarget = gl[OCCLUSION_QUERY_TARGET] ?? gl.ANY_SAMPLES_PASSED;
    if (!queryTarget) return;
    hiZDepthSectors.fill(1);

    for (const chunkKey of worldState.loadedChunks) {
        const chunkMeta = worldState.chunkMeta.get(chunkKey);
        if (!chunkMeta?.occlusionQuery) continue;

        const available = gl.getQueryParameter(chunkMeta.occlusionQuery, gl.QUERY_RESULT_AVAILABLE);
        if (!available) continue;

        const isVisible = !!gl.getQueryParameter(chunkMeta.occlusionQuery, gl.QUERY_RESULT);
        reusableOcclusionQueries.push(chunkMeta.occlusionQuery);
        chunkMeta.occlusionQuery = null;

        chunkMeta.lastOcclusionResult = isVisible;
        if (chunkMeta.occlusionVisible !== isVisible) {
            chunkMeta.occlusionVisible = isVisible;
            updateChunkMeshVisibility(chunkKey);
        }

        if (!passHierarchicalZOcclusion(chunkMeta)) {
            chunkMeta.occlusionVisible = false;
            updateChunkMeshVisibility(chunkKey);
            continue;
        }

        syncOcclusionProxyTransform(chunkKey);
        const proxy = chunkMeta.occlusionProxy;
        if (!proxy || chunkMeta.occlusionQuery) continue;

        chunkMeta.occlusionQuery = reusableOcclusionQueries.pop() ?? gl.createQuery();
        if (!chunkMeta.occlusionQuery) continue;

        proxy.userData.activeQuery = chunkMeta.occlusionQuery;
        proxy.userData.queryTarget = queryTarget;
        proxy.visible = true;
        occlusionProxiesToTest.push(proxy);
    }

    occlusionProxiesToTest.length = 0;
    for (const chunkKey of worldState.loadedChunks) {
        const chunkMeta = worldState.chunkMeta.get(chunkKey);
        if (!chunkMeta?.frustumVisible || !chunkMeta.bounds) continue;

        if (chunkMeta.bounds.containsPoint(camera.position)) {
            if (!chunkMeta.occlusionVisible) {
                chunkMeta.occlusionVisible = true;
                updateChunkMeshVisibility(chunkKey);
            }
            continue;
        }

        if (!passHierarchicalZOcclusion(chunkMeta)) {
            if (chunkMeta.occlusionVisible) {
                chunkMeta.occlusionVisible = false;
                updateChunkMeshVisibility(chunkKey);
            }
            continue;
        }

        syncOcclusionProxyTransform(chunkKey);
        const proxy = chunkMeta.occlusionProxy;
        if (!proxy || chunkMeta.occlusionQuery) continue;

        chunkMeta.occlusionQuery = reusableOcclusionQueries.pop() ?? gl.createQuery();
        if (!chunkMeta.occlusionQuery) continue;

        proxy.userData.activeQuery = chunkMeta.occlusionQuery;
        proxy.userData.queryTarget = queryTarget;
        proxy.visible = true;
        occlusionProxiesToTest.push(proxy);
    }

    if (occlusionProxiesToTest.length === 0) return;

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(occlusionScene, camera);
    renderer.autoClear = prevAutoClear;

    for (const proxy of occlusionProxiesToTest) proxy.visible = false;
}

function getHeight(q, r) {
    const continent = CONTINENT_AMPLITUDE * worldState.simplex.noise2D(q * CONTINENT_FREQUENCY, r * CONTINENT_FREQUENCY) - CONTINENT_OFFSET;
    const terrain = (TERRAIN_MID_AMPLITUDE * worldState.simplex.noise2D(q * TERRAIN_MID_FREQUENCY, r * TERRAIN_MID_FREQUENCY))
        + (TERRAIN_DETAIL_AMPLITUDE * worldState.simplex.noise2D(q * TERRAIN_DETAIL_FREQUENCY, r * TERRAIN_DETAIL_FREQUENCY));
    return Math.floor(continent + terrain);
}

function smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - (2 * t));
}

function getSmoothedHeight(rawHeight) {
    const coastBlend = smoothstep(SEA_LEVEL - 3, SEA_LEVEL + 3, rawHeight);
    return Math.round((rawHeight * coastBlend) + (SEA_LEVEL * (1 - coastBlend)));
}

function getClimate(q, r) {
    return {
        temp: worldState.simplex.noise2D(q * TEMPERATURE_FREQUENCY, r * TEMPERATURE_FREQUENCY),
        moist: worldState.simplex.noise2D((q * MOISTURE_FREQUENCY) + MOISTURE_OFFSET, (r * MOISTURE_FREQUENCY) + MOISTURE_OFFSET)
    };
}

function normalizeWeights(weights) {
    const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
    if (total <= 0) return weights;

    const normalized = {};
    Object.entries(weights).forEach(([biome, value]) => {
        normalized[biome] = value / total;
    });
    return normalized;
}

function getBiomeWeights(temp, moist) {
    const cold = 1 - smoothstep(-0.3, 0.2, temp);
    const freezing = 1 - smoothstep(-0.75, -0.45, temp);
    const wet = smoothstep(-0.1, 0.15, moist);
    const dry = 1 - wet;
    const mountainness = smoothstep(-0.65, -0.45, -moist) * smoothstep(0.05, 0.3, temp);

    return normalizeWeights({
        plains: dry * (1 - cold) * (1 - mountainness),
        forest: wet * (1 - cold),
        snowy_plains: dry * cold * (1 - freezing),
        snowy_forest: wet * cold * (1 - freezing),
        arctic: freezing,
        mountains: mountainness * (1 - freezing)
    });
}

function getDominantBiome(biomeWeights) {
    let selected = 'plains';
    let bestWeight = -1;
    Object.entries(biomeWeights).forEach(([biome, weight]) => {
        if (weight > bestWeight) {
            selected = biome;
            bestWeight = weight;
        }
    });
    return selected;
}

function biomeHeightModifier(biomeWeights, q, r, baseHeight) {
    const mountainModifier = 30 * worldState.simplex.noise2D(q * 0.02, r * 0.02) * (biomeWeights.mountains ?? 0);
    const plainsModifier = -0.5 * baseHeight * (biomeWeights.plains ?? 0);
    return mountainModifier + plainsModifier;
}

function getBiomeAt(climateBiome, height) {
    if (height < SEA_LEVEL) return 'ocean';
    if (height < SEA_LEVEL + 2) return 'beach';
    return climateBiome;
}

function addGeneratedBlock(chunkBlockKeys, q, r, h, typeIndex) {
    const key = `${q},${r},${h}`;
    if (!worldState.permanentBlocks.has(key) && !worldState.removedBlocks.has(key)) addBlock(q, r, h, typeIndex, false, false, false);
    if (worldState.worldBlocks.has(key)) chunkBlockKeys.add(key);
}

function addGeneratedFluidColumn(chunkBlockKeys, q, r, fromHeight, downToExclusive, fluidTypeIndex) {
    for (let fluidH = fromHeight; fluidH > downToExclusive; fluidH--) {
        addGeneratedBlock(chunkBlockKeys, q, r, fluidH, fluidTypeIndex);
    }
}

function applyDirtyChunks(budget = Number.POSITIVE_INFINITY) {
    if (worldState.dirtyChunks.size === 0) return;
    if (budget <= 0) return;

    let processed = 0;
    const processedChunkKeys = [];
    for (const chunkKey of worldState.dirtyChunks) {
        if (processed >= budget) break;
        if (!worldState.loadedChunks.has(chunkKey)) {
            worldState.chunkBlocks.delete(chunkKey);
            processedChunkKeys.push(chunkKey);
            processed++;
            continue;
        }

        const chunkBlockKeys = worldState.chunkBlocks.get(chunkKey) ?? new Set();
        worldState.chunkBlocks.set(chunkKey, chunkBlockKeys);
        recomputeChunkGreedyFaceQuads(chunkKey);

        const chunk = worldState.chunkMeta.get(chunkKey);
        if (chunk) {
            chunk.dirty = true;
            chunk.bounds = recomputeChunkBounds(chunkKey);
            if (chunk.bounds) syncOcclusionProxyTransform(chunkKey);
        }

        updateChunkMeshVisibility(chunkKey);
        processedChunkKeys.push(chunkKey);
        processed++;
    }

    for (const chunkKey of processedChunkKeys) {
        const chunk = worldState.chunkMeta.get(chunkKey);
        if (chunk && chunk.lodLevel === 2) chunk.dirty = false;
        worldState.dirtyChunks.delete(chunkKey);
    }
}

function maybeAddTree(chunkBlockKeys, q, r, groundHeight, biome) {
    if (!(biome === 'forest' || biome === 'snowy_forest')) return;
    if (groundHeight <= SEA_LEVEL) return;

    const treeNoise = worldState.simplex.noise2D((q * 0.13) + 200, (r * 0.13) + 200);
    if (treeNoise < 0.72) return;

    addGeneratedBlock(chunkBlockKeys, q, r, groundHeight + 1, BLOCK_INDEX.oakWood);
    addGeneratedBlock(chunkBlockKeys, q, r, groundHeight + 2, BLOCK_INDEX.oakWood);
    addGeneratedBlock(chunkBlockKeys, q, r, groundHeight + 3, BLOCK_INDEX.oakLeaves);
    addGeneratedBlock(chunkBlockKeys, q + 1, r, groundHeight + 2, BLOCK_INDEX.oakLeaves);
    addGeneratedBlock(chunkBlockKeys, q - 1, r, groundHeight + 2, BLOCK_INDEX.oakLeaves);
    addGeneratedBlock(chunkBlockKeys, q, r + 1, groundHeight + 2, BLOCK_INDEX.oakLeaves);
    addGeneratedBlock(chunkBlockKeys, q, r - 1, groundHeight + 2, BLOCK_INDEX.oakLeaves);
}

function isChunkWithinRenderDistance(cq, cr) {
    const current = worldState.frameCameraAxial ?? worldToAxial(camera.position);
    const currentCq = Math.round(current.q / CHUNK_SIZE);
    const currentCr = Math.round(current.r / CHUNK_SIZE);
    return axialChunkDistance(cq, cr, currentCq, currentCr) <= RENDER_DIST;
}

function initChunkGenerationWorker() {
    if (!ENABLE_WORLDGEN_WORKER || chunkGenerationWorker) return;
    if (typeof Worker === 'undefined') return;

    try {
        chunkGenerationWorker = new Worker(new URL('./workers/chunkWorker.js', import.meta.url), { type: 'module' });
    } catch (error) {
        console.warn('Falling back to main-thread chunk generation.', error);
        chunkGenerationWorker = null;
        return;
    }

    chunkGenerationWorker.addEventListener('message', (event) => {
        const { chunkKey, cq, cr, columns } = event.data ?? {};
        if (!chunkKey || !pendingChunkGenerationInFlight.has(chunkKey)) return;
        pendingChunkGenerationInFlight.delete(chunkKey);
        if (!isChunkWithinRenderDistance(cq, cr)) return;
        if (worldState.loadedChunks.has(chunkKey)) return;
        if (pendingChunkApplySet.has(chunkKey)) return;
        pendingChunkApplySet.add(chunkKey);
        pendingChunkApplyQueue.push({ chunkKey, cq, cr, columns });
    });

    chunkGenerationWorker.addEventListener('error', (error) => {
        console.warn('Chunk generation worker crashed, using main-thread generation fallback.', error);
        chunkGenerationWorker?.terminate();
        chunkGenerationWorker = null;
        pendingChunkGenerationInFlight.clear();
        pendingChunkApplyQueue.length = 0;
        pendingChunkApplySet.clear();
    });
}

function applyGeneratedChunkColumns(cq, cr, columns) {
    const chunkKey = `${cq},${cr}`;
    ensureChunkMeta(cq, cr);
    worldState.loadedChunks.add(chunkKey);
    const chunkBlockKeys = recycledChunkBlockSets.pop() ?? new Set();
    chunkBlockKeys.clear();
    worldState.chunkBlocks.set(chunkKey, chunkBlockKeys);

    const packedColumns = columns && typeof columns.count === 'number' && columns.qBuffer instanceof ArrayBuffer;
    const columnCount = packedColumns ? columns.count : (columns?.length ?? 0);
    const qValues = packedColumns ? new Int32Array(columns.qBuffer) : null;
    const rValues = packedColumns ? new Int32Array(columns.rBuffer) : null;
    const heightValues = packedColumns ? new Int32Array(columns.heightBuffer) : null;
    const topBlockTypes = packedColumns ? new Uint8Array(columns.topBlockTypeBuffer) : null;
    const surfaceFluidTypes = packedColumns ? new Uint8Array(columns.surfaceFluidTypeBuffer) : null;
    const flags = packedColumns ? new Uint8Array(columns.flagsBuffer) : null;

    for (let index = 0; index < columnCount; index++) {
        const column = packedColumns ? null : columns[index];
        const q = packedColumns ? qValues[index] : column.q;
        const r = packedColumns ? rValues[index] : column.r;
        const height = packedColumns ? heightValues[index] : column.height;
        const topBlockType = packedColumns ? topBlockTypes[index] : column.topBlockType;
        const addSurfaceFluid = packedColumns ? (flags[index] & 1) !== 0 : column.addSurfaceFluid;
        const surfaceFluidType = packedColumns ? surfaceFluidTypes[index] : column.surfaceFluidType;
        const addTree = packedColumns
            ? ((flags[index] & 2) !== 0 ? 'forest' : (((flags[index] & 4) !== 0) ? 'snow' : null))
            : column.addTree;

        for (let h = NETHROCK_LEVEL_HEX + 1; h <= height; h++) {
            const blockKey = `${q},${r},${h}`;
            let blockType = BLOCK_INDEX.stone;
            if (h === height) blockType = topBlockType;
            else if (h >= height - 2) blockType = BLOCK_INDEX.dirt;

            if (!worldState.permanentBlocks.has(blockKey) && !worldState.removedBlocks.has(blockKey)) addBlock(q, r, h, blockType, false, false, false);
            if (worldState.worldBlocks.has(blockKey)) chunkBlockKeys.add(blockKey);
        }

        const nethrockKey = `${q},${r},${NETHROCK_LEVEL_HEX}`;
        if (!worldState.permanentBlocks.has(nethrockKey) && !worldState.removedBlocks.has(nethrockKey)) addBlock(q, r, NETHROCK_LEVEL_HEX, BLOCK_INDEX.nethrock, false, false, false);
        if (worldState.worldBlocks.has(nethrockKey)) chunkBlockKeys.add(nethrockKey);

        if (addSurfaceFluid) {
            addGeneratedFluidColumn(chunkBlockKeys, q, r, SEA_LEVEL, height, surfaceFluidType);
        }

        if (addTree) maybeAddTree(chunkBlockKeys, q, r, height, addTree === 'snow' ? 'snowy_forest' : 'forest');
    }

    const permanentChunkKeys = worldState.permanentBlocksByChunk.get(chunkKey) ?? new Set();
    for (const key of permanentChunkKeys) {
        const permanentBlock = worldState.permanentBlocks.get(key);
        if (!permanentBlock) continue;

        addBlock(permanentBlock.q, permanentBlock.r, permanentBlock.h, permanentBlock.typeIndex, true, false, false);
        chunkBlockKeys.add(key);
    }

    refreshBlockVisibilityForKeys(chunkBlockKeys);
    recomputeChunkGreedyFaceQuads(chunkKey);
    const chunk = worldState.chunkMeta.get(chunkKey);
    if (chunk) {
        chunk.dirty = true;
        chunk.bounds = recomputeChunkBounds(chunkKey);
        chunk.occlusionVisible = true;
        if (chunk.bounds) syncOcclusionProxyTransform(chunkKey);
    }
    updateChunkMeshVisibility(chunkKey);
}

export function generateChunk(cq, cr) {
    const chunkKey = `${cq},${cr}`;
    if (worldState.loadedChunks.has(chunkKey)) return;
    ensureChunkMeta(cq, cr);
    worldState.loadedChunks.add(chunkKey);
    const chunkBlockKeys = recycledChunkBlockSets.pop() ?? new Set();
    chunkBlockKeys.clear();
    worldState.chunkBlocks.set(chunkKey, chunkBlockKeys);

    const centerQ = cq * CHUNK_SIZE;
    const centerR = cr * CHUNK_SIZE;

    for (let q = -CHUNK_SIZE; q <= CHUNK_SIZE; q++) {
        for (let r = -CHUNK_SIZE; r <= CHUNK_SIZE; r++) {
            if (Math.abs(q + r) <= CHUNK_SIZE) {
                const absQ = centerQ + q;
                const absR = centerR + r;

                const climate = getClimate(absQ, absR);
                const biomeWeights = getBiomeWeights(climate.temp, climate.moist);
                const climateBiome = getDominantBiome(biomeWeights);
                const baseHeight = getHeight(absQ, absR);
                const heightWithBiome = baseHeight + biomeHeightModifier(biomeWeights, absQ, absR, baseHeight);
                const height = getSmoothedHeight(heightWithBiome);
                const biome = getBiomeAt(climateBiome, height);
                const isSnowBiome = biome === 'snowy_plains' || biome === 'snowy_forest' || biome === 'arctic';
                const topBlockType = biome === 'beach'
                    ? BLOCK_INDEX.dirt
                    : (height < SEA_LEVEL ? BLOCK_INDEX.dirt : (isSnowBiome ? BLOCK_INDEX.snow : BLOCK_INDEX.grass));

                // Fill terrain columns with stone core + dirt/surface cap to avoid floating arches.
                for (let h = NETHROCK_LEVEL_HEX + 1; h <= height; h++) {
                    const blockKey = `${absQ},${absR},${h}`;
                    let blockType = BLOCK_INDEX.stone;
                    if (h === height) blockType = topBlockType;
                    else if (h >= height - 2) blockType = BLOCK_INDEX.dirt;

                    if (!worldState.permanentBlocks.has(blockKey) && !worldState.removedBlocks.has(blockKey)) addBlock(absQ, absR, h, blockType, false, false, false);
                    if (worldState.worldBlocks.has(blockKey)) chunkBlockKeys.add(blockKey);
                }

                const nethrockKey = `${absQ},${absR},${NETHROCK_LEVEL_HEX}`;
                if (!worldState.permanentBlocks.has(nethrockKey) && !worldState.removedBlocks.has(nethrockKey)) addBlock(absQ, absR, NETHROCK_LEVEL_HEX, BLOCK_INDEX.nethrock, false, false, false);
                if (worldState.worldBlocks.has(nethrockKey)) chunkBlockKeys.add(nethrockKey);

                if (biome === 'ocean') {
                    const surfaceFluidType = climate.temp < -0.6 ? BLOCK_INDEX.ice : BLOCK_INDEX.water;
                    addGeneratedFluidColumn(chunkBlockKeys, absQ, absR, SEA_LEVEL, height, surfaceFluidType);
                }

                maybeAddTree(chunkBlockKeys, absQ, absR, height, biome);
            }
        }
    }

    const permanentChunkKeys = worldState.permanentBlocksByChunk.get(chunkKey) ?? new Set();
    for (const key of permanentChunkKeys) {
        const permanentBlock = worldState.permanentBlocks.get(key);
        if (!permanentBlock) continue;

        addBlock(permanentBlock.q, permanentBlock.r, permanentBlock.h, permanentBlock.typeIndex, true, false, false);
        chunkBlockKeys.add(key);
    }

    refreshBlockVisibilityForKeys(chunkBlockKeys);
    recomputeChunkGreedyFaceQuads(chunkKey);
    const chunk = worldState.chunkMeta.get(chunkKey);
    if (chunk) {
        chunk.dirty = true;
        chunk.bounds = recomputeChunkBounds(chunkKey);
        chunk.occlusionVisible = true;
        if (chunk.bounds) syncOcclusionProxyTransform(chunkKey);
    }
    updateChunkMeshVisibility(chunkKey);
}

export function unloadChunk(cq, cr) {
    const chunkKey = `${cq},${cr}`;
    if (!worldState.loadedChunks.has(chunkKey)) return;

    const chunkBlockKeys = worldState.chunkBlocks.get(chunkKey) ?? new Set();
    for (const key of chunkBlockKeys) {
        removeBlock(key, { preservePermanent: true, force: true, trackDirty: false, trackRemoval: false });
    }

    worldState.chunkBlocks.delete(chunkKey);
    if (chunkBlockKeys.size > 0) chunkBlockKeys.clear();
    if (recycledChunkBlockSets.length < 128) recycledChunkBlockSets.push(chunkBlockKeys);
    worldState.chunkFaceQuads.delete(chunkKey);
    worldState.loadedChunks.delete(chunkKey);
    worldState.dirtyChunks.delete(chunkKey);

    const chunk = worldState.chunkMeta.get(chunkKey);
    if (chunk) {
        chunk.dirty = false;
        chunk.bounds = null;
        chunk.frustumVisible = false;
        chunk.occlusionVisible = true;
        disposeChunkOcclusionState(chunk);
    }
}


function axialChunkDistance(cqA, crA, cqB, crB) {
    return axialDistance(cqA, crA, cqB, crB);
}

function getChunkPriorityScore(chunkQ, chunkR, cameraChunkQ, cameraChunkR) {
    const distance = axialChunkDistance(chunkQ, chunkR, cameraChunkQ, cameraChunkR);
    camera.getWorldDirection(cameraForwardXZ);
    cameraForwardXZ.y = 0;
    if (cameraForwardXZ.lengthSq() > 0.00001) cameraForwardXZ.normalize();

    const chunkWorld = axialToWorld(chunkQ * CHUNK_SIZE, chunkR * CHUNK_SIZE, 0);
    chunkPriorityVector.set(chunkWorld.x - camera.position.x, 0, chunkWorld.z - camera.position.z);
    if (chunkPriorityVector.lengthSq() > 0.00001) chunkPriorityVector.normalize();

    const forwardDot = cameraForwardXZ.dot(chunkPriorityVector);
    // Lower score is higher priority. Front-facing chunks (dot -> 1) get a stronger boost.
    return distance - (forwardDot * 0.35);
}

function enqueueChunkGeneration(cq, cr) {
    const chunkKey = `${cq},${cr}`;
    if (worldState.loadedChunks.has(chunkKey) || pendingChunkGenerationSet.has(chunkKey) || pendingChunkGenerationInFlight.has(chunkKey)) return;
    pendingChunkGenerationSet.add(chunkKey);
    pendingChunkGenerationQueue.push({ cq, cr, chunkKey });
}

function enqueueChunkUnload(cq, cr) {
    const chunkKey = `${cq},${cr}`;
    if (!worldState.loadedChunks.has(chunkKey) || pendingChunkUnloadSet.has(chunkKey)) return;
    pendingChunkUnloadSet.add(chunkKey);
    pendingChunkUnloadQueue.push({ cq, cr, chunkKey });
}

function rebuildStreamingQueue(cq, cr) {
    const visibleChunkKeys = new Set();

    for (let dq = -RENDER_DIST; dq <= RENDER_DIST; dq++) {
        for (let dr = -RENDER_DIST; dr <= RENDER_DIST; dr++) {
            const ds = -dq - dr;
            if (Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds)) > RENDER_DIST) continue;
            const visibleCq = cq + dq;
            const visibleCr = cr + dr;
            const chunkKey = `${visibleCq},${visibleCr}`;
            visibleChunkKeys.add(chunkKey);
            enqueueChunkGeneration(visibleCq, visibleCr);
        }
    }

    for (const chunkKey of Array.from(worldState.loadedChunks)) {
        if (visibleChunkKeys.has(chunkKey)) continue;

        const chunkMeta = worldState.chunkMeta.get(chunkKey);
        const chunkQ = chunkMeta?.cq ?? Number(chunkKey.split(',')[0]);
        const chunkR = chunkMeta?.cr ?? Number(chunkKey.split(',')[1]);
        enqueueChunkUnload(chunkQ, chunkR);
    }

    for (let i = pendingChunkUnloadQueue.length - 1; i >= 0; i--) {
        const queued = pendingChunkUnloadQueue[i];
        if (!visibleChunkKeys.has(queued.chunkKey)) continue;
        pendingChunkUnloadSet.delete(queued.chunkKey);
        pendingChunkUnloadQueue.splice(i, 1);
    }

    for (let i = pendingChunkGenerationQueue.length - 1; i >= 0; i--) {
        const queued = pendingChunkGenerationQueue[i];
        if (visibleChunkKeys.has(queued.chunkKey)) continue;
        pendingChunkGenerationSet.delete(queued.chunkKey);
        pendingChunkGenerationQueue.splice(i, 1);
    }

    for (const chunkKey of Array.from(pendingChunkGenerationInFlight)) {
        if (visibleChunkKeys.has(chunkKey)) continue;
        pendingChunkGenerationInFlight.delete(chunkKey);
    }

    for (let i = pendingChunkApplyQueue.length - 1; i >= 0; i--) {
        const queued = pendingChunkApplyQueue[i];
        if (visibleChunkKeys.has(queued.chunkKey)) continue;
        pendingChunkApplySet.delete(queued.chunkKey);
        pendingChunkApplyQueue.splice(i, 1);
    }

    const distanceBuckets = Array.from({ length: RENDER_DIST + 1 }, () => []);
    for (const queued of pendingChunkGenerationQueue) {
        const distance = axialChunkDistance(queued.cq, queued.cr, cq, cr);
        const bucket = distanceBuckets[Math.min(RENDER_DIST, distance)];
        queued.priorityScore = getChunkPriorityScore(queued.cq, queued.cr, cq, cr);
        bucket.push(queued);
    }
    pendingChunkGenerationQueue.length = 0;
    for (const bucket of distanceBuckets) {
        bucket.sort((a, b) => a.priorityScore - b.priorityScore);
        pendingChunkGenerationQueue.push(...bucket);
    }

    const applyDistanceBuckets = Array.from({ length: RENDER_DIST + 1 }, () => []);
    for (const queued of pendingChunkApplyQueue) {
        const distance = axialChunkDistance(queued.cq, queued.cr, cq, cr);
        const bucket = applyDistanceBuckets[Math.min(RENDER_DIST, distance)];
        queued.priorityScore = getChunkPriorityScore(queued.cq, queued.cr, cq, cr);
        bucket.push(queued);
    }
    pendingChunkApplyQueue.length = 0;
    for (const bucket of applyDistanceBuckets) {
        bucket.sort((a, b) => a.priorityScore - b.priorityScore);
        pendingChunkApplyQueue.push(...bucket);
    }
}

function flushChunkGenerationBudget() {
    let budget = adaptiveChunkBudget.createBudget;
    while (budget > 0 && pendingChunkGenerationQueue.length > 0) {
        const nextChunk = pendingChunkGenerationQueue.shift();
        pendingChunkGenerationSet.delete(nextChunk.chunkKey);
        if (chunkGenerationWorker && pendingChunkGenerationInFlight.size < adaptiveChunkBudget.maxInFlight) {
            pendingChunkGenerationInFlight.add(nextChunk.chunkKey);
            chunkGenerationWorker.postMessage({
                type: 'generate',
                cq: nextChunk.cq,
                cr: nextChunk.cr,
                chunkSize: CHUNK_SIZE,
                nethrockLevel: NETHROCK_LEVEL_HEX,
                seaLevel: SEA_LEVEL
            });
            budget--;
            continue;
        }

        if (chunkGenerationWorker) {
            pendingChunkGenerationQueue.unshift(nextChunk);
            break;
        }

        generateChunk(nextChunk.cq, nextChunk.cr);
        budget--;
    }
}

function flushChunkUnloadBudget() {
    let budget = CHUNK_UNLOAD_BUDGET;
    while (budget > 0 && pendingChunkUnloadQueue.length > 0) {
        const nextChunk = pendingChunkUnloadQueue.shift();
        pendingChunkUnloadSet.delete(nextChunk.chunkKey);
        unloadChunk(nextChunk.cq, nextChunk.cr);
        budget--;
    }
}

function flushChunkApplyBudget() {
    let budget = adaptiveChunkBudget.applyBudget;
    while (budget > 0 && pendingChunkApplyQueue.length > 0) {
        const nextChunk = pendingChunkApplyQueue.shift();
        pendingChunkApplySet.delete(nextChunk.chunkKey);
        if (worldState.loadedChunks.has(nextChunk.chunkKey)) continue;
        if (!isChunkWithinRenderDistance(nextChunk.cq, nextChunk.cr)) continue;
        applyGeneratedChunkColumns(nextChunk.cq, nextChunk.cr, nextChunk.columns);
        budget--;
    }
}

export function updateChunkBudgetGovernor(frameTimeMs) {
    if (!Number.isFinite(frameTimeMs) || frameTimeMs <= 0) return;

    const prevEma = adaptiveChunkBudget.emaFrameTimeMs;
    adaptiveChunkBudget.emaFrameTimeMs = prevEma + ((frameTimeMs - prevEma) * FRAME_TIME_EMA_ALPHA);

    if (frameTimeMs >= FRAME_TIME_SPIKE_MS || adaptiveChunkBudget.emaFrameTimeMs >= FRAME_TIME_SPIKE_MS) {
        adaptiveChunkBudget.createBudget = Math.max(1, adaptiveChunkBudget.createBudget - 1);
        adaptiveChunkBudget.applyBudget = Math.max(1, adaptiveChunkBudget.applyBudget - 1);
        adaptiveChunkBudget.maxInFlight = Math.max(1, adaptiveChunkBudget.maxInFlight - 1);
        adaptiveChunkBudget.stableFrames = 0;
        return;
    }

    if (adaptiveChunkBudget.emaFrameTimeMs <= FRAME_TIME_STABLE_MS) {
        adaptiveChunkBudget.stableFrames++;
        if (adaptiveChunkBudget.stableFrames < FRAME_TIME_RECOVERY_FRAMES) return;
        adaptiveChunkBudget.stableFrames = 0;

        const maxCreateBudget = Math.max(1, CHUNK_CREATION_BUDGET * 2);
        const maxApplyBudget = Math.max(1, CHUNK_APPLY_BUDGET * 2);
        adaptiveChunkBudget.createBudget = Math.min(maxCreateBudget, adaptiveChunkBudget.createBudget + 1);
        adaptiveChunkBudget.applyBudget = Math.min(maxApplyBudget, adaptiveChunkBudget.applyBudget + 1);
        adaptiveChunkBudget.maxInFlight = Math.min(MAX_WORLDGEN_IN_FLIGHT, adaptiveChunkBudget.maxInFlight + 1);
        return;
    }

    adaptiveChunkBudget.stableFrames = 0;
}

function getCurrentChunkCoords() {
    const current = worldState.frameCameraAxial ?? worldToAxial(camera.position);
    return {
        cq: Math.round(current.q / CHUNK_SIZE),
        cr: Math.round(current.r / CHUNK_SIZE)
    };
}

export function tickChunkApplyBudget() {
    initChunkGenerationWorker();
    applyDirtyChunks(DIRTY_CHUNK_APPLY_BUDGET);
    flushChunkApplyBudget();
}

export function tickChunkStreaming() {
    initChunkGenerationWorker();
    const { cq, cr } = getCurrentChunkCoords();
    const currentChunkKey = `${cq},${cr}`;
    const chunkChanged = currentChunkKey !== lastStreamChunkKey;

    if (chunkChanged) {
        rebuildStreamingQueue(cq, cr);
        lastStreamChunkKey = currentChunkKey;
    }

    flushChunkUnloadBudget();
    flushChunkGenerationBudget();
}

export function tickChunkVisibility() {
    const { cq, cr } = getCurrentChunkCoords();
    const lodChangedChunks = updateChunkLodLevels(cq, cr);
    for (const chunkKey of lodChangedChunks) updateChunkMeshVisibility(chunkKey);
    applyChunkFrustumCulling();
}

export function updateChunks() {
    tickChunkStreaming();
    tickChunkApplyBudget();
    tickChunkVisibility();
}
