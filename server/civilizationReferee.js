// simulationReferee.js
import CivilizationAgent from "./civilizationAgent.js";

class SimulationReferee {
  constructor(mapId, mapData) {
    this.mapId = mapId;
    this.mapData = mapData;
    this.civilizations = new Map();
    this.currentYear = 0;
    this.history = [];
    // coordinate -> civilization_id
    this.territoryMap = new Map();
  }

  // Initialize a new civilization
  initializeCivilization(startingLocation) {
    const id = `civ_${Date.now()}`;
    const civ = new CivilizationAgent(id, startingLocation);
    this.civilizations.set(id, civ);
    this.updateTerritoryMap(id, startingLocation);
    return id;
  }

  // Update territory ownership
  updateTerritoryMap(civId, location) {
    const key = `${location.x},${location.y}`;
    this.territoryMap.set(key, civId);
  }

  // Process a single turn for all civilizations
  async processTurn(llm) {
    this.currentYear += 1;
    const turnEvents = [];

    // Process each civilization's turn
    for (const [civId, civ] of this.civilizations.entries()) {
      // 1. Generate action using LLM
      const action = await civ.decideNextAction(this.mapData, llm);

      // 2. Validate and execute action
      const result = await this.executeAction(civId, action);

      // 3. Process consequences
      const consequences = this.processConsequences(civId, result);

      // 4. Update civilization state (population, etc.)
      civ.updatePopulation();

      // 5. Record events
      turnEvents.push({
        year: this.currentYear,
        civId,
        action,
        result,
        consequences,
      });
    }

    // Process inter-civilization interactions
    const interactions = this.processInteractions();
    turnEvents.push(...interactions);

    // Record history
    this.history.push({
      year: this.currentYear,
      events: turnEvents,
    });

    return turnEvents;
  }

  // Execute a civilization's action
  async executeAction(civId, action) {
    const civ = this.civilizations.get(civId);
    const result = {
      success: false,
      effects: [],
      narrative: "",
    };

    if (!action || !action.type) {
      result.narrative = "No action taken";
      return result;
    }

    switch (action.type) {
      case "EXPAND":
        result.success = this.handleExpansion(civ, action.target);
        if (result.success) result.effects.push("TERRITORY_GAIN");
        break;
      case "DEVELOP":
        result.success = this.handleDevelopment(civ, action.focus);
        if (result.success) result.effects.push("RESOURCE_CHANGE");
        break;
      case "EXPLORE":
        result.success = await this.handleExploration(civ, action.direction);
        if (result.success) result.effects.push("KNOWLEDGE_GAIN");
        break;
      case "TRADE":
        result.success = this.handleTrade(civ, action.partner, action.terms);
        if (result.success) result.effects.push("TRADE_COMPLETED");
        break;
      // Add more action types as needed
      default:
        result.narrative = `Unknown action type: ${action.type}`;
        break;
    }

    return result;
  }

  // Handle territory expansion
  handleExpansion(civ, target) {
    if (!target || !civ.canExpand(target.x, target.y, this.mapData)) {
      return false;
    }

    const targetKey = `${target.x},${target.y}`;
    // Check if it's already owned by someone
    if (this.territoryMap.has(targetKey)) {
      return false;
    }

    civ.territory.add(targetKey);
    this.updateTerritoryMap(civ.id, target);
    return true;
  }

  // Handle development actions
  handleDevelopment(civ, focus) {
    if (!focus) return false;
    switch (focus) {
      case "AGRICULTURE":
        civ.resources.food += 20;
        return true;
      case "CONSTRUCTION":
        civ.resources.materials += 15;
        return true;
      case "TRADE":
        civ.resources.wealth += 10;
        return true;
      default:
        return false;
    }
  }

  // Handle exploration
  async handleExploration(civ, direction) {
    if (!direction) return false;
    // For simplicity, pick the first tile in territory as our "center"
    const [firstCoord] = civ.territory;
    if (!firstCoord) return false;
    const [cx, cy] = firstCoord.split(",").map(Number);
    const target = {
      x: cx + direction.x,
      y: cy + direction.y,
    };

    // Check map bounds
    if (
      target.x < 0 ||
      target.x >= this.mapData[0].length ||
      target.y < 0 ||
      target.y >= this.mapData.length
    ) {
      return false;
    }

    const result = await civ.exploreRegion(target.x, target.y, this.mapData);
    return result.discovered;
  }

  // Validate and execute trades
  handleTrade(civ, partnerId, terms) {
    if (!partnerId || !terms) return false;
    const partner = this.civilizations.get(partnerId);
    if (!partner) return false;

    // Validate trade
    if (!this.validateTrade(civ, partner, terms)) {
      return false;
    }

    // Execute trade
    this.executeTrade(civ, partner, terms);
    return true;
  }

  validateTrade(civ, partner, terms) {
    // Example: require that each side has enough resources to trade
    if (terms.food && civ.resources.food < terms.food) return false;
    if (terms.materials && civ.resources.materials < terms.materials)
      return false;
    if (terms.wealth && civ.resources.wealth < terms.wealth) return false;

    // Similar checks for partner if they are offering resources, etc.
    // This is just a sample check.
    return true;
  }

  executeTrade(civ, partner, terms) {
    // Very simplistic example: civ gives resources, partner receives them
    if (terms.food) {
      civ.resources.food -= terms.food;
      partner.resources.food += terms.food;
    }
    if (terms.materials) {
      civ.resources.materials -= terms.materials;
      partner.resources.materials += terms.materials;
    }
    if (terms.wealth) {
      civ.resources.wealth -= terms.wealth;
      partner.resources.wealth += terms.wealth;
    }
  }

  // Process consequences of a single action’s result
  processConsequences(civId, actionResult) {
    const civ = this.civilizations.get(civId);
    const consequences = [];

    if (!actionResult.effects || actionResult.effects.length === 0) {
      return consequences;
    }

    // Check for resource changes => possible shortage or crisis
    if (actionResult.effects.includes("RESOURCE_CHANGE")) {
      // Example: If any resource is below zero, register a crisis
      for (const [resource, amount] of Object.entries(civ.resources)) {
        if (amount < 0) {
          consequences.push({
            type: "CRISIS",
            severity: "HIGH",
            description: `Severe shortage of ${resource}`,
          });
        }
      }
    }

    // Example of cultural fade or change (if included in your logic)
    // if (actionResult.effects.includes("CULTURAL_CHANGE")) { ... }

    return consequences;
  }

  // Process interactions between civilizations
  processInteractions() {
    const interactions = [];
    const civilizationPairs = this.findAdjacentCivilizations();

    civilizationPairs.forEach(([civA, civB]) => {
      // Probability: base it on distance, relationships, etc.
      const interactionChance = this.calculateInteractionProbability(
        civA,
        civB
      );

      if (Math.random() < interactionChance) {
        const interactionEvent = this.generateInteraction(civA, civB);
        interactions.push(interactionEvent);
      }
    });

    return interactions;
  }

  // Find pairs of civilizations that are adjacent
  findAdjacentCivilizations() {
    const pairs = [];
    const allCivs = Array.from(this.civilizations.values());

    for (let i = 0; i < allCivs.length; i++) {
      for (let j = i + 1; j < allCivs.length; j++) {
        if (this.areCivilizationsAdjacent(allCivs[i], allCivs[j])) {
          pairs.push([allCivs[i], allCivs[j]]);
        }
      }
    }

    return pairs;
  }

  // Check adjacency if any tile in civA’s territory is near a tile in civB’s territory
  areCivilizationsAdjacent(civA, civB) {
    for (const coordA of civA.territory) {
      const [xA, yA] = coordA.split(",").map(Number);
      for (const coordB of civB.territory) {
        const [xB, yB] = coordB.split(",").map(Number);
        // If distance <= 1.5, we consider them adjacent
        const dist = Math.sqrt((xA - xB) ** 2 + (yA - yB) ** 2);
        if (dist <= 1.5) return true;
      }
    }
    return false;
  }

  // Simple function that returns a base probability of interaction
  calculateInteractionProbability(civA, civB) {
    // You can factor in population, territory size, relationship status, etc.
    // For example:
    const baseChance = 0.2;
    // If both are large or share many border tiles, raise the chance
    const territoryFactor =
      Math.min(civA.territory.size, civB.territory.size) / 50;
    // If they are known foes or allies, modify the chance
    // For now, just do something simplistic:
    return Math.min(1, baseChance + territoryFactor * 0.1);
  }

  // Example “interaction” event: trade, conflict, or tension
  generateInteraction(civA, civB) {
    // For simplicity, we randomly pick an interaction
    const roll = Math.random();
    let details = "";

    if (roll < 0.4) {
      details = `${civA.id} and ${civB.id} engaged in minor border skirmishes.`;
    } else if (roll < 0.7) {
      details = `${civA.id} and ${civB.id} sent emissaries for possible trade.`;
    } else {
      details = `${civA.id} and ${civB.id} remained cautious but peaceful.`;
    }

    return {
      year: this.currentYear,
      type: "INTERACTION",
      civA: civA.id,
      civB: civB.id,
      details,
    };
  }
}

export default SimulationReferee;
