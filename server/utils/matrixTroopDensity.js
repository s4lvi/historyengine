// matrixTroopDensity.js — Troop density fluid simulation: mobilization, diffusion, combat
// Red-Black Gauss-Seidel: in-place iteration, no read buffer copy.
// Chunk skipping for diffusion; conservation sums use separate full-bbox pass.

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
      const freeWorkerRatio = Math.max(
        0,
        (population - currentTroops) / population,
      );
      const mobilizeAmount =
        population *
        (mobilizationBaseRate / 10) *
        (1 + freeWorkerRatio * mobilizationFreeWorkerScale);
      nation.troopCount = Math.min(
        targetTroops,
        currentTroops + mobilizeAmount,
      );
    } else if (currentTroops > targetTroops) {
      // Demobilize
      const demobAmount = currentTroops * (demobilizationRate / 10);
      nation.troopCount = Math.max(targetTroops, currentTroops - demobAmount);
    }

    // Clamp troopCount to population
    nation.troopCount = Math.min(nation.troopCount, population);
    nation.troopCount = Math.max(0, nation.troopCount);

    // Seed density if troopCount > 0 but density is near-zero.
    // Uses running counters for O(1) aggregate queries.
    if (nation.troopCount > 0) {
      const ownedCount = matrix.ownedCellCount[nIdx];
      const totalDensity = matrix.troopDensitySum[nIdx];
      if (totalDensity < nation.troopCount * 0.1 && ownedCount > 0) {
        const densityPerCell = nation.troopCount / ownedCount;
        const offset = nIdx * matrix.size;
        // Only seed within bounding box
        const bb = matrix.nationBBox[nIdx];
        if (bb.maxX >= 0) {
          for (let y = bb.minY; y <= bb.maxY; y++) {
            for (let x = bb.minX; x <= bb.maxX; x++) {
              const i = y * matrix.width + x;
              if (matrix.ownership[i] === nIdx) {
                matrix.troopDensity[offset + i] = densityPerCell;
              }
            }
          }
        }
      }
    }
  }
}

/**
 * Tick troop density diffusion.
 * Red-Black Gauss-Seidel: in-place iteration with chunk-based skipping.
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
    diffusionSubSteps = 1,
    borderConcentrationBias = 2.5,
    arrowAttractorStrength = 4.0,
    arrowAttractorRadius = 10,
    maxDensityPerCell = 50.0,
    densityDecayOnUnowned = 0.95,
  } = cfg || {};

  const { width, height, size, ownership, oceanMask, diffusionResistance } =
    matrix;
  const troopDensity = matrix.troopDensity;
  const activeNations = matrix.nextNationSlot;

  // ── Persistent bounding boxes from setOwnerByIndex + margin ──
  const BOUNDS_MARGIN = 12;
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

  // Pre-compute arrow attractor maps per nation + expand bounds to include arrow heads
  const attractorMaps = new Map(); // nIdx -> [{cellIdx, strength}]
  for (const nation of nations) {
    if (nation.status === "defeated") continue;
    const nIdx = matrix.ownerToIndex.get(nation.owner);
    if (nIdx === undefined) continue;

    const attacks = nation.arrowOrders?.attacks || [];
    if (attacks.length === 0) continue;

    const b = nationBounds[nIdx];
    if (!b) continue;
    const fields = [];
    for (const arrow of attacks) {
      if (!arrow.headX && arrow.headX !== 0) continue;
      const hx = Math.round(arrow.headX);
      const hy = Math.round(arrow.headY);
      const percent = arrow.percent || arrow.troopCommitment || 0.25;
      const r = arrowAttractorRadius;
      const corridorHalf = arrow._corridorHalfWidth || 4;

      // Expand bounding box to include arrow head
      if (hx - r < b.minX) b.minX = Math.max(0, hx - r);
      if (hx + r > b.maxX) b.maxX = Math.min(width - 1, hx + r);
      if (hy - r < b.minY) b.minY = Math.max(0, hy - r);
      if (hy + r > b.maxY) b.maxY = Math.min(height - 1, hy + r);

      // Arrow forward direction
      let aDirX = 0,
        aDirY = 1;
      if (arrow.path && arrow.path.length >= 2) {
        const ci = Math.min(arrow.currentIndex || 0, arrow.path.length - 1);
        const fromIdx = Math.max(0, ci - 1);
        const toIdx = Math.min(ci + 1, arrow.path.length - 1);
        const from = arrow.path[fromIdx];
        const to = arrow.path[toIdx];
        aDirX = to.x - from.x;
        aDirY = to.y - from.y;
        const dLen = Math.sqrt(aDirX * aDirX + aDirY * aDirY);
        if (dLen > 0.001) {
          aDirX /= dLen;
          aDirY /= dLen;
        }
      }

      const aMinX = Math.max(0, hx - r);
      const aMaxX = Math.min(width - 1, hx + r);
      const aMinY = Math.max(0, hy - r);
      const aMaxY = Math.min(height - 1, hy + r);

      for (let cy = aMinY; cy <= aMaxY; cy++) {
        for (let cx = aMinX; cx <= aMaxX; cx++) {
          const dx = cx - hx;
          const dy = cy - hy;

          const perpDist = Math.abs(dy * aDirX - dx * aDirY);
          if (perpDist > corridorHalf * 1.5) continue;
          const alongDist = dx * aDirX + dy * aDirY;
          if (alongDist < -r * 0.3) continue;

          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > r) continue;
          const distFalloff = 1 - dist / r;
          const corridorFalloff = Math.max(
            0.1,
            1 - perpDist / (corridorHalf * 1.5),
          );

          const strength =
            arrowAttractorStrength * distFalloff * corridorFalloff * percent;
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

  // Build per-nation troop counts for conservation correction
  const nationTroopCounts = new Float64Array(matrix.maxNations);

  for (const nation of nations) {
    if (nation.status === "defeated") continue;
    const nIdx = matrix.ownerToIndex.get(nation.owner);
    if (nIdx === undefined) continue;
    nationTroopCounts[nIdx] = nation.troopCount || 0;
  }

  // Build attractor lookup: for each cell, sum attractor strength per nation
  const attractorByCell = new Map();
  for (const [nIdx, fields] of attractorMaps) {
    const arr = new Float32Array(size);
    for (const { cellIdx, strength } of fields) {
      arr[cellIdx] += strength;
    }
    attractorByCell.set(nIdx, arr);
  }

  // ── Red-Black Gauss-Seidel with chunk skipping + sub-stepping ──
  // Chunk skipping sleeps deep-interior chunks for diffusion performance.
  // Conservation sums are computed in a separate full-bbox pass for correctness.
  const { chunksX, chunkDirty, chunkHasBorder, chunkSleepCounter } = matrix;
  const SLEEP_THRESHOLD = 3;
  const subSteps = Math.max(1, diffusionSubSteps | 0);

  for (let nIdx = 0; nIdx < activeNations; nIdx++) {
    if (matrix.indexToOwner[nIdx] === null) continue;
    const b = nationBounds[nIdx];
    if (!b) continue;

    const nOffset = nIdx * size;
    const attractorArr = attractorByCell.get(nIdx) || null;
    const hasArrows = attractorArr !== null;

    // Convert bbox to chunk coords
    const bbMinCX = b.minX >> 4;
    const bbMaxCX = Math.min(b.maxX >> 4, chunksX - 1);
    const bbMinCY = b.minY >> 4;
    const bbMaxCY = Math.min(b.maxY >> 4, matrix.chunksY - 1);

    for (let step = 0; step < subSteps; step++) {
      const isLastStep = step === subSteps - 1;

      for (let pass = 0; pass < 2; pass++) {
        for (let ccy = bbMinCY; ccy <= bbMaxCY; ccy++) {
          for (let ccx = bbMinCX; ccx <= bbMaxCX; ccx++) {
            const ci = ccy * chunksX + ccx;
            if (
              !chunkDirty[ci] &&
              !chunkHasBorder[ci] &&
              chunkSleepCounter[ci] > SLEEP_THRESHOLD
            )
              continue;

            const x0 = ccx << 4;
            const y0 = ccy << 4;
            const x1 = Math.min(x0 + 16, width);
            const y1 = Math.min(y0 + 16, height);
            const xStart = Math.max(x0, b.minX);
            const xEnd = Math.min(x1, b.maxX + 1);
            const yStart = Math.max(y0, b.minY);
            const yEnd = Math.min(y1, b.maxY + 1);

            for (let y = yStart; y < yEnd; y++) {
              let x = xStart + ((xStart + y + pass) & 1);
              for (; x < xEnd; x += 2) {
                const i = y * width + x;
                if (oceanMask[i] === 1) continue;

                const offset = nOffset + i;
                const current = troopDensity[offset];
                const cellOwner = ownership[i];

                // Non-owned cells: decay density (only on last step to avoid compounding)
                if (cellOwner !== nIdx) {
                  if (isLastStep && current > 0) {
                    troopDensity[offset] = current * densityDecayOnUnowned;
                  }
                  continue;
                }

                // Owned cell: diffuse + detect border using inline neighbor reads
                let neighborSum = 0;
                let neighborCount = 0;
                let isBorder = false;

                if (x > 0) {
                  const ni = i - 1;
                  if (oceanMask[ni] !== 1) {
                    if (ownership[ni] !== nIdx) {
                      isBorder = true;
                    } else {
                      neighborSum += troopDensity[nOffset + ni];
                      neighborCount++;
                    }
                  }
                } else {
                  isBorder = true;
                }

                if (x < width - 1) {
                  const ni = i + 1;
                  if (oceanMask[ni] !== 1) {
                    if (ownership[ni] !== nIdx) {
                      isBorder = true;
                    } else {
                      neighborSum += troopDensity[nOffset + ni];
                      neighborCount++;
                    }
                  }
                } else {
                  isBorder = true;
                }

                if (y > 0) {
                  const ni = i - width;
                  if (oceanMask[ni] !== 1) {
                    if (ownership[ni] !== nIdx) {
                      isBorder = true;
                    } else {
                      neighborSum += troopDensity[nOffset + ni];
                      neighborCount++;
                    }
                  }
                } else {
                  isBorder = true;
                }

                if (y < height - 1) {
                  const ni = i + width;
                  if (oceanMask[ni] !== 1) {
                    if (ownership[ni] !== nIdx) {
                      isBorder = true;
                    } else {
                      neighborSum += troopDensity[nOffset + ni];
                      neighborCount++;
                    }
                  }
                } else {
                  isBorder = true;
                }

                let target = current;
                if (neighborCount > 0) {
                  const avgNeighbor = neighborSum / neighborCount;
                  let attractorBias = 0;
                  if (attractorArr) {
                    attractorBias = attractorArr[i];
                  }

                  // When nation has active arrows, suppress border bias at non-arrow
                  // border cells so density flows toward arrow positions instead of
                  // spreading uniformly along all borders.
                  let borderBias = 0;
                  if (isBorder) {
                    if (hasArrows) {
                      borderBias = attractorBias > 0.01
                        ? borderConcentrationBias
                        : borderConcentrationBias * 0.15;
                    } else {
                      borderBias = borderConcentrationBias;
                    }
                  }

                  target = avgNeighbor + borderBias + attractorBias;
                }

                const resistance = diffusionResistance[i] || 0;
                let newVal =
                  current + (target - current) * diffusionRate * (1 - resistance);
                if (newVal < 0) newVal = 0;
                if (newVal > maxDensityPerCell) newVal = maxDensityPerCell;
                troopDensity[offset] = newVal;
              }
            }
          }
        }
      }
    }
  }

  // Conservation correction: compute sums over full bbox (no chunk skipping),
  // then scale density so SUM == troopCount.
  const MAX_CONSERVATION_SCALE = 3.0;
  for (let nIdx = 0; nIdx < activeNations; nIdx++) {
    if (matrix.indexToOwner[nIdx] === null) continue;
    const targetSum = nationTroopCounts[nIdx];
    if (targetSum <= 0) continue;
    const b = nationBounds[nIdx];
    if (!b) continue;
    const nOffset = nIdx * size;

    // First pass: compute actual sum over full bbox (all cells, no skipping)
    let actualSum = 0;
    for (let y = b.minY; y <= b.maxY; y++) {
      const rowStart = y * width;
      for (let x = b.minX; x <= b.maxX; x++) {
        actualSum += troopDensity[nOffset + rowStart + x];
      }
    }

    if (actualSum > 0.001) {
      const scale = Math.min(MAX_CONSERVATION_SCALE, targetSum / actualSum);
      // Second pass: scale + compute newSum for running counter
      let newSum = 0;
      for (let y = b.minY; y <= b.maxY; y++) {
        const rowStart = y * width;
        for (let x = b.minX; x <= b.maxX; x++) {
          const off = nOffset + rowStart + x;
          troopDensity[off] *= scale;
          newSum += troopDensity[off];
        }
      }
      matrix.troopDensitySum[nIdx] = newSum;
    } else {
      matrix.troopDensitySum[nIdx] = actualSum;
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
  arrow,
  nation,
  gameState,
  mapData,
  ownershipMap,
  matrix,
  cfg,
  addCell,
  removeCellFromNation,
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

  // Pre-build nation lookup by index to avoid gameState.nations.find() per cell flip
  const nationByIndex = new Array(matrix.nextNationSlot);
  for (const n of gameState.nations) {
    const ni = matrix.ownerToIndex.get(n.owner);
    if (ni !== undefined) nationByIndex[ni] = n;
  }

  const hx = Math.round(arrow.headX ?? 0);
  const hy = Math.round(arrow.headY ?? 0);

  const corridorHalf = arrow._corridorHalfWidth || 4;

  let arrowDirX = 0,
    arrowDirY = 1;
  if (arrow.path && arrow.path.length >= 2) {
    const ci = Math.min(arrow.currentIndex || 0, arrow.path.length - 1);
    const fromIdx = Math.max(0, ci - 1);
    const toIdx = Math.min(ci + 1, arrow.path.length - 1);
    const from = arrow.path[fromIdx];
    const to = arrow.path[toIdx];
    arrowDirX = to.x - from.x;
    arrowDirY = to.y - from.y;
    const dirLen = Math.sqrt(arrowDirX * arrowDirX + arrowDirY * arrowDirY);
    if (dirLen > 0.001) {
      arrowDirX /= dirLen;
      arrowDirY /= dirLen;
    }
  }

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

      const perpDist = Math.abs(dy * arrowDirX - dx * arrowDirY);
      if (perpDist > corridorHalf) continue;

      const alongDist = dx * arrowDirX + dy * arrowDirY;
      if (alongDist < -2) continue;
      if (alongDist > scanR) continue;

      const ci = cy * width + cx;
      const cellOwner = ownership[ci];

      if (cellOwner === nIdx) continue;
      if (matrix.oceanMask[ci] === 1) continue;

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

      const corridorFactor = Math.max(0.1, 1 - (perpDist / corridorHalf) * 0.8);
      const effectiveAttack = attackerDensity * corridorFactor;

      if (cellOwner === UNOWNED) {
        if (effectiveAttack >= combatDensityThreshold) {
          addCell(cx, cy);
          troopDensity[nIdx * size + ci] = attackerDensity * 0.3;
          flipped++;
        }
        continue;
      }

      const defenderDensity = troopDensity[cellOwner * size + ci];
      const rawDefense = defenseStrength[ci] || 1.0;
      const defenderTroopComponent =
        defenderDensity * (cfg.troopDefenseScale || 0.8);
      const terrainMod = Math.max(
        1.0,
        Math.min(3.0, rawDefense - defenderTroopComponent),
      );
      const effectiveDefense =
        defenderDensity * combatDefenderAdvantage * terrainMod;

      if (
        effectiveAttack < combatDensityThreshold &&
        defenderDensity < combatDensityThreshold
      ) {
        continue;
      }

      if (effectiveAttack > effectiveDefense) {
        const defenderLoss = defenderDensity * combatExchangeRate;
        const attackerLoss = defenderDensity * combatExchangeRate * 0.5;

        const defenderNation = nationByIndex[cellOwner];
        if (defenderNation) {
          troopDensity[cellOwner * size + ci] = Math.max(
            0,
            defenderDensity - defenderLoss,
          );
          defenderNation.troopCount = Math.max(
            0,
            (defenderNation.troopCount || 0) - defenderLoss,
          );
          defenderNation.population = Math.max(
            0,
            (defenderNation.population || 0) - defenderLoss,
          );
          removeCellFromNation(defenderNation, cx, cy);
        }

        if (attackerCount > 0) {
          const lossPerCell = attackerLoss / attackerCount;
          for (let d = 0; d < 4; d++) {
            const nx = cx + DX[d];
            const ny = cy + DY[d];
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const ni = ny * width + nx;
            if (ownership[ni] === nIdx) {
              troopDensity[nIdx * size + ni] = Math.max(
                0,
                troopDensity[nIdx * size + ni] - lossPerCell,
              );
            }
          }
          nation.troopCount = Math.max(
            0,
            (nation.troopCount || 0) - attackerLoss,
          );
          nation.population = Math.max(
            0,
            (nation.population || 0) - attackerLoss,
          );
        }

        addCell(cx, cy);
        troopDensity[nIdx * size + ci] = attackerDensity * 0.3;
        flipped++;
      } else {
        const minDensity = Math.min(effectiveAttack, defenderDensity);
        const attritionLoss = minDensity * combatExchangeRate * 0.2;

        if (attritionLoss > 0.001) {
          troopDensity[cellOwner * size + ci] = Math.max(
            0,
            troopDensity[cellOwner * size + ci] - attritionLoss,
          );
          const defenderNation = nationByIndex[cellOwner];
          if (defenderNation) {
            defenderNation.troopCount = Math.max(
              0,
              (defenderNation.troopCount || 0) - attritionLoss,
            );
            defenderNation.population = Math.max(
              0,
              (defenderNation.population || 0) - attritionLoss,
            );
          }

          if (attackerCount > 0) {
            const lossPerCell = attritionLoss / attackerCount;
            for (let d = 0; d < 4; d++) {
              const nx = cx + DX[d];
              const ny = cy + DY[d];
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
              const ni = ny * width + nx;
              if (ownership[ni] === nIdx) {
                troopDensity[nIdx * size + ni] = Math.max(
                  0,
                  troopDensity[nIdx * size + ni] - lossPerCell,
                );
              }
            }
            nation.troopCount = Math.max(
              0,
              (nation.troopCount || 0) - attritionLoss,
            );
            nation.population = Math.max(
              0,
              (nation.population || 0) - attritionLoss,
            );
          }
        }
      }
    }
  }

  if (process.env.DEBUG_TROOP_DENSITY === "true" || flipped > 0) {
    //console.log(`[DENSITY-COMBAT] ${nation.owner} head=(${hx},${hy}) corridor=${corridorHalf} flipped=${flipped} troopCount=${Math.round(nation.troopCount || 0)}`);
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
export function buildTroopDensityPayload(
  matrix,
  nIdx,
  maxDensity = 50,
  threshold = 0.1,
) {
  const { width, size, ownership } = matrix;
  const troopDensity = matrix.troopDensity;
  const offset = nIdx * size;

  // Use bounding box to avoid full-grid scan
  const bb = matrix.nationBBox[nIdx];
  if (!bb || bb.maxX < 0) return [];

  // Find max density for relative normalization
  let peakDensity = 0;
  for (let y = bb.minY; y <= bb.maxY; y++) {
    for (let x = bb.minX; x <= bb.maxX; x++) {
      const i = y * width + x;
      if (ownership[i] !== nIdx) continue;
      const d = troopDensity[offset + i];
      if (d > peakDensity) peakDensity = d;
    }
  }

  if (peakDensity < threshold) return [];

  // Use low absolute threshold so all cells with any troops show up.
  // Normalize to [0, rangeTop] where rangeTop is capped to maxDensity.
  const rangeTop = Math.min(maxDensity, Math.max(peakDensity, 1));

  const result = [];
  for (let y = bb.minY; y <= bb.maxY; y++) {
    for (let x = bb.minX; x <= bb.maxX; x++) {
      const i = y * width + x;
      if (ownership[i] !== nIdx) continue;
      const density = troopDensity[offset + i];
      if (density < threshold) continue;
      const normalized = Math.min(1, density / rangeTop);
      const quantized = Math.min(
        255,
        Math.max(1, Math.round(normalized * 255)),
      );
      result.push(x, y, quantized);
    }
  }

  return result;
}
