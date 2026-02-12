// matrixLoyalty.js — Loyalty diffusion system using typed-array matrix
// Red-Black Gauss-Seidel: in-place iteration, no read buffer copy.
// Chunk-based skipping: sleeps interior chunks with no recent changes.

import { UNOWNED } from "./TerritoryMatrix.js";

/**
 * Tick the loyalty diffusion system.
 * Red-Black Gauss-Seidel: two sub-passes (even/odd checkerboard) reading
 * directly from the loyalty array. Eliminates the 64MB read buffer copy.
 *
 * @param {TerritoryMatrix} matrix
 * @param {object} cfg - loyalty config section
 * @param {Array} nations - gameState.nations array
 */
export function tickLoyaltyDiffusion(matrix, cfg, nations) {
  const {
    diffusionRate = 0.04,
    decayRate = 0.01,
    reinforcementRate = 0.02,
    cityBonus = 0.03,
    capitalBonus = 0.06,
    cityRadius = 10,
    capitalRadius = 15,
  } = cfg || {};

  const { width, height, size, ownership, loyalty, oceanMask } = matrix;
  const activeNations = matrix.nextNationSlot;

  // City bonus grids — cached and only rebuilt when cities change (version check)
  let cityBonusGrids = matrix._cityBonusGrids;
  if (matrix._cityBonusBuiltVersion !== matrix._cityBonusVersion) {
    cityBonusGrids.clear();
    for (const nation of nations) {
      if (nation.status === "defeated") continue;
      const nIdx = matrix.ownerToIndex.get(nation.owner);
      if (nIdx === undefined) continue;
      const cities = nation.cities || [];
      if (cities.length === 0) continue;

      let grid = null;
      for (const city of cities) {
        if (!matrix.inBounds(city.x, city.y)) continue;
        const isCapital = city.type === "capital";
        const radius = isCapital ? capitalRadius : cityRadius;
        const bonus = isCapital ? capitalBonus : cityBonus;
        const r2 = radius * radius;
        const minX = Math.max(0, city.x - radius);
        const maxX = Math.min(width - 1, city.x + radius);
        const minY = Math.max(0, city.y - radius);
        const maxY = Math.min(height - 1, city.y + radius);

        if (!grid) grid = new Float32Array(size);

        for (let cy = minY; cy <= maxY; cy++) {
          for (let cx = minX; cx <= maxX; cx++) {
            const dx = cx - city.x;
            const dy = cy - city.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > r2) continue;
            const falloff = 1 - Math.sqrt(d2) / radius;
            const ci = cy * width + cx;
            grid[ci] += bonus * falloff;
          }
        }
      }
      if (grid) cityBonusGrids.set(nIdx, grid);
    }
    matrix._cityBonusBuiltVersion = matrix._cityBonusVersion;
  }

  // ── Persistent bounding boxes from setOwnerByIndex + margin ──
  const BOUNDS_MARGIN = 16;
  const nationBounds = new Array(activeNations);
  for (let n = 0; n < activeNations; n++) {
    const bb = matrix.nationBBox[n];
    if (bb.maxX < 0) {
      nationBounds[n] = null;
      continue;
    }
    nationBounds[n] = {
      minX: Math.max(0, bb.minX - BOUNDS_MARGIN),
      maxX: Math.min(width - 1, bb.maxX + BOUNDS_MARGIN),
      minY: Math.max(0, bb.minY - BOUNDS_MARGIN),
      maxY: Math.min(height - 1, bb.maxY + BOUNDS_MARGIN),
    };
  }

  const diffRes = matrix.diffusionResistance;
  const { chunksX, chunkDirty, chunkHasBorder, chunkSleepCounter } = matrix;
  const SLEEP_THRESHOLD = 3;

  // ── Red-Black Gauss-Seidel: two sub-passes per nation ──
  for (let n = 0; n < activeNations; n++) {
    if (!matrix.indexToOwner[n]) continue;
    const b = nationBounds[n];
    if (!b) continue;

    const nOffset = n * size;
    const grid = cityBonusGrids.get(n);

    // Convert bbox to chunk coords
    const bbMinCX = b.minX >> 4;
    const bbMaxCX = Math.min((b.maxX >> 4), matrix.chunksX - 1);
    const bbMinCY = b.minY >> 4;
    const bbMaxCY = Math.min((b.maxY >> 4), matrix.chunksY - 1);

    // Two sub-passes: pass 0 = Red (x+y even), pass 1 = Black (x+y odd)
    for (let pass = 0; pass < 2; pass++) {
      for (let ccy = bbMinCY; ccy <= bbMaxCY; ccy++) {
        for (let ccx = bbMinCX; ccx <= bbMaxCX; ccx++) {
          const ci = ccy * chunksX + ccx;
          // Skip sleeping chunks
          if (!chunkDirty[ci] && !chunkHasBorder[ci] && chunkSleepCounter[ci] > SLEEP_THRESHOLD) continue;

          const x0 = ccx << 4;
          const y0 = ccy << 4;
          const x1 = Math.min(x0 + 16, width);
          const y1 = Math.min(y0 + 16, height);
          // Clamp to nation bounds
          const xStart = Math.max(x0, b.minX);
          const xEnd = Math.min(x1, b.maxX + 1);
          const yStart = Math.max(y0, b.minY);
          const yEnd = Math.min(y1, b.maxY + 1);

          for (let y = yStart; y < yEnd; y++) {
            // Red-Black: start x so that (x+y)%2 == pass
            let x = xStart + ((xStart + y + pass) & 1);
            for (; x < xEnd; x += 2) {
              const i = y * width + x;
              if (oceanMask[i] === 1) continue;

              const loyaltyIdx = nOffset + i;
              let newVal = loyalty[loyaltyIdx];
              const currentOwner = ownership[i];

              // 1. Reinforcement
              if (currentOwner === n) {
                newVal += reinforcementRate;
              }

              // 2. Decay
              if (currentOwner !== UNOWNED && currentOwner !== n) {
                newVal -= decayRate;
              }

              // 3. Diffusion from 4-neighbors (reads in-place — Red-Black safe)
              let neighborSum = 0;
              let neighborCount = 0;
              if (x > 0 && oceanMask[i - 1] !== 1) { neighborSum += loyalty[nOffset + i - 1]; neighborCount++; }
              if (x < width - 1 && oceanMask[i + 1] !== 1) { neighborSum += loyalty[nOffset + i + 1]; neighborCount++; }
              if (y > 0 && oceanMask[i - width] !== 1) { neighborSum += loyalty[nOffset + i - width]; neighborCount++; }
              if (y < height - 1 && oceanMask[i + width] !== 1) { neighborSum += loyalty[nOffset + i + width]; neighborCount++; }

              if (neighborCount > 0) {
                const avgNeighbor = neighborSum / neighborCount;
                const diff = avgNeighbor - newVal;
                const resistance = diffRes[i];
                newVal += diff * diffusionRate * (1 - resistance);
              }

              // 4. City/capital bonuses
              if (grid) {
                newVal += grid[i];
              }

              // Clamp 0-1
              loyalty[loyaltyIdx] = newVal > 1 ? 1 : (newVal < 0 ? 0 : newVal);
            }
          }
        }
      }
    }
  }
}

/**
 * Apply arrow pressure as loyalty gain for the attacking nation at frontier cells.
 * Called when an arrow is processing — instead of directly flipping ownership,
 * it increases the attacker's loyalty at the target cells.
 *
 * @param {TerritoryMatrix} matrix
 * @param {number} nationIdx - attacking nation index
 * @param {number} x - target cell x
 * @param {number} y - target cell y
 * @param {number} gain - loyalty gain amount
 */
export function applyArrowLoyaltyPressure(matrix, nationIdx, x, y, gain) {
  if (!matrix.inBounds(x, y)) return;
  matrix.addLoyalty(x, y, nationIdx, gain);

  // Also reduce the current owner's loyalty to make contested flips possible
  const cellIdx = matrix.idx(x, y);
  const currentOwner = matrix.ownership[cellIdx];
  if (currentOwner !== UNOWNED && currentOwner !== nationIdx) {
    matrix.addLoyalty(x, y, currentOwner, -gain * 0.5);
  }
}
