// Resource configuration
export const RESOURCE_GROUPS = {
  Water: ["fresh water"],
  Minerals: [
    "iron ore",
    "precious metals",
    "gems",
    "stone",
    "copper ore",
    "salt",
  ],
  Food: ["fish", "wild fruits", "game animals", "grazing animals"],
  Agriculture: ["arable land", "pastures", "fertile soil"],
  Flora: ["medicinal plants", "timber", "date palm", "fur animals", "herbs"],
};

// Resource weights (relative to base unit in each group)
export const RESOURCE_WEIGHTS = {
  // Water (base: fresh water = 1)
  "fresh water": 1,

  // Minerals (base: stone = 1)
  stone: 1,
  "copper ore": 2,
  "iron ore": 3,
  salt: 4,
  "precious metals": 8,
  gems: 10,

  // Food (base: wild fruits = 1)
  "wild fruits": 1,
  fish: 10,
  "game animals": 15,
  "grazing animals": 30,

  // Agriculture (base: fertile soil = 1)
  "fertile soil": 1,
  "arable land": 2,
  pastures: 3,

  // Flora (base: herbs = 1)
  herbs: 1,
  "medicinal plants": 2,
  "date palm": 3,
  timber: 4,
  "fur animals": 5,
};

// Territory maintenance costs per tick (in base units of each group)
export const TERRITORY_MAINTENANCE_COSTS = {
  Water: 1, // 1 fresh water
  Minerals: 0, // 0.5 stone equivalent
  Food: 2, // 2 wild fruit equivalents
  Agriculture: 1, // 1 fertile soil equivalent
  Flora: 1, // 1 herb equivalent
};

// Territory expansion costs (multiplier of maintenance costs)
export const EXPANSION_COST_MULTIPLIER = 5;

/**
 * Convert a resource amount to its base unit equivalent within its group
 */
function convertToBaseUnits(resource, amount) {
  return (amount || 0) * (RESOURCE_WEIGHTS[resource] || 1);
}

/**
 * Calculate total available resources in base units for each group
 */
export function calculateAvailableResources(nation) {
  const available = {};

  Object.keys(RESOURCE_GROUPS).forEach((group) => {
    available[group] = 0;
    RESOURCE_GROUPS[group].forEach((resource) => {
      const amount = nation.resources[resource] || 0;
      available[group] += convertToBaseUnits(resource, amount);
    });
  });

  return available;
}

/**
 * Check if nation can afford territory maintenance
 */
export function canMaintainTerritory(nation) {
  const available = calculateAvailableResources(nation);
  const territoryCells = nation.territory?.length || 0;

  return Object.keys(TERRITORY_MAINTENANCE_COSTS).every((group) => {
    const requiredAmount = TERRITORY_MAINTENANCE_COSTS[group] * territoryCells;
    return available[group] >= requiredAmount;
  });
}

/**
 * Check if nation can afford expansion
 */
export function canExpandTerritory(nation) {
  const available = calculateAvailableResources(nation);

  return Object.keys(TERRITORY_MAINTENANCE_COSTS).every((group) => {
    const expansionCost =
      TERRITORY_MAINTENANCE_COSTS[group] * EXPANSION_COST_MULTIPLIER;
    return available[group] >= expansionCost;
  });
}

/**
 * Deduct maintenance costs for territory
 */
export function deductMaintenanceCosts(nation) {
  if (!nation.territory?.length) return;

  const totalCells = nation.territory.length;
  Object.keys(RESOURCE_GROUPS).forEach((group) => {
    const requiredAmount = TERRITORY_MAINTENANCE_COSTS[group] * totalCells;
    let remainingCost = requiredAmount;

    // Try to deduct from each resource in the group, starting with lowest weight
    const sortedResources = RESOURCE_GROUPS[group].sort(
      (a, b) => RESOURCE_WEIGHTS[a] - RESOURCE_WEIGHTS[b]
    );

    for (const resource of sortedResources) {
      const baseUnitsAvailable = convertToBaseUnits(
        resource,
        nation.resources[resource] || 0
      );
      if (baseUnitsAvailable > 0) {
        const baseUnitsToDeduct = Math.min(remainingCost, baseUnitsAvailable);
        const actualUnitsToDeduct = Math.ceil(
          baseUnitsToDeduct / RESOURCE_WEIGHTS[resource]
        );

        nation.resources[resource] -= actualUnitsToDeduct;
        if (nation.resources[resource] <= 0) {
          delete nation.resources[resource];
        }

        remainingCost -= baseUnitsToDeduct;
        if (remainingCost <= 0) break;
      }
    }
  });
}

/**
 * Deduct expansion costs
 */
export function deductExpansionCosts(nation) {
  Object.keys(RESOURCE_GROUPS).forEach((group) => {
    const expansionCost =
      TERRITORY_MAINTENANCE_COSTS[group] * EXPANSION_COST_MULTIPLIER;
    let remainingCost = expansionCost;

    const sortedResources = RESOURCE_GROUPS[group].sort(
      (a, b) => RESOURCE_WEIGHTS[a] - RESOURCE_WEIGHTS[b]
    );

    for (const resource of sortedResources) {
      const baseUnitsAvailable = convertToBaseUnits(
        resource,
        nation.resources[resource] || 0
      );
      if (baseUnitsAvailable > 0) {
        const baseUnitsToDeduct = Math.min(remainingCost, baseUnitsAvailable);
        const actualUnitsToDeduct = Math.ceil(
          baseUnitsToDeduct / RESOURCE_WEIGHTS[resource]
        );

        nation.resources[resource] -= actualUnitsToDeduct;
        if (nation.resources[resource] <= 0) {
          delete nation.resources[resource];
        }

        remainingCost -= baseUnitsToDeduct;
        if (remainingCost <= 0) break;
      }
    }
  });
}

/**
 * Calculate cell desirability with resource considerations
 */
export function calculateResourceDesirability(cell) {
  if (!cell?.resources) return 0;

  let score = 0;
  const resourceSet = new Set(cell.resources);

  // Score each resource group
  Object.entries(RESOURCE_GROUPS).forEach(([group, resources]) => {
    const groupResources = resources.filter((r) => resourceSet.has(r));
    if (groupResources.length > 0) {
      // Calculate weighted value of resources in this group
      const groupScore = groupResources.reduce(
        (sum, resource) => sum + RESOURCE_WEIGHTS[resource],
        0
      );

      // Apply group-specific multipliers
      switch (group) {
        case "Water":
          score += groupScore * 3; // Water is critical
          break;
        case "Food":
          score += groupScore * 2; // Food is very important
          break;
        default:
          score += groupScore;
      }
    }
  });

  return score;
}
