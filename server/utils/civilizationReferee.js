// simulationReferee.js
import CivilizationAgent from "./civilizationAgent.js";

class SimulationReferee {
  constructor(mapId, mapData) {
    this.mapId = mapId;
    this.mapData = mapData;
    this.civilizations = new Map();
    this.currentYear = 0;
    this.history = [];
    // Mapping from "x,y" to civilization id
    this.territoryMap = new Map();
  }

  // Initialize a new civilization on the map
  initializeCivilization(startingLocation) {
    const id = `civ_${Date.now()}`;
    const civ = new CivilizationAgent(id, startingLocation);
    this.civilizations.set(id, civ);
    this.updateTerritoryMap(id, startingLocation);
    return id;
  }

  updateTerritoryMap(civId, location) {
    const key = `${location.x},${location.y}`;
    this.territoryMap.set(key, civId);
  }

  /**
   * Process one simulation turn.
   * Each civilization generates its next action via the LLM,
   * and the referee validates and executes the action.
   * Inter-civilizational interactions are also determined by the LLM.
   */
  async processTurn(llm) {
    this.currentYear += 1;
    const turnEvents = [];

    // Process each civilization's turn
    for (const [civId, civ] of this.civilizations.entries()) {
      // 1. Let the civilization decide its next action based on its state.
      const action = await civ.decideNextAction(this.mapData, llm);

      // 2. Validate and execute the action via the referee.
      const result = await this.executeAction(civId, action, llm);

      // 3. Process any consequences (resource crises, etc.)
      const consequences = this.processConsequences(civId, result);

      // 4. Update civilization state (for example, population changes).
      civ.updatePopulation();

      // 5. Record the events of this turn.
      turnEvents.push({
        year: this.currentYear,
        civId,
        action,
        result,
        consequences,
      });
    }

    // Process inter-civilization interactions via the LLM.
    const interactionEvents = await this.processInteractions(llm);
    turnEvents.push(...interactionEvents);

    // Record this turn in history.
    this.history.push({
      year: this.currentYear,
      events: turnEvents,
    });

    return turnEvents;
  }

  /**
   * Given an action (structured as JSON by the LLM), execute it.
   * Some action types are still validated here (e.g. expansion must be adjacent
   * and unoccupied), but the overall decision is LLM-driven.
   */
  async executeAction(civId, action, llm) {
    const civ = this.civilizations.get(civId);
    const result = {
      success: false,
      effects: [],
      narrative: "",
    };

    if (!action || !action.action) {
      result.narrative = "No action taken";
      return result;
    }

    // Determine action type based on the LLM’s decision.
    switch (action.action) {
      case "EXPAND": {
        const target = action.parameters;
        result.success = this.handleExpansion(civ, target);
        if (result.success) result.effects.push("TERRITORY_GAIN");
        break;
      }
      case "DEVELOP": {
        result.success = this.handleDevelopment(civ, action.parameters.focus);
        if (result.success) result.effects.push("RESOURCE_CHANGE");
        break;
      }
      case "EXPLORE": {
        result.success = await this.handleExploration(
          civ,
          action.parameters.direction
        );
        if (result.success) result.effects.push("KNOWLEDGE_GAIN");
        break;
      }
      case "TRADE": {
        result.success = this.handleTrade(
          civ,
          action.parameters.partner,
          action.parameters.terms
        );
        if (result.success) result.effects.push("TRADE_COMPLETED");
        break;
      }
      default:
        result.narrative = `Unknown action: ${action.action}`;
        break;
    }

    return result;
  }

  // --- Action Handlers ---

  handleExpansion(civ, target) {
    if (!target || !civ.canExpand(target.x, target.y, this.mapData)) {
      return false;
    }
    const targetKey = `${target.x},${target.y}`;
    if (this.territoryMap.has(targetKey)) {
      return false;
    }
    civ.territory.add(targetKey);
    this.updateTerritoryMap(civ.id, target);
    return true;
  }

  handleDevelopment(civ, focus) {
    if (!focus) return false;
    // While you can expand this by deferring to an LLM for nuanced development decisions,
    // here we use simple state updates.
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

  async handleExploration(civ, direction) {
    if (!direction) return false;
    // For simplicity, pick one territory tile as the center for exploration.
    const [firstCoord] = civ.territory;
    if (!firstCoord) return false;
    const [cx, cy] = firstCoord.split(",").map(Number);
    const target = {
      x: cx + direction.x,
      y: cy + direction.y,
    };

    // Check map bounds.
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

  handleTrade(civ, partnerId, terms) {
    if (!partnerId || !terms) return false;
    const partner = this.civilizations.get(partnerId);
    if (!partner) return false;

    if (!this.validateTrade(civ, partner, terms)) {
      return false;
    }

    this.executeTrade(civ, partner, terms);
    return true;
  }

  validateTrade(civ, partner, terms) {
    // Ensure that the offering civilization has the resources to trade.
    if (terms.food && civ.resources.food < terms.food) return false;
    if (terms.materials && civ.resources.materials < terms.materials)
      return false;
    if (terms.wealth && civ.resources.wealth < terms.wealth) return false;
    return true;
  }

  executeTrade(civ, partner, terms) {
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

  processConsequences(civId, actionResult) {
    const civ = this.civilizations.get(civId);
    const consequences = [];

    if (!actionResult.effects || actionResult.effects.length === 0) {
      return consequences;
    }

    // Example: Check for resource shortages and trigger a crisis.
    if (actionResult.effects.includes("RESOURCE_CHANGE")) {
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
    // (Additional consequence logic can be added here.)
    return consequences;
  }

  // --- Inter-Civilization Interactions ---

  /**
   * Process interactions between adjacent civilizations.
   * For each pair of adjacent civilizations, we pass a context to the LLM
   * and let it decide if (and what kind of) interaction should occur.
   */
  async processInteractions(llm) {
    const interactions = [];
    const adjacentPairs = this.findAdjacentCivilizations();

    for (const [civA, civB] of adjacentPairs) {
      // Gather a context for the LLM that includes state details of both civilizations.
      const context = {
        year: this.currentYear,
        civA: this.getCivilizationState(civA),
        civB: this.getCivilizationState(civB),
        message:
          "Based on the state of these two adjacent civilizations, decide if an interaction should occur. " +
          "Possible interactions include trade, conflict, alliance, or peaceful coexistence. " +
          "Return a JSON object with keys 'interactionType' (e.g., TRADE, CONFLICT, DIPLOMACY) " +
          "and 'details' (narrative explanation). If no interaction should occur, return null.",
      };

      const prompt = `
You are an expert advisor in inter-civilizational affairs.
Given the following JSON context, decide if an interaction should occur.
If yes, return a JSON object with:
  - "interactionType": (for example, "TRADE", "CONFLICT", "DIPLOMACY")
  - "details": a short explanation.
If no interaction should occur, return null.

Context:
${JSON.stringify(context, null, 2)}

Your decision:
      `;

      let decision;
      try {
        const response = await llm.generateResponse(prompt);
        decision = JSON.parse(response);
      } catch (e) {
        console.error("LLM error during interaction decision:", e);
        decision = null;
      }

      if (decision) {
        interactions.push({
          year: this.currentYear,
          type: "INTERACTION",
          civA: civA.id,
          civB: civB.id,
          interaction: decision,
        });
      }
    }
    return interactions;
  }

  /**
   * Find all pairs of civilizations that are adjacent.
   * Two civilizations are considered adjacent if any tile in one territory
   * is within a small distance of any tile in the other.
   */
  findAdjacentCivilizations() {
    const pairs = [];
    const civList = Array.from(this.civilizations.values());

    for (let i = 0; i < civList.length; i++) {
      for (let j = i + 1; j < civList.length; j++) {
        if (this.areCivilizationsAdjacent(civList[i], civList[j])) {
          pairs.push([civList[i], civList[j]]);
        }
      }
    }
    return pairs;
  }

  areCivilizationsAdjacent(civA, civB) {
    for (const coordA of civA.territory) {
      const [xA, yA] = coordA.split(",").map(Number);
      for (const coordB of civB.territory) {
        const [xB, yB] = coordB.split(",").map(Number);
        // If the distance between any two tiles is within 1.5, they are adjacent.
        const dist = Math.sqrt((xA - xB) ** 2 + (yA - yB) ** 2);
        if (dist <= 1.5) return true;
      }
    }
    return false;
  }

  getCivilizationState(civ) {
    return {
      id: civ.id,
      population: civ.population,
      resources: civ.resources,
      territorySize: civ.territory.size,
      knownWorldSize: civ.knownWorld.size,
      traditions: Array.from(civ.traditions.values()),
      // Additional fields can be added here as needed.
    };
  }
}

export default SimulationReferee;
