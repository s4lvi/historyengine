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
// -----------------------
export function calculateCellDesirability(cell, x, y, territory) {
  if (!cell || typeof cell !== "object") {
    console.warn("Invalid cell data received:", cell);
    return -Infinity;
  }
  let score = 0;
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
  territory.forEach((cell) => {
    allOccupiedPositions.add(`${cell.x},${cell.y}`);
  });
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
// Territory Expansion (with Expansion Target Bonus)
// -----------------------
export function expandTerritory(nation, mapData, allNations) {
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
    .map((adj) => {
      let score = calculateCellDesirability(
        adj.cell,
        adj.x,
        adj.y,
        nation.territory
      );
      if (nation.expansionTarget) {
        const dist =
          Math.abs(adj.x - nation.expansionTarget.x) +
          Math.abs(adj.y - nation.expansionTarget.y);
        if (dist <= 1) {
          score += 1000; // Massive bonus for cells near the target.
        }
      }
      return { ...adj, score };
    })
    .filter((cell) => cell.score > -Infinity);
  const bestCell = _.maxBy(scoredCells, "score");
  if (bestCell) {
    nation.territory.push({ x: bestCell.x, y: bestCell.y });
    deductExpansionCosts(nation);
  }
}

// -----------------------
// Helper: Calculate natural resource limits based on territory yields
// -----------------------
function calculateNaturalResourceLimits(territory, mapData, cities = []) {
  const naturalLimits = {};
  territory.forEach((pos) => {
    if (!mapData[pos.y] || !mapData[pos.y][pos.x]) return;
    const cell = mapData[pos.y][pos.x];
    if (!cell || !Array.isArray(cell.resources)) return;
    // Check if a capital city exists on this cell
    let multiplier = 1;
    if (
      cities &&
      cities.some(
        (city) =>
          city.x === pos.x && city.y === pos.y && city.type === "capital"
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

// -----------------------
// Population Calculation
// -----------------------
function calculateMaxPopulation(nation) {
  let maxPop = nation.territory.length * MAX_POPULATION_PER_TERRITORY;
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

// -----------------------
// Main updateNation function – resources regenerate; auto‑city spawning remains
// -----------------------
export function updateNation(nation, mapData, gameState) {
  if (!Array.isArray(mapData) || !Array.isArray(mapData[0])) {
    console.warn("Invalid map data structure in updateNation");
    return nation;
  }
  const updatedNation = { ...nation };
  updatedNation.resources = updatedNation.resources || {};

  // Pass the nation's cities so capitals boost yields.
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

  expandTerritory(updatedNation, mapData, gameState.nations);
  updatePopulation(updatedNation);

  // Auto‑city spawning logic (unchanged)
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
  return updatedNation;
}
