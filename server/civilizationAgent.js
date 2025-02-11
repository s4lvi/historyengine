// civilizationAgent.js

class CivilizationAgent {
  constructor(id, startingLocation, knownWorld = new Set()) {
    this.id = id;
    this.territory = new Set([`${startingLocation.x},${startingLocation.y}`]);
    this.knownWorld = knownWorld; // Set of coordinates the civilization has discovered
    this.population = 100; // Starting population
    this.resources = {
      food: 100,
      materials: 50,
      wealth: 0,
    };

    // Cultural and social structures
    this.traditions = new Map(); // tradition_id -> { origin, currentForm, importance }
    this.pressures = []; // Array of current pressures facing the civilization
    this.relationships = new Map(); // civ_id -> relationship_status

    // Historical memory
    this.history = [];
    this.lastAction = null;
  }

  // Knowledge and discovery methods
  async exploreRegion(x, y, mapData) {
    const key = `${x},${y}`;
    if (!this.knownWorld.has(key)) {
      this.knownWorld.add(key);
      // Process and store knowledge about the region
      const region = mapData[y][x];
      return {
        discovered: true,
        region: {
          biome: region.biome,
          resources: region.resources,
          features: region.features,
        },
      };
    }
    return { discovered: false };
  }

  // Territory management
  canExpand(x, y, mapData) {
    // Check if location is adjacent to existing territory
    const adjacent = [...this.territory].some((coord) => {
      const [cx, cy] = coord.split(",").map(Number);
      return Math.abs(cx - x) <= 1 && Math.abs(cy - y) <= 1;
    });

    if (!adjacent) return false;

    // Check if terrain is suitable
    const region = mapData[y][x];
    return region.biome !== "OCEAN" && region.elevation < 0.8;
  }

  // Resource management
  calculateResourceYield(region) {
    let yield = {
      food: 0,
      materials: 0,
      wealth: 0,
    };

    // Basic resource calculation based on biome and features
    switch (region.biome) {
      case "GRASSLAND":
        yield.food += 3;
        break;
      case "FOREST":
        yield.food += 1;
        yield.materials += 2;
        break;
      case "RIVER":
        yield.food += 2;
        yield.wealth += 1;
        break;
      // Add more biome-specific yields
    }

    // Additional yields from resources
    region.resources.forEach((resource) => {
      switch (resource) {
        case "fertile soil":
          yield.food += 2;
          break;
        case "timber":
          yield.materials += 2;
          break;
        case "precious metals":
          yield.wealth += 3;
          break;
        // Add more resource-specific yields
      }
    });

    return yield;
  }

  // Population dynamics
  updatePopulation() {
    // Basic population growth/decline based on resources
    const foodPerPerson = this.resources.food / this.population;
    let growthRate = 0;

    if (foodPerPerson > 2) {
      growthRate = 0.1; // Good food supply
    } else if (foodPerPerson > 1) {
      growthRate = 0.05; // Adequate food
    } else {
      growthRate = -0.1; // Food shortage
    }

    this.population = Math.floor(this.population * (1 + growthRate));
    this.resources.food *= 0.5; // Consume food
  }

  // Cultural development
  developTradition(trigger, basis) {
    const traditionId = Date.now().toString();
    this.traditions.set(traditionId, {
      origin: basis,
      currentForm: trigger,
      importance: 0.5,
      age: 0,
    });
    return traditionId;
  }

  // Pressure assessment
  assessPressures(mapData) {
    this.pressures = [];

    // Resource pressures
    const totalFood = this.resources.food;
    const foodNeeded = this.population * 1.5;
    if (totalFood < foodNeeded) {
      this.pressures.push({
        type: "RESOURCE",
        resource: "food",
        severity: (foodNeeded - totalFood) / foodNeeded,
        description: "Food shortage",
      });
    }

    // Population pressure
    const territoryCapacity = this.territory.size * 100; // Simple capacity calculation
    if (this.population > territoryCapacity) {
      this.pressures.push({
        type: "POPULATION",
        severity: (this.population - territoryCapacity) / territoryCapacity,
        description: "Overpopulation",
      });
    }

    return this.pressures;
  }

  // Action generation
  async decideNextAction(mapData, llm) {
    const pressures = this.assessPressures(mapData);

    // Prepare context for LLM
    const context = {
      civilization: {
        population: this.population,
        resources: this.resources,
        territorySize: this.territory.size,
        knownWorldSize: this.knownWorld.size,
        traditions: Array.from(this.traditions.values()),
        pressures: this.pressures,
        lastAction: this.lastAction,
      },
      currentState: {
        pressures: pressures,
        surroundingRegions: this.getAdjacentRegions(mapData),
      },
    };

    // Generate action using LLM
    const response = await llm.generateResponse(context);

    // Parse and validate LLM response
    // Implementation depends on your LLM integration

    return response;
  }

  // Helper method to get adjacent regions
  getAdjacentRegions(mapData) {
    const adjacent = new Set();
    this.territory.forEach((coord) => {
      const [x, y] = coord.split(",").map(Number);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const newX = x + dx;
          const newY = y + dy;
          if (
            newX >= 0 &&
            newX < mapData[0].length &&
            newY >= 0 &&
            newY < mapData.length
          ) {
            adjacent.add(`${newX},${newY}`);
          }
        }
      }
    });
    return Array.from(adjacent).map((coord) => {
      const [x, y] = coord.split(",").map(Number);
      return {
        x,
        y,
        ...mapData[y][x],
      };
    });
  }
}

export default CivilizationAgent;
