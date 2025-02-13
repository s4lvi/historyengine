// gameLogic.js
import mongoose from "mongoose";
import _ from "lodash";
import {
  calculateResourceDesirability,
  canExpandTerritory,
  deductExpansionCosts,
} from "./resourceManagement.js";

// Constants for yields, population, and auto‑city
const RESOURCE_BASE_YIELD = 1; // Base yield per territory cell (can be adjusted)
const MAX_POPULATION_PER_TERRITORY = 100;
const CITY_POPULATION_BONUS = 500;
const POPULATION_GROWTH_RATE = 0.02;
const COMPACTNESS_WEIGHT = 40;

// -----------------------
// Helper: Count adjacent territory cells
// -----------------------
function countAdjacentTerritory(x, y, territory) {
  let count = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      if (territory.some((cell) => cell.x === x + dx && cell.y === y + dy)) {
        count++;
      }
    }
  }
  return count;
}

// -----------------------
// Helper: Calculate cell desirability
// (Re‑uses calculateResourceDesirability from resourceManagement.js for resource factors)
// -----------------------
export function calculateCellDesirability(cell, x, y, territory) {
  if (!cell || typeof cell !== "object") {
    console.warn("Invalid cell data received:", cell);
    return -Infinity;
  }

  let score = 0;
  // Base scores for biomes
  const biomeScores = {
    GRASSLAND: 8,
    WOODLAND: 8,
    TROPICAL_FOREST: 7,
    RAINFOREST: 7,
    FOREST: 7,
    SAVANNA: 5,
    COASTAL: 8,
    DESERT: 2,
    MOUNTAIN: 3,
    RIVER: 10,
    OCEAN: -100,
  };

  score += biomeScores[cell.biome] || 0;
  // Add a weighted resource desirability (from the resourceManagement file)
  score += calculateResourceDesirability(cell) * 2;
  // Bonus for each resource listed
  score += (Array.isArray(cell.resources) ? cell.resources.length : 0) * 2;
  // Bonus for features (assumed one point per feature)
  score += Array.isArray(cell.features) ? cell.features.length : 0;
  // Additional bonus if cell has a river
  if (cell.isRiver) score += 5;
  // Elevation factor (prefer moderate elevations)
  if (typeof cell.elevation === "number") {
    score -= Math.abs(cell.elevation - 0.5) * 5;
  }
  // Moisture bonus
  if (typeof cell.moisture === "number") {
    score += cell.moisture * 3;
  }
  // Temperature factor (prefer moderate temperatures)
  if (typeof cell.temperature === "number") {
    score -= Math.abs(cell.temperature / 100 - 0.5) * 2;
  }
  // Compactness bonus – favor cells adjacent to current territory
  const adjacentCount = countAdjacentTerritory(x, y, territory);
  score += adjacentCount * COMPACTNESS_WEIGHT;

  return score;
}

// -----------------------
// Helper: Get best location for an auto‑spawned city within a nation’s territory
// -----------------------
function getBestCityLocation(nation, mapData) {
  let bestScore = -Infinity;
  let bestLocation = null;
  for (const pos of nation.territory) {
    // Skip if a city is already at this position
    if (
      nation.cities &&
      nation.cities.some((city) => city.x === pos.x && city.y === pos.y)
    )
      continue;
    const cell = mapData[pos.y] && mapData[pos.y][pos.x];
    if (!cell) continue;
    const score = calculateCellDesirability(
      cell,
      pos.x,
      pos.y,
      nation.territory
    );
    if (score > bestScore) {
      bestScore = score;
      bestLocation = pos;
    }
  }
  return bestLocation;
}

// -----------------------
// Helper: Get valid adjacent cells for territory expansion
// -----------------------
function getValidAdjacentCells(territory, mapData, allNations) {
  if (!Array.isArray(mapData) || !Array.isArray(mapData[0])) {
    console.warn("Invalid map data structure");
    return [];
  }

  const adjacentCells = new Set();
  const allOccupiedPositions = new Set();

  // Mark current nation’s cells
  territory.forEach((cell) => {
    allOccupiedPositions.add(`${cell.x},${cell.y}`);
  });
  // Also mark cells occupied by other nations
  if (Array.isArray(allNations)) {
    allNations.forEach((nation) => {
      if (nation.territory) {
        nation.territory.forEach((cell) => {
          allOccupiedPositions.add(`${cell.x},${cell.y}`);
        });
      }
    });
  }

  territory.forEach((cell) => {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const newX = cell.x + dx;
        const newY = cell.y + dy;
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
        adjacentCells.add({ x: newX, y: newY, cell: cellData });
      }
    }
  });

  return Array.from(adjacentCells);
}

// -----------------------
// Territory Expansion
// -----------------------
export function expandTerritory(nation, mapData, allNations) {
  // Check if nation can afford expansion using your resourceManagement function
  if (!canExpandTerritory(nation)) {
    console.log(nation.owner + " cannot afford territory expansion");
    return;
  }

  if (!nation.territory || nation.territory.length === 0) {
    if (nation.startingCell) {
      nation.territory = [nation.startingCell];
      deductExpansionCosts(nation);
    }
    return;
  }

  const adjacentCells = getValidAdjacentCells(
    nation.territory,
    mapData,
    allNations
  );
  if (adjacentCells.length === 0) return;

  const scoredCells = adjacentCells
    .map((adj) => ({
      ...adj,
      score: calculateCellDesirability(
        adj.cell,
        adj.x,
        adj.y,
        nation.territory
      ),
    }))
    .filter((cell) => cell.score > -Infinity);

  const bestCell = _.maxBy(scoredCells, "score");
  if (bestCell) {
    nation.territory.push({ x: bestCell.x, y: bestCell.y });
    deductExpansionCosts(nation);
  }
}

// -----------------------
// Helper: Calculate the “natural” resource limits based on territory yields
// (This function is separate from the resourceManagement “desirability” functions)
// -----------------------
function calculateNaturalResourceLimits(territory, mapData) {
  const naturalLimits = {};
  territory.forEach((pos) => {
    if (!mapData[pos.y] || !mapData[pos.y][pos.x]) return;
    const cell = mapData[pos.y][pos.x];
    if (!cell || !Array.isArray(cell.resources)) return;
    cell.resources.forEach((resource) => {
      // For now we use a simple base yield per cell—
      // you can modify this to incorporate biome or feature multipliers if desired.
      naturalLimits[resource] =
        (naturalLimits[resource] || 0) + RESOURCE_BASE_YIELD;
    });
  });
  return naturalLimits;
}

// -----------------------
// Population Calculation (unchanged)
// -----------------------
function calculateMaxPopulation(nation) {
  let maxPop = nation.territory.length * MAX_POPULATION_PER_TERRITORY;
  maxPop += (nation.cities?.length || 0) * CITY_POPULATION_BONUS;
  // Optionally, population capacity might scale with certain resources:
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

// -----------------------
// Main updateNation function – no base upkeep; resources regenerate; auto‑city spawning
// -----------------------
export function updateNation(nation, mapData, gameState) {
  if (!Array.isArray(mapData) || !Array.isArray(mapData[0])) {
    console.warn("Invalid map data structure in updateNation");
    return nation;
  }

  // Create a working copy
  const updatedNation = { ...nation };
  updatedNation.resources = updatedNation.resources || {};

  // Calculate the natural resource limits (from the territory yield)
  const naturalLimits = calculateNaturalResourceLimits(
    updatedNation.territory,
    mapData
  );

  // Gradually regenerate resources up toward their natural limit.
  // (If a nation has surplus via trade, it stays above the limit.)
  const RESOURCE_REGEN_RATE = 0.1; // 10% of the deficit per tick
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

  // Territory expansion (costs are deducted within expandTerritory)
  expandTerritory(updatedNation, mapData, gameState.nations);

  // Update population normally
  updatePopulation(updatedNation);

  // ---------------------------
  // Auto‑city spawning logic
  // ---------------------------
  // Only attempt auto‑city spawn if auto_city is true on the nation.
  const AUTO_CITY_SPAWN_CHANCE = 0.05; // 5% chance per tick
  // Define the resource cost for building a city:
  const CITY_BUILD_COST = {
    stone: 10,
    "arable land": 20,
  };

  if (updatedNation.auto_city) {
    // Check that the nation has enough resources to build a city.
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
        // Deduct the resource cost for city building.
        for (const resource in CITY_BUILD_COST) {
          updatedNation.resources[resource] -= CITY_BUILD_COST[resource];
        }
        const newCity = {
          name: `City ${
            updatedNation.cities ? updatedNation.cities.length + 1 : 1
          }`,
          x: bestLocation.x,
          y: bestLocation.y,
          population: 50, // Starting population for a new city.
        };
        if (!updatedNation.cities) updatedNation.cities = [];
        updatedNation.cities.push(newCity);
      }
    }
  }

  return updatedNation;
}
