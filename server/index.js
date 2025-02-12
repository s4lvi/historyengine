// index.js (or server.js)
import express from "express";
import mongoose from "mongoose";
import cors from "cors";

import mapRoutes from "./routes/mapRoutes.js";
import gameRoutes from "./routes/gameRoutes.js";

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
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => {
    console.error("Error connecting to MongoDB:", err);
    process.exit(1);
  });
mongoose.connection.on("error", (err) =>
  console.error("MongoDB connection error:", err)
);
await mongoose.connection.collection("gamerooms").drop();

// -------------------------------------------------------------------
// Mount the Route Handlers
// -------------------------------------------------------------------
app.use("/api/maps", mapRoutes);
app.use("/api/gamerooms", gameRoutes);

// -------------------------------------------------------------------
// Global Tick Loop for Game Rooms with Strategy Game Logic
// -------------------------------------------------------------------
// const TICK_INTERVAL_MS = 1000; // 1 second
// setInterval(tickGameRooms, TICK_INTERVAL_MS);

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
