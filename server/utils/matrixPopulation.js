// matrixPopulation.js — Population density diffusion + defense strength computation

import { UNOWNED } from "./TerritoryMatrix.js";

const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];

/**
 * Tick population density diffusion.
 * Heat-equation diffusion from cities outward with natural decay.
 *
 * @param {TerritoryMatrix} matrix
 * @param {object} cfg - populationDensity config section
 * @param {Array} nations - gameState.nations array
 */
export function tickPopulationDensity(matrix, cfg, nations) {
  const {
    diffusionRate = 0.05,
    decayRate = 0.02,
    citySource = 0.5,
    capitalSource = 1.0,
  } = cfg || {};

  const { width, height, size, ownership, populationDensity, oceanMask } = matrix;

  // Double buffer
  const readBuffer = new Float32Array(size);
  readBuffer.set(populationDensity);

  // Pre-compute city positions per nation index
  const cityPositions = [];
  for (const nation of nations) {
    if (nation.status === "defeated") continue;
    const nIdx = matrix.ownerToIndex.get(nation.owner);
    if (nIdx === undefined) continue;
    for (const city of nation.cities || []) {
      if (!matrix.inBounds(city.x, city.y)) continue;
      cityPositions.push({
        idx: matrix.idx(city.x, city.y),
        nIdx,
        isCapital: city.type === "capital",
      });
    }
  }

  for (let i = 0; i < size; i++) {
    if (oceanMask[i] === 1) continue;

    const x = i % width;
    const y = (i - x) / width;

    // Diffusion from neighbors
    let neighborSum = 0;
    let neighborCount = 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (oceanMask[ni] === 1) continue;
      neighborSum += readBuffer[ni];
      neighborCount++;
    }

    let newVal = readBuffer[i];

    // Diffusion
    if (neighborCount > 0) {
      const avgNeighbor = neighborSum / neighborCount;
      newVal += (avgNeighbor - newVal) * diffusionRate;
    }

    // Natural decay
    newVal -= newVal * decayRate;

    populationDensity[i] = Math.max(0, newVal);
  }

  // Apply source terms at city locations
  for (const city of cityPositions) {
    if (ownership[city.idx] === city.nIdx) {
      const source = city.isCapital ? capitalSource : citySource;
      populationDensity[city.idx] = Math.min(
        10, // cap density
        populationDensity[city.idx] + source
      );
    }
  }
}

/**
 * Compute defense strength from population density + structure bonuses.
 *
 * @param {TerritoryMatrix} matrix
 * @param {Array} nations - gameState.nations array
 * @param {object} structureConfig - config.structures
 * @param {number} densityDefenseScale - config.populationDensity.densityDefenseScale
 */
export function computeDefenseStrength(matrix, nations, structureConfig, densityDefenseScale = 0.5, troopDefenseScale = 0) {
  const { width, height, size, ownership, populationDensity, defenseStrength, oceanMask } = matrix;

  const townConfig = structureConfig?.town || { defenseRadius: 20 };
  const towerConfig = structureConfig?.tower || { defenseRadius: 40 };

  // Reset defense
  for (let i = 0; i < size; i++) {
    if (oceanMask[i] === 1) continue;
    // Base defense = 1.0 + population density contribution
    let defense = 1.0 + populationDensity[i] * densityDefenseScale;

    // Add troop density contribution (per owning nation)
    if (troopDefenseScale > 0) {
      const ownerIdx = ownership[i];
      if (ownerIdx >= 0 && ownerIdx < matrix.maxNations && matrix.indexToOwner[ownerIdx] !== null) {
        defense += matrix.troopDensity[ownerIdx * size + i] * troopDefenseScale;
      }
    }

    defenseStrength[i] = defense;
  }

  // Apply structure bonuses
  for (const nation of nations) {
    if (nation.status === "defeated") continue;
    const nIdx = matrix.ownerToIndex.get(nation.owner);
    if (nIdx === undefined) continue;

    for (const city of nation.cities || []) {
      if (!matrix.inBounds(city.x, city.y)) continue;

      let radius, bonusMult;
      if (city.type === "tower") {
        radius = towerConfig.defenseRadius || 40;
        bonusMult = (towerConfig.troopLossMultiplier || 6.0) * 0.1; // Scale down for additive bonus
      } else if (city.type === "town" || city.type === "capital") {
        radius = townConfig.defenseRadius || 20;
        bonusMult = (townConfig.troopLossMultiplier || 3.0) * 0.1;
      } else {
        continue;
      }

      // Apply bonus within radius with distance falloff
      const r2 = radius * radius;
      const minX = Math.max(0, city.x - radius);
      const maxX = Math.min(width - 1, city.x + radius);
      const minY = Math.max(0, city.y - radius);
      const maxY = Math.min(height - 1, city.y + radius);

      for (let cy = minY; cy <= maxY; cy++) {
        for (let cx = minX; cx <= maxX; cx++) {
          const dx = cx - city.x;
          const dy = cy - city.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;

          const ci = cy * width + cx;
          if (ownership[ci] !== nIdx) continue;

          const falloff = 1 - d2 / r2; // quadratic falloff, avoids sqrt per cell
          defenseStrength[ci] += bonusMult * falloff;
        }
      }
    }
  }
}
