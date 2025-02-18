// gameLogic.js
import _ from "lodash";
import config from "../config/config.js";
import { updateLoyalty, initializeLoyalty } from "./loyaltySystem.js";

const MAX_POPULATION_PER_TERRITORY = 10;
const CITY_POPULATION_BONUS = 500;
const COMPACTNESS_WEIGHT = 10;
const REINFORCEMENT_RATE = 1;
const ENEMY_TERRITORY_PENALTY = 1;

export function checkWinCondition(gameState, mapData) {
  // Compute total claimable cells (cells that are not ocean)
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

function countAdjacentTerritory(x, y, territory, territorySet = null) {
  let count = 0;
  const tSet = territorySet || getTerritorySet(territory);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      if (tSet.has(`${x + dx},${y + dy}`)) {
        count++;
      }
    }
  }
  return count;
}

export function calculateCellDesirability(
  cell,
  x,
  y,
  territory,
  territorySet = null,
  cities = []
) {
  if (!cell || typeof cell !== "object") {
    console.warn("Invalid cell data received:", cell);
    return -Infinity;
  }
  let score = 0;
  const biomeScores = config.biomeDesirabilityScores;
  score += biomeScores[cell.biome] * 5 || 0;
  score += (Array.isArray(cell.resources) ? cell.resources.length : 0) * 50;
  if (cell.isRiver) score += 5;
  if (typeof cell.temperature === "number") {
    score + (cell.temperature - 0.5) * 100;
  }
  const adjacentCount = countAdjacentTerritory(x, y, territory, territorySet);
  score += adjacentCount * COMPACTNESS_WEIGHT;

  // Factor in the distance to the nearest 'town' or 'capital'
  if (Array.isArray(cities) && cities.length > 0) {
    let minDistance = Infinity;
    cities.forEach((city) => {
      if (city.type === "town" || city.type === "capital") {
        // Using distance
        const distance = Math.sqrt((x - city.x) ** 2 + (y - city.y) ** 2);
        if (distance < minDistance) {
          minDistance = distance;
        }
      }
    });
    const CITY_PROXIMITY_WEIGHT = 5; // Adjust this constant to change the influence.
    if (minDistance < Infinity) {
      // Closer cells get a higher bonus.
      //score += CITY_PROXIMITY_WEIGHT / (minDistance + 1);
      score -= minDistance * CITY_PROXIMITY_WEIGHT;
    }
  }

  return score;
}

function getBestCityLocation(nation, mapData) {
  let bestScore = -Infinity;
  let bestLocation = null;
  const territorySet = getTerritorySet(nation.territory);
  const cityPositions = new Set();
  if (nation.cities) {
    nation.cities.forEach((city) => {
      cityPositions.add(`${city.x},${city.y}`);
    });
  }
  forEachTerritoryCell(nation.territory, (x, y) => {
    if (cityPositions.has(`${x},${y}`)) return;
    const cell = mapData[y] && mapData[y][x];
    if (!cell) return;
    const score = calculateCellDesirability(
      cell,
      x,
      y,
      nation.territory,
      territorySet
    );
    if (score > bestScore) {
      bestScore = score;
      bestLocation = { x, y };
    }
  });
  return bestLocation;
}

function getBorderCells(nation, mapData, allNations) {
  // If we have a cached border set and no territory delta changes, reuse it.
  if (
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

export function setExpansionTarget(nation, target, mapData) {
  // Verify the target cell is on land.
  if (
    !mapData[target.y] ||
    !mapData[target.y][target.x] ||
    mapData[target.y][target.x].biome === "OCEAN"
  ) {
    return {
      success: false,
      message: "Expansion target must be on land (non-OCEAN biome)",
    };
  }

  // Use resource cost from config.
  const cost = config.expansionTarget.cost;
  for (const resource in cost) {
    if ((nation.resources[resource] || 0) < cost[resource]) {
      return {
        success: false,
        message: `Insufficient resources: ${resource} required`,
      };
    }
  }
  // Deduct the resource cost.
  for (const resource in cost) {
    nation.resources[resource] -= cost[resource];
  }
  const duration = config.expansionTarget.duration;

  // Determine the starting point for the expansion target:
  // Prefer the nearest city; if none exist, use the nation's starting cell.
  let startingPoint = null;
  if (nation.cities && nation.cities.length > 0) {
    let bestDistance = Infinity;
    nation.cities.forEach((city) => {
      const distance =
        Math.abs(city.x - target.x) + Math.abs(city.y - target.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        startingPoint = { x: city.x, y: city.y };
      }
    });
  } else if (nation.startingCell) {
    startingPoint = nation.startingCell;
  }
  if (!startingPoint) {
    return {
      success: false,
      message:
        "No valid starting point (city or starting cell) found for expansion target",
    };
  }

  // Always reset the expansion target.
  nation.expansionTarget = {
    start: { ...startingPoint },
    current: { ...startingPoint },
    final: { x: target.x, y: target.y },
    ticksRemaining: duration,
    totalDuration: duration,
  };

  return { success: true, message: "Expansion target set" };
}

export function expandTerritory(nation, mapData, allNations) {
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
  const adjacentCells = getBorderCells(nation, mapData, allNations);
  if (adjacentCells.length === 0) return;

  // Get cities that can support territory expansion
  const supportCities = (nation.cities || []).filter(
    (city) => city.type === "capital" || city.type === "town"
  );

  if (supportCities.length === 0) return; // No valid cities to support expansion

  // Define maximum expansion distance from cities
  const MAX_EXPANSION_DISTANCE = 10; // Maximum tiles away from a city

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

  const territorySet = getTerritorySet(nation.territory);
  const scoredCells = validAdjacentCells
    .map((adj) => {
      if (adj.cell.biome === "OCEAN") return null;
      let score = calculateCellDesirability(
        adj.cell,
        adj.x,
        adj.y,
        nation.territory,
        territorySet,
        nation.cities.filter((c) => c.type === "town" || c.type === "capital")
      );

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

export function updateArmyMovements(updatedNation, mapData, gameState) {
  if (!updatedNation.armies || !Array.isArray(updatedNation.armies)) {
    return updatedNation.armies || [];
  }

  // Create a map of current army positions for collision detection
  const occupiedPositions = new Map();

  // First pass: Record current positions of all armies from all nations
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

  const ARMY_STEP = config.armyMovementStep || 0.2;
  const TARGET_SNAP_DISTANCE = 1.0; // Distance at which army snaps to target

  updatedNation.armies = updatedNation.armies
    .map((army) => {
      // Skip movement if army has no position
      if (!army.position) return army;

      let newPosition = { ...army.position };

      // Update movement based on attackTarget
      if (army.attackTarget) {
        const { current, final } = army.attackTarget;
        const dx = final.x - current.x;
        const dy = final.y - current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= TARGET_SNAP_DISTANCE) {
          // Check if final position is occupied
          const finalPosKey = `${Math.floor(final.x)},${Math.floor(final.y)}`;
          const isFinalPositionOccupied =
            occupiedPositions.has(finalPosKey) &&
            occupiedPositions.get(finalPosKey).armyId !== army.id;

          if (!isFinalPositionOccupied) {
            // Snap to final position
            newPosition = { x: final.x, y: final.y };

            // Update occupied positions map
            const oldPosKey = `${Math.floor(army.position.x)},${Math.floor(
              army.position.y
            )}`;
            occupiedPositions.delete(oldPosKey);
            occupiedPositions.set(finalPosKey, {
              nationId: updatedNation.id,
              armyId: army.id,
            });

            // Clear attack target since we've reached destination
            army.attackTarget = null;
          }
        } else {
          const targetAngle = Math.atan2(dy, dx);
          const maxAngleVariation = Math.PI / 36;
          const randomVariation = (Math.random() - 0.5) * 2 * maxAngleVariation;
          const newAngle = targetAngle + randomVariation;

          // Calculate proposed new position
          const proposedX =
            current.x +
            config.armies.stats[army.type].speed * Math.cos(newAngle);
          const proposedY =
            current.y +
            config.armies.stats[army.type].speed * Math.sin(newAngle);

          // Check if the proposed position is valid (on map and not ocean)
          const isValidTerrain =
            mapData[Math.floor(proposedY)] &&
            mapData[Math.floor(proposedY)][Math.floor(proposedX)] &&
            mapData[Math.floor(proposedY)][Math.floor(proposedX)].biome !==
              "OCEAN";

          // Check for army collision at the proposed position
          const proposedPosKey = `${Math.floor(proposedX)},${Math.floor(
            proposedY
          )}`;
          const isPositionOccupied =
            occupiedPositions.has(proposedPosKey) &&
            occupiedPositions.get(proposedPosKey).armyId !== army.id;

          // Only move if position is valid and unoccupied
          if (isValidTerrain && !isPositionOccupied) {
            newPosition = { x: proposedX, y: proposedY };
            army.attackTarget.current = { ...newPosition };

            // Update occupied positions map
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

      // Update army position
      army.position = newPosition;

      const posX = Math.floor(army.position.x);
      const posY = Math.floor(army.position.y);

      // Retrieve the maximum power for this army type from config
      const maxPower = config.armies?.stats?.[army.type]?.power || 100;

      // Initialize currentPower if not already set
      if (army.currentPower === undefined) {
        army.currentPower = maxPower;
      }

      // Apply territory modifiers
      if (isCellInTerritory(updatedNation.territory, posX, posY)) {
        // Army is in friendly territory—reinforce it
        army.currentPower += REINFORCEMENT_RATE;
      } else {
        // Check if army is in enemy territory
        let inEnemyTerritory = false;
        if (gameState.nations && Array.isArray(gameState.nations)) {
          for (const otherNation of gameState.nations) {
            if (
              otherNation.owner !== updatedNation.owner &&
              isCellInTerritory(otherNation.territory, posX, posY)
            ) {
              inEnemyTerritory = true;
              break;
            }
          }
        }
        if (inEnemyTerritory) {
          army.currentPower -= ENEMY_TERRITORY_PENALTY;
        }
      }

      // Clamp currentPower between 0 and maxPower
      army.currentPower = Math.min(maxPower, Math.max(0, army.currentPower));

      // Return null if army is destroyed (power = 0)
      return army.currentPower > 0 ? army : null;
    })
    .filter((army) => army !== null);

  return updatedNation.armies;
}

// Helper function to check if a position is within map bounds
function isInBounds(x, y, mapData) {
  return (
    mapData &&
    Array.isArray(mapData) &&
    y >= 0 &&
    y < mapData.length &&
    x >= 0 &&
    x < mapData[0].length
  );
}

export function updateNation(nation, mapData, gameState) {
  const overallStart = process.hrtime();
  if (!Array.isArray(mapData) || !Array.isArray(mapData[0])) {
    console.warn("Invalid map data structure in updateNation");
    return nation;
  }
  // Reset territory delta
  nation.territoryDelta = { add: { x: [], y: [] }, sub: { x: [], y: [] } };
  // Invalidate caches if territory changed (this should be done when delta is nonempty)
  if (
    nation.territoryDelta.add.x.length > 0 ||
    nation.territoryDelta.sub.x.length > 0
  ) {
    delete nation.cachedBorderSet;
    delete nation.cachedNaturalLimits;
    delete nation.cachedConnectedCells;
  }
  const updatedNation = { ...nation };
  updatedNation.resources = updatedNation.resources || {};

  // --- 1. Update Loyalty ---
  const startLoyalty = process.hrtime();
  // Use cached connectivity if possible.
  let connectedCells;
  if (!nation.territoryDelta.sub.x.length && nation.cachedConnectedCells) {
    connectedCells = nation.cachedConnectedCells;
  } else {
    connectedCells = computeConnectedCells(nation);
    nation.cachedConnectedCells = connectedCells;
  }
  const lostCells = updateLoyalty(updatedNation, gameState, connectedCells);
  const endLoyalty = process.hrtime(startLoyalty);
  // --- 2. Regenerate Natural Resources (using cached natural limits) ---
  const startNaturalResources = process.hrtime();
  if (updatedNation.cities) {
    updatedNation.cities.forEach((city) => {
      // Only resource structures produce resources.
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

      // Add the production to the nation's resources.
      updatedNation.resources[city.resource] =
        (updatedNation.resources[city.resource] || 0) + productionAmount;
    });
  }
  const endNaturalResources = process.hrtime(startNaturalResources);

  // --- 3. Update Expansion Target ---
  const startExpansionTarget = process.hrtime();
  if (
    updatedNation.expansionTarget &&
    updatedNation.expansionTarget.ticksRemaining > 0
  ) {
    const expTarget = updatedNation.expansionTarget;
    const baseStep = 0.2;
    const maxAngleVariation = Math.PI / 36;
    const dx = expTarget.final.x - expTarget.current.x;
    const dy = expTarget.final.y - expTarget.current.y;
    const targetAngle = Math.atan2(dy, dx);
    const randomVariation = (Math.random() - 0.5) * 2 * maxAngleVariation;
    const newAngle = targetAngle + randomVariation;
    const newX = expTarget.current.x + baseStep * Math.cos(newAngle);
    const newY = expTarget.current.y + baseStep * Math.sin(newAngle);
    if (
      mapData[Math.floor(newY)] &&
      mapData[Math.floor(newY)][Math.floor(newX)] &&
      mapData[Math.floor(newY)][Math.floor(newX)].biome !== "OCEAN"
    ) {
      expTarget.current = { x: newX, y: newY };
    }
    expTarget.ticksRemaining--;
  }
  if (updatedNation.expansionTarget?.ticksRemaining === 0) {
    delete updatedNation.expansionTarget;
  }
  const endExpansionTarget = process.hrtime(startExpansionTarget);

  // --- 4. Update Armies Movement ---
  const startArmies = process.hrtime();
  if (updatedNation.armies && Array.isArray(updatedNation.armies)) {
    const ARMY_STEP = config.armyMovementStep || 0.2;

    updatedNation.armies = updateArmyMovements(
      updatedNation,
      mapData,
      gameState
    );
  }
  const endArmies = process.hrtime(startArmies);

  // --- 5. Update Territory Expansion and Population ---
  const startTerritoryPopulation = process.hrtime();
  if (updatedNation.status !== "defeated") {
    expandTerritory(updatedNation, mapData, gameState.nations);
    updatePopulation(updatedNation);
  }
  const endTerritoryPopulation = process.hrtime(startTerritoryPopulation);
  // console.log(
  //   `Territory expansion and population update took ${(
  //     endTerritoryPopulation[0] * 1000 +
  //     endTerritoryPopulation[1] / 1e6
  //   ).toFixed(2)} ms`
  // );

  // --- 6. Auto‑City Spawning ---
  // Updated CITY_BUILD_COST: now uses { stone, food } instead of { stone, "arable land" }
  const startAutoCity = process.hrtime();
  const CITY_BUILD_COST = { stone: 10, food: 20 };
  if (updatedNation.auto_city) {
    let canBuild = true;
    for (const resource in CITY_BUILD_COST) {
      if (
        (updatedNation.resources[resource] || 0) < CITY_BUILD_COST[resource]
      ) {
        canBuild = false;
        break;
      }
    }
    if (canBuild && Math.random() < 0.05) {
      const bestLocation = getBestCityLocation(updatedNation, mapData);
      if (bestLocation) {
        for (const resource in CITY_BUILD_COST) {
          updatedNation.resources[resource] -= CITY_BUILD_COST[resource];
        }
        const newCity = {
          name: `City ${
            updatedNation.cities ? updatedNation.cities.length + 1 : 1
          }`,
          x: bestLocation.x,
          y: bestLocation.y,
          population: 50,
        };
        if (!updatedNation.cities) updatedNation.cities = [];
        updatedNation.cities.push(newCity);
        // Territory changed, so invalidate caches.
        delete updatedNation.cachedNaturalLimits;
        delete updatedNation.cachedBorderSet;
      }
    }
  }
  const endAutoCity = process.hrtime(startAutoCity);

  // --- 7. Finalize Territory Delta for Client ---
  if (updatedNation.territoryDelta) {
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
    updatedNation.territoryDelta = {
      add: { x: [], y: [] },
      sub: { x: [], y: [] },
    };
  }
  const overallEnd = process.hrtime(overallStart);
  console.log(
    `updateNation overall took ${(
      overallEnd[0] * 1000 +
      overallEnd[1] / 1e6
    ).toFixed(2)} ms`
  );
  return updatedNation;
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
