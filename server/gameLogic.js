// gameLogic.js
import mongoose from "mongoose";

// Define intervals for specific game actions
const EXPANSION_INTERVAL = 5; // Expand territory every 5 ticks
const RESOURCE_INTERVAL = 3; // Collect resources every 3 ticks

/**
 * Expand a nation's territory.
 * In a full implementation, you would examine the room's map data and select the best adjacent cell.
 */
export function expandNation(nation, map) {
  if (!nation.territory || nation.territory.length === 0) {
    // Initialize with the starting cell if no territory exists yet.
    nation.territory = [nation.startingCell];
  } else {
    // For demonstration, use the last cell and add a random adjacent cell.
    const lastCell = nation.territory[nation.territory.length - 1];
    const newX = lastCell.x + Math.floor(Math.random() * 3) - 1;
    const newY = lastCell.y + Math.floor(Math.random() * 3) - 1;
    // Avoid duplicating territory cells.
    if (!nation.territory.some((cell) => cell.x === newX && cell.y === newY)) {
      nation.territory.push({ x: newX, y: newY });
    }
  }
}

/**
 * Collect resources from all cells in the nation's territory.
 * In a full implementation, you would examine each cell’s actual resource values and apply modifiers.
 */
export function collectResources(nation, map) {
  if (!nation.resources) nation.resources = {};
  const resourceTypes = [
    "iron ore",
    "precious metals",
    "gems",
    "stone",
    "copper ore",
    "fresh water",
    "fish",
    "medicinal plants",
    "wild fruits",
    "game animals",
    "arable land",
    "pastures",
    "grazing animals",
    "timber",
    "salt",
    "date palm",
    "fur animals",
    "fertile soil",
    "herbs",
  ];
  resourceTypes.forEach((resource) => {
    let yieldAmount = Math.floor(Math.random() * 5) + 1; // Yield between 1 and 5
    // Multiply by the number of territory cells.
    yieldAmount *= nation.territory ? nation.territory.length : 1;
    nation.resources[resource] =
      (nation.resources[resource] || 0) + yieldAmount;
  });
}

/**
 * Update a city's state.
 * This function takes the current city, the nation (player state), and the world state.
 * It returns an updated city. You can expand this logic as needed.
 */
export function updateCity(city, nation, worldState) {
  // For example, grow the city's population by 2% per tick.
  city.population = Math.floor(city.population * 1.02);
  // Simulate bonus resource production from the city.
  nation.resources = nation.resources || {};
  nation.resources["arable land"] = (nation.resources["arable land"] || 0) + 5;
  return city;
}

/**
 * Main tick function for game rooms.
 * Iterates over each open game room and updates its game state.
 */
export async function tickGameRooms() {
  try {
    const GameRoom = mongoose.model("GameRoom");
    const gameRooms = await GameRoom.find({ status: "open" });
    for (let room of gameRooms) {
      room.tickCount += 1;

      // Ensure gameState and its nations array exist.
      if (!room.gameState) room.gameState = {};
      if (!room.gameState.nations) room.gameState.nations = [];

      // Process each nation in the game room.
      for (let nation of room.gameState.nations) {
        // Expand territory every EXPANSION_INTERVAL ticks.
        if (room.tickCount % EXPANSION_INTERVAL === 0) {
          expandNation(nation, room.map);
        }
        // Collect resources every RESOURCE_INTERVAL ticks.
        if (room.tickCount % RESOURCE_INTERVAL === 0) {
          collectResources(nation, room.map);
        }
        // Simulate basic population growth and increment national will.
        nation.population = Math.floor(nation.population * 1.01);
        nation.nationalWill = (nation.nationalWill || 0) + 1;

        // Update each buildable thing (e.g., cities).
        if (nation.cities && Array.isArray(nation.cities)) {
          nation.cities = nation.cities.map((city) =>
            updateCity(city, nation, room.gameState)
          );
        }
      }

      // Record when the game state was last updated.
      room.gameState.lastUpdated = new Date();
      await room.save();
      console.log(`GameRoom ${room._id} ticked. Tick count: ${room.tickCount}`);
    }
  } catch (error) {
    console.error("Error in tickGameRooms:", error);
  }
}
