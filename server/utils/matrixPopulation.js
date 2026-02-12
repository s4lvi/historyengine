// matrixPopulation.js — Population density diffusion + defense strength computation
// Red-Black Gauss-Seidel: in-place iteration, no read buffer copy.
// Chunk-based skipping: sleeps interior chunks with no recent changes.

import { UNOWNED } from "./TerritoryMatrix.js";

/**
 * Tick population density diffusion.
 * Red-Black Gauss-Seidel with chunk-based active cell tracking.
 * Heat-equation diffusion from cities outward with natural decay.
 *
 * @param {TerritoryMatrix} matrix
 * @param {object} cfg - populationDensity config section
 * @param {Array} nations - gameState.nations array
 */
export function tickPopulationDensity(matrix, cfg, nations, regionData = null, regionCfg = null) {
  const {
    diffusionRate = 0.05,
    decayRate = 0.02,
    citySource = 0.5,
    capitalSource = 1.0,
  } = cfg || {};

  const { width, height, size, ownership, populationDensity, oceanMask } = matrix;

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

  // Pre-compute region-based city density boost map
  let cityRegionSet = null;
  const cityDensityMult = regionCfg?.cityDensityMultiplier || 1.0;
  if (regionData && cityDensityMult > 1.0) {
    cityRegionSet = new Set();
    for (const nation of nations) {
      if (nation.status === "defeated") continue;
      const nIdx = matrix.ownerToIndex.get(nation.owner);
      if (nIdx === undefined) continue;
      for (const city of nation.cities || []) {
        if (city.type !== "town" && city.type !== "capital") continue;
        if (!matrix.inBounds(city.x, city.y)) continue;
        const rId = regionData.assignment[city.y * width + city.x];
        if (rId !== 65535) {
          cityRegionSet.add((nIdx << 16) | rId);
        }
      }
    }
  }

  const { chunksX, chunkDirty, chunkHasBorder, chunkSleepCounter } = matrix;
  const SLEEP_THRESHOLD = 3;

  // Red-Black Gauss-Seidel: two sub-passes, in-place, no read buffer
  for (let pass = 0; pass < 2; pass++) {
    for (let ccy = 0; ccy < matrix.chunksY; ccy++) {
      for (let ccx = 0; ccx < chunksX; ccx++) {
        const ci = ccy * chunksX + ccx;
        if (!chunkDirty[ci] && !chunkHasBorder[ci] && chunkSleepCounter[ci] > SLEEP_THRESHOLD) continue;

        const x0 = ccx << 4;
        const y0 = ccy << 4;
        const x1 = Math.min(x0 + 16, width);
        const y1 = Math.min(y0 + 16, height);

        for (let y = y0; y < y1; y++) {
          let x = x0 + ((x0 + y + pass) & 1);
          for (; x < x1; x += 2) {
            const i = y * width + x;
            if (oceanMask[i] === 1) continue;

            // Diffusion from 4-neighbors (in-place reads — Red-Black safe)
            let neighborSum = 0;
            let neighborCount = 0;
            if (x > 0 && oceanMask[i - 1] !== 1) { neighborSum += populationDensity[i - 1]; neighborCount++; }
            if (x < width - 1 && oceanMask[i + 1] !== 1) { neighborSum += populationDensity[i + 1]; neighborCount++; }
            if (y > 0 && oceanMask[i - width] !== 1) { neighborSum += populationDensity[i - width]; neighborCount++; }
            if (y < height - 1 && oceanMask[i + width] !== 1) { neighborSum += populationDensity[i + width]; neighborCount++; }

            let newVal = populationDensity[i];

            // Diffusion — boosted in regions with cities
            let effectiveDiffRate = diffusionRate;
            if (cityRegionSet && cityRegionSet.size > 0) {
              const ownerIdx = ownership[i];
              if (ownerIdx !== UNOWNED) {
                const rId = regionData.assignment[i];
                if (rId !== 65535 && cityRegionSet.has((ownerIdx << 16) | rId)) {
                  effectiveDiffRate *= cityDensityMult;
                }
              }
            }

            if (neighborCount > 0) {
              const avgNeighbor = neighborSum / neighborCount;
              newVal += (avgNeighbor - newVal) * effectiveDiffRate;
            }

            // Natural decay
            newVal -= newVal * decayRate;

            populationDensity[i] = newVal > 0 ? newVal : 0;
          }
        }
      }
    }
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
export function computeDefenseStrength(matrix, nations, structureConfig, densityDefenseScale = 0.5, troopDefenseScale = 0, regionData = null, regionCfg = null) {
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
        bonusMult = (towerConfig.troopLossMultiplier || 6.0) * 0.1;
      } else if (city.type === "town" || city.type === "capital") {
        radius = townConfig.defenseRadius || 20;
        bonusMult = (townConfig.troopLossMultiplier || 3.0) * 0.1;
      } else {
        continue;
      }

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

          const falloff = 1 - d2 / r2;
          defenseStrength[ci] += bonusMult * falloff;
        }
      }
    }
  }

  // Region-based tower defense bonus
  if (regionData && regionCfg?.towerDefenseBonus) {
    const towerBonusTiers = regionCfg.towerDefenseBonus;
    const assignment = regionData.assignment;

    const regionTowerCount = new Map();
    for (const nation of nations) {
      if (nation.status === "defeated") continue;
      const nIdx = matrix.ownerToIndex.get(nation.owner);
      if (nIdx === undefined) continue;
      for (const city of nation.cities || []) {
        if (city.type !== "tower") continue;
        if (!matrix.inBounds(city.x, city.y)) continue;
        const rId = assignment[city.y * width + city.x];
        if (rId === 65535) continue;
        const key = (nIdx << 16) | rId;
        regionTowerCount.set(key, (regionTowerCount.get(key) || 0) + 1);
      }
    }

    if (regionTowerCount.size > 0) {
      const regionBonus = new Map();
      for (const [key, count] of regionTowerCount) {
        let bonus = 0;
        for (let t = 0; t < Math.min(count, towerBonusTiers.length); t++) {
          bonus += towerBonusTiers[t];
        }
        regionBonus.set(key, bonus);
      }

      for (let i = 0; i < size; i++) {
        if (oceanMask[i] === 1) continue;
        const ownerIdx = ownership[i];
        if (ownerIdx === UNOWNED) continue;
        const rId = assignment[i];
        if (rId === 65535) continue;
        const bonus = regionBonus.get((ownerIdx << 16) | rId);
        if (bonus) {
          defenseStrength[i] *= (1 + bonus);
        }
      }
    }
  }
}
