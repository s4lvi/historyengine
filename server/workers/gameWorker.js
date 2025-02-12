// gameWorker.js
import { parentPort, workerData } from "worker_threads";
import { updateNation } from "../utils/gameLogic.js";

class GameProcessor {
  constructor(initialState) {
    console.log(
      "Worker initialized with state:",
      JSON.stringify(initialState, null, 2)
    );

    this.gameState = JSON.parse(
      JSON.stringify({
        nations: [],
        ...initialState.gameState,
      })
    );
    this.tickCount = initialState.tickCount || 0;
    this.mapData = initialState.mapData || [];

    console.log(
      "Initial game state after construction:",
      JSON.stringify(this.gameState, null, 2)
    );
  }

  processGameTick() {
    this.tickCount += 1;
    console.log(`\n[Tick ${this.tickCount}] Starting tick processing`);
    console.log("Current game state:", JSON.stringify(this.gameState, null, 2));

    // Make a deep copy of the current state
    const currentState = JSON.parse(JSON.stringify(this.gameState));
    console.log(
      "State after deep copy:",
      JSON.stringify(currentState, null, 2)
    );

    // Process each nation
    if (currentState.nations && currentState.nations.length > 0) {
      console.log(`Processing ${currentState.nations.length} nations`);

      currentState.nations = currentState.nations.map((nation) => {
        console.log(
          "Processing nation:",
          JSON.stringify(nation.owner, null, 2)
        );

        // Create a working copy of the nation
        const nationCopy = { ...nation };

        if (nationCopy.territory && nationCopy.territory.length > 0) {
          console.log("Nation has territory:", nationCopy.territory.length);

          const validTerritory = nationCopy.territory.filter(
            (cell) =>
              cell.x >= 0 &&
              cell.y >= 0 &&
              cell.y < this.mapData.length &&
              cell.x < this.mapData[0].length
          );

          console.log("Valid territory count:", validTerritory.length);

          if (validTerritory.length > 0) {
            // Ensure territory is preserved
            nationCopy.territory = validTerritory;
            const updatedNation = updateNation(
              nationCopy,
              this.mapData,
              currentState
            );
            console.log(
              "Nation after update:",
              JSON.stringify(updatedNation.owner, null, 2)
            );
            return updatedNation;
          }
        }
        console.log("Returning original nation (no valid territory)");
        return nation;
      });

      console.log(
        "Nations after processing:",
        JSON.stringify(currentState.nations.length, null, 2)
      );
    } else {
      console.log("No nations to process");
    }

    // Update the state with the processed data
    this.gameState = currentState;
    this.gameState.lastUpdated = new Date();

    const result = {
      gameState: this.gameState,
      tickCount: this.tickCount,
    };

    console.log("Final state for tick: ", JSON.stringify(result, null, 2));
    return result;
  }

  updateMapData(newMapData) {
    console.log("Updating map data");
    this.mapData = newMapData;
  }

  updateState(newState) {
    console.log("Updating state with:", JSON.stringify(newState, null, 2));

    if (newState.gameState) {
      // Deep copy to prevent reference issues
      const newGameState = JSON.parse(JSON.stringify(newState.gameState));

      this.gameState = {
        ...this.gameState,
        ...newGameState,
        nations: newGameState.nations || this.gameState.nations || [],
      };

      console.log(
        "State after update:",
        JSON.stringify(this.gameState, null, 2)
      );
    }
    if (typeof newState.tickCount === "number") {
      this.tickCount = newState.tickCount;
    }
  }
}

// Initialize game processor with worker data
const processor = new GameProcessor(workerData);

// Process game ticks
const tickInterval = setInterval(() => {
  try {
    const result = processor.processGameTick();
    parentPort.postMessage(result);
  } catch (error) {
    console.error("Error in game tick:", error);
    console.error(error.stack);
    parentPort.postMessage({
      type: "ERROR",
      error: error.message,
      stack: error.stack,
    });
  }
}, 1000);

// Handle messages from the main thread
parentPort.on("message", (message) => {
  try {
    console.log("Worker received message:", JSON.stringify(message, null, 2));

    switch (message.type) {
      case "UPDATE_STATE":
        processor.updateState(message);
        break;
      case "UPDATE_MAP":
        processor.updateMapData(message.mapData);
        break;
      default:
        console.log("Unknown message type:", message.type);
    }
  } catch (error) {
    console.error("Error handling message:", error);
    console.error(error.stack);
    parentPort.postMessage({
      type: "ERROR",
      error: error.message,
      stack: error.stack,
    });
  }
});

// Cleanup on exit
parentPort.on("close", () => {
  clearInterval(tickInterval);
});
