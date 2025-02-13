// gameWorker.js
import mongoose from "mongoose";
import { parentPort, workerData } from "worker_threads";
import { updateNation } from "../utils/gameLogic.js";
import GameRoom from "../models/GameRoom.js";

// Make sure we have a connection to the DB (you might have your own connection logic)
if (mongoose.connection.readyState === 0) {
  mongoose
    .connect("mongodb://localhost:27017/fantasy-maps", {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })
    .catch((err) => console.error("Worker DB connection error:", err));
}

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
  async saveStateToDB() {
    const GameRoom = mongoose.model("GameRoom");
    await GameRoom.findByIdAndUpdate(this.roomId, {
      $set: {
        gameState: this.gameState,
        tickCount: this.tickCount,
      },
    });
  }

  // Process a tick: load the latest state, update it, then save it back.
  async processGameTick() {
    await this.loadStateFromDB();

    this.tickCount += 1;
    // console.log(`\n[TICK ${this.tickCount}] Starting tick processing`);
    // console.log(
    //   "[TICK] Loaded gameState:",
    //   JSON.stringify(this.gameState, null, 2)
    // );

    // If there are no nations, nothing to process.
    if (
      !this.gameState ||
      !Array.isArray(this.gameState.nations) ||
      this.gameState.nations.length === 0
    ) {
      // console.log("[TICK] No nations to process");
      return;
    }

    try {
      const updatedNations = this.gameState.nations.map((nation) => {
        // console.log(`[TICK] Processing nation: ${nation.owner}`);
        return updateNation(nation, this.mapData, this.gameState);
      });
      // Update gameState with the processed nations and a timestamp.
      this.gameState = {
        ...this.gameState,
        nations: updatedNations,
        lastUpdated: new Date(),
      };
      // console.log(
      //     "[TICK] Updated gameState:",
      //     JSON.stringify(this.gameState, null, 2)
      //   );
      // Save the updated state back to the DB.
      await this.saveStateToDB();
    } catch (error) {
      console.error("[TICK] Error processing nations:", error);
    }
  }
}

// Main asynchronous tick loop.
async function tickLoop() {
  // Create a processor instance using initial workerData.
  // (We assume workerData contains roomId, tickCount, and mapData.)
  const processor = new GameProcessor(workerData);
  while (true) {
    try {
      await processor.processGameTick();
    } catch (error) {
      console.error("[WORKER] Error during tick processing:", error);
    }
    // Wait 1 second between ticks.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

tickLoop();
