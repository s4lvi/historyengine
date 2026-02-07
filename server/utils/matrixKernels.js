// matrixKernels.js — Pure-function kernels operating on typed arrays
// No string keys, no Map/Set allocation in hot paths

import { UNOWNED } from "./TerritoryMatrix.js";

const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];

/**
 * For each cell, find nation with highest loyalty; if > threshold, set as owner.
 * Only flips ownership when a *different* nation exceeds the threshold AND
 * beats the current owner's loyalty. Never reverts owned cells to UNOWNED —
 * territory loss is handled by direct arrow combat, not passive loyalty decay.
 * Returns the number of ownership changes.
 */
export function deriveOwnershipFromLoyalty(matrix, threshold = 0.6) {
  const { size, ownership, loyalty, oceanMask } = matrix;
  let changes = 0;

  for (let i = 0; i < size; i++) {
    if (oceanMask[i] === 1) continue;

    let bestNation = UNOWNED;
    let bestLoyalty = 0;

    for (let n = 0; n < matrix.nextNationSlot; n++) {
      if (!matrix.indexToOwner[n]) continue; // skip removed nations
      const val = loyalty[n * size + i];
      if (val > bestLoyalty) {
        bestLoyalty = val;
        bestNation = n;
      }
    }

    // No nation has any loyalty here — leave ownership as-is
    if (bestNation === UNOWNED || bestLoyalty < threshold) continue;

    const currentOwner = ownership[i];

    // Already owned by the nation with highest loyalty — no change
    if (bestNation === currentOwner) continue;

    if (currentOwner !== UNOWNED) {
      // Cell is owned — only flip if challenger's loyalty exceeds current owner's
      const currentLoyalty = loyalty[currentOwner * size + i];
      if (bestLoyalty <= currentLoyalty) continue;
    }

    // Flip: unowned cell claimed, or challenger beat the defender
    ownership[i] = bestNation;
    changes++;
  }

  return changes;
}

/**
 * Compute frontier mask: mark unowned cells adjacent to any owned cell.
 * Returns a Uint8Array where 1 = frontier cell.
 */
export function computeFrontierMask(matrix) {
  const { width, height, size, ownership, oceanMask } = matrix;
  const frontier = new Uint8Array(size);

  for (let i = 0; i < size; i++) {
    if (ownership[i] !== UNOWNED || oceanMask[i] === 1) continue;
    const x = i % width;
    const y = (i - x) / width;

    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (ownership[ny * width + nx] !== UNOWNED) {
        frontier[i] = 1;
        break;
      }
    }
  }

  return frontier;
}

/**
 * Return scored frontier candidates for a nation.
 * Candidates are unowned or enemy cells adjacent to the nation's territory.
 * Returns array of {x, y, score, ownedNeighborCount, sourceIdx} sorted by score desc.
 */
export function computeNationFrontierCandidates(matrix, nationIdx, params = {}) {
  const { width, height, size, ownership, oceanMask, biomeIndex } = matrix;
  const {
    anchor = null,
    targetPoint = null,
    arrowPath = null,
    distancePenaltyPerTile = 0.02,
    maxCandidates = 500,
    maxDistFromPath = 7,
  } = params;

  const candidates = [];
  // Use a flat visited array instead of Set
  const visited = new Uint8Array(size);

  for (let i = 0; i < size; i++) {
    if (ownership[i] !== nationIdx) continue;
    const x = i % width;
    const y = (i - x) / width;

    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

      const ni = ny * width + nx;
      if (visited[ni]) continue;
      visited[ni] = 1;

      if (ownership[ni] === nationIdx) continue;
      if (oceanMask[ni] === 1) continue;

      // Count owned neighbors
      let ownedNeighborCount = 0;
      for (let dd = 0; dd < 4; dd++) {
        const sx = nx + DX[dd];
        const sy = ny + DY[dd];
        if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
        if (ownership[sy * width + sx] === nationIdx) {
          ownedNeighborCount++;
        }
      }

      if (ownedNeighborCount === 0) continue;

      // Calculate min distance to arrow path if provided
      let minDistToPath = Infinity;
      let pathProgress = 0;
      if (arrowPath && arrowPath.length >= 2) {
        const pathSegments = Math.max(1, arrowPath.length - 1);
        for (let pi = 0; pi < arrowPath.length - 1; pi++) {
          const p1 = arrowPath[pi];
          const p2 = arrowPath[pi + 1];
          const segDx = p2.x - p1.x;
          const segDy = p2.y - p1.y;
          const lenSq = segDx * segDx + segDy * segDy;
          let t = lenSq > 0 ? ((nx - p1.x) * segDx + (ny - p1.y) * segDy) / lenSq : 0;
          t = Math.max(0, Math.min(1, t));
          const closestX = p1.x + t * segDx;
          const closestY = p1.y + t * segDy;
          const dd = Math.hypot(nx - closestX, ny - closestY);
          const segmentProgress = (pi + t) / pathSegments;
          if (dd < minDistToPath || (Math.abs(dd - minDistToPath) < 0.001 && segmentProgress > pathProgress)) {
            minDistToPath = dd;
            pathProgress = segmentProgress;
          }
        }
        if (minDistToPath > maxDistFromPath) continue;
      }

      // Score the candidate
      const distToTarget = targetPoint
        ? Math.hypot(nx - targetPoint.x, ny - targetPoint.y)
        : 0;
      const distFromAnchor = anchor
        ? Math.hypot(nx - anchor.x, ny - anchor.y)
        : 0;

      const holeBonus =
        ownedNeighborCount >= 3 ? 18 + ownedNeighborCount * 4 : ownedNeighborCount * 2;

      let score = holeBonus;
      if (arrowPath) {
        score += pathProgress * 35 - minDistToPath * 4 - distToTarget * 1.2 - distFromAnchor * 0.25;
        if (ownedNeighborCount <= 1) score -= 12;
      } else {
        score -= distancePenaltyPerTile * distFromAnchor;
      }

      candidates.push({
        x: nx,
        y: ny,
        score,
        ownedNeighborCount,
        sourceIdx: i,
        minDistToPath,
        pathProgress,
        distToTarget,
      });

      if (candidates.length >= maxCandidates) break;
    }
    if (candidates.length >= maxCandidates) break;
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

/**
 * For each cell, count 4-neighbors owned per nation.
 * Returns Uint8Array[size * maxNations] (flat, row-major by cell then nation).
 */
export function computeAdjacencyCount(matrix) {
  const { width, height, size, ownership } = matrix;
  const maxN = matrix.nextNationSlot;
  const counts = new Uint8Array(size * maxN);

  for (let i = 0; i < size; i++) {
    const x = i % width;
    const y = (i - x) / width;

    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const owner = ownership[ny * width + nx];
      if (owner !== UNOWNED && owner < maxN) {
        counts[i * maxN + owner]++;
      }
    }
  }

  return counts;
}

/**
 * Detect encirclement using BFS flood fill on ownership.
 * Returns array of { cells: number[] (flat indices), ownerIdx: int, encirclerIdx: int }
 */
export function detectEncirclement(matrix, nations = []) {
  const { width, height, size, ownership, oceanMask } = matrix;
  const visited = new Uint8Array(size);
  const results = [];

  // Build city locations per nation index for capital check
  const capitalCells = new Map(); // nationIdx -> Set of flat indices
  for (const nation of nations) {
    const nIdx = matrix.ownerToIndex.get(nation.owner);
    if (nIdx === undefined) continue;
    const cellSet = new Set();
    for (const city of nation.cities || []) {
      if (matrix.inBounds(city.x, city.y)) {
        cellSet.add(matrix.idx(city.x, city.y));
      }
    }
    capitalCells.set(nIdx, cellSet);
  }

  for (let startI = 0; startI < size; startI++) {
    if (visited[startI]) continue;
    if (oceanMask[startI] === 1) {
      visited[startI] = 1;
      continue;
    }

    const ownerId = ownership[startI];
    const component = [];
    const queue = [startI];
    let qIdx = 0;
    const boundaryOwners = new Set();
    let touchesEdge = false;

    // Mark start as pending
    visited[startI] = 1;

    while (qIdx < queue.length) {
      const ci = queue[qIdx++];
      component.push(ci);
      const cx = ci % width;
      const cy = (ci - cx) / width;

      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d];
        const ny = cy + DY[d];

        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          touchesEdge = true;
          continue;
        }

        const ni = ny * width + nx;
        if (oceanMask[ni] === 1) {
          touchesEdge = true;
          continue;
        }

        const neighborOwner = ownership[ni];
        if (neighborOwner === ownerId) {
          if (!visited[ni]) {
            visited[ni] = 1;
            queue.push(ni);
          }
          continue;
        }

        boundaryOwners.add(neighborOwner);
      }
    }

    if (touchesEdge) continue;
    if (boundaryOwners.size !== 1) continue;

    const [encircler] = boundaryOwners;
    if (encircler === UNOWNED || encircler === ownerId) continue;

    // Check if component contains a capital
    const ownerCities = capitalCells.get(ownerId);
    let hasCapital = false;
    if (ownerCities) {
      for (const ci of component) {
        if (ownerCities.has(ci)) {
          hasCapital = true;
          break;
        }
      }
    }

    results.push({
      cells: component,
      ownerIdx: ownerId,
      encirclerIdx: encircler,
      hasCapital,
    });
  }

  return results;
}

/**
 * BFS from seed cell, returning connected mask for a specific nation.
 * Returns Uint8Array[size] where 1 = connected to seed.
 */
export function computeConnectedComponent(matrix, nationIdx, seedX, seedY) {
  const { width, height, size, ownership } = matrix;
  if (!matrix.inBounds(seedX, seedY)) return new Uint8Array(size);

  const connected = new Uint8Array(size);
  const seedI = matrix.idx(seedX, seedY);

  // Seed must be owned by this nation — if not, return empty component
  if (ownership[seedI] !== nationIdx) return connected;

  const queue = [seedI];
  connected[seedI] = 1;

  let qIdx = 0;
  while (qIdx < queue.length) {
    const ci = queue[qIdx++];
    const cx = ci % width;
    const cy = (ci - cx) / width;

    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

      const ni = ny * width + nx;
      if (connected[ni]) continue;
      if (ownership[ni] !== nationIdx) continue;

      connected[ni] = 1;
      queue.push(ni);
    }
  }

  return connected;
}

// 8-connected neighbor offsets (cardinal + diagonal)
const DX8 = [1, -1, 0, 0, 1, 1, -1, -1];
const DY8 = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * Passive concavity fill: claim unowned non-ocean cells that have enough
 * 8-connected neighbors (cardinal + diagonal) owned by the same nation.
 * Uses multiple cascading passes so fills propagate inward each tick.
 * If two nations tie at the threshold, the cell is skipped (contested).
 * Returns total count of filled cells across all passes.
 *
 * @param {TerritoryMatrix} matrix
 * @param {Array} nations - gameState.nations array
 * @param {number} minNeighbors - minimum owned neighbors out of 8 to claim (default 5)
 * @param {number} maxPasses - max cascading passes per tick (default 3)
 */
export function passiveConcavityFill(matrix, nations, minNeighbors = 5, maxPasses = 3) {
  const { width, height, size, ownership, oceanMask } = matrix;
  let totalFilled = 0;

  for (let pass = 0; pass < maxPasses; pass++) {
    let filled = 0;

    for (let i = 0; i < size; i++) {
      if (ownership[i] !== UNOWNED) continue;
      if (oceanMask[i] === 1) continue;

      const x = i % width;
      const y = (i - x) / width;

      // Count 8-connected neighbors per nation
      let bestNation = UNOWNED;
      let bestCount = 0;
      let tied = false;

      // Track seen nations — at most 8 neighbors so max 8 entries
      const seen = [];

      for (let d = 0; d < 8; d++) {
        const nx = x + DX8[d];
        const ny = y + DY8[d];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const owner = ownership[ny * width + nx];
        if (owner === UNOWNED) continue;

        let found = false;
        for (let s = 0; s < seen.length; s++) {
          if (seen[s][0] === owner) {
            seen[s][1]++;
            found = true;
            if (seen[s][1] > bestCount) {
              bestCount = seen[s][1];
              bestNation = owner;
              tied = false;
            } else if (seen[s][1] === bestCount && owner !== bestNation) {
              tied = true;
            }
            break;
          }
        }
        if (!found) {
          seen.push([owner, 1]);
          if (1 > bestCount) {
            bestCount = 1;
            bestNation = owner;
            tied = false;
          } else if (1 === bestCount && owner !== bestNation) {
            tied = true;
          }
        }
      }

      if (bestCount < minNeighbors) continue;
      if (tied) continue;

      // Claim cell
      ownership[i] = bestNation;
      if (bestNation >= 0 && bestNation < matrix.maxNations) {
        matrix.loyalty[bestNation * size + i] = 1.0;
      }
      filled++;
    }

    totalFilled += filled;
    if (filled === 0) break; // no more cells to fill, stop cascading
  }

  return totalFilled;
}

/**
 * BFS from capital, set non-connected owned cells to UNOWNED.
 * Returns count of removed cells.
 */
export function removeDisconnectedTerritory(matrix, nationIdx, capitalX, capitalY) {
  const connected = computeConnectedComponent(matrix, nationIdx, capitalX, capitalY);
  const { size, ownership } = matrix;
  let removed = 0;

  for (let i = 0; i < size; i++) {
    if (ownership[i] === nationIdx && !connected[i]) {
      ownership[i] = UNOWNED;
      removed++;
    }
  }

  return removed;
}
