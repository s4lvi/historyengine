// index.js (or server.js)
import dotenv from "dotenv";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

import mapRoutes from "./routes/mapRoutes.js";
import gameRoutes from "./routes/gameRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import { gameLoop } from "./workers/gameLoop.js";
import GameRoom from "./models/GameRoom.js";
import {
  initWebSocket,
  hasActiveConnections,
  getLastActivity,
  touchRoom,
} from "./wsHub.js";
import { debug, debugWarn } from "./utils/debug.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });

const CLEAR_ROOMS =
  process.argv.includes("--clear-rooms") ||
  process.env.CLEAR_ROOMS === "true";

const app = express();
app.set("trust proxy", 1);

const allowedOrigins = (process.env.CLIENT_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(express.json());

// -------------------------------------------------------------------
// Connect to MongoDB
// -------------------------------------------------------------------

const MONGO_URI =
  process.env.MONGO_URI || "mongodb://localhost:27017/fantasy-maps";

mongoose
  .connect(MONGO_URI)
  .then(() => {
    debug("Connected to MongoDB");
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
    debugWarn("RESET_DB enabled: dropped gamerooms, mapchunks, maps");
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
      debug("[CLEAR] No open rooms to clear.");
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

    debug(`[CLEAR] Removed ${rooms.length} room(s) and their map data.`);
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
    debug(
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
      debug(`Closed inactive room ${roomId}`);
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
app.use("/api/auth", authRoutes);

// -------------------------------------------------------------------
// Serve static files from the React app in production
// -------------------------------------------------------------------

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
initWebSocket(
  server,
  (roomId) => gameLoop.getLiveGameRoom(roomId),
  (roomId) => gameLoop.getCachedMatrix(roomId)
);
setInterval(cleanupEmptyRooms, EMPTY_ROOM_CLEANUP_INTERVAL_MS);
server.listen(PORT, () => {
  debug(`Server running on port ${PORT}`);
});

// Graceful shutdown
async function gracefulShutdown(signal) {
  debug(`\n[SHUTDOWN] Received ${signal}, saving all rooms...`);
  try {
    await gameLoop.stopAllRooms();
  } catch (err) {
    console.error("[SHUTDOWN] Error stopping rooms:", err.message);
  }
  server.close(() => {
    debug("[SHUTDOWN] HTTP server closed");
    mongoose.disconnect().then(() => {
      debug("[SHUTDOWN] MongoDB disconnected");
      process.exit(0);
    });
  });
  // Force exit after 10 seconds if graceful shutdown hangs
  setTimeout(() => {
    console.error("[SHUTDOWN] Forced exit after timeout");
    process.exit(1);
  }, 10000);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
