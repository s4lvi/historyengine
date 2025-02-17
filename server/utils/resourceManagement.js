// resourceManagement.js

// New flat resource list
export const RESOURCE_LIST = [
  "food",
  "wood",
  "stone",
  "bronze",
  "steel",
  "horses",
];

// New resource weights (used for cell desirability, etc.)
export const RESOURCE_WEIGHTS = {
  food: 1,
  wood: 1,
  stone: 1,
  bronze: 2,
  steel: 3,
  horses: 2,
};

// Territory maintenance cost per cell (per tick) for each resource.
// Adjust these values to balance how expensive it is to maintain each cell.
export const TERRITORY_MAINTENANCE_COSTS = {
  food: 1, // each cell costs 1 unit of food per tick
  wood: 0, // each cell costs 1 unit of wood per tick
  stone: 0, // each cell costs 1 unit of stone per tick
  bronze: 0, // no cost
  steel: 0, // no cost
  horses: 0, // no cost
};

// Multiplier for territory expansion cost.
export const EXPANSION_COST_MULTIPLIER = 5;

/**
 * Calculate available resources for a nation using the flat resource list.
 */
export function calculateAvailableResources(nation) {
  const available = {};
  for (const resource of RESOURCE_LIST) {
    available[resource] = nation.resources?.[resource] || 0;
  }
  return available;
}

export function assignResourcesToMap(mapData) {
  // First, ensure we're working with a 2D array
  if (!Array.isArray(mapData)) {
    console.error("mapData is not an array");
    return mapData;
  }

  // Map over rows first, then cells
  return mapData.map((row, rowIndex) => {
    // Handle case where row is an object with numeric keys
    if (!Array.isArray(row) && typeof row === "object") {
      // Convert object row to array
      const arrayRow = Object.keys(row)
        .filter((key) => !isNaN(key))
        .sort((a, b) => parseInt(a) - parseInt(b))
        .map((key) => row[key]);

      // Now process each cell in the array row
      return arrayRow.map((cell, colIndex) => {
        if (!cell) return null;

        return {
          ...cell,
          resources: generateFlatResources(
            cell.biome,
            cell.elevation,
            cell.moisture,
            cell.temperature
          ),
        };
      });
    }

    // If row is already an array, process it directly
    if (Array.isArray(row)) {
      return row.map((cell, colIndex) => {
        if (!cell) return null;

        return {
          ...cell,
          resources: generateFlatResources(
            cell.biome,
            cell.elevation,
            cell.moisture,
            cell.temperature
          ),
        };
      });
    }

    console.error(`Invalid row format at index ${rowIndex}:`, row);
    return row; // Return unchanged if invalid format
  });
}

function generateFlatResources(biome, elevation, moisture, temperature) {
  const resources = [];

  // In grassland or savanna, assign food and a chance for horses.
  if (biome === "GRASSLAND" || biome === "SAVANNA") {
    if (Math.random() < 0.004) resources.push("food");
    if (Math.random() < 0.0008) resources.push("horses");
  }

  // In woodlands or forests, assign wood.
  if (
    biome === "WOODLAND" ||
    biome === "FOREST" ||
    biome === "TROPICAL_FOREST" ||
    biome === "RAINFOREST"
  ) {
    if (Math.random() < 0.008) resources.push("wood");
  }

  // In mountains, assign stone and, at higher elevations, bronze or steel.
  if (biome === "MOUNTAIN") {
    if (Math.random() < 0.015) resources.push("stone");
    if (elevation > 0.7 && Math.random() < 0.005) resources.push("bronze");
    if (elevation > 0.85 && Math.random() < 0.0005) resources.push("steel");
  }

  return resources;
}
