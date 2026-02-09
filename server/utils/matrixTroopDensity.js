// matrixTroopDensity.js — Troop density fluid simulation: mobilization, diffusion, combat

import { UNOWNED } from "./TerritoryMatrix.js";

const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];

/**
 * Tick mobilization: adjust nation.troopCount toward troopTarget * population.
 * Mobilization rate scales with free worker ratio.
 * Seeds density at capital if troopCount > 0 but density is zero everywhere.
 *
 * @param {TerritoryMatrix} matrix
 * @param {object} cfg - troopDensity config section
 * @param {Array} nations - gameState.nations array
 */
export function tickMobilization(matrix, cfg, nations) {
  const {
    mobilizationBaseRate = 0.05,
    mobilizationFreeWorkerScale = 1.5,
    demobilizationRate = 0.03,
    seedDensityAtCapital = 5.0,
  } = cfg || {};

  for (const nation of nations) {
    if (nation.status === "defeated") continue;
    const nIdx = matrix.ownerToIndex.get(nation.owner);
    if (nIdx === undefined) continue;

    const population = nation.population || 0;
    if (population <= 0) continue;

    // Initialize troopCount if missing
    if (nation.troopCount == null) nation.troopCount = 0;
    // troopTarget is a ratio 0-1 (e.g. 0.2 = 20% of pop as troops)
    if (nation.troopTarget == null) nation.troopTarget = 0.2;

    const targetTroops = nation.troopTarget * population;
    const currentTroops = nation.troopCount;

    if (currentTroops < targetTroops) {
      // Mobilize: recruit from free workers
      const freeWorkerRatio = Math.max(0, (population - currentTroops) / population);
      const mobilizeAmount = population * (mobilizationBaseRate / 10) * (1 + freeWorkerRatio * mobilizationFreeWorkerScale);
      nation.troopCount = Math.min(targetTroops, currentTroops + mobilizeAmount);
    } else if (currentTroops > targetTroops) {
      // Demobilize
      const demobAmount = currentTroops * (demobilizationRate / 10);
      nation.troopCount = Math.max(targetTroops, currentTroops - demobAmount);
    }

    // Clamp troopCount to population
    nation.troopCount = Math.min(nation.troopCount, population);
    nation.troopCount = Math.max(0, nation.troopCount);

    // Seed density if troopCount > 0 but density is near-zero.
    // Distribute uniformly across all owned cells so density is immediately
    // available at borders (instead of taking 50+ ticks to diffuse from capital).
    if (nation.troopCount > 0) {
      const offset = nIdx * matrix.size;
      let totalDensity = 0;
      for (let i = 0; i < matrix.size; i++) {
        totalDensity += matrix.troopDensity[offset + i];
      }
      if (totalDensity < nation.troopCount * 0.1) {
        // Count owned cells
        let ownedCount = 0;
        for (let i = 0; i < matrix.size; i++) {
          if (matrix.ownership[i] === nIdx) ownedCount++;
        }
        if (ownedCount > 0) {
          const densityPerCell = nation.troopCount / ownedCount;
          for (let i = 0; i < matrix.size; i++) {
            if (matrix.ownership[i] === nIdx) {
              matrix.troopDensity[offset + i] = densityPerCell;
            }
          }
        }
      }
    }
  }
}

/**
 * Tick troop density diffusion.
 * Diffuses troops across owned territory with border concentration bias
 * and arrow attractor fields. Enforces conservation: SUM(density) == troopCount.
 *
 * @param {TerritoryMatrix} matrix
 * @param {object} cfg - troopDensity config section
 * @param {Array} nations - gameState.nations array
 */
export function tickTroopDensityDiffusion(matrix, cfg, nations) {
  const {
    diffusionRate = 0.06,
    borderConcentrationBias = 2.5,
    arrowAttractorStrength = 4.0,
    arrowAttractorRadius = 10,
    maxDensityPerCell = 50.0,
    densityDecayOnUnowned = 0.95,
  } = cfg || {};

  const { width, height, size, ownership, oceanMask, diffusionResistance } = matrix;
  const troopDensity = matrix.troopDensity;
  const readBuffer = matrix.troopDensityReadBuffer;

  // Copy current density to read buffer
  readBuffer.set(troopDensity);

  // Pre-compute arrow attractor maps per nation
  const attractorMaps = new Map(); // nIdx -> [{cellIdx, strength}]
  for (const nation of nations) {
    if (nation.status === "defeated") continue;
    const nIdx = matrix.ownerToIndex.get(nation.owner);
    if (nIdx === undefined) continue;

    const attacks = nation.arrowOrders?.attacks || [];
    if (attacks.length === 0) continue;

    const fields = [];
    for (const arrow of attacks) {
      if (!arrow.headX && arrow.headX !== 0) continue;
      const hx = Math.round(arrow.headX);
      const hy = Math.round(arrow.headY);
      const percent = arrow.percent || arrow.troopCommitment || 0.25;
      const r = arrowAttractorRadius;
      const corridorHalf = arrow._corridorHalfWidth || 4;

      // Arrow forward direction: use path segment, not head-to-waypoint
      let aDirX = 0, aDirY = 1;
      if (arrow.path && arrow.path.length >= 2) {
        const ci = Math.min(arrow.currentIndex || 0, arrow.path.length - 1);
        const fromIdx = Math.max(0, ci - 1);
        const toIdx = Math.min(ci + 1, arrow.path.length - 1);
        const from = arrow.path[fromIdx];
        const to = arrow.path[toIdx];
        aDirX = to.x - from.x;
        aDirY = to.y - from.y;
        const dLen = Math.sqrt(aDirX * aDirX + aDirY * aDirY);
        if (dLen > 0.001) { aDirX /= dLen; aDirY /= dLen; }
      }

      const minX = Math.max(0, hx - r);
      const maxX = Math.min(width - 1, hx + r);
      const minY = Math.max(0, hy - r);
      const maxY = Math.min(height - 1, hy + r);

      for (let cy = minY; cy <= maxY; cy++) {
        for (let cx = minX; cx <= maxX; cx++) {
          const dx = cx - hx;
          const dy = cy - hy;

          // Corridor-shaped attractor: perpendicular distance limits width,
          // along-path distance limits depth. Concentrates density along the path.
          const perpDist = Math.abs(dy * aDirX - dx * aDirY);
          if (perpDist > corridorHalf * 1.5) continue; // wider than combat for smoother flow
          const alongDist = dx * aDirX + dy * aDirY;
          if (alongDist < -r * 0.3) continue; // don't pull from far behind

          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > r) continue;
          const distFalloff = 1 - dist / r;
          const corridorFalloff = Math.max(0.1, 1 - perpDist / (corridorHalf * 1.5));

          const strength = arrowAttractorStrength * distFalloff * corridorFalloff * percent;
          if (strength > 0.01) {
            fields.push({ cellIdx: cy * width + cx, strength });
          }
        }
      }
    }
    if (fields.length > 0) {
      attractorMaps.set(nIdx, fields);
    }
  }

  // Build per-nation running sums for conservation correction
  const nationSums = new Float64Array(matrix.maxNations);
  const nationTroopCounts = new Float64Array(matrix.maxNations);

  for (const nation of nations) {
    if (nation.status === "defeated") continue;
    const nIdx = matrix.ownerToIndex.get(nation.owner);
    if (nIdx === undefined) continue;
    nationTroopCounts[nIdx] = nation.troopCount || 0;
  }

  // Build attractor lookup: for each cell, sum attractor strength per nation
  // (sparse — only cells near arrow heads have values)
  const attractorByCell = new Map(); // nIdx -> Float32Array(size) — lazy
  for (const [nIdx, fields] of attractorMaps) {
    const arr = new Float32Array(size);
    for (const { cellIdx, strength } of fields) {
      arr[cellIdx] += strength;
    }
    attractorByCell.set(nIdx, arr);
  }

  // Single pass through all cells
  for (let i = 0; i < size; i++) {
    if (oceanMask[i] === 1) continue;

    const x = i % width;
    const y = (i - x) / width;
    const cellOwner = ownership[i];

    // Process each nation's density at this cell
    for (let nIdx = 0; nIdx < matrix.nextNationSlot; nIdx++) {
      if (matrix.indexToOwner[nIdx] === null) continue;

      const offset = nIdx * size + i;
      const current = readBuffer[offset];

      // Non-owned cells: decay density
      if (cellOwner !== nIdx) {
        if (current > 0) {
          troopDensity[offset] = current * densityDecayOnUnowned;
          nationSums[nIdx] += troopDensity[offset];
        }
        continue;
      }

      // Owned cell: diffuse
      let neighborSum = 0;
      let neighborCount = 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (oceanMask[ni] === 1) continue;
        // Only diffuse within owned territory
        if (ownership[ni] !== nIdx) continue;
        neighborSum += readBuffer[nIdx * size + ni];
        neighborCount++;
      }

      let target = current;
      if (neighborCount > 0) {
        const avgNeighbor = neighborSum / neighborCount;

        // Check if border cell (any non-owned 4-neighbor)
        let isBorder = false;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d];
          const ny = y + DY[d];
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            isBorder = true;
            break;
          }
          if (ownership[ny * width + nx] !== nIdx) {
            isBorder = true;
            break;
          }
        }

        const borderBias = isBorder ? borderConcentrationBias : 0;

        // Arrow attractor bias
        let attractorBias = 0;
        const attractorArr = attractorByCell.get(nIdx);
        if (attractorArr) {
          attractorBias = attractorArr[i];
        }

        target = avgNeighbor + borderBias + attractorBias;
      }

      const resistance = diffusionResistance[i] || 0;
      let newVal = current + (target - current) * diffusionRate * (1 - resistance);
      newVal = Math.max(0, Math.min(maxDensityPerCell, newVal));
      troopDensity[offset] = newVal;
      nationSums[nIdx] += newVal;
    }
  }

  // Conservation correction: scale density so SUM == troopCount
  for (let nIdx = 0; nIdx < matrix.nextNationSlot; nIdx++) {
    if (matrix.indexToOwner[nIdx] === null) continue;
    const targetSum = nationTroopCounts[nIdx];
    const actualSum = nationSums[nIdx];
    if (actualSum > 0.001 && targetSum > 0) {
      const scale = targetSum / actualSum;
      const offset = nIdx * size;
      for (let i = 0; i < size; i++) {
        troopDensity[offset + i] *= scale;
      }
    }
  }
}

/**
 * Resolve density-based combat for a single arrow.
 * Uses a narrow CORRIDOR along the arrow path (not a circle around the head)
 * to create a focused fountainhead push. Captured cells are seeded with density
 * so the arrow can continue advancing on subsequent ticks.
 *
 * @param {object} arrow - the attack arrow object
 * @param {object} nation - the attacking nation
 * @param {object} gameState - full game state
 * @param {Array} mapData - 2D map array
 * @param {Map} ownershipMap - string-key ownership map
 * @param {TerritoryMatrix} matrix
 * @param {object} cfg - troopDensity config section
 * @param {Function} addCell - function to add a cell to the nation
 * @param {Function} removeCellFromNation - function to remove a cell from target nation
 * @returns {number} number of cells flipped
 */
export function resolveDensityCombat(
  arrow, nation, gameState, mapData, ownershipMap, matrix, cfg, addCell, removeCellFromNation
) {
  const {
    combatExchangeRate = 0.3,
    combatDefenderAdvantage = 1.3,
    combatDensityThreshold = 0.1,
    arrowAttractorRadius = 10,
  } = cfg || {};

  const nIdx = matrix.ownerToIndex.get(nation.owner);
  if (nIdx === undefined) return 0;

  const { width, height, size, ownership, defenseStrength } = matrix;
  const troopDensity = matrix.troopDensity;

  const hx = Math.round(arrow.headX ?? 0);
  const hy = Math.round(arrow.headY ?? 0);

  // Corridor half-width: how many cells to each side of the arrow path
  // Narrow corridor creates focused push instead of parallel border push
  const corridorHalf = arrow._corridorHalfWidth || 4;

  // Arrow forward direction: use the PATH SEGMENT direction, not head-to-waypoint.
  // This is stable regardless of where the head actually is.
  let arrowDirX = 0, arrowDirY = 1;
  if (arrow.path && arrow.path.length >= 2) {
    const ci = Math.min(arrow.currentIndex || 0, arrow.path.length - 1);
    const fromIdx = Math.max(0, ci - 1);
    const toIdx = Math.min(ci + 1, arrow.path.length - 1);
    const from = arrow.path[fromIdx];
    const to = arrow.path[toIdx];
    arrowDirX = to.x - from.x;
    arrowDirY = to.y - from.y;
    const dirLen = Math.sqrt(arrowDirX * arrowDirX + arrowDirY * arrowDirY);
    if (dirLen > 0.001) { arrowDirX /= dirLen; arrowDirY /= dirLen; }
  }

  // Scan a bounding box around the head
  const scanR = arrowAttractorRadius;
  const minX = Math.max(0, hx - scanR);
  const maxX = Math.min(width - 1, hx + scanR);
  const minY = Math.max(0, hy - scanR);
  const maxY = Math.min(height - 1, hy + scanR);

  let flipped = 0;

  for (let cy = minY; cy <= maxY; cy++) {
    for (let cx = minX; cx <= maxX; cx++) {
      const dx = cx - hx;
      const dy = cy - hy;

      // Corridor check: perpendicular distance from arrow path line
      const perpDist = Math.abs(dy * arrowDirX - dx * arrowDirY);
      if (perpDist > corridorHalf) continue;

      // Along-path distance: positive = ahead of head, negative = behind
      const alongDist = dx * arrowDirX + dy * arrowDirY;
      if (alongDist < -2) continue; // skip cells behind the head
      if (alongDist > scanR) continue; // don't reach too far ahead

      const ci = cy * width + cx;
      const cellOwner = ownership[ci];

      if (cellOwner === nIdx) continue;
      if (matrix.oceanMask[ci] === 1) continue;

      // Check adjacency to our territory and gather attacker density
      let adjacentToUs = false;
      let attackerDensity = 0;
      let attackerCount = 0;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d];
        const ny = cy + DY[d];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (ownership[ni] === nIdx) {
          adjacentToUs = true;
          attackerDensity += troopDensity[nIdx * size + ni];
          attackerCount++;
        }
      }
      if (!adjacentToUs) continue;
      if (attackerCount > 0) attackerDensity /= attackerCount;

      // Corridor falloff: full attack at center of corridor, fading at edges
      const corridorFactor = Math.max(0.1, 1 - (perpDist / corridorHalf) * 0.8);
      const effectiveAttack = attackerDensity * corridorFactor;

      // Unowned cells: capture if enough effective attack
      if (cellOwner === UNOWNED) {
        if (effectiveAttack >= combatDensityThreshold) {
          addCell(cx, cy);
          // Seed density: troops occupy captured cell so front can keep advancing
          troopDensity[nIdx * size + ci] = attackerDensity * 0.3;
          flipped++;
        }
        continue;
      }

      // Enemy cells: density combat
      const defenderDensity = troopDensity[cellOwner * size + ci];
      // defenseStrength includes population density, troop density, and structures.
      // We do NOT use it as a multiplier on defenderDensity (that would double-count
      // troop density). Instead extract a small terrain/structure bonus from it.
      // Base defenseStrength is ~1.0 + popDens*0.5 + troopDens*0.8 + structures.
      // Strip out the troop density contribution to avoid double-counting.
      const rawDefense = defenseStrength[ci] || 1.0;
      // Terrain/structure modifier: defenseStrength minus the troop density component
      // Clamp to [1.0, 3.0] so structures help but don't make cells invincible
      const defenderTroopComponent = defenderDensity * (cfg.troopDefenseScale || 0.8);
      const terrainMod = Math.max(1.0, Math.min(3.0, rawDefense - defenderTroopComponent));
      const effectiveDefense = defenderDensity * combatDefenderAdvantage * terrainMod;

      if (effectiveAttack < combatDensityThreshold && defenderDensity < combatDensityThreshold) {
        continue;
      }

      if (effectiveAttack > effectiveDefense) {
        // Flip cell
        const defenderLoss = defenderDensity * combatExchangeRate;
        const attackerLoss = defenderDensity * combatExchangeRate * 0.5;

        // Apply losses to defender
        const defenderOwner = matrix.getOwnerByIndex(cellOwner);
        const defenderNation = gameState.nations.find(n => n.owner === defenderOwner);
        if (defenderNation) {
          troopDensity[cellOwner * size + ci] = Math.max(0, defenderDensity - defenderLoss);
          defenderNation.troopCount = Math.max(0, (defenderNation.troopCount || 0) - defenderLoss);
          defenderNation.population = Math.max(0, (defenderNation.population || 0) - defenderLoss);
          removeCellFromNation(defenderNation, cx, cy);
        }

        // Apply losses to attacker (spread across adjacent cells)
        if (attackerCount > 0) {
          const lossPerCell = attackerLoss / attackerCount;
          for (let d = 0; d < 4; d++) {
            const nx = cx + DX[d];
            const ny = cy + DY[d];
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const ni = ny * width + nx;
            if (ownership[ni] === nIdx) {
              troopDensity[nIdx * size + ni] = Math.max(0, troopDensity[nIdx * size + ni] - lossPerCell);
            }
          }
          nation.troopCount = Math.max(0, (nation.troopCount || 0) - attackerLoss);
          nation.population = Math.max(0, (nation.population || 0) - attackerLoss);
        }

        // Transfer ownership + seed density so front keeps advancing
        addCell(cx, cy);
        troopDensity[nIdx * size + ci] = attackerDensity * 0.3;
        flipped++;
      } else {
        // Attrition: both sides lose a small amount
        const minDensity = Math.min(effectiveAttack, defenderDensity);
        const attritionLoss = minDensity * combatExchangeRate * 0.2;

        if (attritionLoss > 0.001) {
          troopDensity[cellOwner * size + ci] = Math.max(0, troopDensity[cellOwner * size + ci] - attritionLoss);
          const defenderOwner = matrix.getOwnerByIndex(cellOwner);
          const defenderNation = gameState.nations.find(n => n.owner === defenderOwner);
          if (defenderNation) {
            defenderNation.troopCount = Math.max(0, (defenderNation.troopCount || 0) - attritionLoss);
            defenderNation.population = Math.max(0, (defenderNation.population || 0) - attritionLoss);
          }

          if (attackerCount > 0) {
            const lossPerCell = attritionLoss / attackerCount;
            for (let d = 0; d < 4; d++) {
              const nx = cx + DX[d];
              const ny = cy + DY[d];
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
              const ni = ny * width + nx;
              if (ownership[ni] === nIdx) {
                troopDensity[nIdx * size + ni] = Math.max(0, troopDensity[nIdx * size + ni] - lossPerCell);
              }
            }
            nation.troopCount = Math.max(0, (nation.troopCount || 0) - attritionLoss);
            nation.population = Math.max(0, (nation.population || 0) - attritionLoss);
          }
        }
      }
    }
  }

  if (process.env.DEBUG_TROOP_DENSITY === "true" || flipped > 0) {
    console.log(`[DENSITY-COMBAT] ${nation.owner} head=(${hx},${hy}) corridor=${corridorHalf} flipped=${flipped} troopCount=${Math.round(nation.troopCount || 0)}`);
  }

  return flipped;
}

/**
 * Build compact troop density payload for client transmission.
 * Returns flat array [x0, y0, density0, x1, y1, density1, ...] for cells above threshold.
 * Density is quantized to uint8 (0-255).
 *
 * @param {TerritoryMatrix} matrix
 * @param {number} nIdx - nation index
 * @param {number} maxDensity - max density for normalization (default 50)
 * @param {number} threshold - minimum density to include (default 0.1)
 * @returns {number[]} flat array of [x, y, quantizedDensity, ...]
 */
export function buildTroopDensityPayload(matrix, nIdx, maxDensity = 50, threshold = 0.1) {
  const { width, size, ownership } = matrix;
  const troopDensity = matrix.troopDensity;
  const offset = nIdx * size;

  // Compute average density. Only show cells significantly above average
  // to highlight concentration points (borders, arrow heads) rather than
  // coloring the entire territory uniformly.
  let totalDensity = 0;
  let ownedCount = 0;
  for (let i = 0; i < size; i++) {
    if (ownership[i] !== nIdx) continue;
    totalDensity += troopDensity[offset + i];
    ownedCount++;
  }
  const avgDensity = ownedCount > 0 ? totalDensity / ownedCount : 0;
  // Require cells to be 2x the average to show up — prevents uniform coloring
  const effectiveThreshold = Math.max(threshold, avgDensity * 2.0);
  // Scale range: avgDensity*2 maps to 0, maxDensity maps to 255
  const rangeBottom = effectiveThreshold;
  const rangeTop = Math.max(rangeBottom + 1, maxDensity);

  const result = [];
  for (let i = 0; i < size; i++) {
    if (ownership[i] !== nIdx) continue;
    const density = troopDensity[offset + i];
    if (density < effectiveThreshold) continue;
    const x = i % width;
    const y = (i - x) / width;
    // Coarse quantization (32 levels) to prevent flicker from small oscillations
    const normalized = (density - rangeBottom) / (rangeTop - rangeBottom);
    const quantized = Math.min(255, Math.max(1, Math.round(normalized * 32) * 8));
    result.push(x, y, quantized);
  }

  return result;
}
