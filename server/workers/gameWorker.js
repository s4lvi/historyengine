// gameWorker.js
import { parentPort, workerData } from "worker_threads";
import mongoose from "mongoose";
import workerpool from "workerpool";
import "../models/GameRoom.js";
import path from "path";
import { fileURLToPath } from "url";

// Initialize database
if (mongoose.connection.readyState === 0) {
  mongoose
    .connect("mongodb://localhost:27017/fantasy-maps", {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })
    .catch((err) => console.error("Worker DB connection error:", err));
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const nationPool = workerpool.pool(path.join(__dirname, "nationWorker.js"));

let paused = false;
const roomId = workerData.roomId;
const mapData = workerData.mapData;

// Main tick loop
async function processTick() {
  try {
    // Load current state
    const GameRoom = mongoose.model("GameRoom");
    const gameRoom = await GameRoom.findById(roomId).lean();
    if (!gameRoom?.gameState?.nations?.length) return;

    // console.log(
    //   "[TICK] Processing nations:",
    //   gameRoom.gameState.nations.map((n) => n.owner)
    // );

    // Process each nation
    for (const nation of gameRoom.gameState.nations) {
      try {
        // Process the nation
        const updatedNation = await nationPool.exec("updateNationInWorker", [
          nation,
          mapData,
          gameRoom.gameState,
        ]);

        // Update just this nation in the database
        await GameRoom.findOneAndUpdate(
          {
            _id: roomId,
            "gameState.nations.owner": nation.owner,
          },
          {
            $set: {
              "gameState.nations.$": updatedNation,
            },
          }
        );

        //console.log(`[TICK] Updated nation: ${nation.owner}`);
      } catch (error) {
        console.error(`[TICK] Error updating nation ${nation.owner}:`, error);
      }
    }

    // Update tick count separately
    await GameRoom.findByIdAndUpdate(roomId, {
      $inc: { tickCount: 1 },
      $set: { "gameState.lastUpdated": new Date() },
    });

    console.log("[TICK] Completed tick");
  } catch (error) {
    console.error("[TICK] Error:", error);
  }
}

// Handle pause/unpause messages
parentPort.on("message", (msg) => {
  if (msg.type === "PAUSE") {
    paused = true;
    console.log("[WORKER] Paused");
  } else if (msg.type === "UNPAUSE") {
    paused = false;
    console.log("[WORKER] Unpaused");
  }
});

// Main loop
async function tickLoop() {
  while (true) {
    if (!paused) {
      await processTick();
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
tickLoop().catch((error) => {
  console.error("[WORKER] Fatal error:", error);
  process.exit(1);
});
