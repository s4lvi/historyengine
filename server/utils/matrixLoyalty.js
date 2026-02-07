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

  // Double buffer: copy current loyalty to read from
  const readBuffer = new Float32Array(loyalty.length);
  readBuffer.set(loyalty);

  // Pre-compute city/capital positions per nation index
  const cityInfoByNIdx = new Map();
  for (const nation of nations) {
    if (nation.status === "defeated") continue;
    const nIdx = matrix.ownerToIndex.get(nation.owner);
    if (nIdx === undefined) continue;
    const cities = [];
    for (const city of nation.cities || []) {
      if (!matrix.inBounds(city.x, city.y)) continue;
      cities.push({
        x: city.x,
        y: city.y,
        isCapital: city.type === "capital",
      });
    }
    cityInfoByNIdx.set(nIdx, cities);
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

      // 4. City/capital bonuses with distance falloff
      const cities = cityInfoByNIdx.get(n);
      if (cities) {
        for (const city of cities) {
          const dist = Math.hypot(x - city.x, y - city.y);
          const radius = city.isCapital ? capitalRadius : cityRadius;
          const bonus = city.isCapital ? capitalBonus : cityBonus;
          if (dist <= radius) {
            const falloff = 1 - dist / radius;
            newVal += bonus * falloff;
          }
        }
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
}
