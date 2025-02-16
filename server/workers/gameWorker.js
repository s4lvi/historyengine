// gameWorker.js
import mongoose from "mongoose";
import { parentPort, workerData } from "worker_threads";
import path from "path";
import { fileURLToPath } from "url";
import workerpool from "workerpool";
import "../models/GameRoom.js";

// Setup __dirname for ES Modules.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure we have a connection to the DB.
if (mongoose.connection.readyState === 0) {
  mongoose
    .connect("mongodb://localhost:27017/fantasy-maps", {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })
    .catch((err) => console.error("Worker DB connection error:", err));
}

// Create a worker pool for processing nation updates.
// We use the nationWorker.js file we created.
const nationWorkerPath = fileURLToPath(
  new URL("./nationWorker.js", import.meta.url)
);
const nationPool = workerpool.pool(nationWorkerPath);

let paused = false;
parentPort.on("message", (msg) => {
  if (msg.type === "PAUSE") {
    paused = true;
    console.log("Worker paused");
  } else if (msg.type === "UNPAUSE") {
    paused = false;
    console.log("Worker unpaused");
  } else if (msg.type === "UPDATE_STATE") {
    // Optionally update internal state if needed.
  }
});

class GameProcessor {
  constructor(initialState) {
    // Expect initialState to contain the roomId so we know which room to load.
    this.roomId = initialState.roomId;
    this.mapData = initialState.mapData || [];
    // We'll load the latest gameState from the DB on each tick.
    this.tickCount = initialState.tickCount || 0;
  }

  // Load the latest game state for this room from the database.
  async loadStateFromDB() {
    const GameRoom = mongoose.model("GameRoom");
    const gameRoom = await GameRoom.findById(this.roomId).lean();
    if (gameRoom) {
      // Ensure gameState has a nations array.
      this.gameState =
        gameRoom.gameState && Array.isArray(gameRoom.gameState.nations)
          ? gameRoom.gameState
          : { nations: [] };
      this.tickCount = gameRoom.tickCount || this.tickCount;
    } else {
      // If room not found, default to empty state.
      this.gameState = { nations: [] };
    }
  }

  // Save the updated state back to the database.
  // Add this to saveStateToDB in gameWorker.js
  async saveStateToDB() {
    const GameRoom = mongoose.model("GameRoom");

    // Debug the state structure
    function getMaxDepth(obj, currentPath = "") {
      if (typeof obj !== "object" || obj === null) {
        return { depth: 0, path: currentPath };
      }

      let maxDepth = 0;
      let maxPath = currentPath;

      for (const key in obj) {
        const result = getMaxDepth(
          obj[key],
          currentPath ? `${currentPath}.${key}` : key
        );
        if (result.depth + 1 > maxDepth) {
          maxDepth = result.depth + 1;
          maxPath = result.path;
        }
      }

      return { depth: maxDepth, path: maxPath };
    }

    // Proceed with the save
    await GameRoom.findByIdAndUpdate(this.roomId, {
      $set: {
        gameState: this.gameState,
        tickCount: this.tickCount,
      },
    });
  }
  // Process a tick: load the latest state, update it using a worker pool, then save it.
  async processGameTick() {
    await this.loadStateFromDB();
    this.tickCount += 1;

    if (!this.gameState?.nations?.length) return;
    // At start of processGameTick
    console.log(
      "[TICK] Processing tick, nations:",
      this.gameState?.nations?.map((n) => n.owner)
    );
    try {
      // Process one nation at a time to avoid state conflicts
      for (let i = 0; i < this.gameState.nations.length; i++) {
        const nation = this.gameState.nations[i];

        // Get latest state for this nation from DB to ensure we have any player actions
        const GameRoom = mongoose.model("GameRoom");
        const latestRoom = await GameRoom.findById(this.roomId).lean();
        if (!latestRoom) continue;

        // Find the latest version of this nation
        const latestNation = latestRoom.gameState.nations.find(
          (n) => n.owner === nation.owner
        );
        if (!latestNation) continue;

        // Process this nation with latest game state
        const updatedNation = await nationPool.exec("updateNationInWorker", [
          latestNation,
          this.mapData,
          latestRoom.gameState,
        ]);

        // Update just this nation in the game state
        const nationIndex = this.gameState.nations.findIndex(
          (n) => n.owner === nation.owner
        );
        if (nationIndex !== -1) {
          this.gameState.nations[nationIndex] = updatedNation;
        }

        // Save after each nation update
        await this.saveStateToDB();
      }

      this.gameState.lastUpdated = new Date();
    } catch (error) {
      console.error("[TICK] Error processing nations:", error);
    }
  }
}

// Main asynchronous tick loop.
async function tickLoop() {
  const processor = new GameProcessor(workerData);
  while (true) {
    // Wait while paused.
    while (paused) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    try {
      await processor.processGameTick();
    } catch (error) {
      console.error("[WORKER] Error during tick processing:", error);
    }
    // Wait a bit before processing the next tick.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
tickLoop();
