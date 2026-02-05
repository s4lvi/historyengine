// gameLogic.js
import config from "../config/config.js";
import { getTerrainCostModifiers, getNodeMultiplier } from "./territorialUtils.js";

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
  cachedFrontierSet = null // OPTIMIZATION 3: Pre-computed frontier set
) {
  return updateNationTerritorial(
    nation,
    mapData,
    gameState,
    ownershipMap,
    bonusesByOwner,
    currentTick,
    cachedFrontierSet
  );
}

function updateNationTerritorial(
  nation,
  mapData,
  gameState,
  ownershipMap,
  bonusesByOwner,
  currentTick,
  cachedFrontierSet = null // OPTIMIZATION 3
) {
  if (!Array.isArray(mapData) || !Array.isArray(mapData[0])) {
    console.warn("Invalid map data structure in updateNationTerritorial");
    return nation;
  }

  const updatedNation = nation;
  updatedNation.resources = updatedNation.resources || {};
  updatedNation.territoryDelta =
    updatedNation.territoryDelta || { add: { x: [], y: [] }, sub: { x: [], y: [] } };

  const clearTerritory = () => {
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
      // First check our own territory array (more reliable for newly founded nations)
      const capitalInOwnTerritory = isCellInTerritory(updatedNation.territory, capital.x, capital.y);

      // Also check ownership map if available
      const capitalKey = `${capital.x},${capital.y}`;
      const capitalOwner = ownershipMap?.get(capitalKey);
      const capitalOwnedInMap = capitalOwner && capitalOwner.owner === updatedNation.owner;

      // Capital is safe if it's in our territory array OR owned by us in the map
      const capitalSafe = capitalInOwnTerritory || capitalOwnedInMap;

      if (!capitalSafe) {
        // Capital territory lost - try to promote nearest town
        const towns = updatedNation.cities?.filter((city) => city.type === "town") || [];
        if (towns.length > 0) {
          // Find nearest town that is still in our territory
          let nearestTown = null;
          let minDistance = Infinity;
          for (const town of towns) {
            const townInTerritory = isCellInTerritory(updatedNation.territory, town.x, town.y);
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
            // Remove the old capital (it was captured)
            const capitalIndex = updatedNation.cities.findIndex((c) => c === capital);
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
    const ownedTiles = updatedNation.territory?.x?.length || 0;
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
        gameState
      );
    }

    // Apply arrow orders (Big Arrow system)
    if (updatedNation.arrowOrders && (updatedNation.arrowOrders.attack || updatedNation.arrowOrders.defend)) {
      try {
        processArrowOrders(
          updatedNation,
          gameState,
          mapData,
          ownershipMap,
          bonusesByOwner,
          cachedFrontierSet
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

function selectBotTargetCellAny(nation, mapData, ownershipMap, anchor, resourceNodeClaims) {
  const candidates = getFrontierCandidatesForBot(
    nation,
    mapData,
    ownershipMap,
    anchor,
    resourceNodeClaims
  );
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function selectBotTargetCell(nation, mapData, ownershipMap, anchor, resourceNodeClaims) {
  const candidates = getFrontierCandidatesForBot(
    nation,
    mapData,
    ownershipMap,
    anchor,
    resourceNodeClaims
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
  gameState
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

  // Check if bot already has an active attack arrow
  if (nation.arrowOrders?.attack && nation.arrowOrders.attack.remainingPower > 0) {
    // Log every 20 ticks when bots have active arrows
    if (tickCount % 20 === 0) {
      const arrow = nation.arrowOrders.attack;
      console.log(`[BOTS] ${nation.name || nation.owner} has active arrow (power: ${arrow.remainingPower?.toFixed(1)})`);
    }
    return;
  }

  const orderInterval = config?.territorial?.botOrderIntervalTicks ?? 4;
  const lastTick = nation.lastBotOrderTick ?? -Infinity;
  if (tickCount - lastTick < orderInterval) {
    // Only log occasionally
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
  let candidate = selectBotTargetCell(
    nation,
    mapData,
    ownershipMap,
    anchor,
    resourceNodeClaims
  );
  if (!candidate) {
    candidate = selectBotTargetCellAny(
      nation,
      mapData,
      ownershipMap,
      anchor,
      resourceNodeClaims
    );
  }
  if (!candidate) {
    // Bots with no frontier candidates might be stuck or defeated
    // Log this always to help debug
    console.log(`[BOTS] ${nation.name || nation.owner} has no expansion candidates (territory: ${nation.territory?.x?.length || 0} cells)`);
    return;
  }

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

  // Safety: if bot has less than 10 population, use all of it
  const actualPower = available < 10 ? available : power;

  // Deduct population and create arrow order
  nation.population = Math.max(0, available - actualPower);
  nation.arrowOrders = nation.arrowOrders || {};
  nation.arrowOrders.attack = {
    id: new Date().toISOString(),
    type: "attack",
    path: [
      { x: anchor.x, y: anchor.y },
      { x: candidate.x, y: candidate.y }
    ],
    currentIndex: 1, // Start at 1 to target the destination, not the anchor
    remainingPower: actualPower,
    initialPower: actualPower,
    percent: clampedPercent,
    createdAt: new Date(),
  };

  if (process.env.DEBUG_BOTS === "true") {
    console.log(`[BOTS] ${nation.name || nation.owner} arrow: power=${actualPower.toFixed(0)} target=(${candidate.x},${candidate.y})`);
  }
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
  resourceNodeClaims = null
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
 * Process arrow orders (Big Arrow system)
 * Attack arrows: expand along the drawn path
 * Defend arrows: reinforce defense along the path (troops return to population)
 */
function processArrowOrders(
  nation,
  gameState,
  mapData,
  ownershipMap,
  bonusesByOwner,
  cachedFrontierSet = null
) {
  if (!nation.arrowOrders) return;
  if (!ownershipMap) return;

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
    config?.territorial?.maxArrowPressurePerTick ??
    Math.max(pressurePerTick, 40);
  const arrowMaxStallTicks = config?.territorial?.arrowMaxStallTicks ?? 6;
  const maxArrowCandidates = config?.territorial?.maxArrowCandidatesPerNation ?? 500;
  const minOwnedNeighborsForStableExpansion =
    config?.territorial?.minOwnedNeighborsForStableExpansion ?? 1;

  const getArrowMaxDurationMs = (arrow) => {
    const initialPower = Number(
      arrow?.initialPower ?? arrow?.remainingPower ?? 0
    );
    const scaledDuration = minArrowDurationMs + initialPower * arrowDurationPerPowerMs;
    return Math.max(
      minArrowDurationMs,
      Math.min(maxArrowDurationMs, scaledDuration)
    );
  };

  const anchor = getNationAnchor(nation);
  const width = mapData[0]?.length || 0;
  const height = mapData.length || 0;
  const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // Process attack arrow
  if (nation.arrowOrders?.attack) {
    const arrow = nation.arrowOrders.attack;
    let remaining = arrow.remainingPower || 0;

    // Expiry scales with committed power so large arrows do not die instantly.
    const maxDurationMs = getArrowMaxDurationMs(arrow);
    const arrowAge = arrow.createdAt ? Date.now() - new Date(arrow.createdAt).getTime() : 0;
    if (arrowAge > maxDurationMs) {
      console.log(`[ARROW] Attack arrow expired for ${nation.name || nation.owner} (age: ${arrowAge}ms)`);
      // Return remaining power to population
      nation.population = (nation.population || 0) + (arrow.remainingPower || 0);
      nation.arrowOrders.attack = null;
      delete nation.arrowOrders.attack;
    } else {
      // Validate arrow.path is a proper array with valid points
      const validPath = Array.isArray(arrow.path) && arrow.path.length >= 2 &&
        arrow.path.every(p => p && typeof p.x === 'number' && typeof p.y === 'number');

      if (!validPath) {
        // Invalid path structure, remove the arrow
        console.log(`[ARROW] Removing invalid attack arrow for ${nation.name || nation.owner}`);
        nation.arrowOrders.attack = null;
        delete nation.arrowOrders.attack;
      } else if (remaining > 0) {
        const initialPower = Number(arrow.initialPower ?? remaining ?? 0);
        const dynamicBudget =
          pressurePerTick +
          Math.sqrt(Math.max(0, initialPower)) * arrowPressurePerSqrtPower;
        const budget = Math.min(
          remaining,
          Math.max(1, Math.min(maxArrowPressurePerTick, dynamicBudget))
        );
      let spent = 0;
      let attempts = 0;

      // Get current target point from path
      const currentIndex = arrow.currentIndex || 0;
      const targetPoint = arrow.path[Math.min(currentIndex, arrow.path.length - 1)];

      // Build frontier candidates
      const candidates = [];
      const territorySet = getTerritorySetCached(nation);
      const frontierChecked = new Set();
      const tx = nation.territory?.x || [];
      const ty = nation.territory?.y || [];
      const sourcePoint =
        arrow.path[Math.max(0, Math.min((arrow.currentIndex || 1) - 1, arrow.path.length - 1))] ||
        arrow.path[0];
      const pathSegments = Math.max(1, arrow.path.length - 1);

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

          const cell = mapData[ny]?.[nx];
          if (!cell || cell.biome === "OCEAN") continue;

          // Count owned neighbors FIRST (need this for compactness check)
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

          // Calculate min distance to the arrow path line segments.
          let minDistToPath = Infinity;
          let pathProgress = 0;
          for (let pi = 0; pi < arrow.path.length - 1; pi++) {
            const p1 = arrow.path[pi];
            const p2 = arrow.path[pi + 1];
            const segDx = p2.x - p1.x;
            const segDy = p2.y - p1.y;
            const lenSq = segDx * segDx + segDy * segDy;
            let t = lenSq > 0 ? ((nx - p1.x) * segDx + (ny - p1.y) * segDy) / lenSq : 0;
            t = Math.max(0, Math.min(1, t));
            const closestX = p1.x + t * segDx;
            const closestY = p1.y + t * segDy;
            const d = Math.hypot(nx - closestX, ny - closestY);
            const segmentProgress = (pi + t) / pathSegments;
            if (d < minDistToPath || (Math.abs(d - minDistToPath) < 0.001 && segmentProgress > pathProgress)) {
              minDistToPath = d;
              pathProgress = segmentProgress;
            }
          }
          // Handle single-point path or fallback.
          if (arrow.path.length === 1 || minDistToPath === Infinity) {
            const d = Math.hypot(nx - arrow.path[0].x, ny - arrow.path[0].y);
            if (d < minDistToPath) minDistToPath = d;
          }

          // Keep the expansion front tight around the planned arrow path.
          if (minDistToPath > 7) continue;

          const distToTarget = Math.hypot(nx - targetPoint.x, ny - targetPoint.y);
          const distFromSource = Math.hypot(nx - sourcePoint.x, ny - sourcePoint.y);

          // Favor coherent fronts that move along the arrow while still closing local gaps.
          const holeBonus =
            ownedNeighborCount >= 3 ? 18 + ownedNeighborCount * 4 : ownedNeighborCount * 2;
          const score =
            holeBonus +
            pathProgress * 35 -
            minDistToPath * 4 -
            distToTarget * 1.2 -
            distFromSource * 0.25 -
            (ownedNeighborCount <= 1 ? 12 : 0);
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
          if (candidates.length >= maxArrowCandidates) {
            break candidateScan;
          }
        }
      }

      candidates.sort((a, b) => b.score - a.score);

      // Try to expand
      for (const candidate of candidates) {
        if (spent >= budget || attempts >= attemptsPerTick) break;

        const { x, y, sourceCell, cell, minDistToPath, distToTarget, pathProgress } = candidate;
        const key = `${x},${y}`;
        const currentOwner = ownershipMap.get(key);

        if (currentOwner?.owner === nation.owner) {
          attempts++;
          continue;
        }

        // Suppress checkerboard growth by preferring tiles that are supported
        // by multiple already-owned neighbors, except at the immediate spear tip.
        let liveOwnedNeighborCount = 0;
        for (const [dx, dy] of neighbors) {
          if (ownershipMap.get(`${x + dx},${y + dy}`)?.owner === nation.owner) {
            liveOwnedNeighborCount += 1;
          }
        }
        const spearTip = distToTarget <= 2.5 || minDistToPath <= 1.0;
        const requiredNeighbors =
          minDistToPath <= 1.5 || pathProgress >= 0.4
            ? Math.max(1, minOwnedNeighborsForStableExpansion - 1)
            : minOwnedNeighborsForStableExpansion;
        if (!spearTip && liveOwnedNeighborCount < requiredNeighbors) {
          attempts++;
          continue;
        }

        const { lossMult, speedMult } = getTerrainCostModifiers(sourceCell?.biome, cell?.biome);
        const targetTerrainMult = terrainExpansionCostMultByBiome[cell?.biome] || 1;
        let terrainCrossMult = 1;
        if (sourceCell?.biome === "RIVER" || cell?.biome === "RIVER") {
          terrainCrossMult *= riverCrossingCostMult;
        }
        if (sourceCell?.biome === "MOUNTAIN" || cell?.biome === "MOUNTAIN") {
          terrainCrossMult *= mountainCrossingCostMult;
        }

        const distance = anchor ? Math.hypot(x - anchor.x, y - anchor.y) : 0;
        const clampedDistance = Math.min(distance, maxDistancePenaltyTiles);
        const distanceMult = 1 + distancePenaltyPerTile * clampedDistance;

        let cost;
        if (!currentOwner) {
          // Unowned tile
          const expansionPower = bonusesByOwner?.[nation.owner]?.expansionPower || 1;
          cost = (baseCost * lossMult * distanceMult * terrainCrossMult * targetTerrainMult) /
                 (expansionPower * speedMult);
        } else {
          // Enemy tile
          const attackerPower = bonusesByOwner?.[nation.owner]?.attackPower || 1;
          const defenderPower = bonusesByOwner?.[currentOwner.owner]?.defensePower || 1;
          let defense = baseDefense * defenderPower * contestedDefenseMult;
          const terrainDefenseMult = terrainDefenseMultByBiome[cell?.biome] || 1;
          defense *= terrainDefenseMult;

          const structureDefense = getStructureDefenseBoost(x, y, currentOwner, structureConfig);
          defense *= structureDefense.troopLossMultiplier;
          const structureSpeedMult = structureDefense.speedMultiplier;

          // HUGE bonus when attacking encircled enemies (they're cut off, demoralized)
          const encirclementBonus = currentOwner.isEncircled ? 0.2 : 1; // 80% defense reduction!
          defense *= encirclementBonus;

          cost = (baseCost * lossMult * defense * distanceMult * terrainCrossMult * targetTerrainMult) /
                 (attackerPower * speedMult * structureSpeedMult);
        }

        if (budget - spent >= cost) {
          if (currentOwner && currentOwner.owner !== nation.owner) {
            // CRITICAL: Find the nation object from gameState.nations, not the ownershipMap!
            // The ownershipMap may contain stale references that won't be saved.
            const targetNation = gameState.nations.find(n => n.owner === currentOwner.owner);
            if (targetNation) {
              removeTerritoryCell(targetNation, x, y);
            }
          }
          addTerritoryCell(nation, x, y);
          ownershipMap.set(key, nation);
          spent += cost;
        }

        attempts++;
      }

      // Update arrow progress along path
      const distToCurrentTarget = getMinDistanceToTerritory(nation, targetPoint.x, targetPoint.y, 3);
      if (spent > 0) {
        // Check if we've reached the current target point - advance to next waypoint
        if (distToCurrentTarget <= 2 && arrow.currentIndex < arrow.path.length - 1) {
          arrow.currentIndex = (arrow.currentIndex || 0) + 1;
        }
      }

      remaining -= spent;
      arrow.remainingPower = remaining;
      arrow.stalledTicks = spent > 0 ? 0 : Number(arrow.stalledTicks || 0) + 1;

        // Remove arrow if power is too low to capture anything (cost is usually 1-3)
        // Or if arrow has been stalled for multiple ticks.
        if (
          remaining <= 3 ||
          (spent === 0 && remaining < 10) ||
          (arrow.stalledTicks >= arrowMaxStallTicks)
        ) {
          if (arrow.stalledTicks >= arrowMaxStallTicks && remaining > 0) {
            nation.population = (nation.population || 0) + remaining;
          }
          nation.arrowOrders.attack = null;
          delete nation.arrowOrders.attack;
        }
      }
    }
  }

  // Process defend arrow
  if (nation.arrowOrders?.defend) {
    const arrow = nation.arrowOrders.defend;
    let remaining = arrow.remainingPower || 0;

    // Expiry scales with committed power so large arrows do not die instantly.
    const maxDurationMs = getArrowMaxDurationMs(arrow);
    const arrowAge = arrow.createdAt ? Date.now() - new Date(arrow.createdAt).getTime() : 0;
    if (arrowAge > maxDurationMs) {
      console.log(`[ARROW] Defend arrow expired for ${nation.name || nation.owner} (age: ${arrowAge}ms)`);
      // Return remaining power to population
      nation.population = (nation.population || 0) + (arrow.remainingPower || 0);
      nation.arrowOrders.defend = null;
      delete nation.arrowOrders.defend;
    } else {
      // Validate arrow.path is a proper array with valid points
      const validPath = Array.isArray(arrow.path) && arrow.path.length >= 2 &&
        arrow.path.every(p => p && typeof p.x === 'number' && typeof p.y === 'number');

      if (!validPath) {
        // Invalid path structure, remove the arrow
        console.log(`[ARROW] Removing invalid defend arrow for ${nation.name || nation.owner}`);
        nation.arrowOrders.defend = null;
        delete nation.arrowOrders.defend;
      } else if (remaining > 0) {
      // Defend arrow: slowly return troops to population (defensive stance)
      // The troops are "defending" along the path, which means they're not expanding
      // but their presence makes it harder for enemies to take those tiles
      // For now, just decay the arrow over time and return troops
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

  // Hole-filling pass to reduce frontier artifacts/checkerboards.
  if (nation.territory?.x?.length > 0) {
    const holesToFill = [];
    const checked = new Set();
    const tx = nation.territory.x;
    const ty = nation.territory.y;
    const dynamicFillBudget = Math.max(
      4,
      Math.min(18, Math.floor(tx.length * 0.008))
    );

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
            if (ownershipMap.get(`${nx + ddx},${ny + ddy}`)?.owner === nation.owner) {
              ownedCount++;
            }
          }

          if (ownedCount >= requiredOwnedNeighbors) {
            holesToFill.push({ x: nx, y: ny, key, ownedCount });
          }
        }
      }
    };

    // First pass: strict holes, second pass: softer gaps if room remains in budget.
    collectHoles(3);
    if (holesToFill.length < Math.floor(dynamicFillBudget * 0.35)) {
      collectHoles(2);
    }

    holesToFill.sort((a, b) => b.ownedCount - a.ownedCount);

    for (const hole of holesToFill.slice(0, dynamicFillBudget)) {
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
