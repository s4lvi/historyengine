// regionGenerator.js — Poisson-disc seeds + BFS Voronoi + smoothing
// Generates map regions (provinces) for the economy system

import { randFromSeed } from "./resourceManagement.js";

/**
 * Generate regions for a map using Poisson-disc seed placement + BFS Voronoi partitioning.
 *
 * @param {Array<Array>} mapData - 2D array of cell objects with .biome
 * @param {number} width
 * @param {number} height
 * @param {number} seed
 * @param {object} regionCfg - config.regions section
 * @returns {{ seeds: Array<{id,x,y}>, assignment: Uint16Array, regionCount: number }}
 */
export function generateRegions(mapData, width, height, seed, regionCfg = {}) {
  const {
    targetSpacing = 25,
    mountainBarrierCost = 3,
    riverBarrierCost = 2,
    smoothingPasses = 2,
  } = regionCfg;

  // --- Step 1: Generate seed points on a jittered grid, skip ocean ---
  const seeds = [];
  let regionId = 0;
  const gridCols = Math.ceil(width / targetSpacing);
  const gridRows = Math.ceil(height / targetSpacing);

  for (let gy = 0; gy < gridRows; gy++) {
    for (let gx = 0; gx < gridCols; gx++) {
      const cx = Math.floor(gx * targetSpacing + targetSpacing / 2);
      const cy = Math.floor(gy * targetSpacing + targetSpacing / 2);

      // Jitter by +/-10 cells using deterministic RNG
      const jx = Math.round((randFromSeed(seed, gx, gy, 100) - 0.5) * 20);
      const jy = Math.round((randFromSeed(seed, gx, gy, 101) - 0.5) * 20);

      const sx = Math.max(0, Math.min(width - 1, cx + jx));
      const sy = Math.max(0, Math.min(height - 1, cy + jy));

      // Skip ocean cells
      const cell = mapData[sy] && mapData[sy][sx];
      if (!cell || cell.biome === "OCEAN") continue;

      seeds.push({ id: regionId, x: sx, y: sy });
      regionId++;
    }
  }

  if (seeds.length === 0) {
    return { seeds: [], assignment: new Uint16Array(width * height), regionCount: 0 };
  }

  // --- Step 2: Multi-source BFS (Dijkstra-style with terrain costs) ---
  const UNASSIGNED = 65535;
  const assignment = new Uint16Array(width * height).fill(UNASSIGNED);
  const dist = new Float32Array(width * height).fill(Infinity);

  // Simple binary heap priority queue
  const heap = [];
  function heapPush(cost, idx) {
    heap.push({ cost, idx });
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].cost <= heap[i].cost) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  }
  function heapPop() {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      while (true) {
        let smallest = i;
        const l = 2 * i + 1, r = 2 * i + 2;
        if (l < heap.length && heap[l].cost < heap[smallest].cost) smallest = l;
        if (r < heap.length && heap[r].cost < heap[smallest].cost) smallest = r;
        if (smallest === i) break;
        [heap[smallest], heap[i]] = [heap[i], heap[smallest]];
        i = smallest;
      }
    }
    return top;
  }

  // Initialize seeds
  for (const s of seeds) {
    const idx = s.y * width + s.x;
    assignment[idx] = s.id;
    dist[idx] = 0;
    heapPush(0, idx);
  }

  const DX = [1, -1, 0, 0];
  const DY = [0, 0, 1, -1];

  while (heap.length > 0) {
    const { cost, idx } = heapPop();

    // Skip if already visited with a lower cost
    if (cost > dist[idx]) continue;

    const x = idx % width;
    const y = (idx - x) / width;
    const srcRegion = assignment[idx];

    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

      const ni = ny * width + nx;
      const cell = mapData[ny] && mapData[ny][nx];
      if (!cell) continue;

      // Ocean is impassable
      if (cell.biome === "OCEAN") continue;

      // Compute edge cost
      let edgeCost = 1;
      if (cell.biome === "MOUNTAIN") edgeCost += mountainBarrierCost;
      if (cell.biome === "RIVER" || cell.isRiver) edgeCost += riverBarrierCost;

      const newDist = cost + edgeCost;
      if (newDist < dist[ni]) {
        dist[ni] = newDist;
        assignment[ni] = srcRegion;
        heapPush(newDist, ni);
      }
    }
  }

  // --- Step 3: Smoothing passes (majority-vote) ---
  for (let pass = 0; pass < smoothingPasses; pass++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (assignment[idx] === UNASSIGNED) continue;

        const myRegion = assignment[idx];
        let diffCount = 0;

        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d];
          const ny = y + DY[d];
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          if (assignment[ni] !== UNASSIGNED && assignment[ni] !== myRegion) {
            diffCount++;
          }
        }

        // If 3+ of 4 cardinal neighbors are different, reassign to most common neighbor
        if (diffCount >= 3) {
          const counts = new Map();
          for (let d = 0; d < 4; d++) {
            const nx = x + DX[d];
            const ny = y + DY[d];
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const ni = ny * width + nx;
            if (assignment[ni] !== UNASSIGNED) {
              counts.set(assignment[ni], (counts.get(assignment[ni]) || 0) + 1);
            }
          }
          let bestRegion = myRegion;
          let bestCount = 0;
          for (const [r, c] of counts) {
            if (c > bestCount) {
              bestCount = c;
              bestRegion = r;
            }
          }
          assignment[idx] = bestRegion;
        }
      }
    }
  }

  return { seeds, assignment, regionCount: seeds.length };
}

/**
 * Get the region ID for a cell.
 * @param {Uint16Array} assignment
 * @param {number} width
 * @param {number} x
 * @param {number} y
 * @returns {number} regionId (65535 = unassigned/ocean)
 */
export function getRegionForCell(assignment, width, x, y) {
  return assignment[y * width + x];
}
