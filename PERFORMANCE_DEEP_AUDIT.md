# MineHex Deep Performance Audit

_Last updated: May 13, 2026._

This audit focuses on the hexagonal voxel world, chunk streaming, rendering, simulation, input responsiveness, and JavaScript allocation behavior. Impact estimates prioritize frame-time stability on low-end browsers first.

## Implemented in this pass

### 1. Chunk AABB recomputation rebuilt static X/Z bounds every time
- **Impact:** Medium-high during chunk generation, dirty rebuilds, culling setup, and occlusion setup.
- **Where:** `src/worldgen.js` / `recomputeChunkBounds`.
- **Why slow:** The previous path iterated every local hex cell and every hex corner on each full bounds recompute. X/Z footprint only depends on chunk size, not chunk contents, so most work was invariant.
- **Optimization:** Precompute the local chunk X/Z footprint once and translate it per chunk; only scan block heights for min/max Y. Height lookup now uses cached block coordinates before falling back to unpacking.
- **Gameplay behavior:** Bounds remain conservative and still include the same hex corners and vertical margins.

### 2. Chunk priority scoring allocated world vectors
- **Impact:** Medium when streaming queues are rebuilt or reprioritized.
- **Where:** `src/worldgen.js` / `getChunkPriorityScore`, `rebuildStreamingQueue`.
- **Why slow:** Queue prioritization called `axialToWorld`, which allocates `THREE.Vector3` objects for each queued chunk while sorting/generation pressure is high.
- **Optimization:** Compute chunk center X/Z directly using the axial-to-world formula and reuse the existing priority vector.
- **Gameplay behavior:** Priority scores are numerically equivalent for X/Z ordering.

### 3. Dirty chunk processing used `Array.shift()` inside budget loops
- **Impact:** Medium with many dirty chunks after edits or terrain updates.
- **Where:** `src/worldgen.js` / `applyDirtyChunks`.
- **Why slow:** `shift()` is O(n) because it compacts the array for every processed dirty chunk.
- **Optimization:** Iterate by index and keep the same hot/cold priority ordering without repeated compaction.
- **Gameplay behavior:** Dirty chunks are processed in the same sorted order.

### 4. Streaming queue rebuild allocated a visible-set every camera chunk move
- **Impact:** Medium during traversal, especially on low-memory devices.
- **Where:** `src/worldgen.js` / `rebuildStreamingQueue`.
- **Why slow:** Rebuilding queues allocated a fresh `Set` and copied loaded chunk keys with `Array.from` before unload checks.
- **Optimization:** Reuse one `Set` for visible chunks and iterate `loadedChunks` directly. Chunk unloads are still queued rather than applied while iterating.
- **Gameplay behavior:** The same chunks are generated/unloaded.

### 5. Hex distance allocated cube-coordinate objects
- **Impact:** Medium because chunk distance is used by LOD, streaming, queue priority, and culling decisions.
- **Where:** `src/coords.js` / `axialDistance`.
- **Why slow:** Distance converted each axial coordinate pair into temporary cube objects.
- **Optimization:** Compute cube deltas directly: `dx = dq`, `dz = dr`, `dy = -dx - dz`.
- **Gameplay behavior:** Hex distance is mathematically identical.

### 6. Chunk visibility refresh allocated nested target arrays per block
- **Impact:** Medium-high during chunk generation and chunk apply.
- **Where:** `src/blocks.js` / `refreshBlockVisibilityForKeys`.
- **Why slow:** For every block, the old path created a target array plus mapped neighbor arrays, producing large GC bursts for full chunks.
- **Optimization:** Update the block and each face neighbor directly in a loop while keeping the de-duplication `Set`.
- **Gameplay behavior:** The same cells have their visibility masks refreshed.

## Remaining major hotspots and recommendations

### World + chunk systems

1. **Chunk data is still split across several maps (`worldBlocks`, `chunkBlocks`, `chunkBlockData`, `blockIndexByKey`).**
   - **Impact:** High.
   - **Where:** `src/blocks.js`, `src/state.js`, `src/worldgen.js`.
   - **Why slow:** Every block lookup crosses multiple hash maps and often still retains object-like render records.
   - **Better implementation:** Make chunk-local typed arrays the authoritative block store, with sparse maps only for player edits and unusual blocks. Keep render batches derived from chunk data.

2. **Face grouping still creates string group keys during greedy meshing.**
   - **Impact:** High during chunk rebuilds.
   - **Where:** `src/blocks.js` / `recomputeChunkGreedyFaceQuads`.
   - **Why slow:** `${plane}:${planeValue}:...` allocates strings for every visible face.
   - **Better implementation:** Use nested `Map`s or integer-packed group IDs per face direction/type/plane.

3. **Full chunk greedy recompute runs after local edits.**
   - **Impact:** High near active editing/mining.
   - **Where:** `src/worldgen.js` / `processDirtyChunk`; `src/blocks.js` / `recomputeChunkGreedyFaceQuads`.
   - **Why slow:** A single block change can rebuild all render batches for the chunk.
   - **Better implementation:** Track dirty subregions/heights and rebuild only affected planes or small vertical bands.

4. **Chunk apply still creates all block records on the main thread.**
   - **Impact:** High during world loading/streaming.
   - **Where:** `src/worldgen.js` / `applyGeneratedChunkColumns`.
   - **Why slow:** Worker output is compact, but the main thread expands each column into block records, visibility, and mesh batches.
   - **Better implementation:** Move face-mask and batch-buffer generation into workers and transfer typed buffers to the render thread.

5. **Streaming queues still sort active items.**
   - **Impact:** Medium.
   - **Where:** `src/worldgen.js` / `rebuildStreamingQueue`.
   - **Why slow:** Sorting is O(n log n), and priority changes with camera direction.
   - **Better implementation:** Bucket chunks by hex distance and front/side sector; process nearest buckets first.

### Rendering

6. **Detailed chunks render one `InstancedMesh` per material per chunk, not one merged geometry per visible face set.**
   - **Impact:** High when many chunks are visible.
   - **Where:** `src/worldgen.js` / `rebuildChunkDetailedMeshes`, `rebuildChunkInstancedLodMeshes`.
   - **Why slow:** Instancing reduces per-block meshes, but still draws full prism instances and hidden internal geometry within each block geometry.
   - **Better implementation:** Generate chunk face meshes from greedy quads and emit one `BufferGeometry` per material class.

7. **Transparent/liquid materials can increase overdraw.**
   - **Impact:** Medium.
   - **Where:** `src/config.js`, `src/shaders/materials.js`, chunk render batches.
   - **Why slow:** Transparent surfaces require sorting/blending and can render behind terrain.
   - **Better implementation:** Separate opaque and transparent passes, avoid generating fully hidden water faces, and keep water batches small.

8. **Occlusion queries add GPU/CPU synchronization pressure.**
   - **Impact:** Medium-high depending on GPU/driver.
   - **Where:** `src/worldgen.js` / `runChunkOcclusionCulling`.
   - **Why slow:** Query result handling can stall or create delayed visibility transitions.
   - **Better implementation:** Continue throttling distant chunks; consider Hi-Z depth-sector culling as the main path and queries only for large uncertain chunks.

### Simulation and input

9. **Collision samples repeatedly convert world positions to axial coordinates.**
   - **Impact:** Medium per frame.
   - **Where:** `src/physics.js` / `collidesAtCameraPosition`, `resolveGroundCollision`, `getSweptGroundSnapY`.
   - **Why slow:** Multiple samples per axis move repeat coordinate conversion and map lookup.
   - **Better implementation:** Cache sampled axial cells per physics frame and use column top-height data for most vertical checks.

10. **Ground raycast still uses render meshes as collision candidates.**
    - **Impact:** Medium.
    - **Where:** `src/physics.js` / `getGroundHit`; `src/blocks.js` / `collectChunkRaycastCandidates`.
    - **Why slow:** Physics raycasts traverse Three.js mesh structures instead of the hex column heightfield.
    - **Better implementation:** Prefer top-solid-height and swept-heightfield collision; raycast only for unusual geometry or debug.

11. **Dropped item ticking is linear in dropped item count.**
    - **Impact:** Low now, medium if drops accumulate.
    - **Where:** `src/input.js` / `tickDroppedMiningItems`.
    - **Why slow:** Every item updates every frame and can allocate/render independently.
    - **Better implementation:** Cap drops per chunk, merge nearby stacks, and tick far drops at lower frequency.

### Memory and JavaScript hot paths

12. **Block render records are object-heavy.**
    - **Impact:** High memory and GC.
    - **Where:** `src/blocks.js` / `createBlockRecord`.
    - **Why slow:** Each block has nested objects for position/rotation/scale/userData even when chunk meshes are the render unit.
    - **Better implementation:** Store q/r/h/type arrays in chunk data and create object records only for edited blocks or compatibility boundaries.

13. **Inventory/UI rendering can query DOM repeatedly.**
    - **Impact:** Low during gameplay, medium while inventory is open.
    - **Where:** `src/input.js` / `updateSelectedBlock`, inventory render paths.
    - **Why slow:** DOM queries and class toggles are unnecessary on hotbar changes.
    - **Better implementation:** Reuse cached slot element maps for active-state updates.

14. **World autosave snapshots can be blocking as worlds grow.**
    - **Impact:** Medium during autosave spikes.
    - **Where:** `src/main.js` / `buildWorldDataSnapshot`, `persistActiveWorld`.
    - **Why slow:** Snapshotting edited/removed block sets can walk large maps on the main thread.
    - **Better implementation:** Maintain incremental dirty save journals and compact them during idle time.

## Recommended next implementation order

1. Worker-built chunk mesh buffers with transferables.
2. Greedy face group key removal.
3. Partial dirty chunk rebuilds by touched face plane/height band.
4. Heightfield-first player collision with render raycast fallback.
5. Chunk-local authoritative typed arrays and sparse edit overlays.
6. Save-journal compaction for world persistence.
