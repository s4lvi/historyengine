// index.js (or server.js)
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import http from "http";

import mapRoutes from "./routes/mapRoutes.js";
import gameRoutes from "./routes/gameRoutes.js";
import { gameLoop } from "./workers/gameLoop.js";
import GameRoom from "./models/GameRoom.js";
import path from "path";
import { fileURLToPath } from "url";
import {
  initWebSocket,
  hasActiveConnections,
  getLastActivity,
  touchRoom,
} from "./wsHub.js";

const __filename = fileURLToPath(import.meta.url);

const CLEAR_ROOMS =
  process.argv.includes("--clear-rooms") ||
  process.env.CLEAR_ROOMS === "true";

const app = express();
app.use(cors());
app.use(express.json());

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
  .then(() => {
    console.log("Connected to MongoDB");
    // Resume game loops for active game rooms
    resumeActiveGameLoops();
  })
  .catch((err) => {
    console.error("Error connecting to MongoDB:", err);
    process.exit(1);
  });

mongoose.connection.on("error", (err) =>
  console.error("MongoDB connection error:", err)
);
if (process.env.RESET_DB === "true") {
  try {
    await mongoose.connection.collection("gamerooms").drop();
    await mongoose.connection.collection("mapchunks").drop();
    await mongoose.connection.collection("maps").drop();
    console.warn("RESET_DB enabled: dropped gamerooms, mapchunks, maps");
  } catch (err) {
    console.error("RESET_DB enabled but failed to drop collections:", err);
  }
}

// -------------------------------------------------------------------
// Clear all open/paused rooms (--clear-rooms flag or CLEAR_ROOMS=true)
// -------------------------------------------------------------------
async function clearAllRooms() {
  try {
    const rooms = await GameRoom.find({
      status: { $in: ["open", "paused", "initializing"] },
    })
      .select("_id map")
      .lean();

    if (rooms.length === 0) {
      console.log("[CLEAR] No open rooms to clear.");
      return;
    }

    const MapModel = mongoose.model("Map");
    const MapChunk = mongoose.model("MapChunk");

    for (const room of rooms) {
      const roomId = room._id.toString();
      gameLoop.stopRoom(roomId);
      await MapChunk.deleteMany({ map: room.map });
      await MapModel.findByIdAndDelete(room.map);
      await GameRoom.findByIdAndDelete(room._id);
    }

    console.log(`[CLEAR] Removed ${rooms.length} room(s) and their map data.`);
  } catch (error) {
    console.error("[CLEAR] Error clearing rooms:", error);
  }
}

// -------------------------------------------------------------------
// Function to resume game loops for all open rooms
// -------------------------------------------------------------------
async function resumeActiveGameLoops() {
  try {
    if (CLEAR_ROOMS) {
      await clearAllRooms();
    }

    const openRooms = await GameRoom.find({ status: "open" });
    openRooms.forEach((room) => {
      // Make sure to pass the room id as a string
      gameLoop.startRoom(room._id.toString());
      touchRoom(room._id.toString());
    });
    console.log(
      `Resumed game loops for ${openRooms.length} active game room(s).`
    );
  } catch (error) {
    console.error("Error resuming game loops:", error);
  }
}

const EMPTY_ROOM_TTL_MS = Number(process.env.EMPTY_ROOM_TTL_MS) || 60000;
const EMPTY_ROOM_CLEANUP_INTERVAL_MS =
  Number(process.env.EMPTY_ROOM_CLEANUP_INTERVAL_MS) || 30000;

async function cleanupEmptyRooms() {
  try {
    const rooms = await GameRoom.find({
      status: { $in: ["open", "paused"] },
    })
      .select("_id map")
      .lean();

    const now = Date.now();
    for (const room of rooms) {
      const roomId = room._id.toString();
      if (hasActiveConnections(roomId)) continue;
      const lastActivity = getLastActivity(roomId);
      if (lastActivity && now - lastActivity < EMPTY_ROOM_TTL_MS) continue;

      await gameLoop.stopRoom(roomId);
      const MapModel = mongoose.model("Map");
      const MapChunk = mongoose.model("MapChunk");
      await MapChunk.deleteMany({ map: room.map });
      await MapModel.findByIdAndDelete(room.map);
      await GameRoom.findByIdAndDelete(room._id);
      console.log(`Closed inactive room ${roomId}`);
    }
  } catch (error) {
    console.error("Error cleaning up empty rooms:", error);
  }
}

// -------------------------------------------------------------------
// Mount the Route Handlers
// -------------------------------------------------------------------
app.use("/api/maps", mapRoutes);
app.use("/api/gamerooms", gameRoutes);

// -------------------------------------------------------------------
// Serve static files from the React app in production
// -------------------------------------------------------------------

const __dirname = path.dirname(__filename);
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "..", "client", "build")));

  // For any routes not matching the API, serve index.html
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "client", "build", "index.html"));
  });
}
// -------------------------------------------------------------------
// Global 404 & Error Handling Middleware
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
// Start the Server
// -------------------------------------------------------------------
const PORT = process.env.PORT || 5001;
const server = http.createServer(app);
initWebSocket(server);
setInterval(cleanupEmptyRooms, EMPTY_ROOM_CLEANUP_INTERVAL_MS);
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
