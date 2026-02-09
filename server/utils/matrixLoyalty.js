// matrixLoyalty.js — Loyalty diffusion system using typed-array matrix
// Replaces the old loyaltySystem.js with a proper diffusion model

import { UNOWNED } from "./TerritoryMatrix.js";

const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];

/**
 * Tick the loyalty diffusion system.
 * Double-buffered: reads from current loyalty, writes to new buffer, then commits.
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

  const { width, height, size, maxNations, ownership, loyalty, oceanMask } = matrix;
  const activeNations = matrix.nextNationSlot;

  // Reuse pre-allocated loyalty read buffer instead of allocating per tick
  const readBuffer = matrix.loyaltyReadBuffer;
  readBuffer.set(loyalty);

  // Pre-rasterize per-nation city bonus grids (O(nations * city_area) total)
  const cityBonusGrids = new Map(); // nIdx -> Float32Array(size)
  for (const nation of nations) {
    if (nation.status === "defeated") continue;
    const nIdx = matrix.ownerToIndex.get(nation.owner);
    if (nIdx === undefined) continue;
    const cities = nation.cities || [];
    if (cities.length === 0) continue;

    let grid = null; // lazy-allocate only if nation has valid cities
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

  for (let i = 0; i < size; i++) {
    if (oceanMask[i] === 1) continue;

    const x = i % width;
    const y = (i - x) / width;
    const currentOwner = ownership[i];

    for (let n = 0; n < activeNations; n++) {
      if (!matrix.indexToOwner[n]) continue;

      const loyaltyIdx = n * size + i;
      let newVal = readBuffer[loyaltyIdx];

      // 1. Reinforcement: owned cells gain loyalty for their owner
      if (currentOwner === n) {
        newVal += reinforcementRate;
      }

      // 2. Decay: non-owner loyalty decays
      if (currentOwner !== UNOWNED && currentOwner !== n) {
        newVal -= decayRate;
      }

      // 3. Diffusion from 4-neighbors
      let neighborSum = 0;
      let neighborCount = 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (oceanMask[ni] === 1) continue;
        neighborSum += readBuffer[n * size + ni];
        neighborCount++;
      }

      if (neighborCount > 0) {
        const avgNeighbor = neighborSum / neighborCount;
        const diff = avgNeighbor - newVal;
        const resistance = matrix.diffusionResistance ? matrix.diffusionResistance[i] : 0;
        newVal += diff * diffusionRate * (1 - resistance);
      }

      // 4. City/capital bonuses — O(1) lookup from pre-rasterized grid
      const grid = cityBonusGrids.get(n);
      if (grid) {
        newVal += grid[i];
      }

      // Clamp 0-1
      loyalty[loyaltyIdx] = Math.max(0, Math.min(1, newVal));
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
