// gameRoutes.js
import express from "express";
import mongoose from "mongoose";
import { Worker } from "worker_threads";
import { gameLoop } from "../workers/gameLoop.js";
import config from "../config/config.js";
import { buildGameStateResponse } from "../utils/gameStateView.js";
import { broadcastRoomUpdate, touchRoom } from "../wsHub.js";
import { assignResourcesToMap } from "../utils/resourceManagement.js";
import { generateCityName, generateTowerName, generateUniqueName } from "../utils/nameGenerator.js";
import { computePathLength, computeMaxArrowRange } from "../utils/gameLogic.js";

const router = express.Router();

import GameRoom from "../models/GameRoom.js";

const MIN_FOUND_DISTANCE = 5;
const DEFAULT_ALLOW_REFOUND = config?.territorial?.allowRefound !== false;

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return Boolean(value);
}

async function getAuthoritativeRoom(roomId) {
  return gameLoop.getLiveGameRoom(roomId);
}

function hasValidPlayerCredentials(gameRoom, userId, password) {
  return !!gameRoom?.players?.find(
    (p) => p.userId === userId && p.password === password
  );
}

async function persistRoomMutation(
  gameRoom,
  roomId,
  modifiedPaths = [],
  options = {}
) {
  const { forceSave = false } = options;
  for (const path of modifiedPaths) {
    gameRoom.markModified(path);
  }

  // Active rooms are saved periodically by the loop to avoid version conflicts.
  if (!forceSave && gameLoop.isRoomRunning(roomId)) {
    return;
  }

  await gameRoom.save();
}

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

function isPointNearTerritory(nation, point, maxDistance = 3) {
  if (!point || !nation?.territory?.x || !nation?.territory?.y) return false;
  const tx = nation.territory.x;
  const ty = nation.territory.y;
  for (let i = 0; i < tx.length; i++) {
    const dist = Math.abs(tx[i] - point.x) + Math.abs(ty[i] - point.y);
    if (dist <= maxDistance) return true;
  }
  return false;
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

function buildBotNation(botId, x, y, mapData, existingNations) {
  // Generate circular starting territory (radius 5 for ~10x10 area)
  const startingRadius = 5;
  const territoryX = [];
  const territoryY = [];

  for (let dy = -startingRadius; dy <= startingRadius; dy++) {
    for (let dx = -startingRadius; dx <= startingRadius; dx++) {
      if (dx * dx + dy * dy <= startingRadius * startingRadius) {
        const tx = x + dx;
        const ty = y + dy;
        if (mapData && tx >= 0 && ty >= 0 && ty < mapData.length && tx < mapData[0].length) {
          const cell = mapData[ty][tx];
          if (cell && cell.biome !== "OCEAN") {
            // Check not already claimed
            const alreadyClaimed = (existingNations || []).some((nation) => {
              if (!nation.territory?.x) return false;
              for (let i = 0; i < nation.territory.x.length; i++) {
                if (nation.territory.x[i] === tx && nation.territory.y[i] === ty) {
                  return true;
                }
              }
              return false;
            });
            if (!alreadyClaimed) {
              territoryX.push(tx);
              territoryY.push(ty);
            }
          }
        }
      }
    }
  }

  // Fallback to just the center tile if no valid territory generated
  if (territoryX.length === 0) {
    territoryX.push(x);
    territoryY.push(y);
  }

  const initialDelta = { add: { x: [...territoryX], y: [...territoryY] }, sub: { x: [], y: [] } };
  return {
    owner: botId,
    status: "active",
    isBot: true,
    startingCell: { x, y },
    territory: { x: territoryX, y: territoryY },
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
  };
}

async function spawnBotsForRoom(roomId, mapData, desiredCount) {
  const count = Math.max(0, Number(desiredCount || 0));
  if (!count) return;
  console.log(`[BOTS] spawnBotsForRoom room=${roomId} desired=${count}`);

  const gameRoom = await getAuthoritativeRoom(roomId);
  if (!gameRoom) {
    console.warn(`[BOTS] room not found ${roomId}`);
    return;
  }
  if ((gameRoom.gameState?.nations || []).length === 0) {
    console.log(`[BOTS] deferring spawn; no players have founded yet`);
    return;
  }

  const nations = gameRoom.gameState?.nations || [];
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
    const allExistingNations = nations.concat(created);
    const start = findBotStartCell(mapData, allExistingNations);
    if (!start) {
      console.warn(`[BOTS] no valid start found for ${botId}`);
      break;
    }
    existingNames.add(botId);
    created.push(buildBotNation(botId, start.x, start.y, mapData, allExistingNations));
    console.log(
      `[BOTS] queued ${botId} at (${start.x},${start.y}) room=${roomId}`
    );
  }

  if (created.length > 0) {
    gameRoom.gameState.nations.push(...created);
    await persistRoomMutation(gameRoom, roomId, ["gameState.nations"]);

    // Sync matrix with newly added bot territories
    gameLoop.syncMatrixFromNations(roomId.toString(), gameRoom.gameState.nations);

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
      allowRefound,
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
      gameState: {
        nations: [],
        resourceUpgrades: {},
        resourceNodeClaims: {},
        bots: { count: botCount || 0 },
        settings: {
          allowRefound: parseBoolean(allowRefound, DEFAULT_ALLOW_REFOUND),
        },
      },
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
        let mapData = await runMapGenerationWorker({
          width: w,
          height: h,
          erosion_passes: erosionPasses,
          num_blobs: numBlobs,
          seed: mapSeed,
        });
        mapData = assignResourcesToMap(mapData, mapSeed);
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
        // Refresh in-memory cache so the loop doesn't see stale status
        await gameLoop.refreshRoomCache(gameRoom._id);
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
    const gameRoom = await getAuthoritativeRoom(req.params.id);
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
      allowRefound,
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
        settings: {
          allowRefound: parseBoolean(allowRefound, DEFAULT_ALLOW_REFOUND),
        },
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
      .select("roomName joinCode map createdAt tickCount gameState.settings.allowRefound")
      .populate("map", "name width height");
    const payload = gameRooms.map((room) => {
      const allowRefound =
        room.gameState?.settings?.allowRefound ?? DEFAULT_ALLOW_REFOUND;
      return {
        ...room.toObject(),
        allowRefound,
      };
    });
    res.json(payload);
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
    const roomAllowRefound =
      gameRoom.gameState?.settings?.allowRefound;
    const mergedConfig = {
      ...config,
      territorial: {
        ...(config?.territorial || {}),
        allowRefound:
          roomAllowRefound !== undefined ? roomAllowRefound : DEFAULT_ALLOW_REFOUND,
      },
    };
    res.json({ map: gameRoom.map, config: mergedConfig });
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
        const rawResources = cell.resourceNode?.type
          ? [cell.resourceNode.type]
          : Array.isArray(cell.resources)
          ? cell.resources
          : [];
        const resources = rawResources
          .map((r) => (typeof r === "string" ? r : REVERSE_RESOURCES[r]))
          .filter(Boolean);
        return [
          cell.elevation,
          cell.moisture,
          cell.temperature,
          BIOMES[cell.biome] || 0,
          cell.isRiver ? 1 : 0,
          resources,
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

    if (process.env.DEBUG_RESOURCES === "true" && start === 0) {
      const counts = {};
      for (const row of optimizedChunk) {
        for (const cell of row) {
          const resources = Array.isArray(cell[5]) ? cell[5] : [];
          resources.forEach((r) => {
            const name = typeof r === "string" ? r : REVERSE_RESOURCES[r] ?? r;
            counts[name] = (counts[name] || 0) + 1;
          });
        }
      }
      console.log(`[RESOURCES] room=${req.params.id} counts`, counts);
    }

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
    await gameLoop.stopRoom(req.params.id.toString());
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
    const gameRoom = await getAuthoritativeRoom(req.params.id);
    if (!gameRoom) {
      return res.status(404).json({ error: "Game room not found" });
    }

    // Verify player credentials
    if (!hasValidPlayerCredentials(gameRoom, userId, password)) {
      return res.status(403).json({ error: "Invalid credentials" });
    }
    touchRoom(gameRoom._id.toString());

    await gameLoop.withRoomMutationLock(req.params.id, async () => {
      gameRoom.players = (gameRoom.players || []).filter(
        (player) => player.userId !== userId
      );
      if (Array.isArray(gameRoom.gameState?.nations)) {
        gameRoom.gameState.nations = gameRoom.gameState.nations.filter(
          (nation) => nation.owner !== userId
        );
      }

      // Clear the quitting player's territory from the matrix
      gameLoop.syncMatrixFromNations(req.params.id.toString(), gameRoom.gameState.nations);

      await persistRoomMutation(gameRoom, req.params.id, [
        "players",
        "gameState.nations",
      ]);
      broadcastRoomUpdate(req.params.id.toString(), gameRoom);
    });

    res.json({
      message: "Successfully quit the match",
      remainingPlayers: gameRoom.players.length,
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
    const gameRoom = await getAuthoritativeRoom(req.params.id);
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
      await persistRoomMutation(gameRoom, req.params.id, ["players"]);
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

    const gameRoom = await getAuthoritativeRoom(req.params.id);
    if (!gameRoom) {
      return res.status(404).json({ error: "Game room not found" });
    }

    const player = gameRoom.players.find(
      (p) => p.userId === userId && p.password === password
    );
    if (!player) {
      return res.status(403).json({ error: "Invalid credentials" });
    }
    touchRoom(gameRoom._id.toString());

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
    const { userId, password, x: rawX, y: rawY } = req.body;

    // Validate coordinates are integers
    const x = Number(rawX);
    const y = Number(rawY);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
      return res.status(400).json({ error: "Invalid founding coordinates" });
    }

    console.log("[FOUND] Attempt:", { userId, x, y });

    // 1. Load current state
    const gameRoom = await getAuthoritativeRoom(req.params.id);
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
    touchRoom(gameRoom._id.toString());

    // Initialize gameState if needed
    if (!gameRoom.gameState) {
      gameRoom.gameState = { nations: [] };
    }

    const allowRefound =
      gameRoom.gameState?.settings?.allowRefound ?? DEFAULT_ALLOW_REFOUND;
    const hasDefeatedNation = (gameRoom.gameState.nations || []).some(
      (nation) => nation.owner === userId && nation.status === "defeated"
    );
    if (!allowRefound && hasDefeatedNation) {
      return res.status(403).json({
        error: "Refounding is disabled in this game. You may spectate only.",
        code: "REFOUND_DISABLED",
      });
    }

    // 3. Check for existing nation
    const existingNations = (gameRoom.gameState.nations || []).filter(
      (nation) => nation.owner !== userId || nation.status !== "defeated"
    );

    if (existingNations.some((n) => n.owner === userId)) {
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
    const isOccupied = existingNations.some((nation) => {
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
    const tooClose = existingNations.some((nation) => {
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

    // 4. Create new nation with starting territory (10x10 circle, radius ~5)
    const startingRadius = 5;
    const territoryX = [];
    const territoryY = [];

    // Generate circular starting territory
    for (let dy = -startingRadius; dy <= startingRadius; dy++) {
      for (let dx = -startingRadius; dx <= startingRadius; dx++) {
        // Use circular distance check
        if (dx * dx + dy * dy <= startingRadius * startingRadius) {
          const tx = x + dx;
          const ty = y + dy;
          // Check bounds and terrain
          if (tx >= 0 && ty >= 0 && tx < mapData[0].length && ty < mapData.length) {
            const cell = mapData[ty][tx];
            if (cell && cell.biome !== "OCEAN") {
              // Check not already claimed by another nation
              const alreadyClaimed = existingNations.some((nation) => {
                if (!nation.territory?.x) return false;
                for (let i = 0; i < nation.territory.x.length; i++) {
                  if (nation.territory.x[i] === tx && nation.territory.y[i] === ty) {
                    return true;
                  }
                }
                return false;
              });
              if (!alreadyClaimed) {
                territoryX.push(tx);
                territoryY.push(ty);
              }
            }
          }
        }
      }
    }

    const initialDelta = { add: { x: [...territoryX], y: [...territoryY] }, sub: { x: [], y: [] } };
    const newNation = {
      owner: userId,
      status: "active",
      startingCell: { x, y },
      territory: { x: territoryX, y: territoryY },
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
    };

    let founded = false;
    await gameLoop.withRoomMutationLock(req.params.id, async () => {
      // Re-check from latest in-memory state while lock is held.
      const lockedRoom = await getAuthoritativeRoom(req.params.id);
      if (!lockedRoom) {
        throw new Error("Game room not found during locked mutation");
      }

      const lockedNations = (lockedRoom.gameState?.nations || []).filter(
        (nation) => nation.owner !== userId || nation.status !== "defeated"
      );
      if (lockedNations.some((n) => n.owner === userId)) {
        return;
      }

      lockedRoom.gameState.nations = lockedNations.concat(newNation);
      founded = true;
      await persistRoomMutation(lockedRoom, req.params.id, ["gameState.nations"]);

      // Sync matrix with the new nation's territory
      gameLoop.syncMatrixFromNations(req.params.id.toString(), lockedRoom.gameState.nations);

      const mapDataAfterFound = await gameLoop.getMapData(req.params.id);
      if (mapDataAfterFound) {
        await spawnBotsForRoom(
          req.params.id,
          mapDataAfterFound,
          lockedRoom.gameState?.bots?.count || 0
        );
      }
      broadcastRoomUpdate(req.params.id.toString(), lockedRoom);
    });
    if (!founded) {
      return res
        .status(400)
        .json({ error: "Nation already exists for this user" });
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
// POST /api/gamerooms/:id/buildCity - Build a new city/structure for a nation
// Supports: town, tower, and resource structures (farm, mine, etc.)
// -------------------------------------------------------------------
router.post("/:id/buildCity", async (req, res, next) => {
  console.log("[ROUTE] Build structure request:", req.body);
  try {
    const { userId, password, x, y, cityType, cityName } = req.body;
    if (!userId || !password || x == null || y == null || !cityType) {
      return res
        .status(400)
        .json({ error: "userId, password, x, y, and cityType are required" });
    }
    const gameRoom = await getAuthoritativeRoom(req.params.id);
    if (!gameRoom)
      return res.status(404).json({ error: "Game room not found" });
    if (!hasValidPlayerCredentials(gameRoom, userId, password)) {
      return res.status(403).json({ error: "Invalid credentials" });
    }
    touchRoom(gameRoom._id.toString());

    // Find the player's nation.
    const nation = gameRoom.gameState?.nations?.find((n) => n.owner === userId);
    if (!nation)
      return res.status(404).json({ error: "Nation not found for this user" });

    // Check that the new structure's cell is within the nation's territory.
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

    // For towns, ensure no city exists within 5 cells (Manhattan distance).
    if (cityType === "town") {
      const tooClose = nation.cities?.some(
        (city) =>
          (city.type === "town" || city.type === "capital") &&
          Math.abs(city.x - x) + Math.abs(city.y - y) < 5
      );
      if (tooClose) {
        return res.status(400).json({
          error: "Cannot build town within 5 cells of an existing town or capital",
        });
      }
    }

    // For towers, check they're not too close to other towers
    if (cityType === "tower") {
      const tooClose = nation.cities?.some(
        (city) =>
          city.type === "tower" &&
          Math.abs(city.x - x) + Math.abs(city.y - y) < 3
      );
      if (tooClose) {
        return res.status(400).json({
          error: "Cannot build tower within 3 cells of another tower",
        });
      }
    }

    // Check if there's already a structure on this tile
    const existingStructure = nation.cities?.some(
      (city) => city.x === x && city.y === y
    );
    if (existingStructure) {
      return res.status(400).json({
        error: "A structure already exists on this tile",
      });
    }

    /* ---------------------------------------------
       Resource Structure Placement Checks
       ---------------------------------------------
       Only allow resource structures (i.e. types other than capital, town, tower, fort)
       to be built on a tile that has the required resource.
    */
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

      const required = resourceStructureMapping[cityType];
      let validResource = false;
      if (Array.isArray(required)) {
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
    }

    // Get build cost from config.
    const CITY_BUILD_COSTS = config.buildCosts.structures;
    const cost = CITY_BUILD_COSTS[cityType];
    if (!cost)
      return res.status(400).json({ error: "Invalid structure type specified" });

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
        .json({ error: "Insufficient resources to build this structure" });

    // Deduct the resource costs.
    for (const resource in cost) {
      nation.resources[resource] = (nation.resources[resource] || 0) - cost[resource];
    }

    // Generate name for the structure
    const existingNames = new Set(nation.cities?.map((c) => c.name) || []);
    let generatedName;
    if (cityType === "tower") {
      generatedName = cityName || generateUniqueName(generateTowerName, existingNames);
    } else if (cityType === "town") {
      generatedName = cityName || generateUniqueName(generateCityName, existingNames);
    } else {
      generatedName = cityName || `${cityType.charAt(0).toUpperCase() + cityType.slice(1)} ${nation.cities.length + 1}`;
    }

    console.log(`[BUILD] ${cityType} "${generatedName}" at (${x},${y}) for ${userId}`);

    // Create the new structure.
    const newCity = {
      name: generatedName,
      x,
      y,
      population: cityType === "tower" ? 0 : 50,
      type: cityType,
      resource: producedResource,
    };
    nation.cities.push(newCity);

    await persistRoomMutation(gameRoom, req.params.id, ["gameState.nations"]);
    broadcastRoomUpdate(req.params.id.toString(), gameRoom);

    res.status(201).json({ message: "Structure built successfully", city: newCity });
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
// POST /api/gamerooms/:id/pressure - DEPRECATED
// Pressure orders have been replaced by the arrow system
// -------------------------------------------------------------------
router.post("/:id/pressure", async (req, res) => {
  return res.status(410).json({
    error: "Pressure orders have been removed. Use the arrow system instead.",
  });
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/upgradeNode - DEPRECATED
// Resource node upgrades have been removed from the game
// -------------------------------------------------------------------
router.post("/:id/upgradeNode", async (req, res) => {
  return res.status(410).json({
    error: "Resource node upgrades have been removed.",
  });
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/arrow - Send an attack or defend arrow command
// Big Arrow system: troops follow a drawn path as a broad front
// -------------------------------------------------------------------
router.post("/:id/arrow", async (req, res, next) => {
  try {
    const { userId, password, type, path, percent } = req.body;
    if (!userId || !password || !type || !path || !Array.isArray(path)) {
      return res.status(400).json({
        error: "userId, password, type (attack/defend), and path array are required",
      });
    }

    if (type !== "attack" && type !== "defend") {
      return res.status(400).json({
        error: "type must be either 'attack' or 'defend'",
      });
    }

    if (path.length < 2) {
      return res.status(400).json({
        error: "Arrow path must have at least 2 points",
      });
    }

    const gameRoom = await getAuthoritativeRoom(req.params.id);
    if (!gameRoom)
      return res.status(404).json({ error: "Game room not found" });
    if (!hasValidPlayerCredentials(gameRoom, userId, password)) {
      return res.status(403).json({ error: "Invalid credentials" });
    }
    touchRoom(gameRoom._id.toString());

    const nation = gameRoom.gameState?.nations?.find((n) => n.owner === userId);
    if (!nation)
      return res.status(404).json({ error: "Nation not found for this user" });

    const sanitizedPath = path.map((point) => ({
      x: Number(point?.x),
      y: Number(point?.y),
    }));
    const hasInvalidPoint = sanitizedPath.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)
    );
    if (hasInvalidPoint) {
      return res.status(400).json({
        error: "Arrow path contains invalid coordinates",
      });
    }

    // Validate all path points are within map bounds
    const arrowMapData = await gameLoop.getMapData(req.params.id);
    if (arrowMapData) {
      const mapH = arrowMapData.length;
      const mapW = arrowMapData[0]?.length || 0;
      const hasOutOfBounds = sanitizedPath.some(
        (p) => p.x < 0 || p.y < 0 || p.x >= mapW || p.y >= mapH
      );
      if (hasOutOfBounds) {
        return res.status(400).json({
          error: "Arrow path contains out-of-bounds coordinates",
        });
      }
    }

    if (!isPointNearTerritory(nation, sanitizedPath[0], 3)) {
      return res.status(400).json({
        error: "Arrow must start on or near your territory",
      });
    }

    // Initialize arrowOrders if not present
    if (!nation.arrowOrders) {
      nation.arrowOrders = {};
    }

    // For attack arrows: enforce multi-arrow limits and range
    if (type === "attack") {
      // Migrate legacy format
      if (nation.arrowOrders.attack && !nation.arrowOrders.attacks) {
        nation.arrowOrders.attacks = [nation.arrowOrders.attack];
        delete nation.arrowOrders.attack;
      }
      if (!nation.arrowOrders.attacks) nation.arrowOrders.attacks = [];

      const maxAttackArrows = config?.territorial?.maxAttackArrows ?? 3;
      if (nation.arrowOrders.attacks.length >= maxAttackArrows) {
        return res.status(400).json({
          error: `Maximum ${maxAttackArrows} attack arrows allowed`,
        });
      }

      // Validate arrow range
      const pathLen = computePathLength(sanitizedPath);
      const maxRange = computeMaxArrowRange(nation);
      if (pathLen > maxRange) {
        return res.status(400).json({
          error: `Arrow path too long (${Math.round(pathLen)} tiles). Max range: ${Math.round(maxRange)} tiles`,
        });
      }
    }

    // For defend arrows: still single
    if (type === "defend" && nation.arrowOrders.defend) {
      // Return old defend arrow power
      nation.population = (nation.population || 0) + (nation.arrowOrders.defend.remainingPower || 0);
      delete nation.arrowOrders.defend;
    }

    // Calculate power commitment
    const minPercent = config?.territorial?.minAttackPercent || 0.05;
    const maxPercent = config?.territorial?.maxAttackPercent || 1;
    const rawPercent = Number(percent ?? config?.territorial?.defaultAttackPercent ?? 0.25);
    if (!Number.isFinite(rawPercent)) {
      return res.status(400).json({ error: "Invalid attack percent" });
    }
    const clampedPercent = Math.min(Math.max(rawPercent, minPercent), maxPercent);

    const available = nation.population || 0;
    const power = available * clampedPercent;
    if (power <= 0) {
      return res.status(400).json({ error: "Not enough population to commit" });
    }

    // Deduct population
    nation.population = Math.max(0, available - power);

    const arrowId = new mongoose.Types.ObjectId().toString();

    if (type === "attack") {
      nation.arrowOrders.attacks.push({
        id: arrowId,
        type: "attack",
        path: sanitizedPath,
        currentIndex: 1,
        remainingPower: power,
        initialPower: power,
        percent: clampedPercent,
        createdAt: new Date(),
        frontWidth: 0,
        advanceProgress: 0,
        phase: 1,
        phaseConsolidationRemaining: 0,
        status: "advancing",
        opposingForces: [],
        headX: sanitizedPath[0].x,
        headY: sanitizedPath[0].y,
      });
    } else {
      nation.arrowOrders.defend = {
        id: arrowId,
        type: "defend",
        path: sanitizedPath,
        currentIndex: 0,
        remainingPower: power,
        initialPower: power,
        percent: clampedPercent,
        createdAt: new Date(),
      };
    }

    // H5 diagnostic: always log player arrow creation
    console.log(
      `[H5-ARROW-CREATED] PLAYER ${userId} ${type}: id=${arrowId} power=${power.toFixed(0)} pathLen=${sanitizedPath.length} target=(${sanitizedPath[sanitizedPath.length-1]?.x},${sanitizedPath[sanitizedPath.length-1]?.y}) attacks[]=${nation.arrowOrders.attacks?.length || 0}`
    );

    await persistRoomMutation(gameRoom, req.params.id, ["gameState.nations"]);
    broadcastRoomUpdate(req.params.id.toString(), gameRoom);

    res.json({
      message: `${type} arrow order sent`,
      arrowId,
      percent: clampedPercent,
      pathLength: path.length,
    });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/clearArrow - Clear an active arrow command
// Supports arrowId for specific arrow removal, or type for backward compat
// -------------------------------------------------------------------
router.post("/:id/clearArrow", async (req, res, next) => {
  try {
    const { userId, password, type, arrowId } = req.body;
    if (!userId || !password) {
      return res.status(400).json({
        error: "userId and password are required",
      });
    }

    const gameRoom = await getAuthoritativeRoom(req.params.id);
    if (!gameRoom)
      return res.status(404).json({ error: "Game room not found" });
    if (!hasValidPlayerCredentials(gameRoom, userId, password)) {
      return res.status(403).json({ error: "Invalid credentials" });
    }
    touchRoom(gameRoom._id.toString());

    const nation = gameRoom.gameState?.nations?.find((n) => n.owner === userId);
    if (!nation)
      return res.status(404).json({ error: "Nation not found for this user" });

    if (type === "defend") {
      if (nation.arrowOrders?.defend) {
        nation.population = (nation.population || 0) + (nation.arrowOrders.defend.remainingPower || 0);
        delete nation.arrowOrders.defend;
      }
    } else if (arrowId && nation.arrowOrders?.attacks) {
      // Remove specific attack arrow by id
      const idx = nation.arrowOrders.attacks.findIndex(a => a.id === arrowId);
      if (idx !== -1) {
        nation.population = (nation.population || 0) + (nation.arrowOrders.attacks[idx].remainingPower || 0);
        nation.arrowOrders.attacks.splice(idx, 1);
      }
    } else if (type === "attack") {
      // Clear all attack arrows (backward compat)
      if (nation.arrowOrders?.attacks) {
        for (const a of nation.arrowOrders.attacks) {
          nation.population = (nation.population || 0) + (a.remainingPower || 0);
        }
        nation.arrowOrders.attacks = [];
      }
      // Also handle legacy single attack
      if (nation.arrowOrders?.attack) {
        nation.population = (nation.population || 0) + (nation.arrowOrders.attack.remainingPower || 0);
        delete nation.arrowOrders.attack;
      }
    }

    await persistRoomMutation(gameRoom, req.params.id, ["gameState.nations"]);
    broadcastRoomUpdate(req.params.id.toString(), gameRoom);

    res.json({ message: "Arrow cleared" });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/reinforceArrow - Add troops to active arrow
// -------------------------------------------------------------------
router.post("/:id/reinforceArrow", async (req, res, next) => {
  try {
    const { userId, password, arrowId, percent } = req.body;
    if (!userId || !password || !arrowId) {
      return res.status(400).json({
        error: "userId, password, and arrowId are required",
      });
    }

    const gameRoom = await getAuthoritativeRoom(req.params.id);
    if (!gameRoom)
      return res.status(404).json({ error: "Game room not found" });
    if (!hasValidPlayerCredentials(gameRoom, userId, password)) {
      return res.status(403).json({ error: "Invalid credentials" });
    }
    touchRoom(gameRoom._id.toString());

    const nation = gameRoom.gameState?.nations?.find((n) => n.owner === userId);
    if (!nation)
      return res.status(404).json({ error: "Nation not found for this user" });

    const arrow = nation.arrowOrders?.attacks?.find(a => a.id === arrowId);
    if (!arrow) {
      return res.status(404).json({ error: "Arrow not found" });
    }

    const minPercent = config?.territorial?.reinforceMinPercent ?? 0.05;
    const maxPercent = config?.territorial?.reinforceMaxPercent ?? 0.5;
    const rawPercent = Number(percent ?? 0.1);
    const clampedPercent = Math.min(Math.max(rawPercent, minPercent), maxPercent);

    const available = nation.population || 0;
    const reinforcement = available * clampedPercent;
    if (reinforcement <= 0) {
      return res.status(400).json({ error: "Not enough population to reinforce" });
    }

    nation.population = Math.max(0, available - reinforcement);
    arrow.remainingPower = (arrow.remainingPower || 0) + reinforcement;

    await persistRoomMutation(gameRoom, req.params.id, ["gameState.nations"]);
    broadcastRoomUpdate(req.params.id.toString(), gameRoom);

    res.json({
      message: "Arrow reinforced",
      reinforcement: Math.round(reinforcement),
      newPower: Math.round(arrow.remainingPower),
    });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/retreatArrow - Set arrow to retreating status
// -------------------------------------------------------------------
router.post("/:id/retreatArrow", async (req, res, next) => {
  try {
    const { userId, password, arrowId } = req.body;
    if (!userId || !password || !arrowId) {
      return res.status(400).json({
        error: "userId, password, and arrowId are required",
      });
    }

    const gameRoom = await getAuthoritativeRoom(req.params.id);
    if (!gameRoom)
      return res.status(404).json({ error: "Game room not found" });
    if (!hasValidPlayerCredentials(gameRoom, userId, password)) {
      return res.status(403).json({ error: "Invalid credentials" });
    }
    touchRoom(gameRoom._id.toString());

    const nation = gameRoom.gameState?.nations?.find((n) => n.owner === userId);
    if (!nation)
      return res.status(404).json({ error: "Nation not found for this user" });

    const arrow = nation.arrowOrders?.attacks?.find(a => a.id === arrowId);
    if (!arrow) {
      return res.status(404).json({ error: "Arrow not found" });
    }

    arrow.status = "retreating";

    await persistRoomMutation(gameRoom, req.params.id, ["gameState.nations"]);
    broadcastRoomUpdate(req.params.id.toString(), gameRoom);

    res.json({ message: "Arrow retreating" });
  } catch (error) {
    next(error);
  }
});

export default router;
