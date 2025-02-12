// gameLogic.js
import mongoose from "mongoose";
import _ from "lodash";
import {
  calculateResourceDesirability,
  canMaintainTerritory,
  canExpandTerritory,
  deductMaintenanceCosts,
  deductExpansionCosts,
} from "./resourceManagement.js";

const RESOURCE_BASE_YIELD = 1; // Base resource _yield per territory cell
const MAX_POPULATION_PER_TERRITORY = 100; // Base maximum population per territory cell
const CITY_POPULATION_BONUS = 500; // Additional population capacity per city
const POPULATION_GROWTH_RATE = 0.02;
const COMPACTNESS_WEIGHT = 20;

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

function calculateCellDesirability(cell, x, y, territory) {
  if (!cell || typeof cell !== "object") {
    console.warn("Invalid cell data received:", cell);
    return -Infinity;
  }

  let score = 0;

  // Base scores for different biomes
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

  // Add biome base score
  score += biomeScores[cell.biome] || 0;
  score += calculateResourceDesirability(cell) * 2;

  // Bonus for resources
  score += (Array.isArray(cell.resources) ? cell.resources.length : 0) * 2;

  // Bonus for features
  score += Array.isArray(cell.features) ? cell.features.length : 0;

  // River bonus
  if (cell.isRiver) {
    score += 5;
  }

  // Elevation factor (prefer moderate elevations)
  if (typeof cell.elevation === "number") {
    score -= Math.abs(cell.elevation - 0.5) * 5;
  }

  // Moisture bonus (higher moisture is generally better)
  if (typeof cell.moisture === "number") {
    score += cell.moisture * 3;
  }

  // Temperature factor (prefer moderate temperatures)
  if (typeof cell.temperature === "number") {
    score -= Math.abs(cell.temperature / 100 - 0.5) * 2;
  }

  // Compactness score - heavily favor cells adjacent to multiple territory cells
  const adjacentCount = countAdjacentTerritory(x, y, territory);
  score += adjacentCount * COMPACTNESS_WEIGHT;

  return score;
}

function getValidAdjacentCells(territory, mapData, allNations) {
  if (!Array.isArray(mapData) || !Array.isArray(mapData[0])) {
    console.warn("Invalid map data structure");
    return [];
  }

  const adjacentCells = new Set();

  // Create a set of all occupied positions across all nations
  const allOccupiedPositions = new Set();

  // Add current nation's territory
  territory.forEach((cell) => {
    allOccupiedPositions.add(`${cell.x},${cell.y}`);
  });

  // Add other nations' territory
  if (Array.isArray(allNations)) {
    allNations.forEach((nation) => {
      if (nation.territory) {
        nation.territory.forEach((cell) => {
          allOccupiedPositions.add(`${cell.x},${cell.y}`);
        });
      }
    });
  }

  // Check adjacent cells for expansion
  territory.forEach((cell) => {
    // Check all 8 adjacent positions
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;

        const newX = cell.x + dx;
        const newY = cell.y + dy;
        const posKey = `${newX},${newY}`;

        // Skip if already occupied by any nation
        if (allOccupiedPositions.has(posKey)) continue;

        // Skip if out of bounds
        if (
          newX < 0 ||
          newY < 0 ||
          newY >= mapData.length ||
          newX >= mapData[0].length
        )
          continue;

        // Get the cell data
        const cellData = mapData[newY][newX];
        if (!cellData || cellData.biome === "OCEAN") continue;

        adjacentCells.add({ x: newX, y: newY, cell: cellData });
      }
    }
  });

  return Array.from(adjacentCells);
}

export function expandTerritory(nation, mapData, allNations) {
  // Check if nation can afford expansion
  if (!canExpandTerritory(nation)) {
    console.log("Nation cannot afford territory expansion");
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

  // Score and sort adjacent cells
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

  // Select the best cell for expansion
  const bestCell = _.maxBy(scoredCells, "score");
  if (bestCell) {
    nation.territory.push({ x: bestCell.x, y: bestCell.y });
    deductExpansionCosts(nation);
  }
}

export function calculateResourceYields(territory, mapData) {
  const yields = {};

  territory.forEach((pos) => {
    if (!mapData[pos.y] || !mapData[pos.y][pos.x]) return;

    const cell = mapData[pos.y][pos.x];
    if (!cell || !Array.isArray(cell.resources)) return;

    cell.resources.forEach((resource) => {
      if (!yields[resource]) yields[resource] = 0;

      let _yield = RESOURCE_BASE_YIELD;
      if (resource === "fresh water") _yield *= 2;
      // Biome bonuses
      if (cell.biome === "GRASSLAND") _yield *= 1.2;
      if (cell.biome === "FOREST") _yield *= 1.3;

      // Feature bonuses
      if (Array.isArray(cell.features)) {
        if (cell.features.includes("fertile valleys")) _yield *= 1.5;
        if (cell.features.includes("lowlands")) _yield *= 1.2;
      }

      yields[resource] += _yield;
    });
  });

  return yields;
}

function calculateMaxPopulation(nation) {
  let maxPop = nation.territory.length * MAX_POPULATION_PER_TERRITORY;

  // City bonus
  maxPop += (nation.cities?.length || 0) * CITY_POPULATION_BONUS;

  // Resource bonuses
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
    // Growth rate decreases as population approaches maximum
    const growthFactor = 1 - currentPopulation / maxPopulation;
    const growth = Math.floor(
      currentPopulation * POPULATION_GROWTH_RATE * growthFactor
    );
    nation.population = Math.min(currentPopulation + growth, maxPopulation);
  }
}

export function updateNation(nation, mapData, gameState) {
  if (!Array.isArray(mapData) || !Array.isArray(mapData[0])) {
    console.warn("Invalid map data structure in updateNation");
    return nation; // Return unchanged nation if invalid map data
  }

  // Create a working copy of the nation
  const updatedNation = { ...nation };

  // Ensure resources object exists
  updatedNation.resources = updatedNation.resources || {};

  // Calculate and add new resources
  const newYields = calculateResourceYields(updatedNation.territory, mapData);
  Object.entries(newYields).forEach(([resource, _yield]) => {
    updatedNation.resources[resource] =
      (updatedNation.resources[resource] || 0) + _yield;
  });

  // Check if nation can maintain current territory
  if (!canMaintainTerritory(updatedNation)) {
    console.log(
      "Nation cannot maintain current territory - resources depleted"
    );
    // Optionally implement territory loss mechanics here
    return updatedNation;
  }

  // Deduct maintenance costs
  deductMaintenanceCosts(updatedNation);

  // Expand territory if possible
  expandTerritory(updatedNation, mapData, gameState.nations);

  // Update population
  updatePopulation(updatedNation);

  // Update cities
  if (updatedNation.cities) {
    updatedNation.cities = updatedNation.cities.map((city) => {
      const maxCityPop =
        CITY_POPULATION_BONUS *
        (1 + (updatedNation.resources["arable land"] || 0) / 100) *
        (1 + (updatedNation.resources["fresh water"] || 0) / 100);

      const updatedCity = { ...city };
      if (updatedCity.population < maxCityPop) {
        updatedCity.population = Math.min(
          Math.floor(updatedCity.population * (1 + POPULATION_GROWTH_RATE)),
          maxCityPop
        );
      }
      return updatedCity;
    });
  }

  return updatedNation;
}
