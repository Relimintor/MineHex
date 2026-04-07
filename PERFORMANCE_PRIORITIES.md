# MineHex Performance Priorities (Detailed Implementation Guide)

_Last updated: April 7, 2026._

This document is the **implementation roadmap** for performance work, with explicit pointers to where each bottleneck lives and what to change.

---

## How to read this document

Each optimization includes:
- **Why it matters** (frame-time / stutter / memory / GC / draw-call impact)
- **Where it is now** (exact files + key functions)
- **What to implement** (concrete engineering direction)
- **Validation checklist** (what to benchmark after shipping)

---

## Priority 0 — Instrumentation first (before heavy refactors)

You will move faster if every later change can be measured in the same way.

### P0.1 Add subsystem timing markers and frame budget telemetry
- **Why it matters:** Right now, frame work is split across cadence ticks, but there is no uniform in-game timing dashboard for each subsystem.
- **Where:**
  - `src/main.js` (`animate`, frame cadence calls)
  - `src/worldgen.js` (`tickChunkStreaming`, `tickChunkApplyBudget`, `tickChunkVisibility`, occlusion path)
  - `src/physics.js` (`handlePhysics`)
- **Implement:**
  - Add a lightweight profiler collector in state (rolling window: 120–300 frames).
  - Time each subsystem with `performance.now()` deltas:
    - physics
    - stream queue rebuild + generation
    - dirty apply
    - visibility/LOD
    - occlusion query setup + result processing
    - render
  - Display P50/P95/P99 in a debug overlay toggle.
- **Validate:**
  - Confirm profiler overhead is < 0.3 ms/frame.
  - Capture baseline before and after each optimization phase.

### P0.2 Track allocation pressure and key churn counters
- **Why it matters:** Many hotspots are allocation-driven (string keys, temporary Sets, short-lived arrays).
- **Where:**
  - `src/blocks.js` (string keys, Set-heavy greedy meshing)
  - `src/worldgen.js` (queue rebuild arrays/buckets, key parsing)
- **Implement:**
  - Add debug counters: strings generated, `split(',')` parse count, Set creations in hot loops.
  - Expose in debug HUD (sampling every 30 frames).
- **Validate:**
  - Counter trends drop as packed keys / typed structures are introduced.

---

## Priority 1 — Data layout + key system (highest ROI)

### P1.1 Replace string coordinate keys with packed numeric keys
- **Why it matters:** String creation/parsing in hot paths increases GC and hash-map overhead.
- **Where:**
  - `src/blocks.js`
    - `getChunkKey`, `trackRemovedBlock`, `clearRemovedBlockMark`, `parseBlockKey`, `getBlockAt`, visibility helpers
  - `src/worldgen.js`
    - `ensureChunkMeta`, `recomputeChunkBounds`, `getChunkCoordsFromKey`, dirty chunk classification
  - `src/physics.js`
    - `isChunkLoadedAtWorldPosition`, `getFallbackGroundDistanceFromTopSolidColumn`
  - `src/rules.js` + `src/state.js` (maps keyed by `q,r` and `q,r,h`)
- **Implement:**
  - Introduce helper module (e.g., `src/keys.js`) for:
    - packed block key (`q,r,h`)
    - packed chunk key (`cq,cr`)
    - unpack methods only at boundaries (debug/UI)
  - Keep backward-compatible migration layer during transition.
  - Convert all world/chunk maps to packed keys incrementally.
- **Validate:**
  - Reduction in GC pauses.
  - Lower CPU time in dirty apply + visibility + collision checks.

### P1.2 Move hot block data to struct-of-arrays style storage
- **Why it matters:** Object-heavy per-block records reduce locality and increase overhead.
- **Where:**
  - `src/blocks.js` (`createBlockRecord`, visibility metadata storage)
  - `src/state.js` (world block containers)
  - `src/worldgen.js` (chunk block iteration)
- **Implement:**
  - Keep render representation separate from simulation data.
  - Chunk-local typed arrays for:
    - occupancy/type
    - exposed-face mask
    - top-solid height deltas
  - Optional sparse map for non-default blocks.
- **Validate:**
  - Faster chunk rebuilds.
  - Lower memory footprint and better frame-time consistency.

---

## Priority 2 — Chunk mesh pipeline (draw-call + CPU traversal reduction)

### P2.1 Shift from per-block traversal to chunk-native batched meshes
- **Why it matters:** Repeatedly walking block objects for LOD/visibility/rebuild is costly.
- **Where:**
  - `src/worldgen.js`
    - `rebuildChunkDetailedMeshes`
    - `rebuildChunkInstancedLodMeshes`
    - `updateChunkMeshVisibility`
  - `src/blocks.js` (face visibility source data)
  - `src/geometry.js` / `src/shaders/materials.js`
- **Implement:**
  - Build per-chunk mesh buffers directly from chunk data.
  - Keep one render object per material class per chunk (or per LOD mode).
  - Partial updates: only regenerate modified regions/heights when possible.
- **Validate:**
  - Draw calls drop significantly.
  - CPU time in worldgen visibility + rebuild paths decreases.

### P2.2 Use face-mask driven meshing to avoid repeated neighbor lookups
- **Why it matters:** Visibility functions repeatedly call neighbor checks in JS loops.
- **Where:**
  - `src/blocks.js`
    - `isFaceVisible`, `getVisibleFaces`, `updateBlockVisibilityAt`, `updateVisibilityAround`
- **Implement:**
  - Maintain compact bitmask per block (6 faces).
  - Update masks incrementally on block add/remove for changed neighbors only.
  - Mesher consumes masks directly.
- **Validate:**
  - Reduced CPU in visibility updates after edits/mining.

### P2.3 Optimize greedy merge internals with typed occupancy grids
- **Why it matters:** `Set` + string key operations in greedy merge generate heavy churn.
- **Where:**
  - `src/blocks.js` (`greedyMergeCells`)
- **Implement:**
  - Replace `Set`/`"u,v"` visited tracking with typed bitset/grid indexing.
  - Pre-size buffers by chunk bounds.
- **Validate:**
  - Meshing latency improves for dense chunks.

---

## Priority 3 — Physics and interaction path

### P3.1 Add broad-phase for ground/interact raycasts
- **Why it matters:** `intersectObjects` cost grows with candidate set size.
- **Where:**
  - `src/physics.js` (`getGroundHit`, `resolveGroundCollision`)
  - `src/blocks.js` (`collectChunkRaycastCandidates`)
  - `src/input.js` (center interaction raycast)
- **Implement:**
  - Step 1: chunk AABB reject before mesh list assembly.
  - Step 2: keep candidate caches keyed by camera chunk and reuse for N frames if unchanged.
  - Step 3: clamp raycaster near/far strictly to gameplay range.
- **Validate:**
  - Reduced physics frame cost in movement-heavy scenes.

### P3.2 Use top-solid column cache as primary ground snap path
- **Why it matters:** You already have `topSolidHeightByColumn`; leverage it first when safe.
- **Where:**
  - `src/physics.js` (`getFallbackGroundDistanceFromTopSolidColumn`, `getGroundHit`)
  - `src/rules.js` (top-solid maintenance)
- **Implement:**
  - In non-edge cases (standing on stable terrain), avoid mesh raycast entirely.
  - Fall back to raycast only when vertical uncertainty is high.
- **Validate:**
  - Lower average ground-collision time.

---

## Priority 4 — Streaming, queues, and dirty chunk scheduler

### P4.1 Avoid queue churn from repeated bucket rebuilds and shifts
- **Why it matters:** Frequent `array.shift()` and full rebucketing add overhead.
- **Where:**
  - `src/worldgen.js`
    - queue rebucketing blocks around generation/apply queues
    - `flushChunkGenerationBudget`, `flushChunkApplyBudget`, `flushChunkUnloadBudget`
- **Implement:**
  - Use deque-style indices or ring buffers instead of `shift()`.
  - Keep persistent buckets and update incrementally as camera moves.
  - Track `priorityScore` invalidation cheaply.
- **Validate:**
  - Lower CPU spikes during movement while loading terrain.

### P4.2 Tighten dirty chunk prioritization and batching
- **Why it matters:** Hot/cold queue rebuild every pass can still be expensive if dirty sets are large.
- **Where:**
  - `src/worldgen.js` (`applyDirtyChunks`, `classifyDirtyChunkPriority`, `processDirtyChunk`)
- **Implement:**
  - Maintain two persistent dirty sets (`hot`, `cold`) updated at mutation time.
  - Batch nearby dirty chunks to amortize neighbor-dependent updates.
- **Validate:**
  - Less stutter when placing/removing many blocks quickly.

### P4.3 Push more generation/meshing to worker side with transferable buffers
- **Why it matters:** Main thread still performs expensive apply/rebuild work.
- **Where:**
  - `src/worldgen.js` (worker pool lifecycle + apply path)
  - `src/workers/chunkWorker*.js`
- **Implement:**
  - Worker returns packed mesh-ready buffers (`ArrayBuffer` transfer).
  - Main thread performs lightweight buffer swap only.
- **Validate:**
  - Reduced main-thread frame spikes during chunk generation.

---

## Priority 5 — Culling and LOD costs

### P5.1 Cache static chunk footprint bounds and only update Y incrementally
- **Why it matters:** XZ bounds are deterministic; recomputing corners is unnecessary repeated math.
- **Where:**
  - `src/worldgen.js` (`recomputeChunkBounds`, `applyIncrementalChunkBoundsUpdate`)
- **Implement:**
  - Precompute canonical chunk XZ AABB once (at startup).
  - Per chunk, only maintain minH/maxH and derive Y bounds.
- **Validate:**
  - Faster dirty chunk processing when bounds are touched.

### P5.2 Make occlusion query cadence adaptive by distance and stability
- **Why it matters:** GPU query overhead can exceed benefit for near/small/stable chunks.
- **Where:**
  - `src/worldgen.js` (occlusion query lifecycle and visibility updates)
  - `src/main.js` (`OCCLUSION_CULLING_INTERVAL_FRAMES`, invocation cadence)
- **Implement:**
  - Query far chunks less often (every N frames by ring).
  - Skip near chunks and trivial-size chunks.
  - Reuse previous visibility result with hysteresis.
- **Validate:**
  - Stable FPS with equal/better culling quality.

### P5.3 Improve LOD transition work distribution
- **Why it matters:** LOD rebuild bursts can cluster in same frame.
- **Where:**
  - `src/worldgen.js` (`getChunkLodLevel`, mesh rebuild paths)
- **Implement:**
  - Limit LOD transitions per frame by budget and distance importance.
  - Prewarm adjacent-ring LOD assets ahead of camera direction.
- **Validate:**
  - Lower P95/P99 frame times while sprinting/flying.

---

## Priority 6 — Rendering config and quality scaling

### P6.1 Dynamic quality scaler tied to frame EMA
- **Why it matters:** Runtime conditions vary by device; fixed settings waste budget.
- **Where:**
  - `src/main.js` (frame timing, governor hooks)
  - `src/scene.js` (`setPixelRatio`, antialias, shadow toggles)
  - `src/config.js` (profile flags)
- **Implement:**
  - Add quality ladder:
    - pixel ratio cap
    - shadow map toggle
    - optional post/sky update cadence
  - Promote/demote settings based on sustained EMA thresholds.
- **Validate:**
  - Better stability on low-end hardware with graceful quality fallback.

### P6.2 Throttle non-critical visual updates
- **Why it matters:** Some visual systems do not need full-rate updates.
- **Where:**
  - `src/main.js` (`skyController.update`, HUD updates, avatar preview render)
  - `src/inventoryAvatar.js`
- **Implement:**
  - Run sky/preview/HUD on lower cadence when frame-time exceeds target.
- **Validate:**
  - Small but reliable headroom gains.

---

## Concrete file-by-file optimization map

### `src/blocks.js`
- Convert all string keys to packed keys.
- Replace greedy meshing Sets/string hashes with typed grid/bitset.
- Introduce per-block face mask + incremental updates.
- Keep block simulation record lightweight and renderer-agnostic.

### `src/worldgen.js`
- Remove avoidable parse/split in hot loops.
- Persist queue buckets and avoid `shift`-based dequeue.
- Keep dirty hot/cold sets incrementally maintained.
- Precompute chunk XZ bounds; update Y bounds from min/max height deltas.
- Push mesh-generation heavy work to workers with transferables.

### `src/physics.js`
- Expand broad-phase filtering before mesh intersections.
- Reuse candidate sets for multiple frames when camera chunk unchanged.
- Prefer top-solid cache for stable ground checks.

### `src/input.js`
- Mirror physics raycast improvements for interaction raycasts.
- Clamp raycaster ranges tightly and reuse temporary math objects.

### `src/main.js`
- Maintain cadence separation, but add explicit subsystem profiling.
- Introduce adaptive quality scaler hook to protect frame budget.

### `src/scene.js` / `src/config.js`
- Make quality toggles runtime-adaptive per profile (pixel ratio, AA, shadows).

### `src/workers/chunkWorker*.js`
- Return mesh-ready packed buffers to minimize main-thread apply cost.

---

## Phase plan (execution order)

### Phase A (2–4 days)
1. Instrumentation + counters (P0).
2. Packed keys migration skeleton (P1.1 partial).
3. Physics broad-phase improvements (P3.1 baseline).

### Phase B (4–7 days)
1. Complete packed key migration.
2. Greedy mesh internal rewrite (typed occupancy/visited).
3. Queue/dequeue refactor (persistent buckets, no `shift`).

### Phase C (1–2 weeks)
1. Chunk-native batched mesh pipeline.
2. Worker transferables for mesh-ready chunk payloads.
3. LOD/occlusion adaptive cadence polishing.

### Phase D (ongoing)
1. Dynamic quality scaler tuning.
2. Regression guardrails on P95/P99 frame time and stutter metrics.

---

## Validation matrix (must-pass after each phase)

Track in the same test route and camera movement path every time:

1. **Frame-time metrics:** P50/P95/P99 + worst 1%.
2. **Main-thread breakdown:** physics, streaming, dirty apply, visibility, render.
3. **GPU-side indicators:** draw calls, triangles, occlusion query count/frame.
4. **Memory:** JS heap baseline + peak after 5 minutes moving.
5. **GC:** pause count and longest pause.
6. **Streaming UX:** chunk pop-in delay, stutter count during sprint traversal.

If an optimization improves average FPS but worsens P95/P99 stutter, treat it as incomplete and iterate.

---

## Quick-start shortlist (if you only do 3 things)

1. Packed keys everywhere (`src/blocks.js`, `src/worldgen.js`, `src/physics.js`, `src/rules.js`, `src/state.js`).
2. Greedy meshing rewrite to typed grids (`src/blocks.js`).
3. Streaming queue refactor + worker mesh transferables (`src/worldgen.js`, `src/workers/`).

Those three together should produce the biggest practical reduction in hitching and CPU frame variance.
