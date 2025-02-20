// gameLogic.js
import _ from "lodash";
import config from "../config/config.js";
import { updateLoyalty, initializeLoyalty, LOYALTY } from "./loyaltySystem.js";

const MAX_POPULATION_PER_TERRITORY = 10;
const CITY_POPULATION_BONUS = 500;
const REINFORCEMENT_RATE = LOYALTY.ARMY_BONUS + 1;
const ENEMY_TERRITORY_PENALTY = 1;

export function checkWinCondition(gameState, mapData) {
  // Count active (non-defeated) nations
  const activeNations = gameState.nations.filter(
    (nation) => nation.status !== "defeated"
  );

  // If only one player remains, they win
  if (gameState.players.length === 1) {
    const winner = activeNations[0].owner;
    gameState.nations.forEach((nation) => {
      nation.status = nation.owner === winner ? "winner" : "defeated";
    });
    return;
  }

  // Otherwise, check territory win condition
  let totalClaimable = 0;
  for (let y = 0; y < mapData.length; y++) {
    for (let x = 0; x < mapData[0].length; x++) {
      const cell = mapData[y][x];
      if (cell && cell.biome !== "OCEAN") {
        totalClaimable++;
      }
    }
  }

  // Get the win threshold percentage from your config (e.g., 50 means 50%)
  const winThreshold = config.winConditionPercentage || 50;
  let winner = null;

  // Update each nation with its territory percentage.
  gameState.nations.forEach((nation) => {
    // Skip already defeated nations
    if (nation.status === "defeated") return;

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

function getBorderCells(nation, mapData, allNations, invalidateBorderCache) {
  // If we have a cached border set and no territory delta changes, reuse it.
  if (
    !invalidateBorderCache &&
    nation.cachedBorderSet &&
    (!nation.territoryDelta ||
      (nation.territoryDelta.add.x.length === 0 &&
        nation.territoryDelta.sub.x.length === 0))
  ) {
    return nation.cachedBorderSet;
  }
  const borderCells = getValidAdjacentCells(
    nation.territory,
    mapData,
    allNations
  );
  nation.cachedBorderSet = borderCells;
  return borderCells;
}

function getValidAdjacentCells(territory, mapData, allNations) {
  if (!Array.isArray(mapData) || !Array.isArray(mapData[0])) {
    console.warn("Invalid map data structure");
    return [];
  }
  const adjacentCells = new Set();
  const allOccupiedPositions = new Set();
  const territorySet = getTerritorySet(territory);
  territorySet.forEach((pos) => allOccupiedPositions.add(pos));
  if (Array.isArray(allNations)) {
    allNations.forEach((nation) => {
      if (nation.territory && nation.territory.x && nation.territory.y) {
        getTerritorySet(nation.territory).forEach((pos) =>
          allOccupiedPositions.add(pos)
        );
      }
    });
  }
  forEachTerritoryCell(territory, (x, y) => {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const newX = x + dx;
        const newY = y + dy;
        const posKey = `${newX},${newY}`;
        if (allOccupiedPositions.has(posKey)) continue;
        if (
          newX < 0 ||
          newY < 0 ||
          newY >= mapData.length ||
          newX >= mapData[0].length
        )
          continue;
        const cellData = mapData[newY][newX];
        if (!cellData || cellData.biome === "OCEAN") continue;
        adjacentCells.add(JSON.stringify({ x: newX, y: newY, cell: cellData }));
      }
    }
  });
  return Array.from(adjacentCells).map((str) => JSON.parse(str));
}

export function expandTerritory(
  nation,
  mapData,
  allNations,
  invalidateBorderCache
) {
  // Initialize territory if not set.
  if (
    !nation.territory ||
    !nation.territory.x ||
    nation.territory.x.length === 0
  ) {
    if (nation.startingCell) {
      nation.territory = {
        x: [nation.startingCell.x],
        y: [nation.startingCell.y],
      };
      nation.territoryDelta = {
        add: { x: [nation.startingCell.x], y: [nation.startingCell.y] },
        sub: { x: [], y: [] },
      };
    }
    return;
  }
  if (!nation.territoryDelta) {
    nation.territoryDelta = { add: { x: [], y: [] }, sub: { x: [], y: [] } };
  }

  // Get the current border cells.
  const adjacentCells = getBorderCells(
    nation,
    mapData,
    allNations,
    invalidateBorderCache
  );
  if (adjacentCells.length === 0) return;

  // Get cities that can support territory expansion
  const supportCities = (nation.cities || []).filter(
    (city) => city.type === "capital" || city.type === "town"
  );

  if (supportCities.length === 0) return; // No valid cities to support expansion

  // Define maximum expansion distance from cities
  const MAX_EXPANSION_DISTANCE = 14; // Maximum tiles away from a city

  // Filter cells based on distance from supporting cities
  const validDistanceCells = adjacentCells.filter((adj) => {
    // Check distance to nearest supporting city
    let minDistance = Infinity;
    for (const city of supportCities) {
      const distance = Math.sqrt(
        Math.pow(adj.x - city.x, 2) + Math.pow(adj.y - city.y, 2)
      );
      minDistance = Math.min(minDistance, distance);
    }
    return minDistance <= MAX_EXPANSION_DISTANCE;
  });

  if (validDistanceCells.length === 0) return; // No valid cells within distance

  // *** Filter out candidates not adjacent to connected (capital-linked) territory ***
  const connectedCells = computeConnectedCells(nation);
  const validAdjacentCells = validDistanceCells.filter((adj) => {
    // For each candidate, check its neighboring territory cells.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const neighborX = adj.x + dx;
        const neighborY = adj.y + dy;
        if (isCellInTerritory(nation.territory, neighborX, neighborY)) {
          // Only allow expansion if one of the adjacent territory cells is connected.
          if (connectedCells.has(`${neighborX},${neighborY}`)) {
            return true;
          }
        }
      }
    }
    return false;
  });

  if (validAdjacentCells.length === 0) return;

  // Continue with scoring candidates (using the filtered list)
  const BONUS_MULTIPLIER = 1000;
  let currentMinDistance = Infinity;
  if (nation.expansionTarget) {
    forEachTerritoryCell(nation.territory, (x, y) => {
      const d =
        Math.abs(x - nation.expansionTarget.current.x) +
        Math.abs(y - nation.expansionTarget.current.y);
      if (d < currentMinDistance) currentMinDistance = d;
    });
  }
  const scoredCells = validAdjacentCells
    .map((adj) => {
      if (adj.cell.biome === "OCEAN") return null;
      let score = 1;

      // Add distance-based scoring modifier
      let minCityDistance = Infinity;
      for (const city of supportCities) {
        const distance = Math.sqrt(
          Math.pow(adj.x - city.x, 2) + Math.pow(adj.y - city.y, 2)
        );
        minCityDistance = Math.min(minCityDistance, distance);
      }
      // Prefer cells closer to cities
      score += (MAX_EXPANSION_DISTANCE - minCityDistance) * 50;

      if (nation.expansionTarget && nation.expansionTarget.ticksRemaining > 0) {
        const candidateDistance =
          Math.abs(adj.x - nation.expansionTarget.current.x) +
          Math.abs(adj.y - nation.expansionTarget.current.y);
        if (candidateDistance < currentMinDistance) {
          score += (currentMinDistance - candidateDistance) * BONUS_MULTIPLIER;
        }
      }
      return { ...adj, score };
    })
    .filter((cell) => cell && cell.score > -Infinity);

  const bestCell = _.maxBy(scoredCells, "score");
  if (bestCell) {
    nation.territory.x.push(bestCell.x);
    nation.territory.y.push(bestCell.y);
    initializeLoyalty(nation, bestCell.x, bestCell.y);
    nation.territoryDelta.add.x.push(bestCell.x);
    nation.territoryDelta.add.y.push(bestCell.y);
    // Invalidate caches since territory changed.
    delete nation.cachedBorderSet;
    delete nation.cachedNaturalLimits;
  }
}

function calculateMaxPopulation(nation) {
  let maxPop = nation.territory.x.length * MAX_POPULATION_PER_TERRITORY;
  maxPop += (nation.cities?.length || 0) * CITY_POPULATION_BONUS;
  const resources = nation.resources || {};
  // Updated multiplier: use "food" (instead of "arable land", "fresh water", or "pastures")
  if (resources["food"] > 0) maxPop *= 1.2;
  return Math.floor(maxPop);
}

export function updatePopulation(nation) {
  const maxPopulation = calculateMaxPopulation(nation);
  const currentPopulation = nation.population || 0;
  if (currentPopulation < maxPopulation) {
    const growth = currentPopulation + (nation.cities.length + 5) * 0.01;
    nation.population = Math.min(currentPopulation + growth, maxPopulation);
  }
}

function updateArmyMovementsUpdated(updatedNation, mapData, gameState) {
  if (!updatedNation.armies || !Array.isArray(updatedNation.armies)) {
    return updatedNation.armies || [];
  }

  // Build a map of occupied positions for collision detection.
  const occupiedPositions = new Map();
  if (gameState.nations && Array.isArray(gameState.nations)) {
    gameState.nations.forEach((nation) => {
      if (nation.armies && Array.isArray(nation.armies)) {
        nation.armies.forEach((army) => {
          if (army.position) {
            const posKey = `${Math.floor(army.position.x)},${Math.floor(
              army.position.y
            )}`;
            occupiedPositions.set(posKey, {
              nationId: nation.id,
              armyId: army.id,
            });
          }
        });
      }
    });
  }

  const TARGET_SNAP_DISTANCE = 1.0;
  // Create a global set to capture all cells influenced by armies.
  let globalAffectedCellsSet = new Set();

  updatedNation.armies = updatedNation.armies
    .map((army) => {
      if (!army.position) return army;
      let newPosition = { ...army.position };

      // Process movement if the army has an attack target.
      if (army.attackTarget) {
        const { current, final } = army.attackTarget;
        const dx = final.x - current.x;
        const dy = final.y - current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= TARGET_SNAP_DISTANCE) {
          const finalPosKey = `${Math.floor(final.x)},${Math.floor(final.y)}`;
          const isFinalPositionOccupied =
            occupiedPositions.has(finalPosKey) &&
            occupiedPositions.get(finalPosKey).armyId !== army.id;
          if (!isFinalPositionOccupied) {
            newPosition = { x: final.x, y: final.y };
            const oldPosKey = `${Math.floor(army.position.x)},${Math.floor(
              army.position.y
            )}`;
            occupiedPositions.delete(oldPosKey);
            occupiedPositions.set(finalPosKey, {
              nationId: updatedNation.id,
              armyId: army.id,
            });
            army.attackTarget = null;
          }
        } else {
          const targetAngle = Math.atan2(dy, dx);
          const maxAngleVariation = Math.PI / 36;
          const randomVariation = (Math.random() - 0.5) * 2 * maxAngleVariation;
          const newAngle = targetAngle + randomVariation;
          const proposedX =
            current.x +
            config.armies.stats[army.type].speed * Math.cos(newAngle);
          const proposedY =
            current.y +
            config.armies.stats[army.type].speed * Math.sin(newAngle);
          const floorProposedX = Math.floor(proposedX);
          const floorProposedY = Math.floor(proposedY);
          const isValidTerrain =
            mapData[floorProposedY] &&
            mapData[floorProposedY][floorProposedX] &&
            mapData[floorProposedY][floorProposedX].biome !== "OCEAN";
          const proposedPosKey = `${floorProposedX},${floorProposedY}`;
          const isPositionOccupied =
            occupiedPositions.has(proposedPosKey) &&
            occupiedPositions.get(proposedPosKey).armyId !== army.id;
          if (isValidTerrain && !isPositionOccupied) {
            newPosition = { x: proposedX, y: proposedY };
            army.attackTarget.current = { ...newPosition };
            const oldPosKey = `${Math.floor(army.position.x)},${Math.floor(
              army.position.y
            )}`;
            occupiedPositions.delete(oldPosKey);
            occupiedPositions.set(proposedPosKey, {
              nationId: updatedNation.id,
              armyId: army.id,
            });
          }
        }
      }

      // Update army position.
      army.position = newPosition;
      const posX = Math.floor(army.position.x);
      const posY = Math.floor(army.position.y);
      const maxPower = config.armies?.stats?.[army.type]?.power || 100;
      if (army.currentPower === undefined) {
        army.currentPower = maxPower;
      }

      // --- Apply Territory Modifiers ---
      // Reinforce if in friendly territory.
      if (isCellInTerritory(updatedNation.territory, posX, posY)) {
        army.currentPower += REINFORCEMENT_RATE;
      }
      // For each cell in range (using LOYALTY.ARMY_RANGE), check for enemy influence.
      let enemyPenalty = 0;
      for (let dx = -LOYALTY.ARMY_RANGE; dx <= LOYALTY.ARMY_RANGE; dx++) {
        for (let dy = -LOYALTY.ARMY_RANGE; dy <= LOYALTY.ARMY_RANGE; dy++) {
          // Skip the army's own cell.
          if (dx === 0 && dy === 0) continue;
          const neighborX = posX + dx;
          const neighborY = posY + dy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          // Linear decay: weight is 1 at distance 0 and 0 at LOYALTY.ARMY_RANGE.
          const weight = Math.max(0, 1 - dist / LOYALTY.ARMY_RANGE);
          let isEnemy = false;
          if (gameState.nations && Array.isArray(gameState.nations)) {
            for (const otherNation of gameState.nations) {
              if (
                otherNation.owner !== updatedNation.owner &&
                isCellInTerritory(otherNation.territory, neighborX, neighborY)
              ) {
                isEnemy = true;
                break;
              }
            }
          }
          if (isEnemy) {
            enemyPenalty += ENEMY_TERRITORY_PENALTY * weight;
            // Only add the neighbor if there is enemy influence.
            if (dist <= LOYALTY.ARMY_RANGE) {
              globalAffectedCellsSet.add(`${neighborX},${neighborY}`);
            }
          }
        }
      }
      army.currentPower -= enemyPenalty;
      army.currentPower = Math.min(maxPower, Math.max(0, army.currentPower));

      return army.currentPower > 0 ? army : null;
    })
    .filter((army) => army !== null);

  // Set the nation's global affected cells (for visualization).
  updatedNation.armiesAffectedCells = Array.from(globalAffectedCellsSet).map(
    (key) => {
      const [x, y] = key.split(",").map(Number);
      return { x, y };
    }
  );

  return updatedNation.armies;
}

export function updateNation(nation, mapData, gameState) {
  const overallStart = process.hrtime();
  if (!Array.isArray(mapData) || !Array.isArray(mapData[0])) {
    console.warn("Invalid map data structure in updateNation");
    return nation;
  }

  // Preserve the current territoryDelta (if any) for later comparison.
  // (Assume expandTerritory may add new changes to nation.territoryDelta)
  const previousDelta = nation.territoryDelta || {
    add: { x: [], y: [] },
    sub: { x: [], y: [] },
  };

  // --- 1. Update Loyalty ---
  const startLoyalty = process.hrtime();
  let connectedCells;
  if (!previousDelta.sub.x.length && nation.cachedConnectedCells) {
    connectedCells = nation.cachedConnectedCells;
  } else {
    connectedCells = computeConnectedCells(nation);
    if (nation.cachedConnectedCells != connectedCells) {
      gameState.invalidateBorderCache = true;
    }
    nation.cachedConnectedCells = connectedCells;
  }
  updateLoyalty(nation, gameState, connectedCells);
  if (nation.cachedConnectedCells != connectedCells) {
    gameState.invalidateBorderCache = true;
  }
  const endLoyalty = process.hrtime(startLoyalty);

  connectedCells = computeConnectedCells(nation);
  nation.cachedConnectedCells = connectedCells;

  // --- 2. Regenerate Natural Resources ---
  const startNaturalResources = process.hrtime();
  if (nation.cities) {
    nation.cities.forEach((city) => {
      // Only non‑resource structures produce resources.
      if (["capital", "town", "fort"].includes(city.type)) return;
      const { x, y } = city;
      const cell = mapData[y] && mapData[y][x];
      if (!cell) return;
      const baseProduction = {
        farm: 0.5,
        "lumber mill": 0.5,
        mine: 0.5,
        stable: 0.5,
      };
      const productionAmount = baseProduction[city.type] || 0;
      nation.resources[city.resource] =
        (nation.resources[city.resource] || 0) + productionAmount;
    });
  }
  const endNaturalResources = process.hrtime(startNaturalResources);

  // --- 3. Update Armies Movement ---
  const startArmies = process.hrtime();
  if (nation.armies && Array.isArray(nation.armies)) {
    nation.armies = updateArmyMovementsUpdated(nation, mapData, gameState);
  }
  const endArmies = process.hrtime(startArmies);

  // --- 4. Update Territory Expansion and Population ---
  const startTerritoryPopulation = process.hrtime();
  if (nation.status !== "defeated") {
    expandTerritory(
      nation,
      mapData,
      gameState.nations,
      gameState.invalidateBorderCache
    );
    updatePopulation(nation);
  }
  const endTerritoryPopulation = process.hrtime(startTerritoryPopulation);

  // --- 5. Cache Invalidation: Check if territory changed ---
  const deltaChanged =
    nation.territoryDelta.add.x.length > 0 ||
    nation.territoryDelta.sub.x.length > 0;
  if (deltaChanged) {
    delete nation.cachedBorderSet;
    delete nation.cachedConnectedCells;
    delete nation.cachedNaturalLimits;
    gameState.invalidateBorderCache = true;
  }

  // Additionally, if any enemy nation lost territory, invalidate caches for all nations.
  if (gameState.nations && Array.isArray(gameState.nations)) {
    const enemyLostTerritory = gameState.nations.some((otherNation) => {
      return (
        otherNation.owner !== nation.owner &&
        otherNation.territoryDelta &&
        otherNation.territoryDelta.sub.x.length > 0
      );
    });
    if (enemyLostTerritory) {
      gameState.nations.forEach((nationItem) => {
        delete nationItem.cachedBorderSet;
        delete nationItem.cachedConnectedCells;
      });
      gameState.invalidateBorderCache = true;
    }
  }

  // --- 6. Finalize Territory Delta for Client and Reset It ---
  if (nation.territoryDelta) {
    nation.territoryDeltaForClient = {
      add: {
        x: [...nation.territoryDelta.add.x],
        y: [...nation.territoryDelta.add.y],
      },
      sub: {
        x: [...nation.territoryDelta.sub.x],
        y: [...nation.territoryDelta.sub.y],
      },
    };
    nation.territoryDelta = { add: { x: [], y: [] }, sub: { x: [], y: [] } };
  }

  const overallEnd = process.hrtime(overallStart);
  console.log(
    `updateNation overall took ${(
      overallEnd[0] * 1000 +
      overallEnd[1] / 1e6
    ).toFixed(2)} ms`
  );
  return nation;
}

function computeConnectedCells(nation) {
  const connected = new Set();
  const capital =
    nation.cities && nation.cities.find((city) => city.type === "capital");
  if (!capital) return connected;

  const territorySet = new Set();
  forEachTerritoryCell(nation.territory, (x, y) => {
    territorySet.add(`${x},${y}`);
  });

  const queue = [[capital.x, capital.y]];
  // Use all eight directions instead of just the four cardinal ones.
  const directions = [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  while (queue.length > 0) {
    const [x, y] = queue.shift();
    const key = `${x},${y}`;
    if (!territorySet.has(key)) continue;
    if (connected.has(key)) continue;
    connected.add(key);
    for (const [dx, dy] of directions) {
      const neighborKey = `${x + dx},${y + dy}`;
      if (territorySet.has(neighborKey) && !connected.has(neighborKey)) {
        queue.push([x + dx, y + dy]);
      }
    }
  }
  return connected;
}
