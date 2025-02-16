// gameWorker.js
import { parentPort, workerData } from "worker_threads";
import mongoose from "mongoose";
import workerpool from "workerpool";
import "../models/GameRoom.js";

// Initialize database
if (mongoose.connection.readyState === 0) {
  mongoose
    .connect("mongodb://localhost:27017/fantasy-maps", {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })
    .catch((err) => console.error("Worker DB connection error:", err));
}

const nationWorkerPath = new URL("./nationWorker.js", import.meta.url);
const nationPool = workerpool.pool(nationWorkerPath);

let paused = false;
const roomId = workerData.roomId;
const mapData = workerData.mapData;

// Main tick loop
async function processTick() {
  // 1. Load current state from DB
  const GameRoom = mongoose.model("GameRoom");
  const gameRoom = await GameRoom.findById(roomId).lean();
  if (!gameRoom?.gameState?.nations?.length) return;

  console.log(
    "[TICK] Processing nations:",
    gameRoom.gameState.nations.map((n) => n.owner)
  );

  // 2. Process each nation
  const updatedNations = await Promise.all(
    gameRoom.gameState.nations.map((nation) =>
      nationPool.exec("updateNationInWorker", [
        nation,
        mapData,
        gameRoom.gameState,
      ])
    )
  );

  // 3. Save updated state back to DB
  await GameRoom.findByIdAndUpdate(roomId, {
    $set: {
      "gameState.nations": updatedNations,
      "gameState.lastUpdated": new Date(),
      tickCount: (gameRoom.tickCount || 0) + 1,
    },
  });
}

// Handle pause/unpause messages
parentPort.on("message", (msg) => {
  if (msg.type === "PAUSE") {
    paused = true;
  } else if (msg.type === "UNPAUSE") {
    paused = false;
  }
});

// Main loop
async function tickLoop() {
  while (true) {
    if (!paused) {
      try {
        await processTick();
      } catch (error) {
        console.error("[WORKER] Error during tick:", error);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

tickLoop().catch((error) => {
  console.error("[WORKER] Fatal error:", error);
  process.exit(1);
});
