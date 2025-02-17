// index.js (or server.js)
import express from "express";
import mongoose from "mongoose";
import cors from "cors";

import mapRoutes from "./routes/mapRoutes.js";
import gameRoutes from "./routes/gameRoutes.js";
import { gameLoop } from "./workers/gameLoop.js";
import GameRoom from "./models/GameRoom.js";

const app = express();
app.use(cors());
app.use(express.json());

// -------------------------------------------------------------------
// Connect to MongoDB
// -------------------------------------------------------------------
mongoose
  .connect("mongodb://localhost:27017/fantasy-maps", {
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
await mongoose.connection.collection("gamerooms").drop();

// -------------------------------------------------------------------
// Function to resume game loops for all open rooms
// -------------------------------------------------------------------
async function resumeActiveGameLoops() {
  try {
    const openRooms = await GameRoom.find({ status: "open" });
    openRooms.forEach((room) => {
      // Make sure to pass the room id as a string
      gameLoop.startRoom(room._id.toString());
    });
    console.log(
      `Resumed game loops for ${openRooms.length} active game room(s).`
    );
  } catch (error) {
    console.error("Error resuming game loops:", error);
  }
}

// -------------------------------------------------------------------
// Mount the Route Handlers
// -------------------------------------------------------------------
app.use("/api/maps", mapRoutes);
app.use("/api/gamerooms", gameRoutes);

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
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
