# MineHex Optimization Audit

This audit lists **30 code-level optimizations** found directly in the current codebase plus **10 advanced optimization techniques** worth adding.

> Note: “faster than light” is physically impossible, but these changes can still produce major FPS and frame-time consistency gains.

## 30 concrete optimizations from current code

1. **Stop creating a full array of blocks for every ground raycast.** `getGroundHit` builds `Array.from(worldState.worldBlocks.values())` each physics step; maintain a separate collidable list/set (or per-chunk query) instead. (`src/physics.js`)
2. **Avoid filtering collidable blocks every frame.** The liquid/solid filter in `getGroundHit` should be cached and incrementally updated on block add/remove. (`src/physics.js`)
3. **Reuse movement vectors/eulers in physics.** `new THREE.Vector3()` and `new THREE.Euler()` are allocated in `handlePhysics` per frame. (`src/physics.js`)
4. **Use a broad-phase before raycasting against meshes.** Ground checks should test nearby chunk AABBs first, then test only a tiny candidate set. (`src/physics.js`, `src/worldgen.js`)
5. **Only run full chunk updates when needed.** `updateChunks()` currently runs every locked frame; split stream/cull/remesh into different cadences (e.g., stream at lower Hz). (`src/main.js`, `src/worldgen.js`)
6. **Remove duplicate visibility refresh pass.** `updateChunks()` calls `updateChunkMeshVisibility` during frustum/dirty updates and then again for all chunks at end. (`src/worldgen.js`)
7. **Avoid O(worldBlocks) dirty rebuilds.** `applyDirtyChunks()` scans all blocks to rebuild dirty chunks; track chunk membership incrementally in `addBlock/removeBlock`. (`src/worldgen.js`, `src/blocks.js`)
8. **Cache parsed chunk coordinates.** Repeated `chunkKey.split(',').map(Number)` in hot paths can be avoided by storing numeric coords in metadata. (`src/worldgen.js`)
9. **Precompute chunk hex footprint bounds.** `recomputeChunkBounds` loops all q/r in chunk and calls `axialToWorld`; X/Z extents are static for a given chunk size. (`src/worldgen.js`)
10. **Reduce per-frame query creation/deletion.** Occlusion queries are created/deleted repeatedly; pool and reuse query objects. (`src/worldgen.js`)
11. **Throttle occlusion for stable chunks.** Run occlusion query every N frames for distant chunks instead of every frame. (`src/worldgen.js`)
12. **Skip occlusion for tiny/near chunks.** Close chunks or chunks with few blocks can bypass query overhead. (`src/worldgen.js`)
13. **Avoid sorting generation queue on each rebuild.** `pendingChunkGenerationQueue.sort(...)` is O(n log n); use bucketed rings by distance. (`src/worldgen.js`)
14. **Use a hex radius load mask, not square loops.** `rebuildStreamingQueue` iterates square (i/j) rather than proper hex-distance inclusion. (`src/worldgen.js`)
15. **Batch block creation for chunk generation.** `generateChunk` creates many Mesh objects one by one; merge static geometry by chunk/material. (`src/worldgen.js`, `src/blocks.js`)
16. **Do not keep hidden interior mesh objects alive.** Visibility checks hide many blocks but still keep full Mesh overhead in CPU/GPU state. (`src/blocks.js`, `src/worldgen.js`)
17. **Use chunk mesh buffers instead of per-block meshes.** `addBlock` currently creates a separate `THREE.Mesh` per block; switch to chunk-level `BufferGeometry`. (`src/blocks.js`)
18. **Avoid string keys in tight loops.** Keys like ```${q},${r},${h}``` generate garbage and hashing overhead; use packed integer keys. (`src/blocks.js`, `src/rules.js`, `src/worldgen.js`)
19. **Reduce allocation in greedy meshing.** `greedyMergeCells` uses many short-lived Sets/strings (`keyOf`); use typed occupancy grids. (`src/blocks.js`)
20. **Reduce allocation in visibility refresh.** `refreshBlockVisibilityForKeys` repeatedly splits string keys and builds target arrays. (`src/blocks.js`)
21. **Precompute/carry block type solidity bitset.** `isSolidTypeIndex` + object lookup can be replaced by a flat boolean table for hot checks. (`src/rules.js`, `src/config.js`)
22. **Short-circuit spawn search using column-height cache.** `findSpawnHeight` scans from 80 to -80 each probe; maintain per-column top solid height map. (`src/rules.js`)
23. **Avoid per-click full-scene raycast array creation.** `getCenterIntersection` converts map values to array every call. (`src/input.js`)
24. **Constrain mining/placing raycast distance.** Set raycaster `far` to interaction range to cut intersection tests. (`src/input.js`)
25. **Reuse center-screen `Vector2` for raycaster.** `new THREE.Vector2(0, 0)` in each call is unnecessary allocation. (`src/input.js`)
26. **Disable costly bevel on voxel-like geometry.** `ExtrudeGeometry` with `bevelEnabled: true` increases triangle count. (`src/geometry.js`)
27. **Turn off antialias on low-end profiles.** Renderer always enables antialias; couple it to runtime capability profile. (`src/scene.js`, `src/config.js`)
28. **Consider disabling shadow map when unused.** `renderer.shadowMap.enabled = true` adds overhead even though block lights/shadows are minimal here. (`src/scene.js`)
29. **Convert key state object to fixed map/bitset.** `inputState.keys` object has dynamic property churn; compact structure improves locality. (`src/state.js`, `src/input.js`)
30. **Avoid repeated world<->axial conversions in hot paths.** `worldToAxial(camera.position)` is invoked in multiple systems per frame; cache per-frame camera axial coordinate. (`src/physics.js`, `src/worldgen.js`, `src/rules.js`)

## 10 advanced optimization techniques to add

1. **Chunk mesh baking with `THREE.InstancedMesh` or custom batched `BufferGeometry`** to slash draw calls and CPU scene traversal.
2. **GPU-driven culling (compute-style emulation + indirect draw where available)** for frustum/occlusion/LOD decisions off CPU.
3. **Hierarchical Z (Hi-Z) occlusion** to test chunk bounding boxes against depth pyramids instead of per-chunk GL queries.
4. **Dual-thread architecture with Web Workers**: worldgen, meshing, and compression off main thread; main thread only applies mesh swaps.
5. **Mesh streaming with transferable ArrayBuffers** so worker-built vertex/index buffers move to render thread without copy.
6. **Clipmap-style terrain LOD rings** to keep near detail high and distant geometry ultra-cheap with stable memory bounds.
7. **Temporal workload scheduler** (frame budget manager) that dynamically adapts generation/culling/remesh quotas by frame time.
8. **Data-oriented world storage (SoA + typed arrays)** for occupancy/material/light instead of object-heavy per-block mesh state.
9. **Signed distance / heightfield collision proxy** for player movement to avoid mesh raycasts for simple ground checks.
10. **Progressive rendering quality scaler** (dynamic resolution + selective effect toggles) targeting a stable frame-time budget.

## Newly implemented from this audit

- ✅ **Temporal workload scheduler** added: chunk generation/unload budgets and occlusion query cadence now adapt from a frame-time EMA budget signal. (`src/main.js`, `src/worldgen.js`, `src/state.js`)
- ✅ **Collision heightfield proxy path** added: physics now first resolves ground contact through the per-column top-solid cache before falling back to mesh raycasts. (`src/physics.js`, `src/rules.js`, `src/state.js`)
- ✅ **Progressive rendering quality scaler** added: dynamic render pixel ratio now responds to current frame-time pressure to stabilize frame pacing on slower devices. (`src/main.js`, `src/config.js`)
