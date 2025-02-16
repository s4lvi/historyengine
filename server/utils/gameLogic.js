// gameLogic.js
import _ from "lodash";
import {
  calculateResourceDesirability,
  canExpandTerritory,
  deductExpansionCosts,
} from "./resourceManagement.js";
import config from "../config/config.js";
import { updateLoyalty, initializeLoyalty } from "./loyaltySystem.js";

// Constants for yields, population, and auto‑city
const RESOURCE_BASE_YIELD = 1; // Base yield per territory cell (can be adjusted)
const MAX_POPULATION_PER_TERRITORY = 100;
const CITY_POPULATION_BONUS = 500;
const POPULATION_GROWTH_RATE = 0.02;
const COMPACTNESS_WEIGHT = 40;

/**
 * Helper: Iterate over all cells in a territory.
 * Territory is assumed to have the structure:
 * { x: [x1, x2, ...], y: [y1, y2, ...] }
 */
export function forEachTerritoryCell(territory, callback) {
  if (!territory || !territory.x || !territory.y) return;
  for (let i = 0; i < territory.x.length; i++) {
    callback(territory.x[i], territory.y[i], i);
  }
}

/**
 * Helper: Build and return a Set of territory cell keys ("x,y") for fast lookup.
 */
export function getTerritorySet(territory) {
  const set = new Set();
  if (!territory || !territory.x || !territory.y) return set;
  for (let i = 0; i < territory.x.length; i++) {
    set.add(`${territory.x[i]},${territory.y[i]}`);
  }
  return set;
}

/**
 * Helper: Check if a given cell (x, y) is in the territory.
 * If a precomputed territorySet is provided, it uses that for O(1) lookup.
 */
export function isCellInTerritory(territory, x, y, territorySet = null) {
  const key = `${x},${y}`;
  if (territorySet) return territorySet.has(key);
  // Fallback to linear scan if no set provided.
  let found = false;
  forEachTerritoryCell(territory, (tx, ty) => {
    if (tx === x && ty === y) found = true;
  });
  return found;
}

/**
 * -----------------------
 * Helper: Count adjacent territory cells
 * -----------------------
 * Accepts an optional territorySet for fast membership checking.
 */
function countAdjacentTerritory(x, y, territory, territorySet = null) {
  let count = 0;
  // Use a cached set if available; otherwise build one.
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

/**
 * -----------------------
 * Helper: Calculate cell desirability
 * -----------------------
 * Accepts an optional territorySet to speed up adjacent count checks.
 */
export function calculateCellDesirability(
  cell,
  x,
  y,
  territory,
  territorySet = null
) {
  if (!cell || typeof cell !== "object") {
    console.warn("Invalid cell data received:", cell);
    return -Infinity;
  }
  let score = 0;
  const biomeScores = config.biomeDesirabilityScores;
  score += biomeScores[cell.biome] || 0;
  score += calculateResourceDesirability(cell) * 2;
  score += (Array.isArray(cell.resources) ? cell.resources.length : 0) * 2;
  score += Array.isArray(cell.features) ? cell.features.length : 0;
  if (cell.isRiver) score += 5;
  if (typeof cell.elevation === "number") {
    score -= Math.abs(cell.elevation - 0.5) * 5;
  }
  if (typeof cell.moisture === "number") {
    score += cell.moisture * 3;
  }
  if (typeof cell.temperature === "number") {
    score -= Math.abs(cell.temperature / 100 - 0.5) * 2;
  }
  const adjacentCount = countAdjacentTerritory(x, y, territory, territorySet);
  score += adjacentCount * COMPACTNESS_WEIGHT;
  return score;
}

/**
 * -----------------------
 * Helper: Get best location for an auto‑spawned city within a nation’s territory
 * -----------------------
 */
function getBestCityLocation(nation, mapData) {
  let bestScore = -Infinity;
  let bestLocation = null;

  // Precompute a set of territory cells for faster lookup.
  const territorySet = getTerritorySet(nation.territory);
  // Precompute positions where cities already exist.
  const cityPositions = new Set();
  if (nation.cities) {
    nation.cities.forEach((city) => {
      cityPositions.add(`${city.x},${city.y}`);
    });
  }

  // Iterate over territory cells.
  forEachTerritoryCell(nation.territory, (x, y) => {
    // Skip if a city already exists on this cell.
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

/**
 * -----------------------
 * Helper: Get valid adjacent cells for territory expansion
 * -----------------------
 */
function getValidAdjacentCells(territory, mapData, allNations) {
  if (!Array.isArray(mapData) || !Array.isArray(mapData[0])) {
    console.warn("Invalid map data structure");
    return [];
  }
  const adjacentCells = new Set();
  const allOccupiedPositions = new Set();

  // Add current territory cells.
  const territorySet = getTerritorySet(territory);
  territorySet.forEach((pos) => allOccupiedPositions.add(pos));

  // Add cells occupied by other nations.
  if (Array.isArray(allNations)) {
    allNations.forEach((nation) => {
      if (nation.territory && nation.territory.x && nation.territory.y) {
        getTerritorySet(nation.territory).forEach((pos) =>
          allOccupiedPositions.add(pos)
        );
      }
    });
  }

  // Find adjacent cells.
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
        // Use a unique key to avoid duplicates.
        adjacentCells.add(JSON.stringify({ x: newX, y: newY, cell: cellData }));
      }
    }
  });

  // Convert the set back into an array.
  return Array.from(adjacentCells).map((str) => JSON.parse(str));
}

/**
 * -----------------------
 * Set expansion target with resource cost and tick duration.
 * Returns an object with a success flag and a message.
 * -----------------------
 */
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

/**
 * -----------------------
 * Territory Expansion (with Expansion Target Bonus)
 * -----------------------
 */
export function expandTerritory(nation, mapData, allNations) {
  if (!canExpandTerritory(nation)) return;

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
      // Initialize delta with the starting cell as an addition.
      nation.territoryDelta = {
        add: { x: [nation.startingCell.x], y: [nation.startingCell.y] },
        sub: { x: [], y: [] },
      };
    }
    return;
  }

  // Ensure a delta object exists.
  if (!nation.territoryDelta) {
    nation.territoryDelta = { add: { x: [], y: [] }, sub: { x: [], y: [] } };
  }

  const adjacentCells = getValidAdjacentCells(
    nation.territory,
    mapData,
    allNations
  );
  if (adjacentCells.length === 0) return;

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

  // Precompute territory set for adjacent desirability calculations.
  const territorySet = getTerritorySet(nation.territory);

  const scoredCells = adjacentCells
    .map((adj) => {
      if (adj.cell.biome === "OCEAN") return null;
      let score = calculateCellDesirability(
        adj.cell,
        adj.x,
        adj.y,
        nation.territory,
        territorySet
      );
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
    // Add new cell to the territory.
    nation.territory.x.push(bestCell.x);
    nation.territory.y.push(bestCell.y);
    initializeLoyalty(nation, bestCell.x, bestCell.y);
    // Record the addition in the delta.
    nation.territoryDelta.add.x.push(bestCell.x);
    nation.territoryDelta.add.y.push(bestCell.y);
    deductExpansionCosts(nation);
  }
}

/**
 * -----------------------
 * Helper: Calculate natural resource limits based on territory yields
 * -----------------------
 */
function calculateNaturalResourceLimits(territory, mapData, cities = []) {
  const naturalLimits = {};
  forEachTerritoryCell(territory, (x, y) => {
    if (!mapData[y] || !mapData[y][x]) return;
    const cell = mapData[y][x];
    if (!cell || !Array.isArray(cell.resources)) return;
    let multiplier = 1;
    if (
      cities &&
      cities.some(
        (city) => city.x === x && city.y === y && city.type === "capital"
      )
    ) {
      multiplier = 5;
    }
    cell.resources.forEach((resource) => {
      naturalLimits[resource] =
        (naturalLimits[resource] || 0) + RESOURCE_BASE_YIELD * multiplier;
    });
  });
  return naturalLimits;
}

/**
 * -----------------------
 * Population Calculation
 * -----------------------
 */
function calculateMaxPopulation(nation) {
  let maxPop = nation.territory.x.length * MAX_POPULATION_PER_TERRITORY;
  maxPop += (nation.cities?.length || 0) * CITY_POPULATION_BONUS;
  const resources = nation.resources || {};
  if (resources["arable land"] > 0) maxPop *= 1.2;
  if (resources["fresh water"] > 0) maxPop *= 1.1;
  if (resources["pastures"] > 0) maxPop *= 1.15;
  return Math.floor(maxPop);
}

export function updatePopulation(nation) {
  const maxPopulation = calculateMaxPopulation(nation);
  const currentPopulation = nation.population || 0;
  if (currentPopulation < maxPopulation) {
    const growthFactor = 1 - currentPopulation / maxPopulation;
    const growth = Math.floor(
      currentPopulation * POPULATION_GROWTH_RATE * growthFactor
    );
    nation.population = Math.min(currentPopulation + growth, maxPopulation);
  }
}

/**
 * -----------------------
 * Main updateNation function – resources regenerate; expansion & armies update; auto‑city spawning remains
 * -----------------------
 */
export function updateNation(nation, mapData, gameState) {
  if (!Array.isArray(mapData) || !Array.isArray(mapData[0])) {
    console.warn("Invalid map data structure in updateNation");
    return nation;
  }

  nation.territoryDelta = {
    add: { x: [], y: [] },
    sub: { x: [], y: [] },
  };

  const updatedNation = { ...nation };
  updatedNation.resources = updatedNation.resources || {};

  // Update loyalty and remove lost cells.
  const lostCells = updateLoyalty(updatedNation, gameState);

  // Regenerate natural resources.
  const naturalLimits = calculateNaturalResourceLimits(
    updatedNation.territory,
    mapData,
    updatedNation.cities
  );
  const RESOURCE_REGEN_RATE = 0.1;
  Object.entries(naturalLimits).forEach(([resource, limit]) => {
    const current = updatedNation.resources[resource] || 0;
    if (current < limit) {
      const regen = Math.max(
        1,
        Math.floor((limit - current) * RESOURCE_REGEN_RATE)
      );
      updatedNation.resources[resource] = current + regen;
    }
  });

  // Update expansion target.
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

  // Update armies movement.
  if (updatedNation.armies && Array.isArray(updatedNation.armies)) {
    const ARMY_STEP = config.armyMovementStep || 0.2;
    updatedNation.armies = updatedNation.armies.map((army) => {
      if (army.attackTarget) {
        const { current, final } = army.attackTarget;
        const dx = final.x - current.x;
        const dy = final.y - current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < 0.1) {
          army.attackTarget = null;
        } else {
          const targetAngle = Math.atan2(dy, dx);
          const maxAngleVariation = Math.PI / 36;
          const randomVariation = (Math.random() - 0.5) * 2 * maxAngleVariation;
          const newAngle = targetAngle + randomVariation;
          const newX = current.x + ARMY_STEP * Math.cos(newAngle);
          const newY = current.y + ARMY_STEP * Math.sin(newAngle);
          if (
            mapData[Math.floor(newY)] &&
            mapData[Math.floor(newY)][Math.floor(newX)] &&
            mapData[Math.floor(newY)][Math.floor(newX)].biome !== "OCEAN"
          ) {
            army.attackTarget.current = { x: newX, y: newY };
            army.position = { x: newX, y: newY };
          }
        }
      }
      return army;
    });
  }

  // Update territory expansion and population.
  if (updatedNation.status !== "defeated") {
    expandTerritory(updatedNation, mapData, gameState.nations);
    updatePopulation(updatedNation);
  }

  // Auto‑city spawning.
  const AUTO_CITY_SPAWN_CHANCE = 0.05;
  const CITY_BUILD_COST = {
    stone: 10,
    "arable land": 20,
  };
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
    if (canBuild && Math.random() < AUTO_CITY_SPAWN_CHANCE) {
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
      }
    }
  }

  if (updatedNation.territoryDelta) {
    updatedNation.territoryDeltaForClient = updatedNation.territoryDelta;
    updatedNation.territoryDelta = {
      add: { x: [], y: [] },
      sub: { x: [], y: [] },
    };
  }
  return updatedNation;
}

async function processGameTick(gameRoom) {
  // Get map data for territory expansion
  const MapModel = mongoose.model("Map");
  const MapChunk = mongoose.model("MapChunk");
  const chunks = await MapChunk.find({ map: gameRoom.map }).lean();
  const mapData = []; // Build mapData same as before

  // Process each nation
  if (gameRoom.gameState?.nations) {
    gameRoom.gameState.nations = gameRoom.gameState.nations.map((nation) =>
      updateNation(nation, mapData, gameRoom.gameState)
    );
  }

  gameRoom.tickCount += 1;
  await gameRoom.save();

  return gameRoom;
}
