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
  currentTick = 0
) {
  return updateNationTerritorial(
    nation,
    mapData,
    gameState,
    ownershipMap,
    bonusesByOwner,
    currentTick
  );
}

function updateNationTerritorial(
  nation,
  mapData,
  gameState,
  ownershipMap,
  bonusesByOwner,
  currentTick
) {
  if (!Array.isArray(mapData) || !Array.isArray(mapData[0])) {
    console.warn("Invalid map data structure in updateNationTerritorial");
    return nation;
  }

  const updatedNation = nation;
  updatedNation.resources = updatedNation.resources || {};
  updatedNation.territoryDelta =
    updatedNation.territoryDelta || { add: { x: [], y: [] }, sub: { x: [], y: [] } };
  updatedNation.pressureOrders = updatedNation.pressureOrders || [];

  const bonuses =
    bonusesByOwner?.[updatedNation.owner] || {
      expansionPower: 1,
      attackPower: 1,
      defensePower: 1,
      production: 1,
      goldIncome: 0,
    };

  // Population growth (casual territorial pacing)
  const ownedTiles = updatedNation.territory?.x?.length || 0;
  const baseGrowth = config?.territorial?.baseGrowth || 0.6;
  const growth = baseGrowth * bonuses.production * Math.sqrt(ownedTiles || 1);
  updatedNation.population = (updatedNation.population || 0) + growth;

  // Passive gold income from nodes
  if (bonuses.goldIncome > 0) {
    updatedNation.resources.gold =
      (updatedNation.resources.gold || 0) + bonuses.goldIncome;
  }

  if (updatedNation.isBot) {
    maybeEnqueueBotPressure(
      updatedNation,
      mapData,
      ownershipMap,
      bonusesByOwner,
      currentTick,
      gameState
    );
  }

  // Apply pressure orders (expansion/attack)
  if (updatedNation.pressureOrders.length > 0) {
    processPressureOrders(
      updatedNation,
      gameState,
      mapData,
      ownershipMap,
      bonusesByOwner
    );
  }

  // Defeat if capital is overrun; neutralize disconnected territory.
  const capital =
    updatedNation.cities &&
    updatedNation.cities.find((city) => city.type === "capital");
  if (capital) {
    const capitalKey = `${capital.x},${capital.y}`;
    const capitalOwner = ownershipMap?.get(capitalKey);
    if (!capitalOwner || capitalOwner.owner !== updatedNation.owner) {
      updatedNation.status = "defeated";
      const tx = [...(updatedNation.territory?.x || [])];
      const ty = [...(updatedNation.territory?.y || [])];
      for (let i = 0; i < tx.length; i++) {
        removeTerritoryCell(updatedNation, tx[i], ty[i]);
        ownershipMap?.delete(`${tx[i]},${ty[i]}`);
      }
      updatedNation.pressureOrders = [];
    } else {
      const connectivityInterval =
        config?.territorial?.connectivityCheckIntervalTicks ?? 3;
      const hasChanges =
        (updatedNation.territoryDelta?.add?.x?.length || 0) > 0 ||
        (updatedNation.territoryDelta?.sub?.x?.length || 0) > 0;
      if (
        hasChanges &&
        Number.isFinite(connectivityInterval) &&
        (currentTick ?? 0) % connectivityInterval === 0
      ) {
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
  } else {
    updatedNation.status = "defeated";
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
    } else if (!updatedNation.territoryDeltaForClient) {
      updatedNation.territoryDeltaForClient = {
        add: { x: [], y: [] },
        sub: { x: [], y: [] },
      };
    }
    updatedNation.territoryDelta = { add: { x: [], y: [] }, sub: { x: [], y: [] } };
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

function maybeEnqueueBotPressure(
  nation,
  mapData,
  ownershipMap,
  bonusesByOwner,
  tickCount,
  gameState
) {
  if (!ownershipMap) {
    if (process.env.DEBUG_BOTS === "true") {
      console.log(`[BOTS] skip ${nation.owner} no ownershipMap`);
    }
    return;
  }
  const orderInterval = config?.territorial?.botOrderIntervalTicks ?? 4;
  const lastTick = nation.lastBotOrderTick ?? -Infinity;
  if (tickCount - lastTick < orderInterval) {
    if (process.env.DEBUG_BOTS === "true") {
      console.log(
        `[BOTS] skip ${nation.owner} interval=${tickCount - lastTick}`
      );
    }
    return;
  }
  const maxQueued = config?.territorial?.botMaxQueuedOrders ?? 2;
  if ((nation.pressureOrders?.length || 0) >= maxQueued) {
    if (process.env.DEBUG_BOTS === "true") {
      console.log(
        `[BOTS] skip ${nation.owner} queue=${nation.pressureOrders.length}`
      );
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
    if (process.env.DEBUG_BOTS === "true") {
      console.log(`[BOTS] skip ${nation.owner} no candidates`);
    }
    return;
  }
  let direction = normalizeVector(candidate.x - anchor.x, candidate.y - anchor.y);
  if (!direction) {
    direction = randomDirection();
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
    if (process.env.DEBUG_BOTS === "true") {
      console.log(
        `[BOTS] skip ${nation.owner} population=${available.toFixed(1)}`
      );
    }
    return;
  }

  nation.population = Math.max(0, available - power);
  nation.pressureOrders = nation.pressureOrders || [];
  nation.pressureOrders.push({
    id: new Date().toISOString(),
    direction:
      direction || {
        x: candidate.x - anchor.x,
        y: candidate.y - anchor.y,
      },
    target: { x: candidate.x, y: candidate.y },
    remainingPower: power,
    targetReached: false,
    focusTicksRemaining: 0,
    targetStallTicks: 0,
  });
  if (process.env.DEBUG_BOTS === "true") {
    console.log(
      `[BOTS] order ${nation.owner} pop=${available.toFixed(
        1
      )} spend=${power.toFixed(1)} dir=(${candidate.x - anchor.x},${
        candidate.y - anchor.y
      }) queue=${nation.pressureOrders.length}`
    );
  }
  nation.lastBotOrderTick = tickCount;
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

function processPressureOrders(
  nation,
  gameState,
  mapData,
  ownershipMap,
  bonusesByOwner
) {
  const orders = nation.pressureOrders || [];
  if (!ownershipMap) return;
  const baseCost = config?.territorial?.baseCost || 1;
  const baseDefense = config?.territorial?.baseDefense || 1;
  const pressurePerTick = config?.territorial?.pressurePerTick || 6;
  const attemptsPerTick = config?.territorial?.frontierAttemptsPerTick || 8;
  const distancePenaltyPerTile =
    config?.territorial?.distancePenaltyPerTile ?? 0.02;
  const maxDistancePenaltyTiles =
    config?.territorial?.maxDistancePenaltyTiles ?? 40;
  const minOrderRemaining = config?.territorial?.minOrderRemaining ?? 0.5;
  const maxOrderTicks = config?.territorial?.maxOrderTicks ?? 40;
  const maxOrderStaleTicks = config?.territorial?.maxOrderStaleTicks ?? 6;
  const targetReachDistance = config?.territorial?.targetReachDistance ?? 2;
  const targetFocusTicks = config?.territorial?.targetFocusTicks ?? 14;
  const targetStallToSpreadTicks =
    config?.territorial?.targetStallToSpreadTicks ?? 8;
  const targetMaxTicks = config?.territorial?.targetMaxTicks ?? 45;
  const contestedDefenseMult = config?.territorial?.contestedDefenseMult ?? 1.25;
  const resourceUpgrades = gameState?.resourceUpgrades || {};
  const towerRadius = config?.territorial?.towerDefenseRadius ?? 2;
  const towerDefenseBonus = config?.territorial?.towerDefenseBonus ?? 0.25;
  const riverCrossingCostMult =
    config?.territorial?.riverCrossingCostMult ?? 1.3;
  const mountainCrossingCostMult =
    config?.territorial?.mountainCrossingCostMult ?? 1.6;
  const terrainExpansionCostMultByBiome =
    config?.territorial?.terrainExpansionCostMultByBiome || {};
  const terrainDefenseMultByBiome =
    config?.territorial?.terrainDefenseMultByBiome || {};
  const maxCarryover = config?.territorial?.maxOrderCarryover ?? 60;

  const anchor = getNationAnchor(nation);
  const remainingOrders = [];

  for (const order of orders) {
    let remaining = order.remainingPower || 0;
    if (remaining <= 0) continue;
    if (nation.isBot && remaining <= minOrderRemaining) {
      continue;
    }
    order.ageTicks = (order.ageTicks || 0) + 1;
    if (order.ageTicks > maxOrderTicks) {
      continue;
    }
    if (order.target && !order.targetReached) {
      const distToTarget = getMinDistanceToTerritory(
        nation,
        order.target.x,
        order.target.y,
        targetReachDistance
      );
      if (distToTarget <= targetReachDistance) {
        order.targetReached = true;
        order.focusTicksRemaining = targetFocusTicks;
      } else if (order.ageTicks >= targetMaxTicks) {
        order.targetReached = true;
        order.focusTicksRemaining = targetFocusTicks;
      }
    }
    if ((order.focusTicksRemaining || 0) > 0) {
      order.focusTicksRemaining -= 1;
    }
    const carryOver = order.carryOver || 0;
    const initialBudget = Math.min(remaining, pressurePerTick + carryOver);
    let budget = initialBudget;

    const frontier = getDirectionalFrontierCandidates(
      nation,
      mapData,
      ownershipMap,
      order.direction,
      anchor,
      bonusesByOwner,
      order
    );
    if (process.env.DEBUG_BOTS === "true" && nation.isBot) {
      console.log(
        `[BOTS] process ${nation.owner} remaining=${remaining.toFixed(
          1
        )} frontier=${frontier.length}`
      );
    }
    if (frontier.length === 0) {
      remaining = 0;
    }

    let attempts = 0;
    let spentThisTick = 0;
    while (budget > 0 && attempts < attemptsPerTick && frontier.length > 0) {
      const target = frontier.shift();
      if (!target) break;

      const { x, y, sourceBiome, targetBiome } = target;
      const { lossMult, speedMult } = getTerrainCostModifiers(
        sourceBiome,
        targetBiome
      );
      const distance = target.distanceFromAnchor || 0;
      const clampedDistance = Math.min(distance, maxDistancePenaltyTiles);
      const distanceMult = 1 + distancePenaltyPerTile * clampedDistance;
      const targetTerrainMult =
        terrainExpansionCostMultByBiome[targetBiome] || 1;
      let terrainCrossMult = 1;
      if (sourceBiome === "RIVER" || targetBiome === "RIVER") {
        terrainCrossMult *= riverCrossingCostMult;
      }
      if (sourceBiome === "MOUNTAIN" || targetBiome === "MOUNTAIN") {
        terrainCrossMult *= mountainCrossingCostMult;
      }
      const key = `${x},${y}`;
      const currentOwner = ownershipMap.get(key);
      if (currentOwner?.owner === nation.owner) {
        attempts += 1;
        continue;
      }

      if (!currentOwner) {
        const expansionPower =
          bonusesByOwner?.[nation.owner]?.expansionPower || 1;
        const cost =
          (baseCost *
            lossMult *
            distanceMult *
            terrainCrossMult *
            targetTerrainMult) /
          (expansionPower * speedMult);
        if (budget >= cost) {
          addTerritoryCell(nation, x, y);
          ownershipMap.set(key, nation);
          budget -= cost;
          spentThisTick += cost;
          if (nation.isBot) {
            nation.botLastCaptureTick = gameState?.tickCount || 0;
          }
        } else {
          attempts += 1;
          continue;
        }
      } else if (currentOwner.owner !== nation.owner) {
        const attackerPower =
          bonusesByOwner?.[nation.owner]?.attackPower || 1;
        const defenderPower =
          bonusesByOwner?.[currentOwner.owner]?.defensePower || 1;
        let defense = baseDefense * defenderPower * contestedDefenseMult;
        const terrainDefenseMult =
          terrainDefenseMultByBiome[targetBiome] || 1;
        defense *= terrainDefenseMult;
        if (towerDefenseBonus > 0 && towerRadius > 0) {
          const towerBoost = getTowerDefenseBoost(
            x,
            y,
            currentOwner.owner,
            ownershipMap,
            resourceUpgrades,
            towerRadius,
            towerDefenseBonus
          );
          defense *= 1 + towerBoost;
        }
        const cost =
          (baseCost *
            lossMult *
            defense *
            distanceMult *
            terrainCrossMult *
            targetTerrainMult) /
          (attackerPower * speedMult);
        if (budget >= cost) {
          removeTerritoryCell(currentOwner, x, y);
          addTerritoryCell(nation, x, y);
          ownershipMap.set(key, nation);
          budget -= cost;
          spentThisTick += cost;
          if (nation.isBot) {
            nation.botLastCaptureTick = gameState?.tickCount || 0;
          }
        } else {
          attempts += 1;
          continue;
        }
      }

      attempts += 1;
    }

    order.carryOver = Math.min(
      maxCarryover,
      Math.max(0, carryOver + pressurePerTick - spentThisTick)
    );

    if (spentThisTick === 0 && process.env.DEBUG_ORDERS === "true") {
      let minCost = Infinity;
      let minKey = null;
      let sampleCount = 0;
      for (const target of frontier) {
        const { x, y, sourceBiome, targetBiome } = target;
        const { lossMult, speedMult } = getTerrainCostModifiers(
          sourceBiome,
          targetBiome
        );
        const distance = target.distanceFromAnchor || 0;
        const clampedDistance = Math.min(distance, maxDistancePenaltyTiles);
        const distanceMult = 1 + distancePenaltyPerTile * clampedDistance;
        const targetTerrainMult =
          terrainExpansionCostMultByBiome[targetBiome] || 1;
        let terrainCrossMult = 1;
        if (sourceBiome === "RIVER" || targetBiome === "RIVER") {
          terrainCrossMult *= riverCrossingCostMult;
        }
        if (sourceBiome === "MOUNTAIN" || targetBiome === "MOUNTAIN") {
          terrainCrossMult *= mountainCrossingCostMult;
        }
        const key = `${x},${y}`;
        const currentOwner = ownershipMap.get(key);
        let cost = Infinity;
        if (!currentOwner) {
          const expansionPower =
            bonusesByOwner?.[nation.owner]?.expansionPower || 1;
          cost =
            (baseCost *
              lossMult *
              distanceMult *
              terrainCrossMult *
              targetTerrainMult) /
            (expansionPower * speedMult);
        } else if (currentOwner.owner !== nation.owner) {
          const attackerPower =
            bonusesByOwner?.[nation.owner]?.attackPower || 1;
          const defenderPower =
            bonusesByOwner?.[currentOwner.owner]?.defensePower || 1;
          let defense = baseDefense * defenderPower * contestedDefenseMult;
          const terrainDefenseMult =
            terrainDefenseMultByBiome[targetBiome] || 1;
          defense *= terrainDefenseMult;
          if (towerDefenseBonus > 0 && towerRadius > 0) {
            const towerBoost = getTowerDefenseBoost(
              x,
              y,
              currentOwner.owner,
              ownershipMap,
              resourceUpgrades,
              towerRadius,
              towerDefenseBonus
            );
            defense *= 1 + towerBoost;
          }
          cost =
            (baseCost *
              lossMult *
              defense *
              distanceMult *
              terrainCrossMult *
              targetTerrainMult) /
            (attackerPower * speedMult);
        }
        if (cost < minCost) {
          minCost = cost;
          minKey = key;
        }
        sampleCount += 1;
        if (sampleCount >= 50) break;
      }
      const budgetInfo = `budget=${budget.toFixed(2)} remaining=${remaining.toFixed(
        2
      )}`;
      const costInfo = Number.isFinite(minCost)
        ? `minCost=${minCost.toFixed(2)} minKey=${minKey}`
        : "minCost=n/a";
      console.log(
        `[ORDERS] stall nation=${nation.owner} ${budgetInfo} frontier=${frontier.length} ${costInfo}`
      );
    }

    if (spentThisTick > 0) {
      remaining -= spentThisTick;
      order.staleTicks = 0;
      order.targetStallTicks = 0;
    } else if (nation.isBot) {
      const drain = Math.min(remaining, pressurePerTick * 0.5);
      remaining -= drain;
      if (frontier.length === 0) {
        order.staleTicks = (order.staleTicks || 0) + 1;
      }
      if (order.target && !order.targetReached) {
        order.targetStallTicks = (order.targetStallTicks || 0) + 1;
        if (order.targetStallTicks >= targetStallToSpreadTicks) {
          order.targetReached = true;
          order.focusTicksRemaining = targetFocusTicks;
        }
      }
    } else {
      if (frontier.length === 0) {
        order.staleTicks = (order.staleTicks || 0) + 1;
      }
      if (order.target && !order.targetReached) {
        order.targetStallTicks = (order.targetStallTicks || 0) + 1;
        if (order.targetStallTicks >= targetStallToSpreadTicks) {
          order.targetReached = true;
          order.focusTicksRemaining = targetFocusTicks;
        }
      }
    }
    if (
      remaining > minOrderRemaining &&
      (order.staleTicks || 0) <= maxOrderStaleTicks
    ) {
      remainingOrders.push({
        ...order,
        remainingPower: remaining,
      });
    }
  }

  nation.pressureOrders = remainingOrders;
}

function getTowerDefenseBoost(
  x,
  y,
  ownerId,
  ownershipMap,
  resourceUpgrades,
  radius,
  baseBonus
) {
  let combined = 0;
  let remaining = 1;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      const key = `${nx},${ny}`;
      const upgrade = resourceUpgrades[key];
      if (!upgrade) continue;
      const owner = ownershipMap.get(key);
      if (!owner || owner.owner !== ownerId) continue;
      const level = upgrade.level ?? 0;
      const boost = baseBonus * getNodeMultiplier(level);
      remaining *= Math.max(0, 1 - boost);
    }
  }
  combined = 1 - remaining;
  return combined;
}

function getDirectionalFrontierCandidates(
  nation,
  mapData,
  ownershipMap,
  direction,
  anchor,
  bonusesByOwner,
  order
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

  const territoryX = nation?.territory?.x || [];
  const territoryY = nation?.territory?.y || [];
  const width = mapData[0].length;
  const height = mapData.length;

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
        let adjacentOwned = 0;
        if (owner && owner.owner !== nation.owner) {
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
        let score =
          alignmentWeight * alignmentScore +
          similarityWeight * similarityScore -
          distancePenaltyPerTile * distanceFromAnchor -
          perpPenalty * perpDistance +
          (isPocket ? pocketBonus : 0) -
          terrainScorePenalty;
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

function addTerritoryCell(nation, x, y) {
  if (!nation.territory) {
    nation.territory = { x: [], y: [] };
  }
  if (!nation.territoryDelta) {
    nation.territoryDelta = { add: { x: [], y: [] }, sub: { x: [], y: [] } };
  }
  for (let i = 0; i < nation.territory.x.length; i++) {
    if (nation.territory.x[i] === x && nation.territory.y[i] === y) {
      return;
    }
  }
  nation.territory.x.push(x);
  nation.territory.y.push(y);
  nation.territoryDelta?.add.x.push(x);
  nation.territoryDelta?.add.y.push(y);
}

function removeTerritoryCell(nation, x, y) {
  if (!nation?.territory?.x || !nation?.territory?.y) return;
  if (!nation.territoryDelta) {
    nation.territoryDelta = { add: { x: [], y: [] }, sub: { x: [], y: [] } };
  }
  for (let i = 0; i < nation.territory.x.length; i++) {
    if (nation.territory.x[i] === x && nation.territory.y[i] === y) {
      nation.territory.x.splice(i, 1);
      nation.territory.y.splice(i, 1);
      nation.territoryDelta?.sub.x.push(x);
      nation.territoryDelta?.sub.y.push(y);
      break;
    }
  }
}
