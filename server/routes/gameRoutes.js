// gameRoutes.js
import express from "express";
import mongoose from "mongoose";
import { Worker } from "worker_threads";
import { gameLoop } from "../workers/gameLoop.js";
import config from "../config/config.js";
import { buildGameStateResponse } from "../utils/gameStateView.js";
import { broadcastRoomUpdate, touchRoom } from "../wsHub.js";

const router = express.Router();

import GameRoom from "../models/GameRoom.js";

const MIN_FOUND_DISTANCE = 5;

function manhattanDistance(x1, y1, x2, y2) {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

function isCellOccupied(nations, x, y) {
  return (nations || []).some((nation) => {
    if (!nation.territory || !nation.territory.x || !nation.territory.y)
      return false;
    for (let i = 0; i < nation.territory.x.length; i++) {
      if (nation.territory.x[i] === x && nation.territory.y[i] === y) {
        return true;
      }
    }
    return false;
  });
}

function isTooCloseToExisting(nations, x, y) {
  return (nations || []).some((nation) => {
    if (nation.startingCell) {
      if (
        manhattanDistance(
          x,
          y,
          nation.startingCell.x,
          nation.startingCell.y
        ) < MIN_FOUND_DISTANCE
      ) {
        return true;
      }
    }
    if (nation.cities && nation.cities.length > 0) {
      return nation.cities.some(
        (city) => manhattanDistance(x, y, city.x, city.y) < MIN_FOUND_DISTANCE
      );
    }
    return false;
  });
}

function findBotStartCell(mapData, nations, maxAttempts = 5000) {
  if (!Array.isArray(mapData) || !Array.isArray(mapData[0])) return null;
  const height = mapData.length;
  const width = mapData[0].length;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);
    const cell = mapData[y]?.[x];
    if (!cell || cell.biome === "OCEAN") continue;
    if (isCellOccupied(nations, x, y)) continue;
    if (isTooCloseToExisting(nations, x, y)) continue;
    return { x, y };
  }
  return null;
}

function distanceToBorder(nation, x, y, maxDistance = 10) {
  if (!nation?.territory?.x || !nation?.territory?.y) return Infinity;
  const tx = nation.territory.x;
  const ty = nation.territory.y;
  const owned = new Set();
  for (let i = 0; i < tx.length; i++) {
    owned.add(`${tx[i]},${ty[i]}`);
  }
  let best = Infinity;
  for (let i = 0; i < tx.length; i++) {
    const cx = tx[i];
    const cy = ty[i];
    const neighbors = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    let isBorder = false;
    for (const [dx, dy] of neighbors) {
      const key = `${cx + dx},${cy + dy}`;
      if (!owned.has(key)) {
        isBorder = true;
        break;
      }
    }
    if (!isBorder) continue;
    const dist = Math.abs(cx - x) + Math.abs(cy - y);
    if (dist < best) best = dist;
    if (best <= maxDistance) return best;
  }
  return best;
}

const BOT_NAME_PARTS = {
  start: [
    "Al",
    "Bel",
    "Cor",
    "Dor",
    "Eld",
    "Fal",
    "Gal",
    "Hel",
    "Ith",
    "Jar",
    "Kor",
    "Lor",
    "Mor",
    "Nor",
    "Or",
    "Pal",
    "Quel",
    "Riv",
    "Sol",
    "Tor",
    "Val",
    "Wes",
    "Xan",
    "Yor",
    "Zen",
  ],
  middle: [
    "a",
    "e",
    "i",
    "o",
    "u",
    "ae",
    "io",
    "or",
    "an",
    "en",
    "in",
    "on",
    "un",
    "ar",
    "er",
    "ir",
    "ur",
    "ath",
    "eth",
    "ith",
    "oth",
    "ul",
  ],
  end: [
    "a",
    "on",
    "ia",
    "is",
    "ar",
    "or",
    "en",
    "um",
    "os",
    "as",
    "ath",
    "eth",
    "ir",
    "or",
    "un",
    "ria",
    "dor",
    "mar",
    "tor",
    "lan",
  ],
  titles: [
    "Duchy of {name}",
    "Commonwealth of {name}",
    "Kingdom of {name}",
    "Principality of {name}",
    "Free State of {name}",
    "Republic of {name}",
    "{name} Republic",
    "{name} Confederacy",
    "{name} Union",
    "Grand {name}",
    "{name} Dominion",
    "{name} Federation",
    "{name} League",
    "{name} Pact",
    "{name} Concord",
    "{name} Realm",
    "{name} Empire",
    "{name} Protectorate",
    "{name} Marches",
    "{name} Republic",
  ],
};

function sample(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function titleCase(value) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildBotBaseName() {
  const name =
    sample(BOT_NAME_PARTS.start) +
    sample(BOT_NAME_PARTS.middle) +
    sample(BOT_NAME_PARTS.end);
  return titleCase(name.toLowerCase());
}

function generateBotName(existingNames) {
  const baseName = buildBotBaseName();
  const template = sample(BOT_NAME_PARTS.titles);
  return template.replace("{name}", baseName);
}

function generateUniqueBotName(existingNames, fallbackIndex) {
  const used = existingNames || new Set();
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = generateBotName(used);
    if (!used.has(candidate)) return candidate;
  }
  return `Bot_${fallbackIndex}`;
}

function buildBotNation(botId, x, y) {
  const initialDelta = { add: { x: [x], y: [y] }, sub: { x: [], y: [] } };
  return {
    owner: botId,
    status: "active",
    isBot: true,
    startingCell: { x, y },
    territory: { x: [x], y: [y] },
    territoryDelta: initialDelta,
    territoryDeltaForClient: initialDelta,
    population: 100,
    nationalWill: 50,
    resources: {
      food: 200,
      wood: 150,
      stone: 100,
      iron: 0,
      gold: 0,
    },
    cities: [
      {
        name: "Capital",
        x,
        y,
        population: 50,
        type: "capital",
      },
    ],
    structures: [],
    auto_city: false,
    pressureOrders: [],
  };
}

async function spawnBotsForRoom(roomId, mapData, desiredCount) {
  const count = Math.max(0, Number(desiredCount || 0));
  if (!count) return;
  console.log(`[BOTS] spawnBotsForRoom room=${roomId} desired=${count}`);
  const gameRoom = await GameRoom.findById(roomId);
  if (!gameRoom) {
    console.warn(`[BOTS] room not found ${roomId}`);
    return;
  }
  if ((gameRoom.gameState?.nations || []).length === 0) {
    console.log(`[BOTS] deferring spawn; no players have founded yet`);
    return;
  }
  if (!gameRoom.gameState) {
    gameRoom.gameState = { nations: [], resourceUpgrades: {}, resourceNodeClaims: {} };
  }
  const nations = gameRoom.gameState.nations || [];
  const existingBots = nations.filter((n) => n.isBot);
  const toAdd = Math.max(0, count - existingBots.length);
  if (!toAdd) {
    console.log(
      `[BOTS] no bots to add (existing=${existingBots.length}) room=${roomId}`
    );
    return;
  }

  const created = [];
  const existingNames = new Set(
    nations.map((nation) => nation.owner).filter(Boolean)
  );
  for (let i = 0; i < toAdd; i++) {
    const botId = generateUniqueBotName(
      existingNames,
      existingBots.length + i + 1
    );
    const start = findBotStartCell(mapData, nations.concat(created));
    if (!start) {
      console.warn(`[BOTS] no valid start found for ${botId}`);
      break;
    }
    existingNames.add(botId);
    created.push(buildBotNation(botId, start.x, start.y));
    console.log(
      `[BOTS] queued ${botId} at (${start.x},${start.y}) room=${roomId}`
    );
  }

  if (created.length > 0) {
    gameRoom.gameState.nations = nations.concat(created);
    gameRoom.markModified("gameState.nations");
    await gameRoom.save();
    console.log(
      `[BOTS] spawned ${created.length} bots room=${roomId} totalNations=${gameRoom.gameState.nations.length}`
    );
    broadcastRoomUpdate(roomId.toString(), gameRoom);
  }
}

async function requireCreator(req, res) {
  const { userId, userName, password } = req.body || {};
  const actor = userId || userName;
  if (!actor || !password) {
    res.status(400).json({ error: "userId and password are required" });
    return null;
  }
  const gameRoom = await GameRoom.findById(req.params.id);
  if (!gameRoom) {
    res.status(404).json({ error: "Game room not found" });
    return null;
  }
  if (
    !gameRoom.creator ||
    gameRoom.creator.userId !== actor ||
    gameRoom.creator.password !== password
  ) {
    res.status(403).json({ error: "Invalid room creator credentials" });
    return null;
  }
  return { gameRoom };
}

router.post("/init", async (req, res, next) => {
  try {
    const {
      roomName,
      joinCode,
      creatorName,
      creatorPassword,
      mapName,
      width,
      height,
      erosion_passes,
      num_blobs,
      seed,
      botCount,
    } = req.body;
    console.log(`[BOTS] init botCount=${botCount}`);

    if (!width || !height) {
      const error = new Error("Width and height must be provided");
      error.status = 400;
      throw error;
    }
    const w = Number(width);
    const h = Number(height);
    if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) {
      const error = new Error("Width and height must be positive numbers");
      error.status = 400;
      throw error;
    }

    const mapSeed = seed !== undefined ? Number(seed) : Math.random();

    // Create new Map document with status "generating"
    const Map = mongoose.model("Map");
    const newMap = new Map({
      name: mapName || "Untitled Map",
      width: w,
      height: h,
      seed: mapSeed,
      status: "generating",
    });
    await newMap.save();

    // Generate join code if not provided:
    const generatedJoinCode =
      joinCode || Math.random().toString(36).substring(2, 8).toUpperCase();

    // Create the game room document referencing the new map
    const gameRoomData = {
      map: newMap._id,
      roomName: roomName || "Game Room",
      joinCode: generatedJoinCode,
      status: "initializing", // initial status while map is generating
      creator: { userId: creatorName, password: creatorPassword },
      players: [
        { userId: creatorName, password: creatorPassword, userState: {} },
      ],
      gameState: { nations: [], resourceUpgrades: {}, resourceNodeClaims: {}, bots: { count: botCount || 0 } },
      tickCount: 0,
    };
    const gameRoom = new GameRoom(gameRoomData);
    await gameRoom.save();
    touchRoom(gameRoom._id.toString());

    // Respond immediately with the game room ID and join code
    res
      .status(201)
      .json({ gameRoomId: gameRoom._id, joinCode: generatedJoinCode });

    // ─── Helper: Run Map Generation Worker ─────────────────────────────────
    function runMapGenerationWorker(workerData) {
      return new Promise((resolve, reject) => {
        const worker = new Worker(
          new URL("../workers/mapWorker.js", import.meta.url),
          { workerData }
        );
        worker.on("message", resolve);
        worker.on("error", reject);
        worker.on("exit", (code) => {
          if (code !== 0)
            reject(new Error(`Worker stopped with exit code ${code}`));
        });
      });
    }

    // Set defaults if not provided
    const erosionPasses = erosion_passes || 4;
    const numBlobs = num_blobs || 3;
    // Run map generation asynchronously
    (async () => {
      try {
        console.log(
          "Starting asynchronous map generation for game room:",
          gameRoom._id
        );
        const mapData = await runMapGenerationWorker({
          width: w,
          height: h,
          erosion_passes: erosionPasses,
          num_blobs: numBlobs,
          seed: mapSeed,
        });
        console.log("Map generation completed for game room:", gameRoom._id);

        // Save map chunks
        const MapChunk = mongoose.model("MapChunk");
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
        console.log(
          `Saving ${chunks.length} map chunks for game room:`,
          gameRoom._id
        );
        await MapChunk.insertMany(chunks);
        console.log("Map chunks saved for game room:", gameRoom._id);

        // Update map status to "ready"
        await Map.findByIdAndUpdate(newMap._id, { status: "ready" });
        console.log(
          "Map status updated to 'ready' for game room:",
          gameRoom._id
        );

        // Update game room status to "open"
        await GameRoom.findByIdAndUpdate(gameRoom._id, { status: "open" });
        console.log("Game room status updated to 'open':", gameRoom._id);

        await spawnBotsForRoom(gameRoom._id, mapData, botCount);

        // Start the game loop for the room
        await gameLoop.startRoom(gameRoom._id);
        console.log("Game loop started for room:", gameRoom._id);
      } catch (err) {
        console.error(
          "Error in asynchronous map generation for game room:",
          gameRoom._id,
          err
        );
        const Map = mongoose.model("Map");
        await Map.findByIdAndUpdate(newMap._id, { status: "error" });
        await GameRoom.findByIdAndUpdate(gameRoom._id, { status: "error" });
      }
    })();
  } catch (error) {
    console.error("Error in POST /api/gamerooms/init:", error);
    next(error);
  }
});

// ─── NEW: Status endpoint to poll game room and map readiness ───────────────
router.get("/:id/status", async (req, res, next) => {
  try {
    const gameRoom = await GameRoom.findById(req.params.id).lean();
    if (!gameRoom) {
      return res.status(404).json({ error: "Game room not found" });
    }
    const Map = mongoose.model("Map");
    const map = await Map.findById(gameRoom.map)
      .select("status width height")
      .lean();
    if (!map) {
      return res.status(404).json({ error: "Associated map not found" });
    }
    res.json({
      gameRoomStatus: gameRoom.status,
      mapStatus: map.status,
      width: map.width,
      height: map.height,
      ready: map.status === "ready",
    });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------------
// POST /api/gamerooms - Create a game room (with a map copy)
// -------------------------------------------------------------------
router.post("/", async (req, res, next) => {
  try {
    const {
      mapId,
      roomName,
      joinCode,
      creatorName,
      creatorPassword,
      botCount,
    } = req.body;
    console.log(`[BOTS] create botCount=${botCount}`);
    if (!mapId) return res.status(400).json({ error: "mapId is required" });
    if (!creatorName || !creatorPassword) {
      return res
        .status(400)
        .json({ error: "Room creator name and password are required" });
    }
    const Map = mongoose.model("Map");
    const originalMap = await Map.findById(mapId).lean();
    if (!originalMap)
      return res.status(404).json({ error: "Original map not found" });
    const mapCopyData = {
      name: "Room:" + creatorName,
      width: originalMap.width,
      height: originalMap.height,
    };
    const gameMap = new Map(mapCopyData);
    await gameMap.save();
    const MapChunk = mongoose.model("MapChunk");
    const originalChunks = await MapChunk.find({ map: originalMap._id }).lean();
    const newChunks = originalChunks.map((chunk) => ({
      map: gameMap._id,
      startRow: chunk.startRow,
      endRow: chunk.endRow,
      rows: chunk.rows,
    }));
    if (newChunks.length > 0) {
      await MapChunk.insertMany(newChunks);
    }
    const generatedJoinCode =
      joinCode || Math.random().toString(36).substring(2, 8).toUpperCase();
    const gameRoom = new GameRoom({
      map: gameMap._id,
      roomName: roomName || "Game Room",
      joinCode: generatedJoinCode,
      status: "open",
      creator: {
        userId: creatorName,
        password: creatorPassword,
      },
      players: [
        {
          userId: creatorName,
          password: creatorPassword,
          userState: {},
        },
      ],
      gameState: {
        nations: [], // Nations will be added when players found their nation.
        resourceUpgrades: {},
        resourceNodeClaims: {},
        bots: { count: botCount || 0 },
      },
      tickCount: 0,
    });
    await gameRoom.save();
    touchRoom(gameRoom._id.toString());
    const mapData = await gameLoop.getMapData(gameRoom._id.toString());
    if (mapData) {
      await spawnBotsForRoom(gameRoom._id, mapData, botCount);
    }
    await gameLoop.startRoom(gameRoom._id);
    res.status(201).json(gameRoom);
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------------
// GET /api/gamerooms - List open game rooms
// -------------------------------------------------------------------
router.get("/", async (req, res, next) => {
  try {
    const gameRooms = await GameRoom.find({ status: "open" })
      .select("roomName joinCode map createdAt tickCount")
      .populate("map", "name width height");
    res.json(gameRooms);
  } catch (error) {
    next(error);
  }
});

router.get("/:id/metadata", async (req, res, next) => {
  console.log("[ROUTE] Game room metadata request:", req.params.id);
  try {
    const gameRoom = await GameRoom.findById(req.params.id).populate(
      "map",
      "name width height"
    );
    if (!gameRoom)
      return res.status(404).json({ error: "Game room not found" });
    res.json({ map: gameRoom.map, config: config });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/data", async (req, res, next) => {
  try {
    const { startRow, endRow } = req.query;
    const start = parseInt(startRow, 10) || 0;
    const end = parseInt(endRow, 10) || start + 50;

    console.log(`Fetching map data for room: ${req.params.id}`);

    // Get the cached mapData
    const mapData = await gameLoop.getMapData(req.params.id);
    if (!mapData) {
      console.error(`Failed to get map data for room ${req.params.id}`);
      return res
        .status(404)
        .json({ error: "Map data not found or failed to initialize" });
    }

    // Convert object rows to arrays if necessary
    const rows = mapData
      .slice(start, Math.min(end, mapData.length))
      .map((row) => {
        // Check if row is an object with numbered keys
        if (row && typeof row === "object" && !Array.isArray(row)) {
          // Convert object to array by sorting keys numerically
          return Object.keys(row)
            .filter((key) => !isNaN(key)) // Filter out non-numeric keys
            .sort((a, b) => parseInt(a) - parseInt(b))
            .map((key) => row[key]);
        }
        return row;
      });

    // Define the biomes enum (unchanged)
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

    const resourceList = config?.territorial?.enabled
      ? config?.territorial?.resourceTypes || [
          "food",
          "wood",
          "stone",
          "iron",
          "gold",
        ]
      : config?.resources || [
          "food",
          "wood",
          "stone",
          "bronze",
          "steel",
          "horses",
        ];

    // Define the resources enum
    const RESOURCES = Object.fromEntries(
      resourceList.map((resource, index) => [resource, index])
    );

    // Create reverse mapping for resources
    const REVERSE_RESOURCES = Object.fromEntries(
      Object.entries(RESOURCES).map(([k, v]) => [v, k])
    );

    // Convert the rows to the optimized format
    const optimizedChunk = rows.map((row) => {
      if (!Array.isArray(row)) {
        console.error("Invalid row format:", row);
        return [];
      }
      return row.map((cell) => {
        if (!cell) {
          console.error("Invalid cell:", cell);
          return [0, 0, 0, 0, 0, []];
        }
        return [
          cell.elevation,
          cell.moisture,
          cell.temperature,
          BIOMES[cell.biome] || 0,
          cell.isRiver ? 1 : 0,
          Array.isArray(cell.resources) ? cell.resources : [],
        ];
      });
    });

    // Include reverse mappings (only on the first request chunk)
    const mappings =
      start === 0
        ? {
            biomes: Object.fromEntries(
              Object.entries(BIOMES).map(([k, v]) => [v, k])
            ),
            resources: REVERSE_RESOURCES,
          }
        : undefined;

    console.log(
      `Successfully prepared map data chunk for room ${
        req.params.id
      }: rows ${start}-${Math.min(end, mapData.length)}`
    );

    res.json({
      totalRows: mapData.length,
      startRow: start,
      endRow: Math.min(end, mapData.length),
      chunk: optimizedChunk,
      mappings,
    });
  } catch (error) {
    console.error(`Error fetching map data for room ${req.params.id}:`, error);
    next(error);
  }
});

// -------------------------------------------------------------------
// DELETE /api/gamerooms/:id - Delete a game room (room creator only)
// -------------------------------------------------------------------
router.delete("/:id", async (req, res, next) => {
  try {
    const { userName, password } = req.body;
    if (!userName || !password) {
      return res
        .status(400)
        .json({ error: "userName and password are required" });
    }
    const gameRoom = await GameRoom.findById(req.params.id);
    if (!gameRoom)
      return res.status(404).json({ error: "Game room not found" });
    if (
      !gameRoom.creator ||
      gameRoom.creator.userId !== userName ||
      gameRoom.creator.password !== password
    ) {
      return res
        .status(403)
        .json({ error: "Invalid room creator credentials" });
    }
    const MapModel = mongoose.model("Map");
    const MapChunk = mongoose.model("MapChunk");
    await MapChunk.deleteMany({ map: gameRoom.map });
    await MapModel.findByIdAndDelete(gameRoom.map);
    await GameRoom.findByIdAndDelete(req.params.id);
    res.json({
      message: "Game room and associated map data deleted successfully",
    });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/end - End a game session
// -------------------------------------------------------------------
router.post("/:id/end", async (req, res, next) => {
  try {
    const auth = await requireCreator(req, res);
    if (!auth) return;
    const { gameRoom } = auth;

    // Stop the game loop first
    await gameLoop.stopRoom(gameRoom._id.toString());

    // Now delete associated map data and the game room itself
    const MapModel = mongoose.model("Map");
    const MapChunk = mongoose.model("MapChunk");
    await MapChunk.deleteMany({ map: gameRoom.map });
    await MapModel.findByIdAndDelete(gameRoom.map);
    await GameRoom.findByIdAndDelete(req.params.id);

    res.json({
      message: "Game session ended and all related data deleted successfully",
    });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/pause - Pause a game session (stops updates and ticks)
// -------------------------------------------------------------------
router.post("/:id/pause", async (req, res, next) => {
  try {
    const auth = await requireCreator(req, res);
    if (!auth) return;
    await gameLoop.stopRoom(req.params.id.toString());
    await GameRoom.findByIdAndUpdate(req.params.id, { status: "paused" });
    res.json({ message: "Game session paused successfully" });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/unpause - Unpause a game session (resume updates and ticks)
// -------------------------------------------------------------------
router.post("/:id/unpause", async (req, res, next) => {
  try {
    const auth = await requireCreator(req, res);
    if (!auth) return;
    await GameRoom.findByIdAndUpdate(req.params.id, { status: "open" });
    await gameLoop.startRoom(req.params.id.toString());
    res.json({ message: "Game session unpaused successfully" });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/quit - Quit a match and remove player's nation
// -------------------------------------------------------------------
// -------------------------------------------------------------------
// POST /api/gamerooms/:id/quit - Quit a match and remove player's nation
// -------------------------------------------------------------------
router.post("/:id/quit", async (req, res, next) => {
  try {
    const { userId, password } = req.body;
    if (!userId || !password) {
      return res
        .status(400)
        .json({ error: "userId and password are required" });
    }

    // First, verify the game room exists
    const gameRoom = await GameRoom.findById(req.params.id);
    if (!gameRoom) {
      return res.status(404).json({ error: "Game room not found" });
    }

    // Verify player credentials
    const player = gameRoom.players.find(
      (p) => p.userId === userId && p.password === password
    );
    if (!player) {
      return res.status(403).json({ error: "Invalid credentials" });
    }
    touchRoom(gameRoom._id.toString());

    // Remove the nation and player in a single update operation
    const result = await GameRoom.findOneAndUpdate(
      { _id: req.params.id },
      {
        // Pull the nation from the nations array where owner matches userId
        $pull: {
          "gameState.nations": { owner: userId },
          players: { userId },
        },
      },
      { new: true } // Return the updated document
    );

    if (!result) {
      return res.status(404).json({ error: "Failed to update game room" });
    }

    res.json({
      message: "Successfully quit the match",
      remainingPlayers: result.players.length,
    });
  } catch (error) {
    next(error);
  }
});
// -------------------------------------------------------------------
// POST /api/gamerooms/:id/join - Join a game room
// -------------------------------------------------------------------
router.post("/:id/join", async (req, res, next) => {
  try {
    const { joinCode, userName, password } = req.body;
    if (!userName || !password) {
      return res
        .status(400)
        .json({ error: "userName and password are required" });
    }
    const gameRoom = await GameRoom.findById(req.params.id);
    if (!gameRoom)
      return res.status(404).json({ error: "Game room not found" });
    if (gameRoom.status !== "open")
      return res.status(400).json({ error: "Game room is not open" });
    if (gameRoom.joinCode !== joinCode)
      return res.status(403).json({ error: "Invalid join code" });
    let player = gameRoom.players.find((p) => p.userId === userName);
    if (player) {
      if (player.password !== password) {
        return res
          .status(403)
          .json({ error: "Invalid password for existing user" });
      }
      touchRoom(gameRoom._id.toString());
      res.json({
        message: "Rejoined game room successfully",
        userId: player.userId,
        config: config,
      });
    } else {
      player = { userId: userName, password, userState: {} };
      gameRoom.players.push(player);
      touchRoom(gameRoom._id.toString());
      await gameRoom.save();
      res.json({
        message: "Joined game room successfully",
        userId: player.userId,
      });
    }
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/state - Get the latest game state
// -------------------------------------------------------------------
// In gameRoutes.js
router.post("/:id/state", async (req, res, next) => {
  try {
    const { userId, password, full } = req.body;
    if (!userId || !password) {
      return res
        .status(400)
        .json({ error: "userId and password are required" });
    }

    const gameRoom = await GameRoom.findById(req.params.id).lean();
    if (!gameRoom) {
      return res.status(404).json({ error: "Game room not found" });
    }

    const player = gameRoom.players.find(
      (p) => p.userId === userId && p.password === password
    );
    if (!player) {
      return res.status(403).json({ error: "Invalid credentials" });
    }

    res.json(buildGameStateResponse(gameRoom, userId, !!full));
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/foundNation - Found a nation for a player
// (Automatically builds a capital city on the founding cell)
// -------------------------------------------------------------------
router.post("/:id/foundNation", async (req, res, next) => {
  try {
    const { userId, password, x, y } = req.body;
    console.log("[FOUND] Attempt:", { userId, x, y });

    // 1. Load current state
    const gameRoom = await GameRoom.findById(req.params.id);
    if (!gameRoom) {
      return res.status(404).json({ error: "Game room not found" });
    }

    // 2. Validate
    const player = gameRoom.players.find(
      (p) => p.userId === userId && p.password === password
    );
    if (!player) {
      return res.status(403).json({ error: "Invalid credentials" });
    }

    // Initialize gameState if needed
    if (!gameRoom.gameState) {
      gameRoom.gameState = { nations: [] };
    }

    // 3. Check for existing nation

    gameRoom.gameState.nations = gameRoom.gameState.nations.filter(
      (nation) => nation.owner !== userId || nation.status !== "defeated"
    );

    if (gameRoom.gameState.nations.some((n) => n.owner === userId)) {
      return res
        .status(400)
        .json({ error: "Nation already exists for this user" });
    }

    const mapData = await gameLoop.getMapData(req.params.id);
    if (!mapData || !mapData[y] || !mapData[y][x]) {
      return res.status(400).json({ error: "Invalid founding location" });
    }
    if (mapData[y][x].biome === "OCEAN") {
      return res
        .status(400)
        .json({ error: "Cannot found a nation on ocean tiles" });
    }
    const isOccupied = (gameRoom.gameState.nations || []).some((nation) => {
      if (!nation.territory || !nation.territory.x || !nation.territory.y)
        return false;
      for (let i = 0; i < nation.territory.x.length; i++) {
        if (nation.territory.x[i] === x && nation.territory.y[i] === y) {
          return true;
        }
      }
      return false;
    });
    if (isOccupied) {
      return res
        .status(400)
        .json({ error: "Founding location is already claimed" });
    }
    const tooClose = (gameRoom.gameState.nations || []).some((nation) => {
      if (nation.startingCell) {
        if (
          manhattanDistance(
            x,
            y,
            nation.startingCell.x,
            nation.startingCell.y
          ) < MIN_FOUND_DISTANCE
        ) {
          return true;
        }
      }
      if (nation.cities && nation.cities.length > 0) {
        return nation.cities.some(
          (city) => manhattanDistance(x, y, city.x, city.y) < MIN_FOUND_DISTANCE
        );
      }
      return false;
    });
    if (tooClose) {
      return res.status(400).json({
        error: `Founding location too close to another nation (minimum distance ${MIN_FOUND_DISTANCE})`,
      });
    }

    // 4. Create new nation
    const initialDelta = { add: { x: [x], y: [y] }, sub: { x: [], y: [] } };
    const newNation = {
      owner: userId,
      status: "active",
      startingCell: { x, y },
      territory: { x: [x], y: [y] },
      territoryDelta: initialDelta,
      territoryDeltaForClient: initialDelta,
      population: 100,
      nationalWill: 50,
      resources: {
        food: 200,
        wood: 150,
        stone: 100,
        iron: 0,
        gold: 0,
      },
      cities: [
        {
          name: "Capital",
          x,
          y,
          population: 50,
          type: "capital",
        },
      ],
      structures: [],
      auto_city: false,
      pressureOrders: [],
    };

    // 5. Save directly to DB
    const updatedRoom = await GameRoom.findByIdAndUpdate(
      req.params.id,
      {
        $push: { "gameState.nations": newNation },
      },
      { new: true }
    );
    if (updatedRoom) {
      const mapData = await gameLoop.getMapData(req.params.id);
      if (mapData) {
        await spawnBotsForRoom(
          req.params.id,
          mapData,
          updatedRoom.gameState?.bots?.count || 0
        );
      }
      broadcastRoomUpdate(req.params.id.toString(), updatedRoom);
    }

    res
      .status(201)
      .json({ message: "Nation founded successfully", nation: newNation });
  } catch (error) {
    console.error("[FOUND] Error:", error);
    next(error);
  }
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/buildCity - Build a new city for a nation
// -------------------------------------------------------------------
router.post("/:id/buildCity", async (req, res, next) => {
  console.log("[ROUTE] Build city request:", req.body);
  try {
    if (config?.territorial?.enabled) {
      return res
        .status(400)
        .json({ error: "City building is disabled in this mode" });
    }
    const { userId, password, x, y, cityType, cityName } = req.body;
    if (!userId || !password || x == null || y == null || !cityType) {
      return res
        .status(400)
        .json({ error: "userId, password, x, y, and cityType are required" });
    }
    const gameRoom = await GameRoom.findById(req.params.id);
    if (!gameRoom)
      return res.status(404).json({ error: "Game room not found" });

    // Find the player's nation.
    const nation = gameRoom.gameState?.nations?.find((n) => n.owner === userId);
    if (!nation)
      return res.status(404).json({ error: "Nation not found for this user" });

    // Check that the new city's cell is within the nation's territory.
    let inTerritory = false;
    if (nation.territory && nation.territory.x && nation.territory.y) {
      for (let i = 0; i < nation.territory.x.length; i++) {
        if (nation.territory.x[i] === x && nation.territory.y[i] === y) {
          inTerritory = true;
          break;
        }
      }
    }
    if (!inTerritory) {
      return res
        .status(400)
        .json({ error: "Selected cell is not within your territory" });
    }

    // Ensure no city exists within 5 cells (Manhattan distance).
    const tooClose = nation.cities?.some(
      (city) => Math.abs(city.x - x) + Math.abs(city.y - y) < 5
    );
    if (
      (tooClose && cityType === "town") ||
      cityType === "capital" ||
      cityType === "fort"
    )
      return res.status(400).json({
        error: "Cannot build city within 5 cells of an existing city",
      });

    /* ---------------------------------------------
       New Resource Structure Placement Checks
       ---------------------------------------------
       Only allow resource structures (i.e. types other than capital, town, fort)
       to be built on a tile that has the required resource.
    */
    // Define which structure types are resource structures and their required resource(s)
    const resourceStructureMapping = {
      farm: "food",
      "lumber mill": "wood",
      mine: ["stone", "bronze", "steel"],
      stable: "horses",
    };
    let producedResource = null;
    if (resourceStructureMapping[cityType]) {
      const mapData = await gameLoop.getMapData(req.params.id);
      const cell = mapData[y] && mapData[y][x];
      if (!cell) {
        return res.status(400).json({ error: "Invalid map cell" });
      }

      // Determine the required resource(s) for this structure.
      const required = resourceStructureMapping[cityType];
      let validResource = false;
      if (Array.isArray(required)) {
        // For example, a mine is allowed on stone, bronze, or steel tiles.
        validResource = cell.resources.some((r) => required.includes(r));
      } else {
        validResource = cell.resources.includes(required);
      }
      if (!validResource) {
        return res.status(400).json({
          error: `Cannot build ${cityType} on this tile. Required resource not found.`,
        });
      }
      producedResource = cell.resources[0];
      // Ensure that there is not already a resource structure built on this tile.
      const alreadyBuilt = nation.cities?.some(
        (city) =>
          city.x === x && city.y === y && resourceStructureMapping[city.type] // true if this city is a resource structure
      );
      if (alreadyBuilt) {
        return res.status(400).json({
          error: `A resource structure is already built on this tile.`,
        });
      }
    }

    // -------------------------------------------------
    // Continue with the normal build cost checks and deduction.
    // Get city build cost from config.
    const CITY_BUILD_COSTS = config.buildCosts.structures;
    const cost = CITY_BUILD_COSTS[cityType];
    if (!cost)
      return res.status(400).json({ error: "Invalid city type specified" });

    // Check if the nation has enough resources.
    let canBuild = true;
    for (const resource in cost) {
      if ((nation.resources[resource] || 0) < cost[resource]) {
        canBuild = false;
        break;
      }
    }
    if (!canBuild)
      return res
        .status(400)
        .json({ error: "Insufficient resources to build this city" });

    // Deduct the resource costs.
    for (const resource in cost) {
      nation.resources[resource] -= cost[resource];
    }
    console.log("city build with resource ", producedResource);
    // Create the new city/structure.
    const newCity = {
      name:
        cityName ||
        `${cityType.charAt(0).toUpperCase() + cityType.slice(1)} ${
          nation.cities.length + 1
        }`,
      x,
      y,
      population: 50, // Default starting population; adjust if needed.
      type: cityType,
      resource: producedResource,
    };
    nation.cities.push(newCity);

    // Save updated game state.
    const updatedRoom = await GameRoom.findOneAndUpdate(
      {
        _id: req.params.id,
        "gameState.nations.owner": userId,
      },
      {
        $push: { "gameState.nations.$.cities": newCity },
        $set: { "gameState.nations.$.resources": nation.resources },
      },
      { new: true }
    );
    if (updatedRoom) {
      broadcastRoomUpdate(req.params.id.toString(), updatedRoom);
    }

    res.status(201).json({ message: "City built successfully", city: newCity });
  } catch (error) {
    next(error);
  }
});
// -------------------------------------------------------------------
// POST /api/gamerooms/:id/setExpansionTarget - Set an expansion target for a nation
// -------------------------------------------------------------------
router.post("/:id/setExpansionTarget", async (req, res) => {
  return res.status(410).json({
    error: "Legacy expansion target system has been removed.",
  });
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/raiseArmy - Raise an army by recruiting men.
// -------------------------------------------------------------------
router.post("/:id/raiseArmy", async (req, res) => {
  return res.status(410).json({
    error: "Legacy army system has been removed.",
  });
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/setAttackTarget - Set an attack target for a specific army.
// -------------------------------------------------------------------
router.post("/:id/setAttackTarget", async (req, res) => {
  return res.status(410).json({
    error: "Legacy army system has been removed.",
  });
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/pressure - Send expansion/attack pressure
// -------------------------------------------------------------------
router.post("/:id/pressure", async (req, res, next) => {
  try {
    const { userId, password, direction, percent, target } = req.body;
    if (
      !userId ||
      !password ||
      !direction ||
      direction.x == null ||
      direction.y == null
    ) {
      return res.status(400).json({
        error: "userId, password, and direction (x,y) are required",
      });
    }

    const gameRoom = await GameRoom.findById(req.params.id);
    if (!gameRoom)
      return res.status(404).json({ error: "Game room not found" });

    const nation = gameRoom.gameState?.nations?.find((n) => n.owner === userId);
    if (!nation)
      return res.status(404).json({ error: "Nation not found for this user" });

    const minPercent = config?.territorial?.minAttackPercent || 0.05;
    const maxPercent = config?.territorial?.maxAttackPercent || 1;
    const rawPercent = Number(percent ?? config?.territorial?.defaultAttackPercent ?? 0.25);
    const clampedPercent = Math.min(Math.max(rawPercent, minPercent), maxPercent);

    const available = nation.population || 0;
    const power = available * clampedPercent;
    if (power <= 0) {
      return res.status(400).json({ error: "Not enough population to send" });
    }

    nation.population = Math.max(0, available - power);
    const maxPlayerOrders = config?.territorial?.maxPlayerPressureOrders ?? 1;
    if (!nation.isBot && maxPlayerOrders > 0) {
      nation.pressureOrders = [];
    } else {
      nation.pressureOrders = nation.pressureOrders || [];
    }
    const targetDistanceLimit =
      config?.territorial?.targetBorderDistance ?? 10;
    let resolvedTarget = null;
    if (
      target &&
      Number.isFinite(target.x) &&
      Number.isFinite(target.y)
    ) {
      const targetDistance = distanceToBorder(
        nation,
        target.x,
        target.y,
        targetDistanceLimit
      );
      if (targetDistance <= targetDistanceLimit) {
        resolvedTarget = { x: target.x, y: target.y };
      }
    }

    nation.pressureOrders.push({
      id: new mongoose.Types.ObjectId().toString(),
      direction: { x: direction.x, y: direction.y },
      target: resolvedTarget,
      remainingPower: power,
      targetReached: false,
      focusTicksRemaining: 0,
      targetStallTicks: 0,
    });

    const updatedRoom = await GameRoom.findOneAndUpdate(
      {
        _id: req.params.id,
        "gameState.nations.owner": userId,
      },
      {
        $set: {
          "gameState.nations.$.population": nation.population,
          "gameState.nations.$.pressureOrders": nation.pressureOrders,
        },
      },
      { new: true }
    );
    if (updatedRoom) {
      broadcastRoomUpdate(req.params.id.toString(), updatedRoom);
    }

    res.json({ message: "Pressure order sent", percent: clampedPercent });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/upgradeNode - Upgrade a resource node
// -------------------------------------------------------------------
router.post("/:id/upgradeNode", async (req, res, next) => {
  try {
    const { userId, password, x, y } = req.body;
    if (!userId || !password || x == null || y == null) {
      return res.status(400).json({
        error: "userId, password, x, and y are required",
      });
    }

    const gameRoom = await GameRoom.findById(req.params.id);
    if (!gameRoom)
      return res.status(404).json({ error: "Game room not found" });

    const nation = gameRoom.gameState?.nations?.find((n) => n.owner === userId);
    if (!nation)
      return res.status(404).json({ error: "Nation not found for this user" });

    const inTerritory =
      nation.territory?.x?.some(
        (tx, idx) => tx === x && nation.territory.y[idx] === y
      ) || false;
    if (!inTerritory) {
      return res
        .status(400)
        .json({ error: "Tile is not within your territory" });
    }

    const mapData = await gameLoop.getMapData(req.params.id);
    if (!mapData || !mapData[y] || !mapData[y][x]) {
      return res.status(400).json({ error: "Invalid map cell" });
    }
    const cell = mapData[y][x];
    if (!cell.resourceNode?.type) {
      return res.status(400).json({ error: "No resource node on this tile" });
    }

    const upgrades = gameRoom.gameState.resourceUpgrades || {};
    const claims = gameRoom.gameState.resourceNodeClaims || {};
    const claim = claims[`${x},${y}`];
    if (!claim || claim.owner !== userId) {
      return res.status(400).json({ error: "Node is not captured by your nation" });
    }
    const key = `${x},${y}`;
    const currentLevel =
      upgrades[key]?.level ?? cell.resourceNode.level ?? 0;
    const nextLevel = currentLevel + 1;
    if (nextLevel > 3) {
      return res.status(400).json({ error: "Node is already max level" });
    }

    const costs = config?.territorial?.resourceNodeUpgradeCosts || {};
    const cost = Number(costs[String(nextLevel)] || 0);
    const availableGold = nation.resources?.gold || 0;
    if (availableGold < cost) {
      return res.status(400).json({ error: "Not enough gold" });
    }

    nation.resources.gold = availableGold - cost;
    upgrades[key] = { type: cell.resourceNode.type, level: nextLevel };

    const updatedRoom = await GameRoom.findOneAndUpdate(
      {
        _id: req.params.id,
        "gameState.nations.owner": userId,
      },
      {
        $set: {
          "gameState.nations.$.resources": nation.resources,
          "gameState.resourceUpgrades": upgrades,
        },
      },
      { new: true }
    );

    if (updatedRoom) {
      broadcastRoomUpdate(req.params.id.toString(), updatedRoom);
    }

    res.json({ message: "Node upgraded", level: nextLevel });
  } catch (error) {
    next(error);
  }
});

export default router;
