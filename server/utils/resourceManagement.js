// resourceManagement.js

// New flat resource list
export const RESOURCE_LIST = [
  "food",
  "wood",
  "stone",
  "iron",
  "gold",
];

// New resource weights (used for cell desirability, etc.)
export const RESOURCE_WEIGHTS = {
  food: 1,
  wood: 1,
  stone: 1,
  iron: 2,
  gold: 3,
};

// Territory maintenance cost per cell (per tick) for each resource.
// Adjust these values to balance how expensive it is to maintain each cell.
export const TERRITORY_MAINTENANCE_COSTS = {
  food: 1, // each cell costs 1 unit of food per tick
  wood: 0, // each cell costs 1 unit of wood per tick
  stone: 0, // each cell costs 1 unit of stone per tick
  iron: 0, // no cost
  gold: 0, // no cost
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

export function assignResourcesToMap(mapData, seed = 0) {
  // First, ensure we're working with a 2D array
  if (!Array.isArray(mapData)) {
    console.error("mapData is not an array");
    return mapData;
  }

  const seedValue = normalizeSeed(seed);

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

        const cellX = cell.x ?? colIndex;
        const cellY = cell.y ?? rowIndex;
        const existingResources = Array.isArray(cell.resources)
          ? cell.resources.filter(Boolean)
          : [];
        const biome =
          typeof cell.biome === "string" ? cell.biome.toUpperCase() : cell.biome;
        const existingNodeType =
          cell.resourceNode?.type || existingResources[0] || null;
        const generatedNodeType = existingNodeType
          ? null
          : generateResourceNodeType(
              biome,
              cell.elevation,
              cell.moisture,
              seedValue,
              cellX,
              cellY
            );
        const resourceNodeType = existingNodeType || generatedNodeType;
        const resources =
          existingResources.length > 0
            ? existingResources
            : resourceNodeType
            ? [resourceNodeType]
            : [];
        return {
          ...cell,
          resources,
          resourceNode: resourceNodeType
            ? { type: resourceNodeType, level: 0 }
            : null,
        };
      });
    }

    // If row is already an array, process it directly
    if (Array.isArray(row)) {
      return row.map((cell, colIndex) => {
        if (!cell) return null;

        const cellX = cell.x ?? colIndex;
        const cellY = cell.y ?? rowIndex;
        const existingResources = Array.isArray(cell.resources)
          ? cell.resources.filter(Boolean)
          : [];
        const biome =
          typeof cell.biome === "string" ? cell.biome.toUpperCase() : cell.biome;
        const existingNodeType =
          cell.resourceNode?.type || existingResources[0] || null;
        const generatedNodeType = existingNodeType
          ? null
          : generateResourceNodeType(
              biome,
              cell.elevation,
              cell.moisture,
              seedValue,
              cellX,
              cellY
            );
        const resourceNodeType = existingNodeType || generatedNodeType;
        const resources =
          existingResources.length > 0
            ? existingResources
            : resourceNodeType
            ? [resourceNodeType]
            : [];
        return {
          ...cell,
          resources,
          resourceNode: resourceNodeType
            ? { type: resourceNodeType, level: 0 }
            : null,
        };
      });
    }

    console.error(`Invalid row format at index ${rowIndex}:`, row);
    return row; // Return unchanged if invalid format
  });
}

function normalizeSeed(seed) {
  if (typeof seed === "number") {
    return Math.floor(seed * 1e9) || 0;
  }
  if (typeof seed === "string") {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }
  return 0;
}

export function randFromSeed(seed, x, y, salt = 0) {
  let h = seed + x * 374761393 + y * 668265263 + salt * 1442695041;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return (h >>> 0) / 4294967295;
}

function generateFlatResources(
  biome,
  elevation,
  moisture,
  temperature,
  seed,
  x,
  y
) {
  const resources = [];

  // In grassland or savanna, assign food.
  if (biome === "GRASSLAND" || biome === "SAVANNA") {
    if (randFromSeed(seed, x, y, 1) < 0.004) resources.push("food");
  }

  // In woodlands or forests, assign wood.
  if (
    biome === "WOODLAND" ||
    biome === "FOREST" ||
    biome === "TROPICAL_FOREST" ||
    biome === "RAINFOREST"
  ) {
    if (randFromSeed(seed, x, y, 3) < 0.008) resources.push("wood");
  }

  // In mountains, assign stone and, at higher elevations, iron or gold.
  if (biome === "MOUNTAIN") {
    if (randFromSeed(seed, x, y, 4) < 0.015) resources.push("stone");
    if (elevation > 0.7 && randFromSeed(seed, x, y, 5) < 0.005)
      resources.push("iron");
    if (elevation > 0.85 && randFromSeed(seed, x, y, 6) < 0.0005)
      resources.push("gold");
  }

  return resources;
}

function generateResourceNodeType(biome, elevation, moisture, seed, x, y) {
  const nodeChanceByBiome = {
    GRASSLAND: 0.009,
    SAVANNA: 0.008,
    RIVER: 0.011,
    COASTAL: 0.01,
    FOREST: 0.008,
    WOODLAND: 0.008,
    TROPICAL_FOREST: 0.008,
    RAINFOREST: 0.008,
    TAIGA: 0.007,
    MOUNTAIN: 0.012,
    DESERT: 0.004,
    TUNDRA: 0.004,
  };
  const nodeChance = nodeChanceByBiome[biome] ?? 0;
  if (nodeChance <= 0) return null;

  const roll = randFromSeed(seed, x, y, 50);
  if (roll >= nodeChance) return null;

  let weights = [];
  if (biome === "MOUNTAIN") {
    weights = [
      { type: "stone", w: 0.45 },
      { type: "iron", w: elevation > 0.65 ? 0.25 : 0.18 },
      { type: "gold", w: elevation > 0.8 ? 0.08 : 0.04 },
      { type: "food", w: 0.12 },
      { type: "wood", w: 0.1 },
    ];
  } else if (biome === "DESERT") {
    weights = [
      { type: "stone", w: 0.35 },
      { type: "iron", w: elevation > 0.65 ? 0.2 : 0.12 },
      { type: "gold", w: elevation > 0.8 ? 0.06 : 0.03 },
      { type: "food", w: 0.12 },
      { type: "wood", w: 0.08 },
    ];
  } else if (biome === "TUNDRA") {
    weights = [
      { type: "iron", w: 0.28 },
      { type: "stone", w: 0.22 },
      { type: "food", w: 0.18 },
      { type: "wood", w: 0.12 },
      { type: "gold", w: 0.05 },
    ];
  } else if (biome === "RIVER" || biome === "COASTAL") {
    weights = [
      { type: "food", w: 0.45 },
      { type: "wood", w: 0.22 },
      { type: "stone", w: 0.12 },
      { type: "iron", w: 0.08 },
      { type: "gold", w: 0.05 },
    ];
  } else if (
    biome === "FOREST" ||
    biome === "WOODLAND" ||
    biome === "TROPICAL_FOREST" ||
    biome === "RAINFOREST" ||
    biome === "TAIGA"
  ) {
    weights = [
      { type: "wood", w: 0.45 },
      { type: "food", w: 0.2 },
      { type: "stone", w: 0.12 },
      { type: "iron", w: 0.1 },
      { type: "gold", w: 0.05 },
    ];
  } else if (biome === "GRASSLAND" || biome === "SAVANNA") {
    weights = [
      { type: "food", w: 0.5 },
      { type: "wood", w: 0.2 },
      { type: "stone", w: 0.12 },
      { type: "iron", w: 0.1 },
      { type: "gold", w: 0.08 },
    ];
  } else {
    weights = [
      { type: "food", w: 0.35 },
      { type: "wood", w: 0.22 },
      { type: "stone", w: 0.18 },
      { type: "iron", w: 0.15 },
      { type: "gold", w: 0.1 },
    ];
  }

  let total = 0;
  for (const entry of weights) total += entry.w;
  let pick = randFromSeed(seed, x, y, 51) * total;
  for (const entry of weights) {
    pick -= entry.w;
    if (pick <= 0) return entry.type;
  }
  return weights[weights.length - 1]?.type || null;
}
