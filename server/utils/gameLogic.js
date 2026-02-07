// gameLogic.js
import config from "../config/config.js";
import { getTerrainCostModifiers, getNodeMultiplier } from "./territorialUtils.js";
import { UNOWNED } from "./TerritoryMatrix.js";
import { computeConnectedComponent, removeDisconnectedTerritory } from "./matrixKernels.js";
import { applyArrowLoyaltyPressure } from "./matrixLoyalty.js";

export function checkWinCondition(gameState, mapData, totalClaimableOverride) {
  const totalClaimable =
    Number.isFinite(totalClaimableOverride) && totalClaimableOverride > 0
      ? totalClaimableOverride
      : (() => {
          let count = 0;
          for (let y = 0; y < mapData.length; y++) {
            for (let x = 0; x < mapData[0].length; x++) {
              const cell = mapData[y][x];
              if (cell && cell.biome !== "OCEAN") {
                count++;
              }
            }
          }
          return count;
        })();

  // Get the win threshold percentage from your config (e.g., 50 means 50%)
  const winThreshold = config.winConditionPercentage || 50;
  let winner = null;

  // Update each nation with its territory percentage.
  gameState.nations.forEach((nation) => {
    // Assume nation.territory.x is an array of claimed cell x-coordinates
    const territoryCount =
      nation.territory && nation.territory.x ? nation.territory.x.length : 0;
    // Calculate percentage (round to 2 decimals)
    nation.territoryPercentage = (
      (territoryCount / totalClaimable) *
      100
    ).toFixed(2);
    if (parseFloat(nation.territoryPercentage) >= winThreshold) {
      winner = nation.owner;
    }
  });

  // If a winner is found, update nation statuses accordingly.
  if (winner) {
    gameState.nations.forEach((nation) => {
      nation.status = nation.owner === winner ? "winner" : "defeated";
    });
  }
}

export function forEachTerritoryCell(territory, callback) {
  if (!territory || !territory.x || !territory.y) return;
  for (let i = 0; i < territory.x.length; i++) {
    callback(territory.x[i], territory.y[i], i);
  }
}

export function getTerritorySet(territory) {
  const set = new Set();
  if (!territory || !territory.x || !territory.y) return set;
  for (let i = 0; i < territory.x.length; i++) {
    set.add(`${territory.x[i]},${territory.y[i]}`);
  }
  return set;
}

export function isCellInTerritory(territory, x, y, territorySet = null) {
  const key = `${x},${y}`;
  if (territorySet) return territorySet.has(key);
  let found = false;
  forEachTerritoryCell(territory, (tx, ty) => {
    if (tx === x && ty === y) found = true;
  });
  return found;
}

export function updateNation(
  nation,
  mapData,
  gameState,
  ownershipMap = null,
  bonusesByOwner = null,
  currentTick = 0,
  cachedFrontierSet = null, // OPTIMIZATION 3: Pre-computed frontier set
  matrix = null // Matrix system: when provided, uses typed-array operations
) {
  return updateNationTerritorial(
    nation,
    mapData,
    gameState,
    ownershipMap,
    bonusesByOwner,
    currentTick,
    cachedFrontierSet,
    matrix
  );
}

function updateNationTerritorial(
  nation,
  mapData,
  gameState,
  ownershipMap,
  bonusesByOwner,
  currentTick,
  cachedFrontierSet = null, // OPTIMIZATION 3
  matrix = null // Matrix system
) {
  if (!Array.isArray(mapData) || !Array.isArray(mapData[0])) {
    console.warn("Invalid map data structure in updateNationTerritorial");
    return nation;
  }

  const useMatrix = !!matrix;
  const nIdx = useMatrix ? matrix.ownerToIndex.get(nation.owner) : undefined;

  const updatedNation = nation;
  updatedNation.resources = updatedNation.resources || {};
  updatedNation.territoryDelta =
    updatedNation.territoryDelta || { add: { x: [], y: [] }, sub: { x: [], y: [] } };

  // Matrix-aware territory add/remove helpers
  const _addCell = (x, y) => {
    if (useMatrix && nIdx !== undefined) {
      matrix.setOwner(x, y, nIdx);
      // Also set max loyalty for owned cell
      const loyaltyEnabled = config?.loyalty?.enabled !== false;
      if (loyaltyEnabled) {
        matrix.setLoyalty(x, y, nIdx, 1.0);
      }
    }
    addTerritoryCell(updatedNation, x, y);
    ownershipMap?.set(`${x},${y}`, updatedNation);
  };

  const _removeCell = (x, y) => {
    if (useMatrix && nIdx !== undefined) {
      if (matrix.isOwnedBy(x, y, nIdx)) {
        matrix.setOwner(x, y, UNOWNED);
      }
    }
    removeTerritoryCell(updatedNation, x, y);
    ownershipMap?.delete(`${x},${y}`);
  };

  const _removeCellFromNation = (targetNation, x, y) => {
    if (useMatrix) {
      const targetIdx = matrix.ownerToIndex.get(targetNation.owner);
      if (targetIdx !== undefined && matrix.isOwnedBy(x, y, targetIdx)) {
        matrix.setOwner(x, y, UNOWNED);
      }
    }
    removeTerritoryCell(targetNation, x, y);
  };

  // Check if a cell is owned by this nation
  const _isOwnedByUs = (x, y) => {
    if (useMatrix && nIdx !== undefined) {
      return matrix.isOwnedBy(x, y, nIdx);
    }
    // Legacy: check ownershipMap or territory array
    const key = `${x},${y}`;
    if (ownershipMap) return ownershipMap.get(key)?.owner === updatedNation.owner;
    return isCellInTerritory(updatedNation.territory, x, y);
  };

  const clearTerritory = () => {
    if (useMatrix && nIdx !== undefined) {
      matrix.removeNation(updatedNation.owner);
    }
    const tx = [...(updatedNation.territory?.x || [])];
    const ty = [...(updatedNation.territory?.y || [])];
    for (let i = 0; i < tx.length; i++) {
      removeTerritoryCell(updatedNation, tx[i], ty[i]);
      ownershipMap?.delete(`${tx[i]},${ty[i]}`);
    }
  };

  const markDefeated = () => {
    updatedNation.status = "defeated";
    clearTerritory();
  };

  let skipActions = false;
  if (updatedNation.status === "defeated") {
    markDefeated();
    skipActions = true;
  } else {
    const capital =
      updatedNation.cities &&
      updatedNation.cities.find((city) => city.type === "capital");
    if (!capital) {
      // No capital - check if there are any towns to promote
      const towns = updatedNation.cities?.filter((city) => city.type === "town") || [];
      if (towns.length > 0) {
        // Promote the first town to capital
        towns[0].type = "capital";
        console.log(`[NATION] ${updatedNation.owner}: Town "${towns[0].name}" promoted to capital`);
      } else {
        markDefeated();
        skipActions = true;
      }
    } else {
      // Check if capital is still in our territory
      const capitalSafe = _isOwnedByUs(capital.x, capital.y) ||
        isCellInTerritory(updatedNation.territory, capital.x, capital.y);

      if (!capitalSafe) {
        // Capital territory lost - try to promote nearest town
        const towns = updatedNation.cities?.filter((city) => city.type === "town") || [];
        if (towns.length > 0) {
          // Find nearest town that is still in our territory
          let nearestTown = null;
          let minDistance = Infinity;
          for (const town of towns) {
            const townInTerritory = _isOwnedByUs(town.x, town.y) ||
              isCellInTerritory(updatedNation.territory, town.x, town.y);
            if (townInTerritory) {
              const distance = Math.abs(town.x - capital.x) + Math.abs(town.y - capital.y);
              if (distance < minDistance) {
                minDistance = distance;
                nearestTown = town;
              }
            }
          }
          if (nearestTown) {
            // Promote the nearest town to capital
            nearestTown.type = "capital";
            // Remove the old capital (it was captured) — match by coordinates, not reference
            const capitalIndex = updatedNation.cities.findIndex(
              (c) => c.type === "capital" && c.x === capital.x && c.y === capital.y && c !== nearestTown
            );
            if (capitalIndex !== -1) {
              updatedNation.cities.splice(capitalIndex, 1);
            }
            console.log(`[NATION] ${updatedNation.owner}: Capital lost, town "${nearestTown.name}" promoted to capital`);
          } else {
            markDefeated();
            skipActions = true;
          }
        } else {
          markDefeated();
          skipActions = true;
        }
      }
    }
  }

  const bonuses =
    bonusesByOwner?.[updatedNation.owner] || {
      expansionPower: 1,
      attackPower: 1,
      defensePower: 1,
      production: 1,
      goldIncome: 0,
    };

  if (!skipActions) {
    // OpenFront-style population/troop growth
    // Population = Troops (they're the same resource)
    // Max pop based on territory size + city bonuses
    const ownedTiles = (useMatrix && nIdx !== undefined)
      ? matrix.countTerritory(nIdx)
      : (updatedNation.territory?.x?.length || 0);
    const basePop = Math.pow(ownedTiles, 0.6) * 1000;

    // Add population bonus from cities/towns
    let cityBonus = 0;
    const townPopBonus = config?.structures?.town?.populationBonus || 5000;
    if (updatedNation.cities) {
      for (const city of updatedNation.cities) {
        if (city.type === "capital" || city.type === "town") {
          cityBonus += townPopBonus;
        }
      }
    }

    const maxPopulation = basePop + cityBonus + 1000; // +1000 base minimum
    updatedNation.maxPopulation = maxPopulation;

    // Growth formula: (10 + pop^0.73/4) * (1 - pop/maxPop)
    // Optimal growth at ~42% of max population
    const currentPop = updatedNation.population || 0;
    const popRatio = Math.min(1, currentPop / maxPopulation);
    const baseGrowthRate = 10 + Math.pow(Math.max(1, currentPop), 0.73) / 4;
    const growth = baseGrowthRate * (1 - popRatio) * bonuses.production;

    updatedNation.population = Math.min(maxPopulation, currentPop + growth);

    // Passive gold income from nodes
    if (bonuses.goldIncome > 0) {
      updatedNation.resources.gold =
        (updatedNation.resources.gold || 0) + bonuses.goldIncome;
    }

    if (updatedNation.isBot) {
      maybeEnqueueBotArrow(
        updatedNation,
        mapData,
        ownershipMap,
        bonusesByOwner,
        currentTick,
        gameState,
        matrix
      );
    }

    // Apply arrow orders (Big Arrow system)
    if (updatedNation.arrowOrders && (updatedNation.arrowOrders.attacks?.length > 0 || updatedNation.arrowOrders.attack || updatedNation.arrowOrders.defend)) {
      try {
        processArrowOrders(
          updatedNation,
          gameState,
          mapData,
          ownershipMap,
          bonusesByOwner,
          cachedFrontierSet,
          matrix
        );
      } catch (arrowErr) {
        console.error(`[ARROW] Error processing arrows for ${updatedNation.name || updatedNation.owner}:`, arrowErr.message, arrowErr.stack);
        // Don't clear all arrows on error - just log and continue
        // The arrow will naturally expire or be replaced
      }
    }

    const connectivityInterval =
      config?.territorial?.connectivityCheckIntervalTicks ?? 3;
    const hasChanges =
      (updatedNation.territoryDelta?.add?.x?.length || 0) > 0 ||
      (updatedNation.territoryDelta?.sub?.x?.length || 0) > 0;
    const shouldCheckConnectivity =
      hasChanges ||
      (Number.isFinite(connectivityInterval) &&
        connectivityInterval > 0 &&
        (currentTick ?? 0) % connectivityInterval === 0);
    if (shouldCheckConnectivity) {
      const currentCapital = updatedNation.cities?.find((c) => c.type === "capital");
      // Always clear disconnected cells blacklist at start of connectivity check
      // so cells that reconnect via a different path are no longer blocked
      if (updatedNation._disconnectedCells) updatedNation._disconnectedCells.clear();

      if (useMatrix && nIdx !== undefined && currentCapital) {
        // Matrix path: BFS on typed array — O(cells) with no string allocation
        const removed = removeDisconnectedTerritory(matrix, nIdx, currentCapital.x, currentCapital.y);
        if (removed > 0) {
          // Sync legacy territory arrays from matrix
          const cells = matrix.getCellsForNation(nIdx);
          // Derive removals for delta
          const prevSet = new Set();
          const tx = updatedNation.territory?.x || [];
          const ty = updatedNation.territory?.y || [];
          for (let i = 0; i < tx.length; i++) {
            prevSet.add(`${tx[i]},${ty[i]}`);
          }
          const newSet = new Set();
          for (let i = 0; i < cells.x.length; i++) {
            newSet.add(`${cells.x[i]},${cells.y[i]}`);
          }
          // Track disconnected cells so arrows don't immediately recapture them this tick
          if (!updatedNation._disconnectedCells) updatedNation._disconnectedCells = new Set();
          for (const key of prevSet) {
            if (!newSet.has(key)) {
              const [xStr, yStr] = key.split(",");
              updatedNation.territoryDelta.sub.x.push(Number(xStr));
              updatedNation.territoryDelta.sub.y.push(Number(yStr));
              ownershipMap?.delete(key);
              updatedNation._disconnectedCells.add(key);
            }
          }
          updatedNation.territory = cells;
          // Invalidate legacy caches
          updatedNation._territorySet = undefined;
          updatedNation._borderSet = undefined;
        }
      } else {
        // Legacy path: BFS with string key sets
        const connected = computeConnectedTerritorySet(updatedNation, mapData);
        if (connected) {
          const tx = [...(updatedNation.territory?.x || [])];
          const ty = [...(updatedNation.territory?.y || [])];
          for (let i = 0; i < tx.length; i++) {
            const key = `${tx[i]},${ty[i]}`;
            if (!connected.has(key)) {
              removeTerritoryCell(updatedNation, tx[i], ty[i]);
              ownershipMap?.delete(key);
            }
          }
        }
      }
    }
  }

  if (updatedNation.territoryDelta) {
    const hasDelta =
      (updatedNation.territoryDelta.add.x.length ||
        updatedNation.territoryDelta.add.y.length ||
        updatedNation.territoryDelta.sub.x.length ||
        updatedNation.territoryDelta.sub.y.length) > 0;
    if (hasDelta) {
      updatedNation.territoryDeltaForClient = {
        add: {
          x: [...updatedNation.territoryDelta.add.x],
          y: [...updatedNation.territoryDelta.add.y],
        },
        sub: {
          x: [...updatedNation.territoryDelta.sub.x],
          y: [...updatedNation.territoryDelta.sub.y],
        },
      };
    } else {
      // Always reset to empty when no changes - prevents stale deltas from being re-sent
      updatedNation.territoryDeltaForClient = {
        add: { x: [], y: [] },
        sub: { x: [], y: [] },
      };
    }
    // NOTE: Do NOT reset territoryDelta here - it's needed by processRoom
    // for updating ownership map and frontier set caches.
    // The caller (processRoom) will reset it after using the deltas.
  }

  return updatedNation;
}

function computeConnectedTerritorySet(nation, mapData) {
  const capital =
    nation.cities && nation.cities.find((city) => city.type === "capital");
  if (!capital) return null;
  const territorySet = getTerritorySet(nation.territory);
  const connected = new Set();
  const queue = [[capital.x, capital.y]];
  let queueIndex = 0;
  const width = mapData[0]?.length || 0;
  const height = mapData.length || 0;
  while (queueIndex < queue.length) {
    const [x, y] = queue[queueIndex];
    queueIndex += 1;
    const key = `${x},${y}`;
    if (connected.has(key)) continue;
    if (!territorySet.has(key)) continue;
    connected.add(key);
    const neighbors = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dy] of neighbors) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nKey = `${nx},${ny}`;
      if (!connected.has(nKey) && territorySet.has(nKey)) {
        queue.push([nx, ny]);
      }
    }
  }
  return connected;
}

function selectBotTargetCellAny(nation, mapData, ownershipMap, anchor, resourceNodeClaims, matrix = null, nIdx = undefined) {
  const candidates = getFrontierCandidatesForBot(
    nation,
    mapData,
    ownershipMap,
    anchor,
    resourceNodeClaims,
    matrix,
    nIdx
  );
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function selectBotTargetCell(nation, mapData, ownershipMap, anchor, resourceNodeClaims, matrix = null, nIdx = undefined) {
  const candidates = getFrontierCandidatesForBot(
    nation,
    mapData,
    ownershipMap,
    anchor,
    resourceNodeClaims,
    matrix,
    nIdx
  );
  if (!candidates.length) return null;
  const pickTop = config?.territorial?.botCandidatePickTop ?? 12;
  const pool = candidates.slice(0, Math.max(1, pickTop));
  return pool[Math.floor(Math.random() * pool.length)];
}

function selectBotTargetCellDirectional(
  nation,
  mapData,
  ownershipMap,
  anchor,
  direction
) {
  const candidates = getDirectionalFrontierCandidates(
    nation,
    mapData,
    ownershipMap,
    direction,
    anchor,
    null,
    null
  );
  if (!candidates.length) return null;
  const pickTop = config?.territorial?.botCandidatePickTop ?? 12;
  const pool = candidates.slice(0, Math.max(1, pickTop));
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Bot AI using the arrow system instead of pressure orders
 * Creates simple 2-point arrow paths (anchor -> target)
 */
function maybeEnqueueBotArrow(
  nation,
  mapData,
  ownershipMap,
  bonusesByOwner,
  tickCount,
  gameState,
  matrix = null
) {
  // Skip defeated bots
  if (nation.status === "defeated") {
    return;
  }

  if (!ownershipMap) {
    if (process.env.DEBUG_BOTS === "true") {
      console.log(`[BOTS] skip ${nation.owner} no ownershipMap`);
    }
    return;
  }

  // Migrate legacy single attack to attacks[]
  migrateArrowOrders(nation);

  const maxAttackArrows = config?.territorial?.maxAttackArrows ?? 3;
  const attacks = nation.arrowOrders?.attacks || [];

  // Determine max arrows for this bot based on territory size
  const territorySize = nation.territory?.x?.length || 0;
  const botMaxArrows = territorySize > 200 ? Math.min(2, maxAttackArrows) : 1;

  // Check if bot already has max arrows
  if (attacks.length >= botMaxArrows) {
    if (tickCount % 20 === 0) {
      console.log(`[BOTS] ${nation.name || nation.owner} has ${attacks.length} active arrows`);
    }
    return;
  }

  const orderInterval = config?.territorial?.botOrderIntervalTicks ?? 4;
  const lastTick = nation.lastBotOrderTick ?? -Infinity;
  if (tickCount - lastTick < orderInterval) {
    if (tickCount % 50 === 0 && process.env.DEBUG_BOTS === "true") {
      console.log(`[BOTS] ${nation.name || nation.owner} waiting (interval=${tickCount - lastTick}/${orderInterval})`);
    }
    return;
  }

  const anchor = getNationAnchor(nation);
  if (!anchor) {
    if (process.env.DEBUG_BOTS === "true") {
      console.log(`[BOTS] skip ${nation.owner} no anchor`);
    }
    return;
  }

  const resourceNodeClaims = gameState?.resourceNodeClaims || null;
  const nIdx = matrix ? matrix.ownerToIndex.get(nation.owner) : undefined;
  let candidate = selectBotTargetCell(
    nation,
    mapData,
    ownershipMap,
    anchor,
    resourceNodeClaims,
    matrix,
    nIdx
  );
  if (!candidate) {
    candidate = selectBotTargetCellAny(
      nation,
      mapData,
      ownershipMap,
      anchor,
      resourceNodeClaims,
      matrix,
      nIdx
    );
  }
  if (!candidate) {
    console.log(`[BOTS] ${nation.name || nation.owner} has no expansion candidates (territory: ${nation.territory?.x?.length || 0} cells)`);
    return;
  }

  // Diagnostic: how far is the frontier candidate from the nearest border?
  const borderDist = getMinDistanceToTerritory(nation, candidate.x, candidate.y, 20);
  const anchorDist = Math.hypot(candidate.x - anchor.x, candidate.y - anchor.y);
  console.log(`[BOT-ARROW] ${nation.name || nation.owner} frontier=(${candidate.x},${candidate.y}) distToBorder=${borderDist} distToAnchor=${anchorDist.toFixed(1)} territory=${nation.territory?.x?.length || 0}`);

  const minPercent = config?.territorial?.minAttackPercent ?? 0.05;
  const maxPercent = config?.territorial?.maxAttackPercent ?? 1;
  const rawPercent =
    config?.territorial?.botAttackPercent ??
    config?.territorial?.defaultAttackPercent ??
    0.3;
  const clampedPercent = Math.min(Math.max(rawPercent, minPercent), maxPercent);

  const available = nation.population || 0;
  const power = available * clampedPercent;
  if (power <= 0) {
    console.log(`[BOTS] ${nation.name || nation.owner} has no population (${available.toFixed(1)})`);
    return;
  }

  const actualPower = available < 10 ? available : power;

  nation.population = Math.max(0, available - actualPower);
  nation.arrowOrders = nation.arrowOrders || {};
  if (!nation.arrowOrders.attacks) nation.arrowOrders.attacks = [];

  // Project the target further in the expansion direction so the arrow
  // has room to expand before reaching its final waypoint.
  // Without this, pathLen=2 targets a single frontier cell (1 tile from
  // the border) which gets claimed in 1 tick, wasting 99% of arrow power.
  const dx = candidate.x - anchor.x;
  const dy = candidate.y - anchor.y;
  const dist = Math.hypot(dx, dy);
  const range = config?.territorial?.arrowBaseRange ?? 15;
  let targetX, targetY;
  if (dist > 0.001) {
    const nx = dx / dist;
    const ny = dy / dist;
    targetX = Math.round(anchor.x + nx * (dist + range));
    targetY = Math.round(anchor.y + ny * (dist + range));
  } else {
    // Degenerate case: candidate is at the anchor, just push outward
    targetX = candidate.x + range;
    targetY = candidate.y;
  }

  // Clamp to map bounds if we have mapData dimensions
  if (mapData && mapData[0]) {
    const mapW = mapData[0].length;
    const mapH = mapData.length;
    targetX = Math.max(0, Math.min(mapW - 1, targetX));
    targetY = Math.max(0, Math.min(mapH - 1, targetY));
  }

  const arrowPath = [
    { x: anchor.x, y: anchor.y },
    { x: targetX, y: targetY }
  ];

  nation.arrowOrders.attacks.push({
    id: `bot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "attack",
    path: arrowPath,
    currentIndex: 1,
    remainingPower: actualPower,
    initialPower: actualPower,
    percent: clampedPercent,
    createdAt: new Date(),
    frontWidth: 0,
    advanceProgress: 0,
    phase: 1,
    phaseConsolidationRemaining: 0,
    status: "advancing",
    opposingForces: [],
    headX: arrowPath[0].x,
    headY: arrowPath[0].y,
  });

  console.log(`[BOT-ARROW] ${nation.name || nation.owner} arrow: power=${actualPower.toFixed(0)} frontier=(${candidate.x},${candidate.y}) projected=(${targetX},${targetY}) range=${range}`);
  nation.lastBotOrderTick = tickCount;
}

function pickBotDirection(nation, gameState, anchor) {
  if (!anchor) return randomDirection();
  const enemies = (gameState?.nations || []).filter(
    (n) => n.owner !== nation.owner && n.status !== "defeated"
  );
  let best = null;
  let bestDist = Infinity;
  enemies.forEach((enemy) => {
    const enemyAnchor = getNationAnchor(enemy);
    if (!enemyAnchor) return;
    const dist = Math.hypot(enemyAnchor.x - anchor.x, enemyAnchor.y - anchor.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = enemyAnchor;
    }
  });
  if (!best) return randomDirection();
  const dir = normalizeVector(best.x - anchor.x, best.y - anchor.y);
  return dir || randomDirection();
}

function randomDirection() {
  const angle = Math.random() * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}
function getFrontierCandidatesForBot(
  nation,
  mapData,
  ownershipMap,
  anchor,
  resourceNodeClaims = null,
  matrix = null,
  nIdx = undefined
) {
  const candidates = [];
  const maxCandidates = config?.territorial?.botFrontierCandidateLimit ?? 0;
  const seen = new Set();
  const similarityWeight = config?.territorial?.similarityWeight ?? 1;
  const similarityPower = config?.territorial?.similarityPower ?? 1;
  const distancePenaltyPerTile =
    config?.territorial?.distancePenaltyPerTile ?? 0.02;
  const scanLimit = config?.territorial?.frontierScanLimit ?? 0;
  const resourceWeight = config?.territorial?.botResourcePriorityWeight ?? 1.2;
  const resourceAdjWeight =
    config?.territorial?.botResourceAdjacencyWeight ?? 0.4;

  const territoryX = nation?.territory?.x || [];
  const territoryY = nation?.territory?.y || [];
  const width = mapData[0].length;
  const height = mapData.length;

  const step =
    scanLimit > 0 && territoryX.length > scanLimit
      ? Math.ceil(territoryX.length / scanLimit)
      : 1;
  for (let i = 0; i < territoryX.length; i += step) {
    const x = territoryX[i];
    const y = territoryY[i];
    const neighbors = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dy] of neighbors) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const key = `${nx},${ny}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (ownershipMap.get(key)?.owner === nation.owner) continue;
      // Check matrix ground truth — skip cells already owned by us (legacy map may be stale)
      if (matrix && nIdx !== undefined && matrix.isOwnedBy(nx, ny, nIdx)) continue;
      const cell = mapData[ny]?.[nx];
      if (!cell || cell.biome === "OCEAN") continue;
      const sourceCell = mapData[y]?.[x];
      const similarity = getTerrainCostModifiers(
        sourceCell?.biome,
        cell?.biome
      ).similarity;
      const similarityScore = Math.pow(similarity, similarityPower);
      const distance = anchor
        ? Math.hypot(nx - anchor.x, ny - anchor.y)
        : 0;
      const claim = resourceNodeClaims?.[key];
      const resourceOwned = claim && claim.owner === nation.owner;
      const resourceOpen = !!cell.resourceNode?.type && !resourceOwned;
      let resourceScore = resourceOpen ? resourceWeight : 0;
      if (!resourceOpen && resourceAdjWeight > 0) {
        const adj = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
        for (const [adx, ady] of adj) {
          const ax = nx + adx;
          const ay = ny + ady;
          if (ax < 0 || ay < 0 || ax >= width || ay >= height) continue;
          const adjCell = mapData[ay]?.[ax];
          if (!adjCell?.resourceNode?.type) continue;
          const adjKey = `${ax},${ay}`;
          const adjClaim = resourceNodeClaims?.[adjKey];
          if (adjClaim && adjClaim.owner === nation.owner) continue;
          resourceScore = Math.max(resourceScore, resourceAdjWeight);
        }
      }
      const score =
        similarityWeight * similarityScore -
        distancePenaltyPerTile * distance +
        resourceScore;
      candidates.push({
        x: nx,
        y: ny,
        score,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  if (maxCandidates > 0 && candidates.length > maxCandidates) {
    return candidates.slice(0, maxCandidates);
  }
  return candidates;
}

/**
 * Migrate legacy single attack arrow to attacks[] array
 */
function migrateArrowOrders(nation) {
  if (!nation.arrowOrders) return;
  if (nation.arrowOrders.attack && !nation.arrowOrders.attacks) {
    const legacy = nation.arrowOrders.attack;
    legacy.frontWidth = legacy.frontWidth || 0;
    legacy.advanceProgress = legacy.advanceProgress || 0;
    legacy.phase = legacy.phase || 1;
    legacy.phaseConsolidationRemaining = legacy.phaseConsolidationRemaining || 0;
    legacy.status = legacy.status || "advancing";
    legacy.opposingForces = legacy.opposingForces || [];
    legacy.headX = legacy.headX ?? legacy.path?.[0]?.x ?? 0;
    legacy.headY = legacy.headY ?? legacy.path?.[0]?.y ?? 0;
    nation.arrowOrders.attacks = [legacy];
    delete nation.arrowOrders.attack;
  }
  if (!nation.arrowOrders.attacks) {
    nation.arrowOrders.attacks = [];
  }
}

/**
 * Compute perpendicular distance from point (px,py) to the nearest segment of path
 * Returns { dist, progress } where progress is 0..1 along the full path
 */
function distanceToPath(px, py, path) {
  let minDist = Infinity;
  let bestProgress = 0;
  const totalSegments = Math.max(1, path.length - 1);
  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i];
    const p2 = path[i + 1];
    const segDx = p2.x - p1.x;
    const segDy = p2.y - p1.y;
    const lenSq = segDx * segDx + segDy * segDy;
    let t = lenSq > 0 ? ((px - p1.x) * segDx + (py - p1.y) * segDy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const closestX = p1.x + t * segDx;
    const closestY = p1.y + t * segDy;
    const d = Math.hypot(px - closestX, py - closestY);
    const progress = (i + t) / totalSegments;
    if (d < minDist || (Math.abs(d - minDist) < 0.001 && progress > bestProgress)) {
      minDist = d;
      bestProgress = progress;
    }
  }
  if (path.length === 1 || minDist === Infinity) {
    minDist = Math.hypot(px - path[0].x, py - path[0].y);
  }
  return { dist: minDist, progress: bestProgress };
}

/**
 * Compute total path length
 */
export function computePathLength(path) {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  return len;
}

/**
 * Compute max arrow range for a nation based on population
 */
export function computeMaxArrowRange(nation) {
  const baseRange = config?.territorial?.arrowBaseRange ?? 15;
  const rangePerSqrtPop = config?.territorial?.arrowRangePerSqrtPop ?? 0.15;
  const maxRange = config?.territorial?.arrowMaxRange ?? 60;
  const pop = nation.population || 0;
  return Math.min(maxRange, baseRange + Math.sqrt(pop) * rangePerSqrtPop);
}

/**
 * Front-line attack arrow processing
 * Returns 'remove' if the arrow should be removed, undefined otherwise
 */
function processAttackArrowFrontline(
  arrow, nation, gameState, mapData, ownershipMap, bonusesByOwner, matrix
) {
  const useMatrix = !!matrix;
  const nIdx = useMatrix ? matrix.ownerToIndex.get(nation.owner) : undefined;
  const loyaltyEnabled = useMatrix && config?.loyalty?.enabled !== false;
  const arrowLoyaltyGain = config?.loyalty?.arrowPressureLoyaltyGain ?? 0.1;

  const baseCost = config?.territorial?.baseCost || 1;
  const baseDefense = config?.territorial?.baseDefense || 1;
  const pressurePerTick = config?.territorial?.pressurePerTick || 6;
  const attemptsPerTick = config?.territorial?.frontierAttemptsPerTick || 8;
  const contestedDefenseMult = config?.territorial?.contestedDefenseMult ?? 1.25;
  const structureConfig = config?.structures || {};
  const terrainExpansionCostMultByBiome = config?.territorial?.terrainExpansionCostMultByBiome || {};
  const terrainDefenseMultByBiome = config?.territorial?.terrainDefenseMultByBiome || {};
  const riverCrossingCostMult = config?.territorial?.riverCrossingCostMult ?? 1.3;
  const mountainCrossingCostMult = config?.territorial?.mountainCrossingCostMult ?? 1.5;
  const distancePenaltyPerTile = config?.territorial?.distancePenaltyPerTile ?? 0.02;
  const maxDistancePenaltyTiles = config?.territorial?.maxDistancePenaltyTiles ?? 40;
  const minArrowDurationMs = config?.territorial?.minArrowDurationMs ?? 10000;
  const maxArrowDurationMs = config?.territorial?.maxArrowDurationMs ?? 120000;
  const arrowDurationPerPowerMs = config?.territorial?.arrowDurationPerPowerMs ?? 25;
  const arrowPressurePerSqrtPower = config?.territorial?.arrowPressurePerSqrtPower ?? 0.2;
  const maxArrowPressurePerTick =
    config?.territorial?.maxArrowPressurePerTick ?? Math.max(pressurePerTick, 40);
  const arrowMaxStallTicks = config?.territorial?.arrowMaxStallTicks ?? 6;
  const maxArrowCandidates = config?.territorial?.maxArrowCandidatesPerNation ?? 500;

  const frontBaseWidth = config?.territorial?.frontBaseWidth ?? 3;
  const frontWidthPerSqrtPower = config?.territorial?.frontWidthPerSqrtPower ?? 0.3;
  const frontMaxWidth = config?.territorial?.frontMaxWidth ?? 20;
  const phaseConsolidationTicks = config?.territorial?.phaseConsolidationTicks ?? 3;
  const oppositionScanRadius = config?.territorial?.oppositionScanRadius ?? 3;
  const retreatReturnRate = config?.territorial?.retreatReturnRate ?? 0.1;

  const anchor = getNationAnchor(nation);
  const width = mapData[0]?.length || 0;
  const height = mapData.length || 0;
  const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  let remaining = arrow.remainingPower || 0;

  // Validate path
  const validPath = Array.isArray(arrow.path) && arrow.path.length >= 2 &&
    arrow.path.every(p => p && typeof p.x === 'number' && typeof p.y === 'number');
  if (!validPath) {
    console.log(`[ARROW] Removing invalid attack arrow for ${nation.name || nation.owner}`);
    return 'remove';
  }

  // Check expiry (guard against NaN in initialPower/duration — NaN comparisons always return false)
  let initialPower = Number(arrow.initialPower ?? remaining ?? 0);
  if (!Number.isFinite(initialPower)) initialPower = 0;
  const scaledDuration = minArrowDurationMs + initialPower * arrowDurationPerPowerMs;
  const rawMaxDuration = Math.max(minArrowDurationMs, Math.min(maxArrowDurationMs, scaledDuration));
  const maxDurationMs = Number.isFinite(rawMaxDuration) ? rawMaxDuration : maxArrowDurationMs;
  const rawAge = arrow.createdAt ? Date.now() - new Date(arrow.createdAt).getTime() : Infinity;
  const arrowAge = Number.isFinite(rawAge) ? rawAge : Infinity;
  if (arrowAge > maxDurationMs) {
    nation.population = (nation.population || 0) + Math.max(0, remaining);
    return 'remove';
  }

  // Fail-safe: check matrix directly for arrow completion (bypasses stale caches)
  const arrowTickCount = (arrow._debugTickCount || 0) + 1;
  arrow._debugTickCount = arrowTickCount;
  const shouldLog = arrowTickCount <= 3 || arrowTickCount % 10 === 0;
  const arrowLabel = `[ARROW-STUCK ${nation.name || nation.owner} #${arrow._debugTickCount}]`;

  if (useMatrix && nIdx !== undefined) {
    let allWaypointsOwned = true;
    let firstUnownedWp = -1;
    let firstUnownedCoord = null;
    let firstUnownedOwner = -999;
    for (let pi = Math.max(1, arrow.currentIndex || 1); pi < arrow.path.length; pi++) {
      const wp = arrow.path[pi];
      const rx = Math.round(wp.x);
      const ry = Math.round(wp.y);
      if (!matrix.isOwnedBy(rx, ry, nIdx)) {
        allWaypointsOwned = false;
        firstUnownedWp = pi;
        firstUnownedCoord = { x: rx, y: ry };
        firstUnownedOwner = matrix.inBounds(rx, ry) ? matrix.ownership[matrix.idx(rx, ry)] : -2;
        break;
      }
    }
    if (allWaypointsOwned) {
      console.log(`${arrowLabel} FAIL-SAFE REMOVE: all waypoints owned in matrix, power=${remaining}, pathLen=${arrow.path.length}, curIdx=${arrow.currentIndex}`);
      nation.population = (nation.population || 0) + Math.max(0, remaining);
      return 'remove';
    } else if (shouldLog) {
      console.log(`${arrowLabel} fail-safe: NOT all owned — wp[${firstUnownedWp}]=(${firstUnownedCoord?.x},${firstUnownedCoord?.y}) matrixOwner=${firstUnownedOwner} nIdx=${nIdx}, power=${remaining}, curIdx=${arrow.currentIndex}/${arrow.path.length}, status=${arrow.status}, stalled=${arrow.stalledTicks || 0}`);
    }
  } else if (shouldLog) {
    console.log(`${arrowLabel} fail-safe SKIPPED: useMatrix=${useMatrix} nIdx=${nIdx}, power=${remaining}`);
  }

  // Handle retreat
  if (arrow.status === "retreating") {
    const returnAmount = Math.min(remaining, remaining * retreatReturnRate + 5);
    nation.population = (nation.population || 0) + returnAmount;
    arrow.remainingPower = remaining - returnAmount;
    if (arrow.remainingPower <= 1) return 'remove';
    return;
  }

  // Handle consolidation
  if (arrow.phaseConsolidationRemaining > 0) {
    arrow.phaseConsolidationRemaining--;
    arrow.status = "consolidating";
    // During consolidation, only fill gaps behind front (below)
  } else if (arrow.status === "consolidating") {
    arrow.status = "advancing";
  }

  if (remaining <= 0) return 'remove';

  // Compute front width
  const computedFrontWidth = Math.min(
    frontMaxWidth,
    frontBaseWidth + Math.sqrt(remaining) * frontWidthPerSqrtPower
  );
  arrow.frontWidth = computedFrontWidth;
  const halfWidthBase = computedFrontWidth / 2;
  // Corridor is wider near the origin (pulling at border) and narrows toward the tip
  // pathProgress 0 = origin → 1.5x width; pathProgress 1 = tip → 0.5x width
  const halfWidthAtProgress = (progress) => {
    const taper = 1.5 - 1.0 * progress; // 1.5 at origin, 0.5 at tip
    return halfWidthBase * taper;
  };

  // Compute budget
  const dynamicBudget = pressurePerTick + Math.sqrt(Math.max(0, initialPower)) * arrowPressurePerSqrtPower;
  const budget = Math.min(remaining, Math.max(1, Math.min(maxArrowPressurePerTick, dynamicBudget)));

  // Auto-skip waypoints that are already inside or near own territory
  // Intermediate waypoints: skip if within 2 tiles (avoid stalling on near-misses)
  // Final waypoint: must be IN territory (prevent premature completion)
  const territorySet = getTerritorySetCached(nation);
  let currentIndex = arrow.currentIndex || 1;
  const startIndex = currentIndex;
  while (currentIndex < arrow.path.length) {
    const wp = arrow.path[currentIndex];
    const wpKey = `${Math.round(wp.x)},${Math.round(wp.y)}`;
    const inTerritory = territorySet.has(wpKey);
    const matrixOwned = useMatrix && nIdx !== undefined ? matrix.isOwnedBy(Math.round(wp.x), Math.round(wp.y), nIdx) : false;
    const isLastWaypoint = currentIndex === arrow.path.length - 1;

    if (isLastWaypoint) {
      // Final waypoint: must actually be IN territory
      if (inTerritory || matrixOwned) {
        currentIndex++;
      } else {
        if (shouldLog) {
          const dist = getMinDistanceToTerritory(nation, wp.x, wp.y, 5);
          console.log(`${arrowLabel} auto-skip STOPPED at FINAL wp[${currentIndex}/${arrow.path.length}]: key=${wpKey} inSet=${inTerritory} matrixOwned=${matrixOwned} dist=${dist}`);
        }
        break;
      }
    } else {
      // Intermediate waypoint: skip if close enough
      const dist = getMinDistanceToTerritory(nation, wp.x, wp.y, 3);
      if (inTerritory || matrixOwned || dist <= 2) {
        currentIndex++;
      } else {
        if (shouldLog) {
          console.log(`${arrowLabel} auto-skip STOPPED at wp[${currentIndex}/${arrow.path.length}]: key=${wpKey} inSet=${inTerritory} matrixOwned=${matrixOwned} dist=${dist}`);
        }
        break;
      }
    }
  }
  arrow.currentIndex = Math.min(currentIndex, arrow.path.length - 1);

  // If the arrow has advanced through all waypoints, it's done
  if (currentIndex >= arrow.path.length) {
    console.log(`${arrowLabel} AUTO-SKIP REMOVE: all ${arrow.path.length} waypoints reached. Returning ${remaining} troops.`);
    nation.population = (nation.population || 0) + remaining;
    return 'remove';
  }
  if (currentIndex > startIndex && shouldLog) {
    console.log(`${arrowLabel} auto-skipped from ${startIndex} to ${currentIndex}/${arrow.path.length}`);
  }

  const targetPoint = arrow.path[Math.min(currentIndex, arrow.path.length - 1)];

  let spent = 0;
  let attempts = 0;

  // Only expand if not consolidating
  if (arrow.status === "advancing" || arrow.status === "stalled") {
    // Build frontier candidates within the front width band
    const candidates = [];
    const territorySet = getTerritorySetCached(nation);
    const frontierChecked = new Set();
    const tx = nation.territory?.x || [];
    const ty = nation.territory?.y || [];

    candidateScan:
    for (let i = 0; i < tx.length; i++) {
      for (const [dx, dy] of neighbors) {
        const nx = tx[i] + dx;
        const ny = ty[i] + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

        const key = `${nx},${ny}`;
        if (frontierChecked.has(key)) continue;
        frontierChecked.add(key);

        if (territorySet.has(key)) continue;
        if (ownershipMap.get(key)?.owner === nation.owner) continue;
        // Skip cells recently removed by connectivity check (prevents flash cycle)
        if (nation._disconnectedCells?.has(key)) continue;

        const cell = mapData[ny]?.[nx];
        if (!cell || cell.biome === "OCEAN") continue;

        // Count owned neighbors
        let ownedNeighborCount = 0;
        let sourceCell = null;
        for (const [ddx, ddy] of neighbors) {
          const sx = nx + ddx;
          const sy = ny + ddy;
          if (territorySet.has(`${sx},${sy}`) || ownershipMap.get(`${sx},${sy}`)?.owner === nation.owner) {
            ownedNeighborCount++;
            if (!sourceCell) sourceCell = mapData[sy]?.[sx];
          }
        }
        if (ownedNeighborCount === 0 || !sourceCell) continue;

        // Compute distance to path and progress
        const { dist: minDistToPath, progress: pathProgress } = distanceToPath(nx, ny, arrow.path);

        // Position-dependent corridor width: wider near origin, narrower at tip
        const halfWidth = halfWidthAtProgress(pathProgress);

        // Strict corridor filter — keep expansion tight to the path
        if (minDistToPath > halfWidth) continue;

        // Require 2+ owned neighbors for cells far from path center (prevent checkerboard tendrils)
        if (minDistToPath > 2 && ownedNeighborCount < 2) continue;

        const distToTarget = Math.hypot(nx - targetPoint.x, ny - targetPoint.y);

        // Terrain similarity bonus for natural borders
        const { similarity } = getTerrainCostModifiers(sourceCell?.biome, cell?.biome);

        // Random jitter for organic-looking borders (seeded per-cell for consistency)
        const jitter = ((nx * 7919 + ny * 6271) % 1000) / 1000; // deterministic per cell

        // Scoring: prioritize compactness, then proximity to path center, then forward progress
        // Compactness is king — cells with 3+ owned neighbors are gap-fills (very high priority)
        const compactnessScore = ownedNeighborCount >= 3
          ? 40 + ownedNeighborCount * 5  // gap-fill: highest priority
          : ownedNeighborCount * 8;        // frontier: moderate
        // Prefer cells near the path center (spearhead shape)
        const centerScore = Math.max(0, halfWidth - minDistToPath) * 3;
        // Slight forward bias (but NOT dominant — prevents tendrils)
        const forwardScore = -distToTarget * 0.8;
        // Terrain makes borders look natural
        const terrainScore = similarity * 3;
        // Random jitter for organic borders
        const jitterScore = jitter * 4;
        // Penalize cells with only 1 owned neighbor (tendril tips)
        const isolationPenalty = ownedNeighborCount <= 1 ? -15 : 0;

        const score = compactnessScore + centerScore + forwardScore + terrainScore + jitterScore + isolationPenalty;

        candidates.push({
          x: nx,
          y: ny,
          score,
          sourceCell,
          cell,
          pathProgress,
          ownedNeighborCount,
          minDistToPath,
          distToTarget,
        });
        if (candidates.length >= maxArrowCandidates) break candidateScan;
      }
    }

    // Sort by compactness first (fill gaps before advancing), then by score
    candidates.sort((a, b) => {
      // Gap-fills (3+ neighbors) always come first
      const aGap = a.ownedNeighborCount >= 3 ? 1 : 0;
      const bGap = b.ownedNeighborCount >= 3 ? 1 : 0;
      if (aGap !== bGap) return bGap - aGap;
      return b.score - a.score;
    });

    // Capture within budget
    for (const candidate of candidates) {
      if (spent >= budget || attempts >= attemptsPerTick) break;

      const { x, y, sourceCell, cell, minDistToPath, distToTarget, ownedNeighborCount } = candidate;
      const key = `${x},${y}`;
      const currentOwner = ownershipMap.get(key);

      if (currentOwner?.owner === nation.owner) { attempts++; continue; }

      // Recheck live owned neighbors (may have changed during this tick)
      let liveOwned = 0;
      for (const [ddx, ddy] of neighbors) {
        if (ownershipMap.get(`${x + ddx},${y + ddy}`)?.owner === nation.owner) liveOwned++;
      }
      // Require at least 2 owned neighbors unless at path center (prevents thin tendrils)
      if (liveOwned < 2 && minDistToPath > 1.5) { attempts++; continue; }

      const { lossMult, speedMult } = getTerrainCostModifiers(sourceCell?.biome, cell?.biome);
      const targetTerrainMult = terrainExpansionCostMultByBiome[cell?.biome] || 1;
      let terrainCrossMult = 1;
      if (sourceCell?.biome === "RIVER" || cell?.biome === "RIVER") terrainCrossMult *= riverCrossingCostMult;
      if (sourceCell?.biome === "MOUNTAIN" || cell?.biome === "MOUNTAIN") terrainCrossMult *= mountainCrossingCostMult;

      const distance = anchor ? Math.hypot(x - anchor.x, y - anchor.y) : 0;
      const clampedDistance = Math.min(distance, maxDistancePenaltyTiles);
      const distanceMult = 1 + distancePenaltyPerTile * clampedDistance;

      let cost;
      if (!currentOwner) {
        const expansionPower = bonusesByOwner?.[nation.owner]?.expansionPower || 1;
        cost = (baseCost * lossMult * distanceMult * terrainCrossMult * targetTerrainMult) /
               (expansionPower * speedMult);
      } else {
        const attackerPower = bonusesByOwner?.[nation.owner]?.attackPower || 1;
        const defenderPower = bonusesByOwner?.[currentOwner.owner]?.defensePower || 1;
        let defense = baseDefense * defenderPower * contestedDefenseMult;
        defense *= terrainDefenseMultByBiome[cell?.biome] || 1;

        const structureDefense = getStructureDefenseBoost(x, y, currentOwner, structureConfig);
        defense *= structureDefense.troopLossMultiplier;
        const structureSpeedMult = structureDefense.speedMultiplier;

        const encirclementBonus = currentOwner.isEncircled ? 0.2 : 1;
        defense *= encirclementBonus;

        cost = (baseCost * lossMult * defense * distanceMult * terrainCrossMult * targetTerrainMult) /
               (attackerPower * speedMult * structureSpeedMult);
      }

      if (budget - spent >= cost) {
        if (currentOwner && currentOwner.owner !== nation.owner) {
          const targetNation = gameState.nations.find(n => n.owner === currentOwner.owner);
          if (targetNation) {
            if (useMatrix) {
              const targetIdx = matrix.ownerToIndex.get(targetNation.owner);
              if (targetIdx !== undefined && matrix.isOwnedBy(x, y, targetIdx)) {
                matrix.setOwner(x, y, UNOWNED);
              }
            }
            removeTerritoryCell(targetNation, x, y);
          }
        }
        if (useMatrix && nIdx !== undefined) {
          matrix.setOwner(x, y, nIdx);
          if (loyaltyEnabled) matrix.setLoyalty(x, y, nIdx, 1.0);
        }
        addTerritoryCell(nation, x, y);
        ownershipMap.set(key, nation);
        spent += cost;
      } else if (loyaltyEnabled && useMatrix && nIdx !== undefined) {
        applyArrowLoyaltyPressure(matrix, nIdx, x, y, arrowLoyaltyGain);
      }
      attempts++;
    }
  }

  // Fill behind front: unowned cells behind advance head with 3+ owned neighbors
  {
    const territorySet = getTerritorySetCached(nation);
    const tx = nation.territory?.x || [];
    const ty = nation.territory?.y || [];
    const fillBudget = Math.max(4, Math.min(12, Math.floor(tx.length * 0.005)));
    const fills = [];
    const fillChecked = new Set();

    for (let i = 0; i < tx.length && fills.length < fillBudget; i++) {
      for (const [dx, dy] of neighbors) {
        const nx = tx[i] + dx;
        const ny = ty[i] + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const key = `${nx},${ny}`;
        if (fillChecked.has(key)) continue;
        fillChecked.add(key);
        if (territorySet.has(key)) continue;
        if (nation._disconnectedCells?.has(key)) continue;
        const currentOwner = ownershipMap.get(key);
        if (currentOwner?.owner === nation.owner) continue;
        if (currentOwner?.owner && currentOwner.owner !== nation.owner) continue;
        const cell = mapData[ny]?.[nx];
        if (!cell || cell.biome === "OCEAN") continue;

        const { dist: dtp, progress: fillProgress } = distanceToPath(nx, ny, arrow.path);
        if (dtp > halfWidthAtProgress(fillProgress)) continue;

        let ownedCount = 0;
        for (const [ddx, ddy] of neighbors) {
          if (ownershipMap.get(`${nx + ddx},${ny + ddy}`)?.owner === nation.owner) ownedCount++;
        }
        if (ownedCount >= 3) {
          fills.push({ x: nx, y: ny, key });
        }
      }
    }
    for (const fill of fills) {
      if (useMatrix && nIdx !== undefined) {
        matrix.setOwner(fill.x, fill.y, nIdx);
        if (loyaltyEnabled) matrix.setLoyalty(fill.x, fill.y, nIdx, 1.0);
      }
      addTerritoryCell(nation, fill.x, fill.y);
      ownershipMap.set(fill.key, nation);
    }
  }

  // Track opposition: scan enemy cells adjacent to the front (sampled for perf)
  {
    const opMap = new Map();
    const tx = nation.territory?.x || [];
    const ty = nation.territory?.y || [];
    const scanned = new Set();
    const step = tx.length > 300 ? Math.ceil(tx.length / 300) : 1;

    for (let i = 0; i < tx.length; i += step) {
      const { dist: dtp } = distanceToPath(tx[i], ty[i], arrow.path);
      if (dtp > halfWidthBase * 1.5 + oppositionScanRadius) continue;

      for (const [dx, dy] of neighbors) {
        const nx = tx[i] + dx;
        const ny = ty[i] + dy;
        const key = `${nx},${ny}`;
        if (scanned.has(key)) continue;
        scanned.add(key);
        const owner = ownershipMap.get(key);
        if (owner && owner.owner !== nation.owner) {
          const entry = opMap.get(owner.owner) || { nationOwner: owner.owner, nationName: owner.name || owner.owner, estimatedStrength: 0, contactWidth: 0 };
          entry.contactWidth++;
          entry.estimatedStrength = (owner.population || 0);
          opMap.set(owner.owner, entry);
        }
      }
    }
    arrow.opposingForces = Array.from(opMap.values());
  }

  // Update head position: sample territory near path to find most forward owned cell
  {
    const tx = nation.territory?.x || [];
    const ty = nation.territory?.y || [];
    let bestProgress = arrow.advanceProgress || -1;
    let headX = arrow.headX ?? arrow.path[0].x;
    let headY = arrow.headY ?? arrow.path[0].y;
    // Sample up to 500 cells to avoid O(N) scan on large nations
    const step = tx.length > 500 ? Math.ceil(tx.length / 500) : 1;
    for (let i = 0; i < tx.length; i += step) {
      const { dist: dtp, progress } = distanceToPath(tx[i], ty[i], arrow.path);
      if (dtp <= halfWidthAtProgress(progress) && progress > bestProgress) {
        bestProgress = progress;
        headX = tx[i];
        headY = ty[i];
      }
    }
    arrow.headX = headX;
    arrow.headY = headY;
    arrow.advanceProgress = Math.max(0, bestProgress);
  }

  // Check waypoint reached — advance past waypoints near territory
  // Intermediate waypoints: skip if within 2 tiles of territory (avoid getting stuck on near-misses)
  // Final waypoint: must actually be IN territory (not just near) to prevent premature arrow completion
  {
    const updatedTerritorySet = getTerritorySetCached(nation);
    let ci = arrow.currentIndex;
    const ciStart = ci;
    while (ci < arrow.path.length) {
      const wp = arrow.path[ci];
      const wpKey = `${Math.round(wp.x)},${Math.round(wp.y)}`;
      const isLastWaypoint = ci === arrow.path.length - 1;
      const inTerritory = updatedTerritorySet.has(wpKey);
      // Also check matrix for ground truth
      const matrixOwned = useMatrix && nIdx !== undefined ? matrix.isOwnedBy(Math.round(wp.x), Math.round(wp.y), nIdx) : false;

      if (isLastWaypoint) {
        // Final waypoint: require actually IN territory (territorySet or matrix)
        if (inTerritory || matrixOwned) {
          ci++;
        } else {
          if (shouldLog) {
            const distToWp = getMinDistanceToTerritory(nation, wp.x, wp.y, 3);
            console.log(`${arrowLabel} end-wp-check STOPPED at FINAL wp[${ci}/${arrow.path.length}]: key=${wpKey} inSet=${inTerritory} matrixOwned=${matrixOwned} dist=${distToWp}`);
          }
          break;
        }
      } else {
        // Intermediate waypoint: skip if close to territory
        const distToWp = getMinDistanceToTerritory(nation, wp.x, wp.y, 3);
        if (inTerritory || matrixOwned || distToWp <= 2) {
          ci++;
        } else {
          if (shouldLog) {
            console.log(`${arrowLabel} end-wp-check STOPPED at wp[${ci}/${arrow.path.length}]: key=${wpKey} inSet=${inTerritory} dist=${distToWp} matrixOwned=${matrixOwned}`);
          }
          break;
        }
      }
    }
    if (ci > arrow.currentIndex) {
      const advanced = ci - arrow.currentIndex;
      arrow.currentIndex = Math.min(ci, arrow.path.length - 1);
      arrow.phase = (arrow.phase || 1) + advanced;
      if (ci < arrow.path.length) {
        arrow.phaseConsolidationRemaining = phaseConsolidationTicks;
        arrow.status = "consolidating";
      }
      if (shouldLog) console.log(`${arrowLabel} end-wp-check advanced ${advanced} waypoints (${ciStart}->${ci}), consolidation=${ci < arrow.path.length}`);
    }
  }

  // If the arrow has advanced through all waypoints, it's done
  if (arrow.currentIndex >= arrow.path.length - 1) {
    const updatedTerritorySet = getTerritorySetCached(nation);
    const fwp = arrow.path[arrow.path.length - 1];
    const fwpKey = `${Math.round(fwp.x)},${Math.round(fwp.y)}`;
    const inSet = updatedTerritorySet.has(fwpKey);
    const matrixOwned = useMatrix && nIdx !== undefined ? matrix.isOwnedBy(Math.round(fwp.x), Math.round(fwp.y), nIdx) : false;
    // Final waypoint must actually be IN territory, not just near it
    if (inSet || matrixOwned) {
      remaining = Math.max(0, remaining - spent);
      arrow.remainingPower = remaining;
      console.log(`${arrowLabel} FINAL-WP REMOVE: power=${remaining}, spent=${spent}`);
      if (remaining > 0) nation.population = (nation.population || 0) + remaining;
      return 'remove';
    } else if (shouldLog) {
      const distToFinal = getMinDistanceToTerritory(nation, fwp.x, fwp.y, 5);
      console.log(`${arrowLabel} at final wp but NOT removing: key=${fwpKey} inSet=${inSet} matrixOwned=${matrixOwned} dist=${distToFinal}`);
    }
  }

  remaining = Math.max(0, remaining - spent);
  arrow.remainingPower = remaining;
  arrow.stalledTicks = spent > 0 ? 0 : Number(arrow.stalledTicks || 0) + 1;

  if (arrow.stalledTicks > 0 && arrow.status === "advancing") {
    arrow.status = "stalled";
  }
  if (spent > 0 && arrow.status === "stalled") {
    arrow.status = "advancing";
  }

  if (shouldLog) {
    console.log(`${arrowLabel} END-OF-TICK: power=${remaining}, spent=${spent}, status=${arrow.status}, stalledTicks=${arrow.stalledTicks}, curIdx=${arrow.currentIndex}/${arrow.path.length}, consolidationLeft=${arrow.phaseConsolidationRemaining || 0}, arrowAge=${arrowAge}ms/${maxDurationMs}ms`);
  }

  // Remove if depleted or stalled too long
  if (
    remaining <= 3 ||
    (spent === 0 && remaining < 10) ||
    (arrow.stalledTicks >= arrowMaxStallTicks)
  ) {
    console.log(`${arrowLabel} STALL/DEPLETED REMOVE: power=${remaining}, spent=${spent}, stalledTicks=${arrow.stalledTicks}/${arrowMaxStallTicks}`);
    if (remaining > 0) {
      nation.population = (nation.population || 0) + remaining;
    }
    return 'remove';
  }
}

/**
 * Process arrow orders (Big Arrow system)
 * Attack arrows: expand along the drawn path as a broad front
 * Defend arrows: reinforce defense along the path
 */
function processArrowOrders(
  nation,
  gameState,
  mapData,
  ownershipMap,
  bonusesByOwner,
  cachedFrontierSet = null,
  matrix = null
) {
  if (!nation.arrowOrders) return;
  if (!ownershipMap) return;

  const useMatrix = !!matrix;
  const nIdx = useMatrix ? matrix.ownerToIndex.get(nation.owner) : undefined;
  const loyaltyEnabled = useMatrix && config?.loyalty?.enabled !== false;

  const pressurePerTick = config?.territorial?.pressurePerTick || 6;
  const width = mapData[0]?.length || 0;
  const height = mapData.length || 0;
  const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // Migrate legacy single attack to attacks[]
  migrateArrowOrders(nation);

  // Process attack arrows array
  const attacks = nation.arrowOrders.attacks;
  if (!attacks) {
    console.warn(`[ARROW-DEBUG] nation ${nation.name || nation.owner} has no attacks array after migration!`);
  }
  const toRemove = [];
  for (let i = 0; i < attacks.length; i++) {
    const arrow = attacks[i];
    try {
      const result = processAttackArrowFrontline(arrow, nation, gameState, mapData, ownershipMap, bonusesByOwner, matrix);
      if (result === 'remove') {
        toRemove.push(i);
        console.log(`[ARROW-DEBUG] Arrow ${i} (id=${arrow.id}) for ${nation.name || nation.owner} marked for removal. Power=${arrow.remainingPower}, status=${arrow.status}, currentIndex=${arrow.currentIndex}/${arrow.path?.length}`);
      }
    } catch (err) {
      console.error(`[ARROW] Error processing attack arrow ${i} for ${nation.name || nation.owner}: ${err.message}`);
      // Return remaining troops and remove the broken arrow
      nation.population = (nation.population || 0) + (arrow.remainingPower || 0);
      toRemove.push(i);
    }
  }
  console.log(`[ARROW-DEBUG] ${nation.name || nation.owner}: ${attacks.length} arrows, removing ${toRemove.length}, indices=${JSON.stringify(toRemove)}`);
  // Splice in reverse order
  for (let i = toRemove.length - 1; i >= 0; i--) {
    attacks.splice(toRemove[i], 1);
  }
  console.log(`[ARROW-DEBUG] ${nation.name || nation.owner}: after splice, ${attacks.length} arrows remain. nation.arrowOrders.attacks.length=${nation.arrowOrders.attacks.length}`);

  // Process defend arrow — unchanged
  if (nation.arrowOrders?.defend) {
    const arrow = nation.arrowOrders.defend;
    let remaining = arrow.remainingPower || 0;

    const minArrowDurationMs = config?.territorial?.minArrowDurationMs ?? 10000;
    const maxArrowDurationMs = config?.territorial?.maxArrowDurationMs ?? 120000;
    const arrowDurationPerPowerMs = config?.territorial?.arrowDurationPerPowerMs ?? 25;
    let initialPowerD = Number(arrow.initialPower ?? remaining ?? 0);
    if (!Number.isFinite(initialPowerD)) initialPowerD = 0;
    const scaledDuration = minArrowDurationMs + initialPowerD * arrowDurationPerPowerMs;
    const rawMaxDuration = Math.max(minArrowDurationMs, Math.min(maxArrowDurationMs, scaledDuration));
    const maxDurationMs = Number.isFinite(rawMaxDuration) ? rawMaxDuration : maxArrowDurationMs;
    const rawDefendAge = arrow.createdAt ? Date.now() - new Date(arrow.createdAt).getTime() : Infinity;
    const arrowAge = Number.isFinite(rawDefendAge) ? rawDefendAge : Infinity;

    if (arrowAge > maxDurationMs) {
      nation.population = (nation.population || 0) + remaining;
      nation.arrowOrders.defend = null;
      delete nation.arrowOrders.defend;
    } else {
      const validPath = Array.isArray(arrow.path) && arrow.path.length >= 2 &&
        arrow.path.every(p => p && typeof p.x === 'number' && typeof p.y === 'number');

      if (!validPath) {
        nation.arrowOrders.defend = null;
        delete nation.arrowOrders.defend;
      } else if (remaining > 0) {
        const returnRate = pressurePerTick * 0.3;
        const returned = Math.min(remaining, returnRate);
        nation.population = (nation.population || 0) + returned;
        remaining -= returned;
        arrow.remainingPower = remaining;

        if (remaining <= 0.5) {
          nation.arrowOrders.defend = null;
          delete nation.arrowOrders.defend;
        }
      }
    }
  }

  // Hole-filling pass — unchanged
  if (nation.territory?.x?.length > 0) {
    const holesToFill = [];
    const checked = new Set();
    const tx = nation.territory.x;
    const ty = nation.territory.y;
    const dynamicFillBudget = Math.max(4, Math.min(18, Math.floor(tx.length * 0.008)));

    const collectHoles = (requiredOwnedNeighbors) => {
      for (let i = 0; i < tx.length && holesToFill.length < dynamicFillBudget; i++) {
        for (const [dx, dy] of neighbors) {
          const nx = tx[i] + dx;
          const ny = ty[i] + dy;
          const key = `${nx},${ny}`;
          if (checked.has(key)) continue;
          checked.add(key);

          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const currentOwner = ownershipMap.get(key);
          if (currentOwner?.owner === nation.owner) continue;
          if (currentOwner?.owner && currentOwner.owner !== nation.owner) continue;

          const cell = mapData[ny]?.[nx];
          if (!cell || cell.biome === "OCEAN") continue;

          let ownedCount = 0;
          for (const [ddx, ddy] of neighbors) {
            if (ownershipMap.get(`${nx + ddx},${ny + ddy}`)?.owner === nation.owner) ownedCount++;
          }
          if (ownedCount >= requiredOwnedNeighbors) {
            holesToFill.push({ x: nx, y: ny, key, ownedCount });
          }
        }
      }
    };

    collectHoles(3);
    if (holesToFill.length < Math.floor(dynamicFillBudget * 0.35)) collectHoles(2);

    holesToFill.sort((a, b) => b.ownedCount - a.ownedCount);

    for (const hole of holesToFill.slice(0, dynamicFillBudget)) {
      if (useMatrix && nIdx !== undefined) {
        matrix.setOwner(hole.x, hole.y, nIdx);
        if (loyaltyEnabled) matrix.setLoyalty(hole.x, hole.y, nIdx, 1.0);
      }
      addTerritoryCell(nation, hole.x, hole.y);
      ownershipMap.set(hole.key, nation);
    }
  }
}

/**
 * Calculate defense effects from nearby structures (OpenFront-style defense posts)
 * Towers/towns in range cause higher troop losses and slower attack speed
 * Only the strongest effect applies (like OpenFront's "only one post applies per tile")
 * @param {number} x - Target tile x coordinate
 * @param {number} y - Target tile y coordinate
 * @param {object} defenderNation - The nation defending the tile
 * @param {object} structureConfig - Config for structure defense values
 * @returns {object} { troopLossMultiplier, speedMultiplier }
 */
function getStructureDefenseBoost(x, y, defenderNation, structureConfig) {
  if (!defenderNation?.cities || defenderNation.cities.length === 0) {
    return { troopLossMultiplier: 1, speedMultiplier: 1 };
  }

  const townConfig = structureConfig?.town || {
    defenseRadius: 20,
    troopLossMultiplier: 3.0,
    speedReduction: 0.5
  };
  const towerConfig = structureConfig?.tower || {
    defenseRadius: 40,
    troopLossMultiplier: 6.0,
    speedReduction: 0.66
  };

  let bestTroopLossMult = 1;
  let bestSpeedMult = 1;

  for (const city of defenderNation.cities) {
    // Use Euclidean distance like OpenFront
    const distance = Math.hypot(city.x - x, city.y - y);
    let radius, troopLossMult, speedReduction;

    if (city.type === "tower") {
      radius = towerConfig.defenseRadius;
      troopLossMult = towerConfig.troopLossMultiplier;
      speedReduction = towerConfig.speedReduction;
    } else if (city.type === "town" || city.type === "capital") {
      radius = townConfig.defenseRadius;
      troopLossMult = townConfig.troopLossMultiplier;
      speedReduction = townConfig.speedReduction;
    } else {
      continue;
    }

    if (distance <= radius) {
      // OpenFront style: only one defense post applies per tile (use the strongest)
      if (troopLossMult > bestTroopLossMult) {
        bestTroopLossMult = troopLossMult;
        bestSpeedMult = 1 - speedReduction; // Convert reduction to multiplier
      }
    }
  }

  return { troopLossMultiplier: bestTroopLossMult, speedMultiplier: bestSpeedMult };
}

function getDirectionalFrontierCandidates(
  nation,
  mapData,
  ownershipMap,
  direction,
  anchor,
  bonusesByOwner,
  order,
  cachedFrontierSet = null // OPTIMIZATION 3
) {
  const candidates = [];
  const seen = new Set();
  const baseDir = normalizeVector(direction?.x, direction?.y);
  const target = order?.target || null;
  const focusTicksRemaining = order?.focusTicksRemaining || 0;
  const targetReached = order?.targetReached || false;
  let dir = baseDir;
  if (target && anchor && !targetReached) {
    const targetDir = normalizeVector(target.x - anchor.x, target.y - anchor.y);
    if (targetDir) dir = targetDir;
  }
  if (!dir) return candidates;
  const baseMinAlignment = config?.territorial?.directionBiasMin ?? 0.1;
  const focusMinAlignment = config?.territorial?.targetFocusMinAlignment ?? 0.1;
  const minAlignment =
    focusTicksRemaining > 0 ? focusMinAlignment : baseMinAlignment;
  const alignmentWeight = config?.territorial?.alignmentWeight ?? 1;
  const alignmentPower = config?.territorial?.alignmentPower ?? 1.3;
  const perpPenalty = config?.territorial?.directionPerpPenalty ?? 0;
  const similarityWeight = config?.territorial?.similarityWeight ?? 0.6;
  const similarityPower = config?.territorial?.similarityPower ?? 1;
  const riverCrossingScorePenalty =
    config?.territorial?.riverCrossingScorePenalty ?? 0.3;
  const mountainCrossingScorePenalty =
    config?.territorial?.mountainCrossingScorePenalty ?? 0.45;
  const targetDistancePenalty =
    config?.territorial?.targetDistancePenalty ?? 0.03;
  const targetSpreadRadius = config?.territorial?.targetSpreadRadius ?? 12;
  const targetSpreadWeight = config?.territorial?.targetSpreadWeight ?? 1.4;
  const distancePenaltyPerTile =
    config?.territorial?.distancePenaltyPerTile ?? 0.02;
  const candidateLimit = config?.territorial?.frontierCandidateLimit ?? 0;
  const scanLimit = config?.territorial?.frontierScanLimit ?? 0;
  const pocketBonus = config?.territorial?.pocketBonus ?? 2;
  const compactnessWeight = config?.territorial?.compactnessWeight ?? 0.8;
  const randomnessWeight = config?.territorial?.randomnessWeight ?? 0.5;

  const territoryX = nation?.territory?.x || [];
  const territoryY = nation?.territory?.y || [];
  const width = mapData[0].length;
  const height = mapData.length;

  // OPTIMIZATION 3: If we have a cached frontier set, use it for faster iteration
  const useCachedFrontier = cachedFrontierSet && cachedFrontierSet.size > 0;

  // OPTIMIZATION 3: Fast frontier scan using cached frontier set
  const scanFrontierFromCache = (minAlignment, maxSamples) => {
    if (!cachedFrontierSet) return;
    let scanned = 0;
    const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    for (const key of cachedFrontierSet) {
      if (seen.has(key)) continue;
      seen.add(key);

      const [xStr, yStr] = key.split(",");
      const nx = Number(xStr);
      const ny = Number(yStr);

      const owner = ownershipMap.get(key);
      if (owner?.owner === nation.owner) continue;

      const cell = mapData[ny]?.[nx];
      if (!cell || cell.biome === "OCEAN") continue;

      // Find a source cell (adjacent owned tile)
      let sourceX = nx, sourceY = ny;
      let sourceCell = null;
      for (const [dx, dy] of neighbors) {
        const sx = nx + dx;
        const sy = ny + dy;
        if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
        if (ownershipMap.get(`${sx},${sy}`)?.owner === nation.owner) {
          sourceX = sx;
          sourceY = sy;
          sourceCell = mapData[sy]?.[sx];
          break;
        }
      }
      if (!sourceCell) continue;

      const alignment = computeAlignment(anchor, { x: nx, y: ny }, dir);

      // Count adjacent owned tiles for compactness bonus (favors blob-like expansion)
      let adjacentOwned = 0;
      for (const [adx, ady] of neighbors) {
        const ax = nx + adx;
        const ay = ny + ady;
        if (ax < 0 || ay < 0 || ax >= width || ay >= height) continue;
        if (ownershipMap.get(`${ax},${ay}`)?.owner === nation.owner) {
          adjacentOwned += 1;
        }
      }
      const isPocket = owner && owner.owner !== nation.owner && adjacentOwned >= 3;
      if (alignment < minAlignment && !isPocket) continue;

      const similarity = getTerrainCostModifiers(sourceCell?.biome, cell?.biome).similarity;
      let terrainScorePenalty = 0;
      if (sourceCell?.biome === "RIVER" || cell?.biome === "RIVER") {
        terrainScorePenalty += riverCrossingScorePenalty;
      }
      if (sourceCell?.biome === "MOUNTAIN" || cell?.biome === "MOUNTAIN") {
        terrainScorePenalty += mountainCrossingScorePenalty;
      }
      if (terrainScorePenalty > 0 && owner && owner.owner !== nation.owner) {
        const attackerPower = bonusesByOwner?.[nation.owner]?.attackPower || 1;
        const defenderPower = bonusesByOwner?.[owner.owner]?.defensePower || 1;
        const advantage = attackerPower / Math.max(0.5, defenderPower);
        const advantageScale = Math.max(0.4, 1 / Math.max(1, advantage));
        terrainScorePenalty *= advantageScale;
      }

      const distanceFromAnchor = anchor ? Math.hypot(nx - anchor.x, ny - anchor.y) : 0;
      const targetDistance = target && Number.isFinite(target.x) && Number.isFinite(target.y)
        ? Math.hypot(nx - target.x, ny - target.y)
        : null;
      const alignmentScore = Math.pow(Math.max(0, alignment), alignmentPower);
      const similarityScore = Math.pow(similarity, similarityPower);

      let perpDistance = 0;
      if (anchor) {
        const vx = nx - anchor.x;
        const vy = ny - anchor.y;
        const dot = vx * dir.x + vy * dir.y;
        const vLen2 = vx * vx + vy * vy;
        const perp2 = Math.max(0, vLen2 - dot * dot);
        perpDistance = Math.sqrt(perp2);
      }

      // Compactness bonus: tiles with more owned neighbors create blob-like shapes
      // adjacentOwned ranges from 1-4, normalize to 0-1 scale (1 neighbor = 0, 4 = 1)
      const compactnessScore = (adjacentOwned - 1) / 3;

      // Random noise for organic, natural-looking borders
      const randomScore = Math.random();

      let score =
        alignmentWeight * alignmentScore +
        similarityWeight * similarityScore -
        distancePenaltyPerTile * distanceFromAnchor -
        perpPenalty * perpDistance +
        (isPocket ? pocketBonus : 0) -
        terrainScorePenalty +
        compactnessWeight * compactnessScore +
        randomnessWeight * randomScore;

      if (targetDistance != null) {
        score -= targetDistancePenalty * targetDistance;
        if (focusTicksRemaining > 0) {
          const proximity = Math.max(0, 1 - targetDistance / Math.max(1, targetSpreadRadius));
          score += targetSpreadWeight * proximity;
        }
      }

      candidates.push({
        x: nx,
        y: ny,
        sourceX,
        sourceY,
        sourceBiome: sourceCell?.biome,
        targetBiome: cell?.biome,
        alignment,
        similarity,
        distanceFromAnchor,
        targetDistance,
        score,
      });

      scanned += 1;
      if (maxSamples > 0 && scanned >= maxSamples) return;
    }
  };

  const scanFrontier = (minAlignment, step, maxSamples) => {
    let scanned = 0;
    for (let i = 0; i < territoryX.length; i += step) {
      const x = territoryX[i];
      const y = territoryY[i];
      const neighbors = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const key = `${nx},${ny}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const owner = ownershipMap.get(key);
        if (owner?.owner === nation.owner) continue;
        const cell = mapData[ny][nx];
        if (!cell || cell.biome === "OCEAN") continue;
        const sourceCell = mapData[y]?.[x];
        const alignment = computeAlignment(anchor, { x: nx, y: ny }, dir);
        // Count adjacent owned tiles for compactness bonus (favors blob-like expansion)
        let adjacentOwned = 0;
        const neighborCoords = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
        for (const [adx, ady] of neighborCoords) {
          const ax = nx + adx;
          const ay = ny + ady;
          if (ax < 0 || ay < 0 || ax >= width || ay >= height) continue;
          if (ownershipMap.get(`${ax},${ay}`)?.owner === nation.owner) {
            adjacentOwned += 1;
          }
        }
        const isPocket =
          owner && owner.owner !== nation.owner && adjacentOwned >= 3;
        if (alignment < minAlignment && !isPocket) continue;
        const similarity = getTerrainCostModifiers(
          sourceCell?.biome,
          cell?.biome
        ).similarity;
        let terrainScorePenalty = 0;
        if (sourceCell?.biome === "RIVER" || cell?.biome === "RIVER") {
          terrainScorePenalty += riverCrossingScorePenalty;
        }
        if (sourceCell?.biome === "MOUNTAIN" || cell?.biome === "MOUNTAIN") {
          terrainScorePenalty += mountainCrossingScorePenalty;
        }
        if (terrainScorePenalty > 0 && owner && owner.owner !== nation.owner) {
          const attackerPower =
            bonusesByOwner?.[nation.owner]?.attackPower || 1;
          const defenderPower =
            bonusesByOwner?.[owner.owner]?.defensePower || 1;
          const advantage = attackerPower / Math.max(0.5, defenderPower);
          const advantageScale = Math.max(0.4, 1 / Math.max(1, advantage));
          terrainScorePenalty *= advantageScale;
        }
        const distanceFromAnchor = anchor
          ? Math.hypot(nx - anchor.x, ny - anchor.y)
          : 0;
        const targetDistance =
          target && Number.isFinite(target.x) && Number.isFinite(target.y)
            ? Math.hypot(nx - target.x, ny - target.y)
            : null;
        const alignmentScore = Math.pow(Math.max(0, alignment), alignmentPower);
        const similarityScore = Math.pow(similarity, similarityPower);
        let perpDistance = 0;
        if (anchor) {
          const vx = nx - anchor.x;
          const vy = ny - anchor.y;
          const dot = vx * dir.x + vy * dir.y;
          const vLen2 = vx * vx + vy * vy;
          const perp2 = Math.max(0, vLen2 - dot * dot);
          perpDistance = Math.sqrt(perp2);
        }
        // Compactness bonus: tiles with more owned neighbors create blob-like shapes
        // adjacentOwned ranges from 1-4, normalize to 0-1 scale (1 neighbor = 0, 4 = 1)
        const compactnessScore = (adjacentOwned - 1) / 3;
        // Random noise for organic, natural-looking borders
        const randomScore = Math.random();
        let score =
          alignmentWeight * alignmentScore +
          similarityWeight * similarityScore -
          distancePenaltyPerTile * distanceFromAnchor -
          perpPenalty * perpDistance +
          (isPocket ? pocketBonus : 0) -
          terrainScorePenalty +
          compactnessWeight * compactnessScore +
          randomnessWeight * randomScore;
        if (targetDistance != null) {
          score -= targetDistancePenalty * targetDistance;
          if (focusTicksRemaining > 0) {
            const proximity = Math.max(
              0,
              1 - targetDistance / Math.max(1, targetSpreadRadius)
            );
            score += targetSpreadWeight * proximity;
          }
        }
        candidates.push({
          x: nx,
          y: ny,
          sourceX: x,
          sourceY: y,
          sourceBiome: sourceCell?.biome,
          targetBiome: cell?.biome,
          alignment,
          similarity,
          distanceFromAnchor,
          targetDistance,
          score,
        });
        scanned += 1;
        if (maxSamples > 0 && scanned >= maxSamples) {
          return;
        }
      }
    }
  };

  // OPTIMIZATION 3: Use cached frontier set if available (much faster)
  if (useCachedFrontier) {
    scanFrontierFromCache(minAlignment, scanLimit > 0 ? scanLimit : 0);

    if (candidates.length === 0) {
      const relaxedAlignment = Math.min(0.35, minAlignment);
      scanFrontierFromCache(relaxedAlignment, scanLimit);
    }
  } else {
    // Fallback to original scanning method
    const primaryStep =
      scanLimit > 0 && territoryX.length > scanLimit
        ? Math.ceil(territoryX.length / scanLimit)
        : 1;
    scanFrontier(minAlignment, primaryStep, scanLimit > 0 ? scanLimit : 0);

    if (candidates.length === 0 && primaryStep > 1) {
      const relaxedAlignment = Math.min(0.35, minAlignment);
      const fallbackStep =
        scanLimit > 0 ? Math.ceil(territoryX.length / (scanLimit * 2)) : 1;
      scanFrontier(relaxedAlignment, Math.max(1, fallbackStep), scanLimit);
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  if (candidateLimit > 0 && candidates.length > candidateLimit) {
    return candidates.slice(0, candidateLimit);
  }
  return candidates;
}

function normalizeVector(x, y) {
  const dx = Number(x);
  const dy = Number(y);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  const len = Math.hypot(dx, dy);
  if (len === 0) return null;
  return { x: dx / len, y: dy / len };
}

function computeAlignment(anchor, target, dir) {
  if (!anchor) return 0;
  const vx = target.x - anchor.x;
  const vy = target.y - anchor.y;
  const len = Math.hypot(vx, vy) || 1;
  return (vx / len) * dir.x + (vy / len) * dir.y;
}

function getNationAnchor(nation) {
  const capital =
    nation.cities && nation.cities.find((city) => city.type === "capital");
  if (capital) return { x: capital.x, y: capital.y };
  if (nation.startingCell) return nation.startingCell;
  if (nation.territory?.x?.length > 0) {
    return { x: nation.territory.x[0], y: nation.territory.y[0] };
  }
  return null;
}

function getMinDistanceToTerritory(nation, x, y, maxDistance = Infinity) {
  if (!nation?.territory?.x || !nation?.territory?.y) return Infinity;
  let best = Infinity;
  const tx = nation.territory.x;
  const ty = nation.territory.y;
  for (let i = 0; i < tx.length; i++) {
    const dist = Math.abs(tx[i] - x) + Math.abs(ty[i] - y);
    if (dist < best) best = dist;
    if (best <= maxDistance) return best;
  }
  return best;
}

// Lazy-initialize and return the cached territory Set for O(1) lookups
// Also deduplicates the territory arrays if duplicates are detected
function getTerritorySetCached(nation) {
  // Check if _territorySet exists AND is actually a Set (not a plain object from MongoDB)
  if (!(nation._territorySet instanceof Set)) {
    nation._territorySet = new Set();
    if (nation.territory?.x && nation.territory?.y) {
      const originalLength = nation.territory.x.length;
      // Build set and detect duplicates
      for (let i = 0; i < nation.territory.x.length; i++) {
        nation._territorySet.add(`${nation.territory.x[i]},${nation.territory.y[i]}`);
      }
      // If set size differs from array length, we have duplicates - rebuild arrays
      if (nation._territorySet.size !== originalLength) {
        const newX = [];
        const newY = [];
        for (const key of nation._territorySet) {
          const [xStr, yStr] = key.split(",");
          newX.push(Number(xStr));
          newY.push(Number(yStr));
        }
        nation.territory.x = newX;
        nation.territory.y = newY;
        console.log(`[DEDUPE] ${nation.name || nation.owner} had ${originalLength - nation._territorySet.size} duplicate tiles removed`);
      }
    }
  }
  return nation._territorySet;
}

// Neighbors for border calculations
const NEIGHBORS_4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Update border set when a cell is added - only the new cell and its neighbors might change border status
function updateBorderOnAdd(nation, x, y, territorySet) {
  // Ensure _borderSet is a proper Set (might be plain object from MongoDB)
  if (!(nation._borderSet instanceof Set)) {
    nation._borderSet = new Set();
  }
  const key = `${x},${y}`;

  // Check if the new cell is a border cell (has non-owned neighbor)
  let isBorder = false;
  for (const [dx, dy] of NEIGHBORS_4) {
    const nKey = `${x + dx},${y + dy}`;
    if (!territorySet.has(nKey)) {
      isBorder = true;
    } else {
      // This neighbor was potentially a border cell, recheck it
      let neighborStillBorder = false;
      for (const [ddx, ddy] of NEIGHBORS_4) {
        if (!territorySet.has(`${x + dx + ddx},${y + dy + ddy}`)) {
          neighborStillBorder = true;
          break;
        }
      }
      if (!neighborStillBorder) {
        nation._borderSet.delete(nKey);
      }
    }
  }
  if (isBorder) {
    nation._borderSet.add(key);
  }
}

// Update border set when a cell is removed
function updateBorderOnRemove(nation, x, y, territorySet) {
  // Ensure _borderSet is a proper Set (might be plain object from MongoDB)
  if (!(nation._borderSet instanceof Set)) {
    nation._borderSet = new Set();
    return; // If it wasn't a Set, just return - it will be rebuilt when needed
  }
  const key = `${x},${y}`;
  nation._borderSet.delete(key);

  // Neighbors of removed cell become border cells if they're still in territory
  for (const [dx, dy] of NEIGHBORS_4) {
    const nKey = `${x + dx},${y + dy}`;
    if (territorySet.has(nKey)) {
      nation._borderSet.add(nKey);
    }
  }
}

// Get cached border set for efficient border operations
function getBorderSetCached(nation) {
  if (!(nation._borderSet instanceof Set)) {
    nation._borderSet = new Set();
    const territorySet = getTerritorySetCached(nation);
    if (nation.territory?.x && nation.territory?.y) {
      for (let i = 0; i < nation.territory.x.length; i++) {
        const x = nation.territory.x[i];
        const y = nation.territory.y[i];
        // Cell is border if any neighbor is not in territory
        for (const [dx, dy] of NEIGHBORS_4) {
          if (!territorySet.has(`${x + dx},${y + dy}`)) {
            nation._borderSet.add(`${x},${y}`);
            break;
          }
        }
      }
    }
  }
  return nation._borderSet;
}

function addTerritoryCell(nation, x, y) {
  if (!nation.territory) {
    nation.territory = { x: [], y: [] };
  }
  if (!nation.territoryDelta) {
    nation.territoryDelta = { add: { x: [], y: [] }, sub: { x: [], y: [] } };
  }
  const key = `${x},${y}`;
  const territorySet = getTerritorySetCached(nation);
  // O(1) check
  if (territorySet.has(key)) {
    return;
  }
  nation.territory.x.push(x);
  nation.territory.y.push(y);
  territorySet.add(key);
  nation.territoryDelta?.add.x.push(x);
  nation.territoryDelta?.add.y.push(y);
  updateBorderOnAdd(nation, x, y, territorySet);
}

function removeTerritoryCell(nation, x, y) {
  if (!nation?.territory?.x || !nation?.territory?.y) return;
  if (!nation.territoryDelta) {
    nation.territoryDelta = { add: { x: [], y: [] }, sub: { x: [], y: [] } };
  }
  const key = `${x},${y}`;
  const territorySet = getTerritorySetCached(nation);
  // O(1) check
  if (!territorySet.has(key)) {
    return;
  }
  // O(n) to find index for splice
  for (let i = 0; i < nation.territory.x.length; i++) {
    if (nation.territory.x[i] === x && nation.territory.y[i] === y) {
      nation.territory.x.splice(i, 1);
      nation.territory.y.splice(i, 1);
      territorySet.delete(key);
      nation.territoryDelta?.sub.x.push(x);
      nation.territoryDelta?.sub.y.push(y);
      updateBorderOnRemove(nation, x, y, territorySet);
      break;
    }
  }
}
