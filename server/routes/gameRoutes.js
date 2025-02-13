// gameRoutes.js
import express from "express";
import mongoose from "mongoose";
import { gameWorkerManager } from "../workers/gameWorkerManager.js";
const router = express.Router();

import GameRoom from "../models/GameRoom.js";

// -------------------------------------------------------------------
// POST /api/gamerooms - Create a game room (with a map copy)
// -------------------------------------------------------------------
router.post("/", async (req, res, next) => {
  try {
    const { mapId, roomName, joinCode, creatorName, creatorPassword } =
      req.body;
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
      },
      tickCount: 0,
    });
    await gameRoom.save();
    await gameWorkerManager.startWorker(gameRoom._id, gameRoom);
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
  try {
    const gameRoom = await GameRoom.findById(req.params.id).populate(
      "map",
      "name width height"
    );
    if (!gameRoom)
      return res.status(404).json({ error: "Game room not found" });
    res.json(gameRoom.map);
  } catch (error) {
    next(error);
  }
});

router.get("/:id/data", async (req, res, next) => {
  try {
    const { startRow, endRow } = req.query;
    const start = parseInt(startRow, 10) || 0;
    const end = parseInt(endRow, 10) || start + 50;

    // Find the game room using its id
    const gameRoom = await GameRoom.findById(req.params.id).lean();
    if (!gameRoom) {
      throw new Error("Game room not found");
    }

    // Retrieve the copied map using the map reference stored in the game room
    const MapModel = mongoose.model("Map");
    const map = await MapModel.findById(gameRoom.map).lean();
    if (!map) {
      throw new Error("Map not found for this game room");
    }

    // Retrieve only the chunks that overlap the requested rows
    const MapChunk = mongoose.model("MapChunk");
    const chunks = await MapChunk.find({
      map: map._id,
      startRow: { $lte: end },
      endRow: { $gte: start },
    })
      .sort({ startRow: 1 })
      .lean();

    // Merge and filter rows from the chunks to exactly match the requested range
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

    // Define the constants for converting cell data to the optimized format.
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

    // Convert the retrieved rows into an optimized format:
    const optimizedChunk = rows.map((row) =>
      row.map((cell) => [
        cell.elevation,
        cell.moisture,
        cell.temperature,
        BIOMES[cell.biome],
        cell.isRiver ? 1 : 0,
        cell.features.map((f) => FEATURES[f]),
        cell.resources.map((r) => RESOURCES[r]),
      ])
    );

    // Include reverse mappings (only on the first request chunk)
    const mappings =
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
        : undefined;

    res.json({
      totalRows: map.height,
      startRow: start,
      endRow: Math.min(end, map.height),
      chunk: optimizedChunk,
      mappings,
    });
  } catch (error) {
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
    await gameWorkerManager.stopWorker(req.params.id);
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
    const gameRoom = await GameRoom.findById(req.params.id);
    if (!gameRoom)
      return res.status(404).json({ error: "Game room not found" });

    // Stop the game worker so ticks stop progressing
    await gameWorkerManager.stopWorker(req.params.id);

    // Delete associated map data: MapChunks and the copied Map
    const MapModel = mongoose.model("Map");
    const MapChunk = mongoose.model("MapChunk");
    await MapChunk.deleteMany({ map: gameRoom.map });
    await MapModel.findByIdAndDelete(gameRoom.map);

    // Finally, delete the game room itself
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
    // Pause the game worker (you must implement pauseWorker in your gameWorkerManager)
    console.log("[ROUTE] Pausing game worker for room ID:", req.params.id);
    await gameWorkerManager.pauseWorker(req.params.id);

    // Optionally update the game room status to "paused"
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
    // Unpause the game worker (you must implement unpauseWorker in your gameWorkerManager)
    await gameWorkerManager.unpauseWorker(req.params.id);

    // Optionally update the game room status back to "open"
    await GameRoom.findByIdAndUpdate(req.params.id, { status: "open" });

    res.json({ message: "Game session unpaused successfully" });
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
      res.json({
        message: "Rejoined game room successfully",
        userId: player.userId,
      });
    } else {
      player = { userId: userName, password, userState: {} };
      gameRoom.players.push(player);
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
router.post("/:id/state", async (req, res, next) => {
  try {
    const { userId, password } = req.body;
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
    const latestState = gameWorkerManager.getLatestState(req.params.id);
    if (latestState) {
      return res.json({
        tickCount: latestState.tickCount,
        roomName: gameRoom.roomName,
        roomCreator: gameRoom.creator.userId,
        gameState: latestState.gameState || { nations: [] },
      });
    }
    res.json({
      tickCount: gameRoom.tickCount,
      roomName: gameRoom.roomName,
      roomCreator: gameRoom.creator.userId,
      gameState: gameRoom.gameState || { nations: [] },
    });
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
    console.log("[ROUTE] Found nation request:", { userId, x, y });
    if (!userId || !password || x == null || y == null) {
      return res
        .status(400)
        .json({ error: "userId, password, x, and y are required" });
    }
    const gameRoom = await GameRoom.findById(req.params.id);
    if (!gameRoom) {
      return res.status(404).json({ error: "Game room not found" });
    }
    const workerState = await gameWorkerManager.getLatestState(req.params.id);
    console.log(
      "[ROUTE] Current worker state:",
      JSON.stringify(workerState, null, 2)
    );
    const player = gameRoom.players.find(
      (p) => p.userId === userId && p.password === password
    );
    if (!player) {
      return res.status(403).json({ error: "Invalid credentials" });
    }
    const currentGameState = {
      nations: [],
      ...(workerState?.gameState || {}),
      ...(gameRoom.gameState || {}),
    };
    if (currentGameState.nations.find((n) => n.owner === userId)) {
      return res
        .status(400)
        .json({ error: "Nation already founded for this user" });
    }
    // Create new nation – include an auto_city setting (default false)
    const newNation = {
      owner: userId,
      startingCell: { x, y },
      territory: [{ x, y }],
      population: 100,
      nationalWill: 50,
      resources: {
        "iron ore": 0,
        "precious metals": 0,
        // … other resources as needed …
      },
      // Automatically build a capital city on the founding cell
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
      auto_city: false, // Default auto_city setting; can be updated via /playerSettings
      expansionTarget: null,
      attackTarget: null,
    };
    const updatedGameState = {
      ...currentGameState,
      nations: [...(currentGameState.nations || []), newNation],
    };
    console.log(
      "[ROUTE] Updated game state:",
      JSON.stringify(updatedGameState, null, 2)
    );
    gameRoom.gameState = updatedGameState;
    gameRoom.markModified("gameState");
    await gameRoom.save();
    await gameWorkerManager.updateWorkerState(gameRoom._id, {
      gameState: updatedGameState,
      tickCount: gameRoom.tickCount + 1,
    });
    const verifyState = await gameWorkerManager.getLatestState(gameRoom._id);
    console.log(
      "[ROUTE] Verified state after update:",
      JSON.stringify(verifyState, null, 2)
    );
    res
      .status(201)
      .json({ message: "Nation founded successfully", nation: newNation });
  } catch (error) {
    console.error("[ROUTE] Error in foundNation:", error);
    next(error);
  }
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/buildCity - Build a new city for a nation
// -------------------------------------------------------------------
router.post("/:id/buildCity", async (req, res, next) => {
  console.log("[ROUTE] Build city request:", req.body);
  try {
    const { userId, password, x, y, cityType, cityName } = req.body;
    if (!userId || !password || x == null || y == null || !cityType) {
      return res
        .status(400)
        .json({ error: "userId, password, x, y, and cityType are required" });
    }
    console.log("[ROUTE] Build city validation passed");
    const gameRoom = await GameRoom.findById(req.params.id);
    if (!gameRoom)
      return res.status(404).json({ error: "Game room not found" });

    // Find the player's nation.
    const nation = gameRoom.gameState?.nations?.find((n) => n.owner === userId);
    if (!nation)
      return res.status(404).json({ error: "Nation not found for this user" });

    // Check that the new city's cell is within the nation's territory.
    const inTerritory = nation.territory.some(
      (cell) => cell.x === x && cell.y === y
    );
    if (!inTerritory)
      return res
        .status(400)
        .json({ error: "Selected cell is not within your territory" });

    // Ensure no city exists within 5 cells (Manhattan distance).
    const tooClose = nation.cities?.some(
      (city) => Math.abs(city.x - x) + Math.abs(city.y - y) < 5
    );
    if (tooClose)
      return res.status(400).json({
        error: "Cannot build city within 5 cells of an existing city",
      });

    // Define resource costs for different city types.
    const CITY_BUILD_COSTS = {
      town: { stone: 200, "arable land": 300 },
      city: { stone: 300, "arable land": 400 },
      metropolis: { stone: 500, "arable land": 700 },
    };
    const cost = CITY_BUILD_COSTS[cityType];
    if (!cost)
      return res.status(400).json({ error: "Invalid city type specified" });

    // Check if the nation has enough resources.
    let canBuild = true;
    for (const resource in cost) {
      if ((nation.resources[resource] || 0) < cost[resource]) {
        console.log("[ROUTE] Insufficient resources:", resource);
        canBuild = false;
        break;
      }
    }
    console.log("[ROUTE] Can build:", canBuild);
    if (!canBuild)
      return res
        .status(400)
        .json({ error: "Insufficient resources to build this city" });

    // Deduct the resource costs.
    for (const resource in cost) {
      nation.resources[resource] -= cost[resource];
    }

    // Create the new city.
    const newCity = {
      name:
        cityName ||
        `${cityType.charAt(0).toUpperCase() + cityType.slice(1)} ${
          nation.cities.length + 1
        }`,
      x,
      y,
      population: 50, // starting population
      type: cityType,
    };
    nation.cities.push(newCity);

    // Save updated game state.
    gameRoom.markModified("gameState");
    await gameRoom.save();
    await gameWorkerManager.updateWorkerState(gameRoom._id, {
      gameState: gameRoom.gameState,
      tickCount: gameRoom.tickCount + 1,
    });

    res.status(201).json({ message: "City built successfully", city: newCity });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/setExpansionTarget - Set an expansion target for a nation
// -------------------------------------------------------------------
router.post("/:id/setExpansionTarget", async (req, res, next) => {
  try {
    const { userId, password, target } = req.body;
    if (
      !userId ||
      !password ||
      !target ||
      target.x == null ||
      target.y == null
    ) {
      return res.status(400).json({
        error: "userId, password, and target (with x and y) are required",
      });
    }
    const gameRoom = await GameRoom.findById(req.params.id);
    if (!gameRoom)
      return res.status(404).json({ error: "Game room not found" });

    const nation = gameRoom.gameState?.nations?.find((n) => n.owner === userId);
    if (!nation)
      return res.status(404).json({ error: "Nation not found for this user" });

    // Set the expansion target.
    nation.expansionTarget = { x: target.x, y: target.y };
    gameRoom.markModified("gameState");
    await gameRoom.save();
    await gameWorkerManager.updateWorkerState(gameRoom._id, {
      gameState: gameRoom.gameState,
      tickCount: gameRoom.tickCount + 1,
    });

    res.json({
      message: "Expansion target set successfully",
      expansionTarget: nation.expansionTarget,
    });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/setAttackTarget - Set an attack target for a nation
// -------------------------------------------------------------------
router.post("/:id/setAttackTarget", async (req, res, next) => {
  try {
    const { userId, password, target } = req.body;
    if (!userId || !password) {
      return res
        .status(400)
        .json({ error: "userId and password are required" });
    }
    const gameRoom = await GameRoom.findById(req.params.id);
    if (!gameRoom)
      return res.status(404).json({ error: "Game room not found" });

    const nation = gameRoom.gameState?.nations?.find((n) => n.owner === userId);
    if (!nation)
      return res.status(404).json({ error: "Nation not found for this user" });

    // Set the attack target (can be null or an object with x and y).
    nation.attackTarget =
      target && target.x != null && target.y != null
        ? { x: target.x, y: target.y }
        : null;
    gameRoom.markModified("gameState");
    await gameRoom.save();
    await gameWorkerManager.updateWorkerState(gameRoom._id, {
      gameState: gameRoom.gameState,
      tickCount: gameRoom.tickCount + 1,
    });

    res.json({
      message: "Attack target updated successfully",
      attackTarget: nation.attackTarget,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
