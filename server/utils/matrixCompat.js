// matrixCompat.js — Backward-compatibility layer
// Derives client-format {x[], y[]} deltas from matrix ownership diffs

import { UNOWNED } from "./TerritoryMatrix.js";

/**
 * Compare prevOwnership vs ownership, return per-owner deltas.
 * @returns {Map<string, {add: {x: number[], y: number[]}, sub: {x: number[], y: number[]}}>}
 */
export function deriveNationDeltas(matrix) {
  const { width, size, ownership, prevOwnership } = matrix;
  const deltas = new Map(); // ownerString -> {add, sub}

  const getOrCreate = (ownerStr) => {
    let d = deltas.get(ownerStr);
    if (!d) {
      d = { add: { x: [], y: [] }, sub: { x: [], y: [] } };
      deltas.set(ownerStr, d);
    }
    return d;
  };

  for (let i = 0; i < size; i++) {
    const prev = prevOwnership[i];
    const curr = ownership[i];
    if (prev === curr) continue;

    const x = i % width;
    const y = (i - x) / width;

    // Cell was removed from prev owner
    if (prev !== UNOWNED) {
      const prevOwner = matrix.getOwnerByIndex(prev);
      if (prevOwner) {
        const d = getOrCreate(prevOwner);
        d.sub.x.push(x);
        d.sub.y.push(y);
      }
    }

    // Cell was added to curr owner
    if (curr !== UNOWNED) {
      const currOwner = matrix.getOwnerByIndex(curr);
      if (currOwner) {
        const d = getOrCreate(currOwner);
        d.add.x.push(x);
        d.add.y.push(y);
      }
    }
  }

  return deltas;
}

/**
 * Get full territory for an owner as {x[], y[]}.
 */
export function getFullTerritory(matrix, owner) {
  const nIdx = matrix.ownerToIndex.get(owner);
  if (nIdx === undefined) return { x: [], y: [] };
  return matrix.getCellsForNation(nIdx);
}

function applyDeltaToTerritoryInPlace(territory, delta) {
  const xArr = Array.isArray(territory?.x) ? territory.x : [];
  const yArr = Array.isArray(territory?.y) ? territory.y : [];
  const idxByKey = new Map();

  for (let i = 0; i < xArr.length; i++) {
    idxByKey.set((yArr[i] << 16) | xArr[i], i);
  }

  const subX = delta?.sub?.x || [];
  const subY = delta?.sub?.y || [];
  for (let i = 0; i < subX.length; i++) {
    const key = (subY[i] << 16) | subX[i];
    const idx = idxByKey.get(key);
    if (idx === undefined) continue;

    const last = xArr.length - 1;
    if (idx !== last) {
      const lastX = xArr[last];
      const lastY = yArr[last];
      xArr[idx] = lastX;
      yArr[idx] = lastY;
      idxByKey.set((lastY << 16) | lastX, idx);
    }

    xArr.pop();
    yArr.pop();
    idxByKey.delete(key);
  }

  const addX = delta?.add?.x || [];
  const addY = delta?.add?.y || [];
  for (let i = 0; i < addX.length; i++) {
    const x = addX[i];
    const y = addY[i];
    const key = (y << 16) | x;
    if (idxByKey.has(key)) continue;
    idxByKey.set(key, xArr.length);
    xArr.push(x);
    yArr.push(y);
  }

  return { x: xArr, y: yArr };
}

function syncTerritorySetCache(nation, delta) {
  if (!(nation?._territorySet instanceof Set)) return;

  const subX = delta?.sub?.x || [];
  const subY = delta?.sub?.y || [];
  for (let i = 0; i < subX.length; i++) {
    nation._territorySet.delete((subY[i] << 16) | subX[i]);
  }

  const addX = delta?.add?.x || [];
  const addY = delta?.add?.y || [];
  for (let i = 0; i < addX.length; i++) {
    nation._territorySet.add((addY[i] << 16) | addX[i]);
  }
}

/**
 * Populate nation.territory, nation.territoryDeltaForClient, nation.territoryPercentage
 * from matrix state. Called once at end of each tick.
 *
 * @param {TerritoryMatrix} matrix
 * @param {Array} nations - gameState.nations array (mutated in place)
 * @param {number} totalClaimable - total non-ocean cells
 */
export function applyMatrixToNations(matrix, nations, totalClaimable) {
  const deltas = deriveNationDeltas(matrix);

  for (const nation of nations) {
    if (nation.status === "defeated") {
      // Generate subtraction deltas for defeated nations so clients see territory disappear
      const delta = deltas.get(nation.owner);
      if (delta && delta.sub.x.length > 0) {
        nation.territoryDeltaForClient = delta;
      } else if (nation.territory?.x?.length > 0) {
        // Full subtraction of any remaining territory
        nation.territoryDeltaForClient = {
          add: { x: [], y: [] },
          sub: { x: [...nation.territory.x], y: [...nation.territory.y] },
        };
      }
      nation.territory = { x: [], y: [] };
      nation.territoryPercentage = 0;
      nation.territoryDelta = { add: { x: [], y: [] }, sub: { x: [], y: [] } };
      nation._territorySet = undefined;
      nation._borderSet = undefined;
      continue;
    }

    const nIdx = matrix.ownerToIndex.get(nation.owner);
    if (nIdx === undefined) continue;

    const delta = deltas.get(nation.owner) || {
      add: { x: [], y: [] },
      sub: { x: [], y: [] },
    };
    const hasDelta =
      (delta.add?.x?.length || 0) > 0 || (delta.sub?.x?.length || 0) > 0;

    if (!nation.territory || !Array.isArray(nation.territory.x) || !Array.isArray(nation.territory.y)) {
      nation.territory = { x: [], y: [] };
      nation._territorySet = undefined;
      nation._borderSet = undefined;
    }

    if (hasDelta) {
      nation.territory = applyDeltaToTerritoryInPlace(nation.territory, delta);
      syncTerritorySetCache(nation, delta);
      nation._borderSet = undefined;
    }

    // Update territory percentage
    const count = matrix.countTerritory(nIdx);
    if (nation.territory.x.length !== count) {
      nation.territory = matrix.getCellsForNation(nIdx);
      nation._territorySet = undefined;
      nation._borderSet = undefined;
    }
    if (totalClaimable > 0) {
      nation.territoryPercentage = Math.round((count / totalClaimable) * 10000) / 100;
    }

    // Set client delta from matrix diff
    if (hasDelta) {
      nation.territoryDeltaForClient = delta;
    } else {
      nation.territoryDeltaForClient = {
        add: { x: [], y: [] },
        sub: { x: [], y: [] },
      };
    }

    // Also set territoryDelta for any code that still references it
    nation.territoryDelta = {
      add: { x: [], y: [] },
      sub: { x: [], y: [] },
    };
  }
}
