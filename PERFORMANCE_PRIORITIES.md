# Performance Priorities (April 2026)

This is a practical, implementation-first optimization order based on current hot paths.

## 1) Highest ROI (do first)

1. **Eliminate per-block Mesh dependence in chunk rendering path**
   - Current world state still stores block records that are walked repeatedly for visibility, LOD, and rebuild operations.
   - Move runtime rendering to chunk-native typed buffers (or instance batches) and keep block metadata in lightweight structs only.
   - Why first: this reduces scene traversal overhead, JS object pressure, and update cost in multiple systems at once.

2. **Replace string keys in hot paths with packed numeric keys**
   - Hot code still creates/parses many `"q,r,h"` and `"cq,cr"` keys.
   - Introduce packed integer/block-id keys and chunk-local indexing.
   - Why first: lowers GC churn and hash-map overhead in physics, visibility, and chunk maintenance.

3. **Stop full chunk block scans when applying dirty chunks**
   - Ensure dirty handling uses incremental membership/ops only, not full world/chunk scans.
   - Why first: chunk edits and generation spikes currently amplify frame-time variance.

4. **Reduce raycast candidate cost for player-ground + interaction**
   - Keep raycasts bounded to near chunk candidates and fixed `far` range only.
   - Add a cheap broad-phase (chunk bounds/cell occupancy) before mesh intersection.
   - Why first: this runs frequently and directly affects movement feel.

## 2) Medium ROI (next)

5. **Precompute static chunk footprint bounds once**
   - XZ chunk bounds are deterministic for a given chunk size/layout.
   - Reuse a cached footprint and only update vertical extents incrementally.

6. **Throttle and pool occlusion query workflow**
   - Keep query object pooling, but run occlusion less frequently for stable/far chunks.
   - Skip occlusion for tiny/near chunks where cost > benefit.

7. **Queue discipline for world streaming**
   - Avoid repeated global sorts for generation queues.
   - Use ring/bucket priority by axial distance and camera forward bias.

8. **Decouple system cadences by frame budget**
   - Keep separate rates for stream/apply/visibility/culling and auto-tune based on EMA frame time.

## 3) Low risk quick wins

9. **Tighten allocation hygiene in visibility/meshing helpers**
   - Avoid short-lived Set/string allocations in greedy merge + visibility refresh loops.

10. **Review expensive renderer defaults per device profile**
   - Antialias, shadow map, and pixel ratio cap should remain profile-driven and adaptive.

## Suggested execution plan (short)

- **Phase A (1–2 days):** packed keys + incremental dirty apply + raycast broad-phase.
- **Phase B (2–4 days):** chunk-native render buffers/instancing migration.
- **Phase C (1–2 days):** occlusion/query cadence tuning + stream queue buckets.
- **Phase D (ongoing):** allocator cleanup and profile auto-scaling polish.

## What to measure after each phase

- P50/P95 frame time (ms)
- Main-thread time split: physics, streaming, visibility, rendering
- Draw calls and triangle count
- GC pause frequency and duration
- Chunk load stutter during movement

