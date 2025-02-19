// mapRoutes.js
import express from "express";
import mongoose from "mongoose";
import { Worker } from "worker_threads";

const router = express.Router();

// -------------------------------------------------------------------
// Map & MapChunk Models
// -------------------------------------------------------------------
const mapSchema = new mongoose.Schema({
  name: { type: String, default: "Untitled Map" },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
  status: {
    type: String,
    enum: ["generating", "ready", "error"],
    default: "generating",
  },
});
const Map = mongoose.model("Map", mapSchema);

const mapChunkSchema = new mongoose.Schema({
  map: { type: mongoose.Schema.Types.ObjectId, ref: "Map", required: true },
  startRow: { type: Number, required: true },
  endRow: { type: Number, required: true },
  rows: { type: [[mongoose.Schema.Types.Mixed]], required: true },
});
const MapChunk = mongoose.model("MapChunk", mapChunkSchema);

// -------------------------------------------------------------------
// Helper: Run Map Generation in a Worker Thread
// -------------------------------------------------------------------
function runMapGenerationWorker(workerData) {
  return new Promise((resolve, reject) => {
    // Use a URL for ES Modules to locate the worker file correctly.
    const worker = new Worker(
      new URL("../workers/mapWorker.js", import.meta.url),
      {
        workerData,
      }
    );
    worker.on("message", resolve);
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0)
        reject(new Error(`Worker stopped with exit code ${code}`));
    });
  });
}

// -------------------------------------------------------------------
// Endpoints for Maps
// -------------------------------------------------------------------

// POST /api/maps - Create a new map
router.post("/", async (req, res, next) => {
  try {
    let { name, width, height, erosion_passes, num_blobs, seed } = req.body;

    // Validate dimensions
    if (!width || !height) {
      const error = new Error("Width and height must be provided");
      error.status = 400;
      throw error;
    }
    width = Number(width);
    height = Number(height);
    if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
      const error = new Error("Width and height must be positive numbers");
      error.status = 400;
      throw error;
    }

    console.log("Starting map generation with dimensions:", width, height);
    if (!erosion_passes) erosion_passes = 4;
    if (!num_blobs) num_blobs = 3;
    if (!seed) seed = Math.random();

    // Offload the heavy map generation to a worker thread
    const mapData = await runMapGenerationWorker({
      width,
      height,
      erosion_passes,
      num_blobs,
      seed,
    });
    console.log("Map generated successfully in worker thread");

    // Save map metadata (without the huge mapData)
    const newMap = new Map({
      name: name || "Untitled Map",
      width,
      height,
    });
    console.log("Saving new map metadata to database");
    await newMap.save();
    console.log("Map metadata saved successfully");

    // Define the chunk size (number of rows per chunk)
    const CHUNK_SIZE = 50;
    const chunks = [];
    for (let i = 0; i < mapData.length; i += CHUNK_SIZE) {
      const chunkRows = mapData.slice(i, i + CHUNK_SIZE);
      chunks.push({
        map: newMap._id,
        startRow: i,
        endRow: i + chunkRows.length - 1,
        rows: chunkRows,
      });
    }
    console.log(`Saving ${chunks.length} chunks to the database`);
    await MapChunk.insertMany(chunks);
    console.log("All chunks saved successfully");

    res.status(201).json(newMap);
    console.log("Response sent successfully");
  } catch (error) {
    console.error("Error in POST /api/maps:", error);
    next(error);
  }
});

router.get("/:id/status", async (req, res, next) => {
  try {
    const map = await Map.findById(req.params.id)
      .select("status width height")
      .lean();

    if (!map) {
      return res.status(404).json({ error: "Map not found" });
    }

    // Return both status and dimensions so frontend can prepare
    res.json({
      status: map.status,
      width: map.width,
      height: map.height,
      ready: map.status === "ready",
    });
  } catch (error) {
    console.error("Error checking map status:", error);
    next(error);
  }
});

router.post("/gamemap", async (req, res, next) => {
  try {
    let { name, width, height, erosion_passes, num_blobs, seed } = req.body;

    // Validate dimensions
    if (!width || !height) {
      const error = new Error("Width and height must be provided");
      error.status = 400;
      throw error;
    }
    width = Number(width);
    height = Number(height);
    if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
      const error = new Error("Width and height must be positive numbers");
      error.status = 400;
      throw error;
    }

    // Save map metadata first
    const newMap = new Map({
      name: name || "Untitled Map",
      width,
      height,
      status: "generating",
    });

    await newMap.save();
    console.log("Map metadata saved successfully");

    // Send response immediately with the map ID
    res.status(201).json(newMap._id);
    console.log("Response sent successfully");

    // Continue with map generation asynchronously
    (async () => {
      try {
        console.log(
          "Starting async map generation with dimensions:",
          width,
          height
        );
        if (!erosion_passes) erosion_passes = 4;
        if (!num_blobs) num_blobs = 3;
        if (!seed) seed = Math.random();

        const mapData = await runMapGenerationWorker({
          width,
          height,
          erosion_passes,
          num_blobs,
          seed,
        });
        console.log("Map generated successfully in worker thread");

        // Define the chunk size and save chunks
        const CHUNK_SIZE = 50;
        const chunks = [];
        for (let i = 0; i < mapData.length; i += CHUNK_SIZE) {
          const chunkRows = mapData.slice(i, i + CHUNK_SIZE);
          chunks.push({
            map: newMap._id,
            startRow: i,
            endRow: i + chunkRows.length - 1,
            rows: chunkRows,
          });
        }

        console.log(`Saving ${chunks.length} chunks to the database`);
        await MapChunk.insertMany(chunks);
        console.log("All chunks saved successfully");

        // Update map status to ready after chunks are saved
        await Map.findByIdAndUpdate(newMap._id, { status: "ready" });
        console.log("Map status updated to ready");
      } catch (error) {
        console.error("Error in async map generation:", error);
        // Update map status to error if anything fails
        await Map.findByIdAndUpdate(newMap._id, { status: "error" });
        console.error("Map status updated to error due to:", error.message);
      }
    })();
  } catch (error) {
    console.error("Error in POST /api/maps/gamemap:", error);
    next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const maps = await Map.find({
      name: { $not: /^Room:/ },
    })
      .select("name createdAt width height")
      .sort("-createdAt");
    res.json(maps);
  } catch (error) {
    console.error("Error in GET /api/maps:", error);
    next(error);
  }
});

// GET /api/maps/:id/metadata - Retrieve map metadata
router.get("/:id/metadata", async (req, res, next) => {
  try {
    const map = await Map.findById(req.params.id).select(
      "name width height createdAt"
    );
    if (!map) {
      const error = new Error("Map not found");
      error.status = 404;
      throw error;
    }
    res.json(map);
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------------
// Constants for Optimized Map Data Response
// -------------------------------------------------------------------
const BIOMES = {
  OCEAN: 0,
  COASTAL: 1,
  MOUNTAIN: 2,
  DESERT: 3,
  SAVANNA: 4,
  TROPICAL_FOREST: 5,
  RAINFOREST: 6,
  TUNDRA: 7,
  TAIGA: 8,
  GRASSLAND: 9,
  WOODLAND: 10,
  FOREST: 11,
  RIVER: 12,
};

const FEATURES = {
  peaks: 0,
  cliffs: 1,
  hills: 2,
  springs: 3,
  lowlands: 4,
  wetlands: 5,
  marshes: 6,
  "fertile valleys": 7,
  river: 8,
};

const RESOURCES = {
  "iron ore": 0,
  "precious metals": 1,
  gems: 2,
  stone: 3,
  "copper ore": 4,
  "fresh water": 5,
  fish: 6,
  "medicinal plants": 7,
  "wild fruits": 8,
  "game animals": 9,
  "arable land": 10,
  pastures: 11,
  "grazing animals": 12,
  timber: 13,
  salt: 14,
  "date palm": 15,
  "fur animals": 16,
  "fertile soil": 17,
  herbs: 18,
};

// GET /api/maps/:id/data - Retrieve only the requested map data rows from the chunks
router.get("/:id/data", async (req, res, next) => {
  try {
    const { startRow, endRow } = req.query;
    const start = parseInt(startRow) || 0;
    const end = parseInt(endRow) || start + 50;

    // Verify map existence
    const map = await Map.findById(req.params.id).lean();
    if (!map) {
      throw new Error("Map not found");
    }

    // Retrieve only the chunks that overlap the requested rows
    const chunks = await MapChunk.find({
      map: req.params.id,
      startRow: { $lte: end },
      endRow: { $gte: start },
    })
      .sort({ startRow: 1 })
      .lean();

    // Merge and filter rows from chunks to exactly match the requested range
    let rows = [];
    for (const chunk of chunks) {
      const chunkStart = chunk.startRow;
      for (let i = 0; i < chunk.rows.length; i++) {
        const globalRowIndex = chunkStart + i;
        if (globalRowIndex >= start && globalRowIndex < end) {
          rows.push(chunk.rows[i]);
        }
      }
    }

    // Convert the retrieved rows to an optimized format
    const optimizedChunk = rows.map((row) =>
      row.map((cell) => [
        cell.elevation, // 0: elevation (number)
        cell.moisture, // 1: moisture (number)
        cell.temperature, // 2: temperature (number)
        BIOMES[cell.biome], // 3: biome (number)
        cell.isRiver ? 1 : 0, // 4: isRiver (flag)
        cell.features.map((f) => FEATURES[f]), // 5: features (array of numbers)
        cell.resources.map((r) => RESOURCES[r]), // 6: resources (array of numbers)
      ])
    );

    res.json({
      totalRows: map.height,
      startRow: start,
      endRow: Math.min(end, map.height),
      chunk: optimizedChunk,
      mappings:
        start === 0
          ? {
              biomes: Object.fromEntries(
                Object.entries(BIOMES).map(([k, v]) => [v, k])
              ),
              features: Object.fromEntries(
                Object.entries(FEATURES).map(([k, v]) => [v, k])
              ),
              resources: Object.fromEntries(
                Object.entries(RESOURCES).map(([k, v]) => [v, k])
              ),
            }
          : undefined,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/maps/:id - Retrieve a single map's metadata (without mapData)
router.get("/:id", async (req, res, next) => {
  try {
    const map = await Map.findById(req.params.id).lean();
    if (!map) {
      const error = new Error("Map not found");
      error.status = 404;
      throw error;
    }
    res.json(map);
  } catch (error) {
    console.error("Error in GET /api/maps/:id:", error);
    next(error);
  }
});

// DELETE /api/maps/:id - Delete a map and its associated chunks
router.delete("/:id", async (req, res, next) => {
  try {
    const map = await Map.findByIdAndDelete(req.params.id);
    if (!map) {
      const error = new Error("Map not found");
      error.status = 404;
      throw error;
    }
    // Remove all chunks associated with the map
    await MapChunk.deleteMany({ map: req.params.id });
    res.json({ message: "Map and its chunks deleted successfully" });
  } catch (error) {
    console.error("Error in DELETE /api/maps/:id:", error);
    next(error);
  }
});

export default router;
