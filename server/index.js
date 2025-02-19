// index.js
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import mapRoutes from "./routes/mapRoutes.js";
import gameRoutes from "./routes/gameRoutes.js";
import { gameLoop } from "./services/gameLoop.js";
import GameRoom from "./models/GameRoom.js";
import { gameStateManager } from "./services/GameStateManager.js";
import {
  checkMemoryUsage,
  cleanupInactiveRooms,
} from "./utils/memoryManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -------------------------------------------------------------------
// Express App Setup
// -------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// -------------------------------------------------------------------
// Memory Management and Monitoring
// -------------------------------------------------------------------
const CLEANUP_INTERVAL = 15 * 60 * 1000; // 15 minutes
const MEMORY_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Schedule regular cleanup of inactive rooms
setInterval(cleanupInactiveRooms, CLEANUP_INTERVAL);

// Schedule regular memory usage checks
setInterval(() => {
  const memoryStats = checkMemoryUsage();
  console.log("Memory usage stats:", memoryStats);

  // Optional: implement automatic cleanup if memory usage is too high
  if (memoryStats.heapUsedPercentage > 85) {
    console.warn("High memory usage detected. Triggering cleanup...");
    cleanupInactiveRooms();
  }
}, MEMORY_CHECK_INTERVAL);

// -------------------------------------------------------------------
// Connect to MongoDB
// -------------------------------------------------------------------
const MONGO_URI =
  process.env.MONGO_URI || "mongodb://localhost:27017/fantasy-maps";

mongoose
  .connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(async () => {
    console.log("Connected to MongoDB");

    // Clear existing collections if in development
    if (process.env.NODE_ENV !== "production") {
      try {
        await mongoose.connection.collection("gamerooms").drop();
        await mongoose.connection.collection("mapchunks").drop();
        await mongoose.connection.collection("maps").drop();
        console.log("Development: Cleared existing collections");
      } catch (err) {
        console.log("No existing collections to clear");
      }
    }

    // Resume active game rooms
    await resumeActiveGameLoops();
  })
  .catch((err) => {
    console.error("Error connecting to MongoDB:", err);
    process.exit(1);
  });

mongoose.connection.on("error", (err) => {
  console.error("MongoDB connection error:", err);
});

// -------------------------------------------------------------------
// Function to resume game loops for all open rooms
// -------------------------------------------------------------------
async function resumeActiveGameLoops() {
  try {
    // Get all open rooms from MongoDB
    const openRooms = await GameRoom.find({ status: "open" })
      .select("_id map players creator")
      .lean();

    console.log(`Found ${openRooms.length} active game room(s) to resume`);

    // Initialize game state for each room
    for (const room of openRooms) {
      try {
        // Initialize in-memory state
        gameStateManager.addRoom(room._id.toString(), {
          tickCount: 0,
          lastActivity: Date.now(),
          gameState: {
            nations: [],
            players: room.players,
            creator: room.creator,
          },
        });

        // Start the game loop for this room
        await gameLoop.startRoom(room._id.toString());

        console.log(`Resumed game room: ${room._id}`);
      } catch (error) {
        console.error(`Failed to resume game room ${room._id}:`, error);
      }
    }

    console.log(`Successfully resumed ${openRooms.length} game room(s)`);
  } catch (error) {
    console.error("Error resuming game loops:", error);
  }
}

// -------------------------------------------------------------------
// Mount Routes
// -------------------------------------------------------------------
app.use("/api/maps", mapRoutes);
app.use("/api/gamerooms", gameRoutes);

// -------------------------------------------------------------------
// Serve Static Files in Production
// -------------------------------------------------------------------
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "..", "client", "build")));
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "client", "build", "index.html"));
  });
}

// -------------------------------------------------------------------
// Health Check Endpoint
// -------------------------------------------------------------------
app.get("/health", (req, res) => {
  const memoryStats = checkMemoryUsage();
  const activeGames = gameStateManager.getActiveRoomCount();

  res.json({
    status: "healthy",
    activeGames,
    memoryUsage: memoryStats,
    uptime: process.uptime(),
  });
});

// -------------------------------------------------------------------
// Error Handling
// -------------------------------------------------------------------
app.use((req, res, next) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, req, res, next) => {
  console.error("Global error handler:", err);
  res
    .status(err.status || 500)
    .json({ error: err.message || "Internal Server Error" });
});

// -------------------------------------------------------------------
// Graceful Shutdown
// -------------------------------------------------------------------
process.on("SIGTERM", async () => {
  console.log("Received SIGTERM. Starting graceful shutdown...");

  // Stop all game loops
  const activeRooms = gameStateManager.getAllRoomIds();
  for (const roomId of activeRooms) {
    await gameLoop.stopRoom(roomId);
  }

  // Close MongoDB connection
  await mongoose.connection.close();

  console.log("Graceful shutdown completed");
  process.exit(0);
});

process.on("uncaughtException", async (error) => {
  console.error("Uncaught Exception:", error);
  // Optionally implement emergency state saving here
  process.exit(1);
});

// -------------------------------------------------------------------
// Start Server
// -------------------------------------------------------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  checkMemoryUsage(); // Initial memory usage check
});
