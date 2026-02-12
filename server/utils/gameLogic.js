// gameLogic.js
import config from "../config/config.js";
import {
  getTerrainCostModifiers,
  getNodeMultiplier,
} from "./territorialUtils.js";
import { UNOWNED } from "./TerritoryMatrix.js";
import {
  computeConnectedComponent,
  removeDisconnectedTerritory,
} from "./matrixKernels.js";
import { applyArrowLoyaltyPressure } from "./matrixLoyalty.js";
import { resolveDensityCombat } from "./matrixTroopDensity.js";
import {
  generateCityName,
  generateTowerName,
  generateUniqueName,
} from "./nameGenerator.js";
import { debug, debugWarn } from "./debug.js";

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
    nation.territoryPercentage =
      Math.round((territoryCount / totalClaimable) * 10000) / 100;
    if (nation.territoryPercentage >= winThreshold) {
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
    set.add((territory.y[i] << 16) | territory.x[i]);
  }
  return set;
}

export function isCellInTerritory(territory, x, y, territorySet = null) {
  const numKey = (y << 16) | x;
  if (territorySet) return territorySet.has(numKey);
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
  cachedFrontierSet = null, // unused, kept for call-site compat
  matrix = null, // Matrix system: when provided, uses typed-array operations
  regionData = null,
) {
  return updateNationTerritorial(
    nation,
    mapData,
    gameState,
    ownershipMap,
    bonusesByOwner,
    currentTick,
    matrix,
    regionData,
  );
}

function updateNationTerritorial(
  nation,
  mapData,
  gameState,
  ownershipMap,
  bonusesByOwner,
  currentTick,
  matrix = null, // Matrix system
  regionData = null,
) {
  if (!Array.isArray(mapData) || !Array.isArray(mapData[0])) {
    debugWarn("Invalid map data structure in updateNationTerritorial");
    return nation;
  }

  const useMatrix = !!matrix;
  const nIdx = useMatrix ? matrix.ownerToIndex.get(nation.owner) : undefined;

  const updatedNation = nation;
  updatedNation.resources = updatedNation.resources || {};
  updatedNation.territoryDelta = updatedNation.territoryDelta || {
    add: { x: [], y: [] },
    sub: { x: [], y: [] },
  };
  // Stash current tick so arrow expiry can use tick-based age
  updatedNation._currentTick = currentTick;

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
    if (!useMatrix) ownershipMap?.set(`${x},${y}`, updatedNation);
  };

  const _removeCell = (x, y) => {
    if (useMatrix && nIdx !== undefined) {
      if (matrix.isOwnedBy(x, y, nIdx)) {
        matrix.setOwner(x, y, UNOWNED);
      }
    }
    removeTerritoryCell(updatedNation, x, y);
    if (!useMatrix) ownershipMap?.delete(`${x},${y}`);
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
    if (ownershipMap)
      return ownershipMap.get(key)?.owner === updatedNation.owner;
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
      const towns =
        updatedNation.cities?.filter((city) => city.type === "town") || [];
      if (towns.length > 0) {
        // Promote the first town to capital
        towns[0].type = "capital";
        debug(
          `[NATION] ${updatedNation.owner}: Town "${towns[0].name}" promoted to capital`,
        );
      } else {
        markDefeated();
        skipActions = true;
      }
    } else {
      // Check if capital is still in our territory
      const capitalSafe =
        _isOwnedByUs(capital.x, capital.y) ||
        isCellInTerritory(updatedNation.territory, capital.x, capital.y);

      if (!capitalSafe) {
        // Capital territory lost - try to promote nearest town
        const towns =
          updatedNation.cities?.filter((city) => city.type === "town") || [];
        if (towns.length > 0) {
          // Find nearest town that is still in our territory
          let nearestTown = null;
          let minDistance = Infinity;
          for (const town of towns) {
            const townInTerritory =
              _isOwnedByUs(town.x, town.y) ||
              isCellInTerritory(updatedNation.territory, town.x, town.y);
            if (townInTerritory) {
              const distance =
                Math.abs(town.x - capital.x) + Math.abs(town.y - capital.y);
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
              (c) =>
                c.type === "capital" &&
                c.x === capital.x &&
                c.y === capital.y &&
                c !== nearestTown,
            );
            if (capitalIndex !== -1) {
              updatedNation.cities.splice(capitalIndex, 1);
            }
            debug(
              `[NATION] ${updatedNation.owner}: Capital lost, town "${nearestTown.name}" promoted to capital`,
            );
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

  const bonuses = bonusesByOwner?.[updatedNation.owner] || {
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
    const ownedTiles =
      useMatrix && nIdx !== undefined
        ? matrix.countTerritory(nIdx)
        : updatedNation.territory?.x?.length || 0;
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

    // Initialize troop count if missing
    if (updatedNation.troopCount == null) updatedNation.troopCount = 0;
    if (updatedNation.troopTarget == null) updatedNation.troopTarget = 0.2;

    // Growth formula: (10 + pop^0.73/4) * (1 - pop/maxPop)
    // When troop density is enabled, use freePop (non-troops) as the growth base
    // This makes high troop % slow down growth
    const currentPop = updatedNation.population || 0;
    const troopDensityEnabled = config?.troopDensity?.enabled;
    const freePop = troopDensityEnabled
      ? Math.max(0, currentPop - (updatedNation.troopCount || 0))
      : currentPop;
    const popRatio = Math.min(1, currentPop / maxPopulation);
    const baseGrowthRate = 10 + Math.pow(Math.max(1, freePop), 0.73) / 4;
    const growth = baseGrowthRate * (1 - popRatio) * bonuses.production;

    updatedNation.population = Math.min(maxPopulation, currentPop + growth);

    // Passive gold income from nodes (scales by free worker ratio when troop density enabled)
    if (bonuses.goldIncome > 0) {
      const goldScale =
        troopDensityEnabled && currentPop > 0 ? freePop / currentPop : 1;
      updatedNation.resources.gold =
        (updatedNation.resources.gold || 0) + bonuses.goldIncome * goldScale;
    }

    // Population-based food production — free workers produce food
    const maintCfg = config?.troopMaintenance;
    if (maintCfg?.foodProductionPerPop && currentPop > 0) {
      const foodWorkers = troopDensityEnabled ? freePop : currentPop;
      updatedNation.resources.food =
        (updatedNation.resources.food || 0) +
        foodWorkers * maintCfg.foodProductionPerPop * bonuses.production;
    }

    // Troop maintenance costs — scales with mobilization ratio
    if (
      maintCfg &&
      troopDensityEnabled &&
      updatedNation.troopCount > 0 &&
      currentPop > 0
    ) {
      const mobRatio = updatedNation.troopCount / currentPop;
      const threshold = maintCfg.freeThreshold || 0.25;
      const costMult = mobRatio / threshold;

      const foodCost =
        updatedNation.troopCount * (maintCfg.foodCostPerTroop || 0) * costMult;
      const goldCost =
        updatedNation.troopCount * (maintCfg.goldCostPerTroop || 0) * costMult;

      updatedNation.resources.food =
        (updatedNation.resources.food || 0) - foodCost;
      updatedNation.resources.gold =
        (updatedNation.resources.gold || 0) - goldCost;

      // Auto-reduce mobilization when resources depleted
      const autoTarget = maintCfg.autoReduceTarget || 0.15;
      if (
        updatedNation.resources.food <= 0 ||
        updatedNation.resources.gold <= 0
      ) {
        updatedNation.resources.food = Math.max(
          0,
          updatedNation.resources.food,
        );
        updatedNation.resources.gold = Math.max(
          0,
          updatedNation.resources.gold,
        );
        if (updatedNation.troopTarget > autoTarget) {
          updatedNation.troopTarget = autoTarget;
        }
      }
    }

    if (updatedNation.isBot) {
      maybeEnqueueBotArrow(
        updatedNation,
        mapData,
        ownershipMap,
        bonusesByOwner,
        currentTick,
        gameState,
        matrix,
      );
      maybeEnqueueBotBuild(
        updatedNation,
        mapData,
        gameState,
        currentTick,
        regionData,
        matrix,
      );
    }

    // Apply arrow orders (Big Arrow system)
    if (
      updatedNation.arrowOrders &&
      (updatedNation.arrowOrders.attacks?.length > 0 ||
        updatedNation.arrowOrders.attack ||
        updatedNation.arrowOrders.defend)
    ) {
      try {
        processArrowOrders(
          updatedNation,
          gameState,
          mapData,
          ownershipMap,
          bonusesByOwner,
          matrix,
        );
      } catch (arrowErr) {
        console.error(
          `[ARROW] Error processing arrows for ${updatedNation.name || updatedNation.owner}:`,
          arrowErr.message,
          arrowErr.stack,
        );
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
      const currentCapital = updatedNation.cities?.find(
        (c) => c.type === "capital",
      );
      // Always clear disconnected cells blacklist at start of connectivity check
      // so cells that reconnect via a different path are no longer blocked
      if (updatedNation._disconnectedCells instanceof Set) {
        updatedNation._disconnectedCells.clear();
      } else {
        updatedNation._disconnectedCells = new Set();
      }

      if (useMatrix && nIdx !== undefined && currentCapital) {
        // Matrix path: BFS on typed array — O(cells) with no string allocation
        const removed = removeDisconnectedTerritory(
          matrix,
          nIdx,
          currentCapital.x,
          currentCapital.y,
        );
        if (removed > 0) {
          // Sync legacy territory arrays from matrix
          const cells = matrix.getCellsForNation(nIdx);
          // Build set of new cells for fast lookup
          const newCellSet = new Set();
          for (let i = 0; i < cells.x.length; i++) {
            newCellSet.add((cells.y[i] << 16) | cells.x[i]);
          }
          // Derive removals for delta
          const tx = updatedNation.territory?.x || [];
          const ty = updatedNation.territory?.y || [];
          // Track disconnected cells so arrows don't immediately recapture them this tick
          if (!updatedNation._disconnectedCells)
            updatedNation._disconnectedCells = new Set();
          for (let i = 0; i < tx.length; i++) {
            const numKey = (ty[i] << 16) | tx[i];
            if (!newCellSet.has(numKey)) {
              updatedNation.territoryDelta.sub.x.push(tx[i]);
              updatedNation.territoryDelta.sub.y.push(ty[i]);
              ownershipMap?.delete(`${tx[i]},${ty[i]}`);
              updatedNation._disconnectedCells.add(numKey);
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
            if (!connected.has((ty[i] << 16) | tx[i])) {
              removeTerritoryCell(updatedNation, tx[i], ty[i]);
              ownershipMap?.delete(`${tx[i]},${ty[i]}`);
            }
          }
        }
      }
    }
  }

  // NOTE: territoryDeltaForClient is computed by applyMatrixToNations at tick end
  // from the matrix ownership snapshot diff. No need to derive it here.
  // territoryDelta is kept for processRoom's ownership map cache.

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
    const numKey = (y << 16) | x;
    if (connected.has(numKey)) continue;
    if (!territorySet.has(numKey)) continue;
    connected.add(numKey);
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
      const nKey = (ny << 16) | nx;
      if (!connected.has(nKey) && territorySet.has(nKey)) {
        queue.push([nx, ny]);
      }
    }
  }
  return connected;
}

/**
 * Bot building logic: attempts to build towns and towers when affordable.
 * Runs every ~50 ticks to avoid spamming.
 */
function maybeEnqueueBotBuild(
  nation,
  mapData,
  gameState,
  currentTick,
  regionData,
  matrix = null,
) {
  if (nation.status === "defeated") return;

  // Only try building every 50 ticks (~5 seconds)
  const lastBuildTick = nation._lastBotBuildTick ?? -Infinity;
  if (currentTick - lastBuildTick < 50) return;
  nation._lastBotBuildTick = currentTick;

  const buildCosts = config?.buildCosts?.structures;
  if (!buildCosts) return;

  const resources = nation.resources || {};
  const territory = nation.territory;
  if (!territory?.x?.length || territory.x.length < 30) return; // Need some territory first

  const regionCfg = config?.regions;
  const assignment = regionData?.assignment;
  const regWidth = regionData?.width;

  // Determine what to build: prefer town first, then tower
  const buildOrder = ["town", "tower"];

  for (const buildType of buildOrder) {
    const cost = buildCosts[buildType];
    if (!cost) continue;

    // Check affordability
    let canAfford = true;
    for (const res in cost) {
      if ((resources[res] || 0) < cost[res]) {
        canAfford = false;
        break;
      }
    }
    if (!canAfford) continue;

    // Count existing structures of this type
    const existing = (nation.cities || []).filter(
      (c) =>
        c.type === buildType || (buildType === "town" && c.type === "capital"),
    );

    // Bots limit: 1 town per ~100 territory, up to 3; towers: 1 per ~60 territory, up to 4
    const maxForBot =
      buildType === "town"
        ? Math.min(3, Math.floor(territory.x.length / 100))
        : Math.min(4, Math.floor(territory.x.length / 60));
    if (existing.length >= maxForBot) continue;

    // Find a valid cell to build on
    const anchor = getNationAnchor(nation);
    if (!anchor) continue;

    const tx = territory.x;
    const ty = territory.y;

    // Build a set of all nations' structures for distance checks
    const allCities = [];
    for (const n of gameState?.nations || []) {
      for (const c of n.cities || []) {
        allCities.push(c);
      }
    }

    let bestCell = null;
    let bestScore = -Infinity;

    // Sample territory cells (check up to 200 random cells to avoid O(n) on huge territories)
    const sampleSize = Math.min(territory.x.length, 200);
    const step = Math.max(1, Math.floor(territory.x.length / sampleSize));

    for (let i = 0; i < territory.x.length; i += step) {
      const cx = tx[i];
      const cy = ty[i];

      // Skip if out of map bounds
      if (!mapData[cy] || !mapData[cy][cx]) continue;

      // Skip ocean
      const cell = mapData[cy][cx];
      if (cell.biome === "OCEAN") continue;

      // Skip if a structure already exists here
      if (allCities.some((c) => c.x === cx && c.y === cy)) continue;

      // Distance checks
      if (buildType === "town") {
        // Must be 5+ cells from other towns/capitals
        const tooClose = allCities.some(
          (c) =>
            (c.type === "town" || c.type === "capital") &&
            Math.abs(c.x - cx) + Math.abs(c.y - cy) < 5,
        );
        if (tooClose) continue;
      } else if (buildType === "tower") {
        // Must be 3+ cells from other towers
        const tooClose = (nation.cities || []).some(
          (c) =>
            c.type === "tower" && Math.abs(c.x - cx) + Math.abs(c.y - cy) < 3,
        );
        if (tooClose) continue;
      }

      // Region limit check
      if (assignment && regWidth && regionCfg) {
        const rId = assignment[cy * regWidth + cx];
        if (rId !== 65535) {
          if (buildType === "town") {
            let townCount = 0;
            for (const c of allCities) {
              if (
                (c.type === "town" || c.type === "capital") &&
                assignment[c.y * regWidth + c.x] === rId
              ) {
                townCount++;
              }
            }
            if (townCount >= (regionCfg.maxTownsPerRegion ?? 1)) continue;
          } else if (buildType === "tower") {
            let towerCount = 0;
            for (const c of nation.cities || []) {
              if (
                c.type === "tower" &&
                assignment[c.y * regWidth + c.x] === rId
              ) {
                towerCount++;
              }
            }
            if (towerCount >= (regionCfg.maxTowersPerRegion ?? 2)) continue;
          }
        }
      }

      // Scoring: prefer cells away from capital (for spread), closer to border (for towers)
      const distFromAnchor = Math.hypot(cx - anchor.x, cy - anchor.y);
      let score = 0;

      if (buildType === "town") {
        // Towns: prefer moderate distance from anchor, not too far
        score = distFromAnchor - Math.abs(distFromAnchor - 15) * 0.5;
      } else {
        // Towers: prefer border regions (cells near territory edge)
        score = distFromAnchor * 0.5; // further from capital is better for defense
      }

      if (score > bestScore) {
        bestScore = score;
        bestCell = { x: cx, y: cy };
      }
    }

    if (!bestCell) continue;

    // Deduct resources
    for (const res in cost) {
      nation.resources[res] = (nation.resources[res] || 0) - cost[res];
    }

    // Create the structure with a proper generated name
    const existingNames = new Set((nation.cities || []).map((c) => c.name));
    const structureName =
      buildType === "town"
        ? generateUniqueName(generateCityName, existingNames)
        : generateUniqueName(generateTowerName, existingNames);

    nation.cities = nation.cities || [];
    nation.cities.push({
      name: structureName,
      x: bestCell.x,
      y: bestCell.y,
      population: buildType === "tower" ? 0 : 50,
      type: buildType,
    });

    // Invalidate loyalty city bonus cache
    if (matrix) matrix._cityBonusVersion = (matrix._cityBonusVersion || 0) + 1;

    debug(
      `[BOTS] ${nation.name || nation.owner} built ${buildType} "${structureName}" at (${bestCell.x},${bestCell.y})`,
    );

    // Only build one structure per tick
    return;
  }
}

function selectBotTargetCellAny(
  nation,
  mapData,
  ownershipMap,
  anchor,
  resourceNodeClaims,
  matrix = null,
  nIdx = undefined,
) {
  const candidates = getFrontierCandidatesForBot(
    nation,
    mapData,
    ownershipMap,
    anchor,
    resourceNodeClaims,
    matrix,
    nIdx,
  );
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function selectBotTargetCell(
  nation,
  mapData,
  ownershipMap,
  anchor,
  resourceNodeClaims,
  matrix = null,
  nIdx = undefined,
) {
  const candidates = getFrontierCandidatesForBot(
    nation,
    mapData,
    ownershipMap,
    anchor,
    resourceNodeClaims,
    matrix,
    nIdx,
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
  matrix = null,
) {
  // Skip defeated bots
  if (nation.status === "defeated") {
    return;
  }

  if (!ownershipMap && !matrix) {
    if (process.env.DEBUG_BOTS === "true") {
      debug(`[BOTS] skip ${nation.owner} no ownership source`);
    }
    return;
  }

  // Migrate legacy single attack to attacks[]
  migrateArrowOrders(nation);

  // Adapt bot troop mobilization target based on game state
  if (config?.troopDensity?.enabled) {
    const attacks = nation.arrowOrders?.attacks || [];
    // Check if any enemy arrows are targeting cells near this nation's territory
    const underThreat = (gameState?.nations || []).some((n) => {
      if (n.owner === nation.owner || n.status === "defeated") return false;
      const enemyAttacks = n.arrowOrders?.attacks || [];
      return enemyAttacks.some((a) => {
        if (!a.path || a.path.length < 2) return false;
        const target = a.path[a.path.length - 1];
        const dist = getMinDistanceToTerritory(nation, target.x, target.y, 15);
        return dist <= 10;
      });
    });

    if (underThreat) {
      nation.troopTarget = 0.4; // Under threat: high mobilization
    } else if (attacks.length > 0) {
      nation.troopTarget = 0.3; // Active arrows: moderate mobilization
    } else {
      nation.troopTarget = 0.15; // Peacetime: low mobilization
    }
  }

  const maxAttackArrows = config?.territorial?.maxAttackArrows ?? 3;
  const attacks = nation.arrowOrders?.attacks || [];

  // Determine max arrows for this bot based on territory size
  const territorySize = nation.territory?.x?.length || 0;
  const botMaxArrows = territorySize > 200 ? Math.min(2, maxAttackArrows) : 1;

  // Check if bot already has max arrows
  if (attacks.length >= botMaxArrows) {
    if (tickCount % 20 === 0) {
      debug(
        `[BOTS] ${nation.name || nation.owner} has ${attacks.length} active arrows`,
      );
    }
    return;
  }

  const orderInterval = config?.territorial?.botOrderIntervalTicks ?? 4;
  const lastTick = nation.lastBotOrderTick ?? -Infinity;
  if (tickCount - lastTick < orderInterval) {
    if (tickCount % 50 === 0 && process.env.DEBUG_BOTS === "true") {
      debug(
        `[BOTS] ${nation.name || nation.owner} waiting (interval=${tickCount - lastTick}/${orderInterval})`,
      );
    }
    return;
  }

  const anchor = getNationAnchor(nation);
  if (!anchor) {
    if (process.env.DEBUG_BOTS === "true") {
      debug(`[BOTS] skip ${nation.owner} no anchor`);
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
    nIdx,
  );
  if (!candidate) {
    candidate = selectBotTargetCellAny(
      nation,
      mapData,
      ownershipMap,
      anchor,
      resourceNodeClaims,
      matrix,
      nIdx,
    );
  }
  if (!candidate) {
    debug(
      `[BOTS] ${nation.name || nation.owner} has no expansion candidates (territory: ${nation.territory?.x?.length || 0} cells)`,
    );
    return;
  }

  // Diagnostic: how far is the frontier candidate from the nearest border?
  const borderDist = getMinDistanceToTerritory(
    nation,
    candidate.x,
    candidate.y,
    20,
  );
  const anchorDist = Math.hypot(candidate.x - anchor.x, candidate.y - anchor.y);

  const minPercent = config?.territorial?.minAttackPercent ?? 0.05;
  const maxPercent = config?.territorial?.maxAttackPercent ?? 1;
  const rawPercent =
    config?.territorial?.botAttackPercent ??
    config?.territorial?.defaultAttackPercent ??
    0.3;
  const clampedPercent = Math.min(Math.max(rawPercent, minPercent), maxPercent);

  const troopDensityEnabled = config?.troopDensity?.enabled;

  const available = nation.population || 0;
  const power = available * clampedPercent;
  if (power <= 0) {
    debug(
      `[BOTS] ${nation.name || nation.owner} has no population (${available.toFixed(1)})`,
    );
    return;
  }

  const actualPower = available < 10 ? available : power;

  // Arrow resource cost check for bots
  const arrowCostCfg = config?.arrowCosts;
  if (arrowCostCfg) {
    const attacks = nation.arrowOrders?.attacks || [];
    // First arrow free: applies when bot has no active arrows at all
    const isFirstArrow = arrowCostCfg.firstArrowFree && attacks.length === 0;
    if (!isFirstArrow) {
      const estPathLen = Math.hypot(
        candidate.x - anchor.x,
        candidate.y - anchor.y,
      );
      const foodCost = Math.ceil(
        arrowCostCfg.food.base + arrowCostCfg.food.perTile * estPathLen,
      );
      const goldCost = Math.ceil(
        arrowCostCfg.gold.base + arrowCostCfg.gold.perTile * estPathLen,
      );
      // Bots keep a resource buffer — don't spend last 30% of resources on arrows
      const foodAvail = (nation.resources?.food || 0) * 0.7;
      const goldAvail = (nation.resources?.gold || 0) * 0.7;
      if (foodAvail < foodCost || goldAvail < goldCost) {
        return; // Can't afford arrow, save resources
      }
      nation.resources.food -= foodCost;
      nation.resources.gold -= goldCost;
    }
  }

  // In troop density mode, verify there's meaningful troop density near the
  // border in the target direction before committing resources to an arrow.
  // Without this check, bots create arrows targeting border areas with no
  // troops, which immediately stall and waste arrow slots + resources.
  if (troopDensityEnabled && matrix) {
    const nIdx2 = matrix.ownerToIndex.get(nation.owner);
    if (nIdx2 !== undefined) {
      // Walk from anchor toward candidate, find the border crossing
      const bdx = candidate.x - anchor.x;
      const bdy = candidate.y - anchor.y;
      const bdist = Math.hypot(bdx, bdy);
      if (bdist > 1) {
        const bnx = bdx / bdist;
        const bny = bdy / bdist;
        let borderX = -1,
          borderY = -1;
        for (let s = 0; s <= Math.ceil(bdist); s++) {
          const sx = Math.round(anchor.x + bnx * s);
          const sy = Math.round(anchor.y + bny * s);
          if (!matrix.inBounds(sx, sy)) break;
          if (!matrix.isOwnedBy(sx, sy, nIdx2)) {
            borderX = Math.round(anchor.x + bnx * Math.max(0, s - 1));
            borderY = Math.round(anchor.y + bny * Math.max(0, s - 1));
            break;
          }
        }
        if (borderX >= 0 && borderY >= 0) {
          // Check troop density in a small radius around the border crossing
          let borderDensity = 0;
          const checkR = 5;
          for (let dy2 = -checkR; dy2 <= checkR; dy2++) {
            for (let dx2 = -checkR; dx2 <= checkR; dx2++) {
              const fx = borderX + dx2;
              const fy = borderY + dy2;
              if (!matrix.inBounds(fx, fy)) continue;
              const fi = matrix.idx(fx, fy);
              if (matrix.ownership[fi] === nIdx2) {
                borderDensity += matrix.troopDensity[nIdx2 * matrix.size + fi];
              }
            }
          }
          if (borderDensity < 5) {
            return; // Not enough troops near border in this direction
          }
        }
      }
    }
  }

  // Only deduct population in legacy mode
  if (!troopDensityEnabled) {
    nation.population = Math.max(0, available - actualPower);
  }
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
    { x: targetX, y: targetY },
  ];

  nation.arrowOrders.attacks.push({
    id: `bot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "attack",
    path: arrowPath,
    currentIndex: 1,
    remainingPower: troopDensityEnabled ? 0 : actualPower,
    initialPower: troopDensityEnabled ? 0 : actualPower,
    troopCommitment: clampedPercent,
    percent: clampedPercent,
    createdAt: new Date(),
    createdAtTick: tickCount,
    frontWidth: 0,
    advanceProgress: 0,
    phase: 1,
    phaseConsolidationRemaining: 0,
    status: "advancing",
    opposingForces: [],
    headX: arrowPath[0].x,
    headY: arrowPath[0].y,
    effectiveDensityAtFront: 0,
  });

  nation.lastBotOrderTick = tickCount;
}

function pickBotDirection(nation, gameState, anchor) {
  if (!anchor) return randomDirection();
  const enemies = (gameState?.nations || []).filter(
    (n) => n.owner !== nation.owner && n.status !== "defeated",
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
  nIdx = undefined,
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
      if (ownershipMap?.get(key)?.owner === nation.owner) continue;
      // Check matrix ground truth — skip cells already owned by us (legacy map may be stale)
      if (matrix && nIdx !== undefined && matrix.isOwnedBy(nx, ny, nIdx))
        continue;
      const cell = mapData[ny]?.[nx];
      if (!cell || cell.biome === "OCEAN") continue;
      const sourceCell = mapData[y]?.[x];
      const similarity = getTerrainCostModifiers(
        sourceCell?.biome,
        cell?.biome,
      ).similarity;
      const similarityScore = Math.pow(similarity, similarityPower);
      const distance = anchor ? Math.hypot(nx - anchor.x, ny - anchor.y) : 0;
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
    legacy.phaseConsolidationRemaining =
      legacy.phaseConsolidationRemaining || 0;
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
    if (
      d < minDist ||
      (Math.abs(d - minDist) < 0.001 && progress > bestProgress)
    ) {
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
  arrow,
  nation,
  gameState,
  mapData,
  ownershipMap,
  bonusesByOwner,
  matrix,
) {
  const useMatrix = !!matrix;
  const nIdx = useMatrix ? matrix.ownerToIndex.get(nation.owner) : undefined;
  const loyaltyEnabled = useMatrix && config?.loyalty?.enabled !== false;
  const arrowLoyaltyGain = config?.loyalty?.arrowPressureLoyaltyGain ?? 0.1;

  const baseCost = config?.territorial?.baseCost || 1;
  const baseDefense = config?.territorial?.baseDefense || 1;
  const pressurePerTick = config?.territorial?.pressurePerTick || 6;
  const attemptsPerTick = config?.territorial?.frontierAttemptsPerTick || 8;
  const contestedDefenseMult =
    config?.territorial?.contestedDefenseMult ?? 1.25;
  const structureConfig = config?.structures || {};
  const terrainExpansionCostMultByBiome =
    config?.territorial?.terrainExpansionCostMultByBiome || {};
  const terrainDefenseMultByBiome =
    config?.territorial?.terrainDefenseMultByBiome || {};
  const riverCrossingCostMult =
    config?.territorial?.riverCrossingCostMult ?? 1.3;
  const mountainCrossingCostMult =
    config?.territorial?.mountainCrossingCostMult ?? 1.5;
  const distancePenaltyPerTile =
    config?.territorial?.distancePenaltyPerTile ?? 0.02;
  const maxDistancePenaltyTiles =
    config?.territorial?.maxDistancePenaltyTiles ?? 40;
  const minArrowDurationMs = config?.territorial?.minArrowDurationMs ?? 10000;
  const maxArrowDurationMs = config?.territorial?.maxArrowDurationMs ?? 120000;
  const arrowDurationPerPowerMs =
    config?.territorial?.arrowDurationPerPowerMs ?? 25;
  const arrowPressurePerSqrtPower =
    config?.territorial?.arrowPressurePerSqrtPower ?? 0.2;
  const maxArrowPressurePerTick =
    config?.territorial?.maxArrowPressurePerTick ??
    Math.max(pressurePerTick, 40);
  const arrowMaxStallTicks = config?.territorial?.arrowMaxStallTicks ?? 6;
  const maxArrowCandidates =
    config?.territorial?.maxArrowCandidatesPerNation ?? 500;

  const frontBaseWidth = config?.territorial?.frontBaseWidth ?? 3;
  const frontWidthPerSqrtPower =
    config?.territorial?.frontWidthPerSqrtPower ?? 0.3;
  const frontMaxWidth = config?.territorial?.frontMaxWidth ?? 20;
  const phaseConsolidationTicks =
    config?.territorial?.phaseConsolidationTicks ?? 3;
  const oppositionScanRadius = config?.territorial?.oppositionScanRadius ?? 3;
  const retreatReturnRate = config?.territorial?.retreatReturnRate ?? 0.1;

  const anchor = getNationAnchor(nation);
  const width = mapData[0]?.length || 0;
  const height = mapData.length || 0;
  const neighbors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  let remaining = arrow.remainingPower || 0;

  // Validate path
  const validPath =
    Array.isArray(arrow.path) &&
    arrow.path.length >= 2 &&
    arrow.path.every(
      (p) => p && typeof p.x === "number" && typeof p.y === "number",
    );
  if (!validPath) {
    debug(
      `[ARROW] Removing invalid attack arrow for ${nation.name || nation.owner}`,
    );
    return "remove";
  }

  // Check expiry (guard against NaN in initialPower/duration — NaN comparisons always return false)
  // Density-mode arrows don't use power-based time expiry — they last until
  // stalled, waypoints completed, or manually cancelled.
  const isDensityArrow =
    config?.troopDensity?.enabled && arrow.troopCommitment > 0;
  if (!isDensityArrow) {
    let initialPower = Number(arrow.initialPower ?? remaining ?? 0);
    if (!Number.isFinite(initialPower)) initialPower = 0;
    const scaledDuration =
      minArrowDurationMs + initialPower * arrowDurationPerPowerMs;
    const rawMaxDuration = Math.max(
      minArrowDurationMs,
      Math.min(maxArrowDurationMs, scaledDuration),
    );
    const maxDurationMs = Number.isFinite(rawMaxDuration)
      ? rawMaxDuration
      : maxArrowDurationMs;
    // Prefer tick-based age when available (avoids Date.now() clock skew)
    const tickRateMs = config?.territorial?.tickRateMs || 100;
    let arrowAge;
    if (arrow.createdAtTick != null && nation._currentTick != null) {
      arrowAge = (nation._currentTick - arrow.createdAtTick) * tickRateMs;
    } else {
      const rawAge = arrow.createdAt
        ? Date.now() - new Date(arrow.createdAt).getTime()
        : Infinity;
      arrowAge = Number.isFinite(rawAge) ? rawAge : Infinity;
    }
    if (arrowAge > maxDurationMs) {
      nation.population = (nation.population || 0) + Math.max(0, remaining);
      return "remove";
    }
  }

  // Fail-safe: check matrix directly for arrow completion (bypasses stale caches)
  const arrowTickCount = (arrow._debugTickCount || 0) + 1;
  arrow._debugTickCount = arrowTickCount;
  const shouldLog = arrowTickCount === 1 || arrowTickCount % 50 === 0;
  const arrowLabel = `[ARROW-STUCK ${nation.name || nation.owner} #${arrow._debugTickCount}]`;

  if (useMatrix && nIdx !== undefined) {
    let allWaypointsOwned = true;
    let firstUnownedWp = -1;
    let firstUnownedCoord = null;
    let firstUnownedOwner = -999;
    for (
      let pi = Math.max(1, arrow.currentIndex || 1);
      pi < arrow.path.length;
      pi++
    ) {
      const wp = arrow.path[pi];
      const rx = Math.round(wp.x);
      const ry = Math.round(wp.y);
      if (!matrix.isOwnedBy(rx, ry, nIdx)) {
        allWaypointsOwned = false;
        firstUnownedWp = pi;
        firstUnownedCoord = { x: rx, y: ry };
        firstUnownedOwner = matrix.inBounds(rx, ry)
          ? matrix.ownership[matrix.idx(rx, ry)]
          : -2;
        break;
      }
    }
    if (allWaypointsOwned) {
      // debug(
      //   `${arrowLabel} FAIL-SAFE REMOVE: all waypoints owned in matrix, power=${remaining}, pathLen=${arrow.path.length}, curIdx=${arrow.currentIndex}`,
      // );
      nation.population = (nation.population || 0) + Math.max(0, remaining);
      return "remove";
    } else if (shouldLog) {
      // debug(
      //   `${arrowLabel} fail-safe: NOT all owned — wp[${firstUnownedWp}]=(${firstUnownedCoord?.x},${firstUnownedCoord?.y}) matrixOwner=${firstUnownedOwner} nIdx=${nIdx}, power=${remaining}, curIdx=${arrow.currentIndex}/${arrow.path.length}, status=${arrow.status}, stalled=${arrow.stalledTicks || 0}`,
      // );
    }
  } else if (shouldLog) {
    // debug(
    //   `${arrowLabel} fail-safe SKIPPED: useMatrix=${useMatrix} nIdx=${nIdx}, power=${remaining}`,
    // );
  }

  // ─── Troop-density-based combat path ───
  const troopDensityEnabled = config?.troopDensity?.enabled;
  if (troopDensityEnabled && useMatrix && nIdx !== undefined) {
    // Handle retreat — density redistributes naturally via diffusion
    if (arrow.status === "retreating") {
      // Arrow attractor weakens over time; just remove after a few ticks
      arrow._retreatTicks = (arrow._retreatTicks || 0) + 1;
      if (arrow._retreatTicks > 10) return "remove";
      return;
    }

    // Handle consolidation (same as original)
    if (arrow.phaseConsolidationRemaining > 0) {
      arrow.phaseConsolidationRemaining--;
      arrow.status = "consolidating";
    } else if (arrow.status === "consolidating") {
      arrow.status = "advancing";
    }

    // Auto-skip waypoints that are already owned
    const territorySet = getTerritorySetCached(nation);
    let currentIndex = arrow.currentIndex || 1;
    while (currentIndex < arrow.path.length) {
      const wp = arrow.path[currentIndex];
      const rwx = Math.round(wp.x);
      const rwy = Math.round(wp.y);
      const inTerritory = territorySet.has((rwy << 16) | rwx);
      const matrixOwned = matrix.isOwnedBy(
        Math.round(wp.x),
        Math.round(wp.y),
        nIdx,
      );
      const isLastWaypoint = currentIndex === arrow.path.length - 1;
      if (isLastWaypoint) {
        if (inTerritory || matrixOwned) currentIndex++;
        else break;
      } else {
        const dist = getMinDistanceToTerritory(nation, wp.x, wp.y, 3);
        if (inTerritory || matrixOwned || dist <= 2) currentIndex++;
        else break;
      }
    }
    arrow.currentIndex = Math.min(currentIndex, arrow.path.length - 1);

    if (currentIndex >= arrow.path.length) {
      return "remove";
    }

    // Update head position: walk along the arrow path and find where it
    // crosses the territory border. The head is the last owned cell on the path.
    // This ensures the head is always at the actual border crossing, not at
    // some distant border segment that happens to project onto the path.
    {
      const mw = matrix.width;
      const mh = matrix.height;
      const mOwn = matrix.ownership;
      let headX = arrow.headX ?? arrow.path[0].x;
      let headY = arrow.headY ?? arrow.path[0].y;
      let bestProgress = 0;

      // Walk each path segment, sampling at 1-cell intervals
      const totalSegments = arrow.path.length - 1;
      let foundBorderCrossing = false;
      for (
        let seg = 0;
        seg < arrow.path.length - 1 && !foundBorderCrossing;
        seg++
      ) {
        const p1 = arrow.path[seg];
        const p2 = arrow.path[seg + 1];
        const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const steps = Math.max(1, Math.ceil(segLen));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const sx = Math.round(p1.x + t * (p2.x - p1.x));
          const sy = Math.round(p1.y + t * (p2.y - p1.y));
          if (sx < 0 || sy < 0 || sx >= mw || sy >= mh) continue;
          const ci = sy * mw + sx;
          if (mOwn[ci] === nIdx) {
            // This cell is owned — update candidate head
            headX = sx;
            headY = sy;
            bestProgress = (seg + t) / totalSegments;
          } else {
            // First unowned cell along the path — head is the previous owned cell
            foundBorderCrossing = true;
            break;
          }
        }
      }
      // If we walked the entire path and everything is owned, head is at the end
      arrow.headX = headX;
      arrow.headY = headY;
      arrow.advanceProgress = Math.max(0, bestProgress);
    }

    // Resolve density combat at border cells near arrow head
    if (arrow.status === "advancing" || arrow.status === "stalled") {
      // Set corridor half-width for focused push (uses front width from config)
      const computedCorridorWidth = Math.min(
        frontMaxWidth,
        frontBaseWidth +
          Math.sqrt(nation.troopCount || 100) * frontWidthPerSqrtPower,
      );
      arrow._corridorHalfWidth = computedCorridorWidth / 2;

      const _addCellForCombat = (cx, cy) => {
        if (matrix.isOwnedBy(cx, cy, nIdx)) return; // already owned
        matrix.setOwner(cx, cy, nIdx);
        const loyaltyEnabled2 = config?.loyalty?.enabled !== false;
        if (loyaltyEnabled2) matrix.setLoyalty(cx, cy, nIdx, 1.0);
        addTerritoryCell(nation, cx, cy);
      };
      const _removeCellFromNationForCombat = (targetNation, cx, cy) => {
        if (useMatrix) {
          const targetIdx = matrix.ownerToIndex.get(targetNation.owner);
          if (targetIdx !== undefined && matrix.isOwnedBy(cx, cy, targetIdx)) {
            matrix.setOwner(cx, cy, UNOWNED);
          }
        }
        removeTerritoryCell(targetNation, cx, cy);
      };

      const flipped = resolveDensityCombat(
        arrow,
        nation,
        gameState,
        mapData,
        ownershipMap,
        matrix,
        config.troopDensity,
        _addCellForCombat,
        _removeCellFromNationForCombat,
      );

      // Compute effective density at front for display (total troops near front)
      let frontDensity = 0;
      const hx = Math.round(arrow.headX ?? 0);
      const hy = Math.round(arrow.headY ?? 0);
      const scanR = config?.territorial?.arrowFrontDensityScanRadius || 8;
      for (let dy = -scanR; dy <= scanR; dy++) {
        for (let dx = -scanR; dx <= scanR; dx++) {
          const fx = hx + dx;
          const fy = hy + dy;
          if (!matrix.inBounds(fx, fy)) continue;
          const fi = matrix.idx(fx, fy);
          if (matrix.ownership[fi] === nIdx) {
            frontDensity += matrix.troopDensity[nIdx * matrix.size + fi];
          }
        }
      }
      arrow.effectiveDensityAtFront = Math.round(frontDensity);

      arrow.stalledTicks = flipped > 0 ? 0 : (arrow.stalledTicks || 0) + 1;
      if (arrow.stalledTicks > 0 && arrow.status === "advancing")
        arrow.status = "stalled";
      if (flipped > 0 && arrow.status === "stalled") arrow.status = "advancing";
    }

    // Check waypoint reached (advance past owned waypoints)
    {
      const updatedTerritorySet = getTerritorySetCached(nation);
      let ci = arrow.currentIndex;
      while (ci < arrow.path.length) {
        const wp = arrow.path[ci];
        const rwx2 = Math.round(wp.x);
        const rwy2 = Math.round(wp.y);
        const isLastWaypoint = ci === arrow.path.length - 1;
        const inTerritory2 = updatedTerritorySet.has((rwy2 << 16) | rwx2);
        const matrixOwned2 = matrix.isOwnedBy(rwx2, rwy2, nIdx);
        if (isLastWaypoint) {
          if (inTerritory2 || matrixOwned2) ci++;
          else break;
        } else {
          const distToWp = getMinDistanceToTerritory(nation, wp.x, wp.y, 3);
          if (inTerritory2 || matrixOwned2 || distToWp <= 2) ci++;
          else break;
        }
      }
      if (ci > arrow.currentIndex) {
        arrow.currentIndex = Math.min(ci, arrow.path.length - 1);
        if (ci < arrow.path.length) {
          arrow.phaseConsolidationRemaining = phaseConsolidationTicks;
          arrow.status = "consolidating";
        }
      }
    }

    // If all waypoints reached, remove
    if (arrow.currentIndex >= arrow.path.length - 1) {
      const fwp = arrow.path[arrow.path.length - 1];
      const rfx = Math.round(fwp.x);
      const rfy = Math.round(fwp.y);
      const inSet = getTerritorySetCached(nation).has((rfy << 16) | rfx);
      const matOwned = matrix.isOwnedBy(rfx, rfy, nIdx);
      if (inSet || matOwned) return "remove";
    }

    // Track opposition — only near the arrow head, not the entire territory
    {
      const opMap = new Map();
      const ahx = Math.round(arrow.headX ?? 0);
      const ahy = Math.round(arrow.headY ?? 0);
      const opScanR = config?.troopDensity?.arrowAttractorRadius || 12;
      const opScanR2 = opScanR * opScanR;
      const omMinX = Math.max(0, ahx - opScanR);
      const omMaxX = Math.min((matrix?.width || 200) - 1, ahx + opScanR);
      const omMinY = Math.max(0, ahy - opScanR);
      const omMaxY = Math.min((matrix?.height || 200) - 1, ahy + opScanR);
      // Build nationByIdx for opposition lookup
      const _nationByIdx = matrix.indexToOwner.map(ownerId =>
        ownerId ? gameState.nations.find(n => n.owner === ownerId) : null
      );
      for (let cy = omMinY; cy <= omMaxY; cy++) {
        for (let cx = omMinX; cx <= omMaxX; cx++) {
          const odx = cx - ahx;
          const ody = cy - ahy;
          if (odx * odx + ody * ody > opScanR2) continue;
          const ownerIdx = matrix.getOwner(cx, cy);
          if (ownerIdx === UNOWNED || ownerIdx === nIdx) continue;
          const ownerNation = _nationByIdx[ownerIdx];
          if (!ownerNation) continue;
          const entry = opMap.get(ownerNation.owner) || {
            nationOwner: ownerNation.owner,
            nationName: ownerNation.name || ownerNation.owner,
            estimatedStrength: 0,
            contactWidth: 0,
          };
          entry.contactWidth++;
          entry.estimatedStrength = ownerNation.population || 0;
          opMap.set(ownerNation.owner, entry);
        }
      }
      arrow.opposingForces = Array.from(opMap.values());
    }

    // Remove arrows that have no troops at the front (depleted or density
    // never reached the head). Track consecutive "empty front" ticks.
    // Grace period: new arrows need time for density to diffuse to the front,
    // so don't start counting emptyFrontTicks until the arrow has been alive
    // for at least 50 ticks (~5s). This prevents premature removal of arrows
    // whose attractor hasn't had time to pull troops to the border.
    const arrowAge = arrow._debugTickCount || 0;
    const emptyFrontGraceTicks =
      config?.territorial?.arrowEmptyFrontGraceTicks || 50;
    const emptyFrontMaxTicks =
      config?.territorial?.arrowEmptyFrontMaxTicks || 20;
    if ((arrow.effectiveDensityAtFront || 0) < 1) {
      if (arrowAge >= emptyFrontGraceTicks) {
        arrow.emptyFrontTicks = (arrow.emptyFrontTicks || 0) + 1;
        if (arrow.emptyFrontTicks >= emptyFrontMaxTicks) {
          return "remove";
        }
      }
    } else {
      arrow.emptyFrontTicks = 0;
    }

    // Stall-based removal for density arrows
    const densityStallMult =
      config?.territorial?.arrowDensityStallMultiplier || 8;
    const densityStallLimit = Math.max(
      40,
      arrowMaxStallTicks * densityStallMult,
    );
    if (arrow.stalledTicks >= densityStallLimit) {
      return "remove";
    }

    return; // Done with troopDensity path
  }

  // ─── Legacy power-budget combat path ───

  // Handle retreat
  if (arrow.status === "retreating") {
    const returnAmount = Math.min(remaining, remaining * retreatReturnRate + 5);
    nation.population = (nation.population || 0) + returnAmount;
    arrow.remainingPower = remaining - returnAmount;
    if (arrow.remainingPower <= 1) return "remove";
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

  if (remaining <= 0) return "remove";

  // Compute front width
  const computedFrontWidth = Math.min(
    frontMaxWidth,
    frontBaseWidth + Math.sqrt(remaining) * frontWidthPerSqrtPower,
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
  const dynamicBudget =
    pressurePerTick +
    Math.sqrt(Math.max(0, initialPower)) * arrowPressurePerSqrtPower;
  const budget = Math.min(
    remaining,
    Math.max(1, Math.min(maxArrowPressurePerTick, dynamicBudget)),
  );

  // Auto-skip waypoints that are already inside or near own territory
  // Intermediate waypoints: skip if within 2 tiles (avoid stalling on near-misses)
  // Final waypoint: must be IN territory (prevent premature completion)
  const territorySet = getTerritorySetCached(nation);
  let currentIndex = arrow.currentIndex || 1;
  const startIndex = currentIndex;
  while (currentIndex < arrow.path.length) {
    const wp = arrow.path[currentIndex];
    const rwpx = Math.round(wp.x);
    const rwpy = Math.round(wp.y);
    const inTerritory = territorySet.has((rwpy << 16) | rwpx);
    const matrixOwned =
      useMatrix && nIdx !== undefined
        ? matrix.isOwnedBy(rwpx, rwpy, nIdx)
        : false;
    const isLastWaypoint = currentIndex === arrow.path.length - 1;

    if (isLastWaypoint) {
      // Final waypoint: must actually be IN territory
      if (inTerritory || matrixOwned) {
        currentIndex++;
      } else {
        if (shouldLog) {
          const dist = getMinDistanceToTerritory(nation, wp.x, wp.y, 5);
          debug(
            `${arrowLabel} auto-skip STOPPED at FINAL wp[${currentIndex}/${arrow.path.length}]: (${rwpx},${rwpy}) inSet=${inTerritory} matrixOwned=${matrixOwned} dist=${dist}`,
          );
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
          debug(
            `${arrowLabel} auto-skip STOPPED at wp[${currentIndex}/${arrow.path.length}]: (${rwpx},${rwpy}) inSet=${inTerritory} matrixOwned=${matrixOwned} dist=${dist}`,
          );
        }
        break;
      }
    }
  }
  arrow.currentIndex = Math.min(currentIndex, arrow.path.length - 1);

  // If the arrow has advanced through all waypoints, it's done
  if (currentIndex >= arrow.path.length) {
    debug(
      `${arrowLabel} AUTO-SKIP REMOVE: all ${arrow.path.length} waypoints reached. Returning ${remaining} troops.`,
    );
    nation.population = (nation.population || 0) + remaining;
    return "remove";
  }
  if (currentIndex > startIndex && shouldLog) {
    debug(
      `${arrowLabel} auto-skipped from ${startIndex} to ${currentIndex}/${arrow.path.length}`,
    );
  }

  const targetPoint = arrow.path[Math.min(currentIndex, arrow.path.length - 1)];

  let spent = 0;
  let attempts = 0;

  // Only expand if not consolidating
  if (arrow.status === "advancing" || arrow.status === "stalled") {
    // Build frontier candidates within the front width band
    const candidates = [];
    const frontierChecked = useMatrix ? new Set() : new Set();
    const tx = nation.territory?.x || [];
    const ty = nation.territory?.y || [];

    candidateScan: for (let i = 0; i < tx.length; i++) {
      for (const [dx, dy] of neighbors) {
        const nx = tx[i] + dx;
        const ny = ty[i] + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

        const numKey = (ny << 16) | nx;
        if (frontierChecked.has(numKey)) continue;
        frontierChecked.add(numKey);

        if (useMatrix) {
          if (matrix.isOwnedBy(nx, ny, nIdx)) continue;
        } else {
          const territorySet = getTerritorySetCached(nation);
          if (territorySet.has((ny << 16) | nx)) continue;
          if (ownershipMap.get(`${nx},${ny}`)?.owner === nation.owner) continue;
        }
        // Skip cells recently removed by connectivity check (prevents flash cycle)
        if (nation._disconnectedCells?.has(numKey)) continue;

        const cell = mapData[ny]?.[nx];
        if (!cell || cell.biome === "OCEAN") continue;

        // Count owned neighbors
        let ownedNeighborCount = 0;
        let sourceCell = null;
        for (const [ddx, ddy] of neighbors) {
          const sx = nx + ddx;
          const sy = ny + ddy;
          if (useMatrix ? matrix.isOwnedBy(sx, sy, nIdx) : (
            getTerritorySetCached(nation).has((sy << 16) | sx) ||
            ownershipMap.get(`${sx},${sy}`)?.owner === nation.owner
          )) {
            ownedNeighborCount++;
            if (!sourceCell) sourceCell = mapData[sy]?.[sx];
          }
        }
        if (ownedNeighborCount === 0 || !sourceCell) continue;

        // Compute distance to path and progress
        const { dist: minDistToPath, progress: pathProgress } = distanceToPath(
          nx,
          ny,
          arrow.path,
        );

        // Position-dependent corridor width: wider near origin, narrower at tip
        const halfWidth = halfWidthAtProgress(pathProgress);

        // Strict corridor filter — keep expansion tight to the path
        if (minDistToPath > halfWidth) continue;

        // Require 2+ owned neighbors for cells far from path center (prevent checkerboard tendrils)
        if (minDistToPath > 2 && ownedNeighborCount < 2) continue;

        const distToTarget = Math.hypot(nx - targetPoint.x, ny - targetPoint.y);

        // Terrain similarity bonus for natural borders
        const { similarity } = getTerrainCostModifiers(
          sourceCell?.biome,
          cell?.biome,
        );

        // Random jitter for organic-looking borders (seeded per-cell for consistency)
        const jitter = ((nx * 7919 + ny * 6271) % 1000) / 1000; // deterministic per cell

        // Scoring: prioritize compactness, then proximity to path center, then forward progress
        // Compactness is king — cells with 3+ owned neighbors are gap-fills (very high priority)
        const compactnessScore =
          ownedNeighborCount >= 3
            ? 40 + ownedNeighborCount * 5 // gap-fill: highest priority
            : ownedNeighborCount * 8; // frontier: moderate
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

        const score =
          compactnessScore +
          centerScore +
          forwardScore +
          terrainScore +
          jitterScore +
          isolationPenalty;

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

    // Build nationByIdx lookup once for capture path
    const nationByIdx = useMatrix ? matrix.indexToOwner.map(ownerId =>
      ownerId ? gameState.nations.find(n => n.owner === ownerId) : null
    ) : null;

    // Capture within budget
    for (const candidate of candidates) {
      if (spent >= budget || attempts >= attemptsPerTick) break;

      const {
        x,
        y,
        sourceCell,
        cell,
        minDistToPath,
        distToTarget,
        ownedNeighborCount,
      } = candidate;

      // Get current owner via matrix (O(1) typed-array read) or ownershipMap fallback
      let currentOwnerNation = null;
      if (useMatrix) {
        const cellOwnerIdx = matrix.getOwner(x, y);
        if (cellOwnerIdx === nIdx) {
          attempts++;
          continue;
        }
        if (cellOwnerIdx !== UNOWNED) {
          currentOwnerNation = nationByIdx[cellOwnerIdx] || null;
        }
      } else {
        const key = `${x},${y}`;
        const currentOwner = ownershipMap.get(key);
        if (currentOwner?.owner === nation.owner) {
          attempts++;
          continue;
        }
        currentOwnerNation = currentOwner || null;
      }

      // Recheck live owned neighbors (may have changed during this tick)
      let liveOwned = 0;
      if (useMatrix) {
        for (const [ddx, ddy] of neighbors) {
          if (matrix.isOwnedBy(x + ddx, y + ddy, nIdx)) liveOwned++;
        }
      } else {
        for (const [ddx, ddy] of neighbors) {
          if (ownershipMap.get(`${x + ddx},${y + ddy}`)?.owner === nation.owner)
            liveOwned++;
        }
      }
      // Require at least 2 owned neighbors unless at path center (prevents thin tendrils)
      if (liveOwned < 2 && minDistToPath > 1.5) {
        attempts++;
        continue;
      }

      const { lossMult, speedMult } = getTerrainCostModifiers(
        sourceCell?.biome,
        cell?.biome,
      );
      const targetTerrainMult =
        terrainExpansionCostMultByBiome[cell?.biome] || 1;
      let terrainCrossMult = 1;
      if (sourceCell?.biome === "RIVER" || cell?.biome === "RIVER")
        terrainCrossMult *= riverCrossingCostMult;
      if (sourceCell?.biome === "MOUNTAIN" || cell?.biome === "MOUNTAIN")
        terrainCrossMult *= mountainCrossingCostMult;

      const distance = anchor ? Math.hypot(x - anchor.x, y - anchor.y) : 0;
      const clampedDistance = Math.min(distance, maxDistancePenaltyTiles);
      const distanceMult = 1 + distancePenaltyPerTile * clampedDistance;

      let cost;
      if (!currentOwnerNation) {
        const expansionPower =
          bonusesByOwner?.[nation.owner]?.expansionPower || 1;
        cost =
          (baseCost *
            lossMult *
            distanceMult *
            terrainCrossMult *
            targetTerrainMult) /
          (expansionPower * speedMult);
      } else {
        const attackerPower = bonusesByOwner?.[nation.owner]?.attackPower || 1;
        const defenderPower =
          bonusesByOwner?.[currentOwnerNation.owner]?.defensePower || 1;
        let defense = baseDefense * defenderPower * contestedDefenseMult;
        defense *= terrainDefenseMultByBiome[cell?.biome] || 1;

        const structureDefense = getStructureDefenseBoost(
          x,
          y,
          currentOwnerNation,
          structureConfig,
        );
        defense *= structureDefense.troopLossMultiplier;
        const structureSpeedMult = structureDefense.speedMultiplier;

        const encirclementBonus = currentOwnerNation.isEncircled ? 0.2 : 1;
        defense *= encirclementBonus;

        cost =
          (baseCost *
            lossMult *
            defense *
            distanceMult *
            terrainCrossMult *
            targetTerrainMult) /
          (attackerPower * speedMult * structureSpeedMult);
      }

      if (budget - spent >= cost) {
        if (currentOwnerNation && currentOwnerNation.owner !== nation.owner) {
          if (useMatrix) {
            const targetIdx = matrix.ownerToIndex.get(currentOwnerNation.owner);
            if (
              targetIdx !== undefined &&
              matrix.isOwnedBy(x, y, targetIdx)
            ) {
              matrix.setOwner(x, y, UNOWNED);
            }
          }
          removeTerritoryCell(currentOwnerNation, x, y);
        }
        if (useMatrix && nIdx !== undefined) {
          matrix.setOwner(x, y, nIdx);
          if (loyaltyEnabled) matrix.setLoyalty(x, y, nIdx, 1.0);
        }
        addTerritoryCell(nation, x, y);
        spent += cost;
      } else if (loyaltyEnabled && useMatrix && nIdx !== undefined) {
        applyArrowLoyaltyPressure(matrix, nIdx, x, y, arrowLoyaltyGain);
      }
      attempts++;
    }
  }

  // Fill behind front: unowned cells behind advance head with 3+ owned neighbors
  {
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
        const numKey = (ny << 16) | nx;
        if (fillChecked.has(numKey)) continue;
        fillChecked.add(numKey);
        if (useMatrix) {
          // Skip if owned by us
          if (matrix.isOwnedBy(nx, ny, nIdx)) continue;
          // Skip if owned by someone else (only fill unowned gaps)
          const fillOwnerIdx = matrix.getOwner(nx, ny);
          if (fillOwnerIdx !== UNOWNED) continue;
        } else {
          const territorySet = getTerritorySetCached(nation);
          if (territorySet.has((ny << 16) | nx)) continue;
          const currentOwner = ownershipMap.get(`${nx},${ny}`);
          if (currentOwner?.owner === nation.owner) continue;
          if (currentOwner?.owner && currentOwner.owner !== nation.owner)
            continue;
        }
        if (nation._disconnectedCells?.has(numKey)) continue;
        const cell = mapData[ny]?.[nx];
        if (!cell || cell.biome === "OCEAN") continue;

        const { dist: dtp, progress: fillProgress } = distanceToPath(
          nx,
          ny,
          arrow.path,
        );
        if (dtp > halfWidthAtProgress(fillProgress)) continue;

        let ownedCount = 0;
        if (useMatrix) {
          for (const [ddx, ddy] of neighbors) {
            if (matrix.isOwnedBy(nx + ddx, ny + ddy, nIdx)) ownedCount++;
          }
        } else {
          for (const [ddx, ddy] of neighbors) {
            if (
              ownershipMap.get(`${nx + ddx},${ny + ddy}`)?.owner === nation.owner
            )
              ownedCount++;
          }
        }
        if (ownedCount >= 3) {
          fills.push({ x: nx, y: ny });
        }
      }
    }
    for (const fill of fills) {
      if (useMatrix && nIdx !== undefined) {
        matrix.setOwner(fill.x, fill.y, nIdx);
        if (loyaltyEnabled) matrix.setLoyalty(fill.x, fill.y, nIdx, 1.0);
      }
      addTerritoryCell(nation, fill.x, fill.y);
    }
  }

  // Track opposition: scan enemy cells adjacent to the front (sampled for perf)
  {
    const opMap = new Map();
    const tx = nation.territory?.x || [];
    const ty = nation.territory?.y || [];
    const scanned = new Set();
    const step = tx.length > 300 ? Math.ceil(tx.length / 300) : 1;
    // Build nationByIdx for opposition (reuse if already built above)
    const _opNationByIdx = nationByIdx || (useMatrix ? matrix.indexToOwner.map(ownerId =>
      ownerId ? gameState.nations.find(n => n.owner === ownerId) : null
    ) : null);

    for (let i = 0; i < tx.length; i += step) {
      const { dist: dtp } = distanceToPath(tx[i], ty[i], arrow.path);
      if (dtp > halfWidthBase * 1.5 + oppositionScanRadius) continue;

      for (const [dx, dy] of neighbors) {
        const nx = tx[i] + dx;
        const ny = ty[i] + dy;
        const numKey = (ny << 16) | nx;
        if (scanned.has(numKey)) continue;
        scanned.add(numKey);
        if (useMatrix) {
          const ownerIdx = matrix.getOwner(nx, ny);
          if (ownerIdx === UNOWNED || ownerIdx === nIdx) continue;
          const ownerNation = _opNationByIdx[ownerIdx];
          if (!ownerNation) continue;
          const entry = opMap.get(ownerNation.owner) || {
            nationOwner: ownerNation.owner,
            nationName: ownerNation.name || ownerNation.owner,
            estimatedStrength: 0,
            contactWidth: 0,
          };
          entry.contactWidth++;
          entry.estimatedStrength = ownerNation.population || 0;
          opMap.set(ownerNation.owner, entry);
        } else {
          const owner = ownershipMap.get(`${nx},${ny}`);
          if (owner && owner.owner !== nation.owner) {
            const entry = opMap.get(owner.owner) || {
              nationOwner: owner.owner,
              nationName: owner.name || owner.owner,
              estimatedStrength: 0,
              contactWidth: 0,
            };
            entry.contactWidth++;
            entry.estimatedStrength = owner.population || 0;
            opMap.set(owner.owner, entry);
          }
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
      const ewpx = Math.round(wp.x);
      const ewpy = Math.round(wp.y);
      const isLastWaypoint = ci === arrow.path.length - 1;
      const inTerritory = updatedTerritorySet.has((ewpy << 16) | ewpx);
      // Also check matrix for ground truth
      const matrixOwned =
        useMatrix && nIdx !== undefined
          ? matrix.isOwnedBy(ewpx, ewpy, nIdx)
          : false;

      if (isLastWaypoint) {
        // Final waypoint: require actually IN territory (territorySet or matrix)
        if (inTerritory || matrixOwned) {
          ci++;
        } else {
          if (shouldLog) {
            const distToWp = getMinDistanceToTerritory(nation, wp.x, wp.y, 3);
            debug(
              `${arrowLabel} end-wp-check STOPPED at FINAL wp[${ci}/${arrow.path.length}]: (${ewpx},${ewpy}) inSet=${inTerritory} matrixOwned=${matrixOwned} dist=${distToWp}`,
            );
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
            debug(
              `${arrowLabel} end-wp-check STOPPED at wp[${ci}/${arrow.path.length}]: (${ewpx},${ewpy}) inSet=${inTerritory} dist=${distToWp} matrixOwned=${matrixOwned}`,
            );
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
      if (shouldLog)
        debug(
          `${arrowLabel} end-wp-check advanced ${advanced} waypoints (${ciStart}->${ci}), consolidation=${ci < arrow.path.length}`,
        );
    }
  }

  // If the arrow has advanced through all waypoints, it's done
  if (arrow.currentIndex >= arrow.path.length - 1) {
    const updatedTerritorySet = getTerritorySetCached(nation);
    const fwp = arrow.path[arrow.path.length - 1];
    const fwpx = Math.round(fwp.x);
    const fwpy = Math.round(fwp.y);
    const inSet = updatedTerritorySet.has((fwpy << 16) | fwpx);
    const matrixOwned =
      useMatrix && nIdx !== undefined
        ? matrix.isOwnedBy(fwpx, fwpy, nIdx)
        : false;
    // Final waypoint must actually be IN territory, not just near it
    if (inSet || matrixOwned) {
      remaining = Math.max(0, remaining - spent);
      arrow.remainingPower = remaining;
      debug(
        `${arrowLabel} FINAL-WP REMOVE: power=${remaining}, spent=${spent}`,
      );
      if (remaining > 0)
        nation.population = (nation.population || 0) + remaining;
      return "remove";
    } else if (shouldLog) {
      const distToFinal = getMinDistanceToTerritory(nation, fwp.x, fwp.y, 5);
      debug(
        `${arrowLabel} at final wp but NOT removing: key=${fwpKey} inSet=${inSet} matrixOwned=${matrixOwned} dist=${distToFinal}`,
      );
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
    debug(
      `${arrowLabel} END-OF-TICK: power=${remaining}, spent=${spent}, status=${arrow.status}, stalledTicks=${arrow.stalledTicks}, curIdx=${arrow.currentIndex}/${arrow.path.length}, consolidationLeft=${arrow.phaseConsolidationRemaining || 0}, arrowAge=${arrowAge}ms/${maxDurationMs}ms`,
    );
  }

  // Remove if depleted or stalled too long
  if (
    remaining <= 3 ||
    (spent === 0 && remaining < 10) ||
    arrow.stalledTicks >= arrowMaxStallTicks
  ) {
    debug(
      `${arrowLabel} STALL/DEPLETED REMOVE: power=${remaining}, spent=${spent}, stalledTicks=${arrow.stalledTicks}/${arrowMaxStallTicks}`,
    );
    if (remaining > 0) {
      nation.population = (nation.population || 0) + remaining;
    }
    return "remove";
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
  matrix = null,
) {
  if (!nation.arrowOrders) return;
  if (!ownershipMap && !matrix) return;

  const useMatrix = !!matrix;
  const nIdx = useMatrix ? matrix.ownerToIndex.get(nation.owner) : undefined;
  const loyaltyEnabled = useMatrix && config?.loyalty?.enabled !== false;

  const pressurePerTick = config?.territorial?.pressurePerTick || 6;
  const width = mapData[0]?.length || 0;
  const height = mapData.length || 0;
  const neighbors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  // Migrate legacy single attack to attacks[]
  migrateArrowOrders(nation);

  // Process attack arrows array
  const attacks = nation.arrowOrders.attacks;
  if (!attacks) {
    // debugWarn(
    //   `[ARROW-DEBUG] nation ${nation.name || nation.owner} has no attacks array after migration!`,
    // );
  }
  const toRemove = [];
  for (let i = 0; i < attacks.length; i++) {
    const arrow = attacks[i];
    try {
      const result = processAttackArrowFrontline(
        arrow,
        nation,
        gameState,
        mapData,
        ownershipMap,
        bonusesByOwner,
        matrix,
      );
      if (result === "remove") {
        toRemove.push(i);
        // debug(
        //   `[ARROW-DEBUG] Arrow ${i} (id=${arrow.id}) for ${nation.name || nation.owner} marked for removal. Power=${arrow.remainingPower}, status=${arrow.status}, currentIndex=${arrow.currentIndex}/${arrow.path?.length}`,
        // );
      }
    } catch (err) {
      console.error(
        `[ARROW] Error processing attack arrow ${i} for ${nation.name || nation.owner}: ${err.message}`,
      );
      // Return remaining troops and remove the broken arrow
      nation.population =
        (nation.population || 0) + (arrow.remainingPower || 0);
      toRemove.push(i);
    }
  }
  if (process.env.DEBUG_ARROWS === "true") {
    // debug(
    //   `[ARROW-DEBUG] ${nation.name || nation.owner}: ${attacks.length} arrows, removing ${toRemove.length}, indices=${JSON.stringify(toRemove)}`,
    // );
  }
  // Splice in reverse order
  for (let i = toRemove.length - 1; i >= 0; i--) {
    attacks.splice(toRemove[i], 1);
  }
  if (process.env.DEBUG_ARROWS === "true") {
    // debug(
    //   `[ARROW-DEBUG] ${nation.name || nation.owner}: after splice, ${attacks.length} arrows remain. nation.arrowOrders.attacks.length=${nation.arrowOrders.attacks.length}`,
    // );
  }

  // Process defend arrow — unchanged
  if (nation.arrowOrders?.defend) {
    const arrow = nation.arrowOrders.defend;
    let remaining = arrow.remainingPower || 0;

    const minArrowDurationMs = config?.territorial?.minArrowDurationMs ?? 10000;
    const maxArrowDurationMs =
      config?.territorial?.maxArrowDurationMs ?? 120000;
    const arrowDurationPerPowerMs =
      config?.territorial?.arrowDurationPerPowerMs ?? 25;
    let initialPowerD = Number(arrow.initialPower ?? remaining ?? 0);
    if (!Number.isFinite(initialPowerD)) initialPowerD = 0;
    const scaledDuration =
      minArrowDurationMs + initialPowerD * arrowDurationPerPowerMs;
    const rawMaxDuration = Math.max(
      minArrowDurationMs,
      Math.min(maxArrowDurationMs, scaledDuration),
    );
    const maxDurationMs = Number.isFinite(rawMaxDuration)
      ? rawMaxDuration
      : maxArrowDurationMs;
    // Prefer tick-based age when available
    const tickRateMsD = config?.territorial?.tickRateMs || 100;
    let defendAge;
    if (arrow.createdAtTick != null && nation._currentTick != null) {
      defendAge = (nation._currentTick - arrow.createdAtTick) * tickRateMsD;
    } else {
      const rawDefendAge = arrow.createdAt
        ? Date.now() - new Date(arrow.createdAt).getTime()
        : Infinity;
      defendAge = Number.isFinite(rawDefendAge) ? rawDefendAge : Infinity;
    }

    if (defendAge > maxDurationMs) {
      nation.population = (nation.population || 0) + remaining;
      nation.arrowOrders.defend = null;
      delete nation.arrowOrders.defend;
    } else {
      const validPath =
        Array.isArray(arrow.path) &&
        arrow.path.length >= 2 &&
        arrow.path.every(
          (p) => p && typeof p.x === "number" && typeof p.y === "number",
        );

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

  // Hole-filling pass
  if (nation.territory?.x?.length > 0) {
    const holesToFill = [];
    const checked = new Set();
    const tx = nation.territory.x;
    const ty = nation.territory.y;
    const dynamicFillBudget = Math.max(
      4,
      Math.min(18, Math.floor(tx.length * 0.008)),
    );

    const collectHoles = (requiredOwnedNeighbors) => {
      for (
        let i = 0;
        i < tx.length && holesToFill.length < dynamicFillBudget;
        i++
      ) {
        for (const [dx, dy] of neighbors) {
          const nx = tx[i] + dx;
          const ny = ty[i] + dy;
          const numKey = (ny << 16) | nx;
          if (checked.has(numKey)) continue;
          checked.add(numKey);

          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (useMatrix) {
            const cellOwnerIdx = matrix.getOwner(nx, ny);
            if (cellOwnerIdx === nIdx) continue; // already ours
            if (cellOwnerIdx !== UNOWNED) continue; // owned by someone else
          } else {
            const currentOwner = ownershipMap.get(`${nx},${ny}`);
            if (currentOwner?.owner === nation.owner) continue;
            if (currentOwner?.owner && currentOwner.owner !== nation.owner)
              continue;
          }

          const cell = mapData[ny]?.[nx];
          if (!cell || cell.biome === "OCEAN") continue;

          let ownedCount = 0;
          if (useMatrix) {
            for (const [ddx, ddy] of neighbors) {
              if (matrix.isOwnedBy(nx + ddx, ny + ddy, nIdx)) ownedCount++;
            }
          } else {
            for (const [ddx, ddy] of neighbors) {
              if (
                ownershipMap.get(`${nx + ddx},${ny + ddy}`)?.owner ===
                nation.owner
              )
                ownedCount++;
            }
          }
          if (ownedCount >= requiredOwnedNeighbors) {
            holesToFill.push({ x: nx, y: ny, ownedCount });
          }
        }
      }
    };

    collectHoles(3);
    if (holesToFill.length < Math.floor(dynamicFillBudget * 0.35))
      collectHoles(2);

    holesToFill.sort((a, b) => b.ownedCount - a.ownedCount);

    for (const hole of holesToFill.slice(0, dynamicFillBudget)) {
      if (useMatrix && nIdx !== undefined) {
        matrix.setOwner(hole.x, hole.y, nIdx);
        if (loyaltyEnabled) matrix.setLoyalty(hole.x, hole.y, nIdx, 1.0);
      }
      addTerritoryCell(nation, hole.x, hole.y);
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
    speedReduction: 0.5,
  };
  const towerConfig = structureConfig?.tower || {
    defenseRadius: 40,
    troopLossMultiplier: 6.0,
    speedReduction: 0.66,
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

  return {
    troopLossMultiplier: bestTroopLossMult,
    speedMultiplier: bestSpeedMult,
  };
}

function normalizeVector(x, y) {
  const dx = Number(x);
  const dy = Number(y);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  const len = Math.hypot(dx, dy);
  if (len === 0) return null;
  return { x: dx / len, y: dy / len };
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
// Uses numeric keys: (y << 16) | x — eliminates string allocation
// Also deduplicates the territory arrays if duplicates are detected
function getTerritorySetCached(nation) {
  // Check if _territorySet exists AND is actually a Set (not a plain object from MongoDB)
  if (!(nation._territorySet instanceof Set)) {
    nation._territorySet = new Set();
    if (nation.territory?.x && nation.territory?.y) {
      const originalLength = nation.territory.x.length;
      // Build set and detect duplicates
      for (let i = 0; i < nation.territory.x.length; i++) {
        nation._territorySet.add(
          (nation.territory.y[i] << 16) | nation.territory.x[i],
        );
      }
      // If set size differs from array length, we have duplicates - rebuild arrays
      if (nation._territorySet.size !== originalLength) {
        const newX = [];
        const newY = [];
        for (const numKey of nation._territorySet) {
          newX.push(numKey & 0xFFFF);
          newY.push(numKey >> 16);
        }
        nation.territory.x = newX;
        nation.territory.y = newY;
        debug(
          `[DEDUPE] ${nation.name || nation.owner} had ${originalLength - nation._territorySet.size} duplicate tiles removed`,
        );
      }
    }
  }
  return nation._territorySet;
}

// Neighbors for border calculations
const NEIGHBORS_4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// Update border set when a cell is added - only the new cell and its neighbors might change border status
// Uses numeric keys: (y << 16) | x
function updateBorderOnAdd(nation, x, y, territorySet) {
  // Ensure _borderSet is a proper Set (might be plain object from MongoDB)
  if (!(nation._borderSet instanceof Set)) {
    nation._borderSet = new Set();
  }
  const key = (y << 16) | x;

  // Check if the new cell is a border cell (has non-owned neighbor)
  let isBorder = false;
  for (const [dx, dy] of NEIGHBORS_4) {
    const nKey = ((y + dy) << 16) | (x + dx);
    if (!territorySet.has(nKey)) {
      isBorder = true;
    } else {
      // This neighbor was potentially a border cell, recheck it
      let neighborStillBorder = false;
      for (const [ddx, ddy] of NEIGHBORS_4) {
        if (!territorySet.has(((y + dy + ddy) << 16) | (x + dx + ddx))) {
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
// Uses numeric keys: (y << 16) | x
function updateBorderOnRemove(nation, x, y, territorySet) {
  // Ensure _borderSet is a proper Set (might be plain object from MongoDB)
  if (!(nation._borderSet instanceof Set)) {
    nation._borderSet = new Set();
    return; // If it wasn't a Set, just return - it will be rebuilt when needed
  }
  const key = (y << 16) | x;
  nation._borderSet.delete(key);

  // Neighbors of removed cell become border cells if they're still in territory
  for (const [dx, dy] of NEIGHBORS_4) {
    const nKey = ((y + dy) << 16) | (x + dx);
    if (territorySet.has(nKey)) {
      nation._borderSet.add(nKey);
    }
  }
}

// Get cached border set for efficient border operations
// Uses numeric keys: (y << 16) | x
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
          if (!territorySet.has(((y + dy) << 16) | (x + dx))) {
            nation._borderSet.add((y << 16) | x);
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
  const numKey = (y << 16) | x;
  const territorySet = getTerritorySetCached(nation);
  // O(1) check
  if (territorySet.has(numKey)) {
    return;
  }
  nation.territory.x.push(x);
  nation.territory.y.push(y);
  territorySet.add(numKey);
  nation.territoryDelta?.add.x.push(x);
  nation.territoryDelta?.add.y.push(y);
  updateBorderOnAdd(nation, x, y, territorySet);
}

function removeTerritoryCell(nation, x, y) {
  if (!nation?.territory?.x || !nation?.territory?.y) return;
  if (!nation.territoryDelta) {
    nation.territoryDelta = { add: { x: [], y: [] }, sub: { x: [], y: [] } };
  }
  const numKey = (y << 16) | x;
  const territorySet = getTerritorySetCached(nation);
  // O(1) check
  if (!territorySet.has(numKey)) {
    return;
  }
  // O(n) to find index, then swap-and-pop for O(1) removal
  for (let i = 0; i < nation.territory.x.length; i++) {
    if (nation.territory.x[i] === x && nation.territory.y[i] === y) {
      const last = nation.territory.x.length - 1;
      if (i !== last) {
        nation.territory.x[i] = nation.territory.x[last];
        nation.territory.y[i] = nation.territory.y[last];
      }
      nation.territory.x.pop();
      nation.territory.y.pop();
      territorySet.delete(numKey);
      nation.territoryDelta?.sub.x.push(x);
      nation.territoryDelta?.sub.y.push(y);
      updateBorderOnRemove(nation, x, y, territorySet);
      break;
    }
  }
}
