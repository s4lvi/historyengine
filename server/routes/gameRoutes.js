// gameRoutes.js
import express from "express";
import mongoose from "mongoose";
import { Worker } from "worker_threads";
import { gameLoop } from "../services/gameLoop.js";
import config from "../config/config.js";
import { LOYALTY } from "../utils/loyaltySystem.js";
import { gameStateManager } from "../services/GameStateManager.js";

const router = express.Router();

import GameRoom from "../models/GameRoom.js";

function runMapGenerationWorker(workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../services/mapWorker.js", import.meta.url),
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

// POST /api/gamerooms/init
router.post("/init", async (req, res, next) => {
  try {
    const {
      roomName,
      joinCode,
      creatorName,
      creatorPassword,
      width,
      height,
      erosion_passes = 4,
      num_blobs = 3,
      seed = Math.random(),
    } = req.body;

    // Input validation
    if (!width || !height || width <= 0 || height <= 0) {
      return res
        .status(400)
        .json({ error: "Valid width and height are required" });
    }

    // Generate join code if not provided
    const generatedJoinCode =
      joinCode || Math.random().toString(36).substring(2, 8).toUpperCase();

    // Create minimal game room record in MongoDB
    const gameRoom = new GameRoom({
      roomName: roomName || "Game Room",
      joinCode: generatedJoinCode,
      status: "initializing",
      creator: { userId: creatorName, password: creatorPassword },
      players: [{ userId: creatorName, password: creatorPassword }],
      width,
      height,
    });
    await gameRoom.save();

    // Initialize in-memory game state
    gameStateManager.addRoom(gameRoom._id.toString(), {
      tickCount: 0,
      lastActivity: Date.now(),
      width,
      height,
      gameState: {
        nations: [],
        players: [{ userId: creatorName, password: creatorPassword }],
        creator: { userId: creatorName, password: creatorPassword },
      },
    });

    // Respond immediately with room details
    res.status(201).json({
      gameRoomId: gameRoom._id,
      joinCode: generatedJoinCode,
    });

    // Generate map asynchronously
    (async () => {
      try {
        // Generate map data
        const mapData = await runMapGenerationWorker({
          width,
          height,
          erosion_passes,
          num_blobs,
          seed,
        });

        // Store map data in memory
        gameStateManager.setMapData(gameRoom._id.toString(), mapData);

        // Update game room status
        await GameRoom.findByIdAndUpdate(gameRoom._id, { status: "open" });

        // Start game loop
        await gameLoop.startRoom(gameRoom._id.toString());

        console.log(`Game room ${gameRoom._id} initialized successfully`);
      } catch (error) {
        console.error("Error in map generation:", error);
        await GameRoom.findByIdAndUpdate(gameRoom._id, { status: "error" });
        gameStateManager.removeRoom(gameRoom._id.toString());
      }
    })();
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------------
// Get game room status
// -------------------------------------------------------------------
router.get("/:id/status", async (req, res, next) => {
  try {
    const gameRoom = await GameRoom.findById(req.params.id).lean();
    if (!gameRoom) {
      return res.status(404).json({ error: "Game room not found" });
    }

    const gameState = gameStateManager.getRoom(req.params.id);
    if (!gameState) {
      return res.status(404).json({ error: "Game state not found" });
    }

    res.json({
      gameRoomStatus: gameRoom.status,
      width: gameState.width,
      height: gameState.height,
      ready: gameRoom.status === "open",
    });
  } catch (error) {
    next(error);
  }
});

/* =========================================================================
   LOBBY ENDPOINTS
   ========================================================================= */

// Create a new lobby. A newly created game room starts in "lobby" mode.
router.post("/", async (req, res, next) => {
  try {
    const {
      roomName,
      joinCode,
      creatorName,
      creatorPassword,
      // Lobby settings can include: mapSize, width, height, erosion_passes, num_blobs, maxPlayers
      lobby: lobbySettings = {},
    } = req.body;

    if (!creatorName || !creatorPassword) {
      return res
        .status(400)
        .json({ error: "Creator credentials are required" });
    }

    // Generate a join code if not provided.
    const generatedJoinCode =
      joinCode || Math.random().toString(36).substring(2, 8).toUpperCase();

    const gameRoom = new GameRoom({
      roomName: roomName || "Game Room",
      joinCode: generatedJoinCode,
      status: "lobby", // start in the lobby phase
      creator: { userId: creatorName, password: creatorPassword },
      players: [{ userId: creatorName, password: creatorPassword }],
      // Store base dimensions in the root as well as inside lobby settings.
      width: lobbySettings.width || 150,
      height: lobbySettings.height || 150,
      lobby: {
        mapSize: lobbySettings.mapSize || "Normal",
        width: lobbySettings.width || 150,
        height: lobbySettings.height || 150,
        erosion_passes: lobbySettings.erosion_passes || 3,
        num_blobs: lobbySettings.num_blobs || 9,
        maxPlayers: lobbySettings.maxPlayers || 4,
      },
    });

    await gameRoom.save();

    res.status(201).json({
      lobbyId: gameRoom._id,
      joinCode: generatedJoinCode,
    });
  } catch (error) {
    next(error);
  }
});

// List available lobbies (rooms in "lobby" status)
router.get("/", async (req, res, next) => {
  try {
    const gameRooms = await GameRoom.find({ status: "lobby" })
      .select("roomName creator players createdAt lobby")
      .lean();

    const enhancedRooms = gameRooms.map((room) => ({
      _id: room._id,
      roomName: room.roomName,
      creator: room.creator,
      players: room.players || [],
      createdAt: room.createdAt,
      lobby: room.lobby,
      playerCount: room.players?.length || 0,
      status: room.status,
    }));

    res.json(enhancedRooms);
  } catch (error) {
    next(error);
  }
});

// GET /api/gamerooms/:id - Retrieve full lobby details
router.get("/:id", async (req, res, next) => {
  try {
    const gameRoom = await GameRoom.findById(req.params.id)
      .select("roomName joinCode status players lobby createdAt")
      .lean();
    if (!gameRoom) {
      return res.status(404).json({ error: "Lobby not found" });
    }
    res.json(gameRoom);
  } catch (error) {
    next(error);
  }
});

// Join a lobby. Checks that the room is still in lobby mode and that it isn’t full.
router.post("/:id/join", async (req, res, next) => {
  try {
    const { joinCode, userName, password } = req.body;
    if (!userName || !password) {
      return res
        .status(400)
        .json({ error: "userName and password are required" });
    }

    const gameRoom = await GameRoom.findById(req.params.id);
    if (!gameRoom) {
      return res.status(404).json({ error: "Lobby not found" });
    }

    // Ensure the room is still waiting in the lobby.
    if (gameRoom.status !== "lobby") {
      return res.status(400).json({ error: "Game has already started" });
    }

    if (gameRoom.joinCode !== joinCode) {
      return res.status(403).json({ error: "Invalid join code" });
    }

    if (gameRoom.players.length >= gameRoom.lobby.maxPlayers) {
      return res.status(400).json({ error: "Lobby is full" });
    }

    let player = gameRoom.players.find((p) => p.userId === userName);
    if (player) {
      if (player.password !== password) {
        return res
          .status(403)
          .json({ error: "Invalid password for existing user" });
      }
      res.json({
        message: "Rejoined lobby successfully",
        userId: player.userId,
        lobby: gameRoom.lobby,
      });
    } else {
      player = { userId: userName, password };
      gameRoom.players.push(player);
      await gameRoom.save();

      res.json({
        message: "Joined lobby successfully",
        userId: player.userId,
        lobby: gameRoom.lobby,
      });
    }
  } catch (error) {
    next(error);
  }
});

// Update lobby settings. Only the lobby creator can change settings.
router.put("/:id/settings", async (req, res, next) => {
  try {
    const { userName, password, lobby: lobbySettings } = req.body;
    if (!userName || !password || !lobbySettings) {
      return res
        .status(400)
        .json({ error: "userName, password, and lobby settings are required" });
    }

    const gameRoom = await GameRoom.findById(req.params.id);
    if (!gameRoom) {
      return res.status(404).json({ error: "Lobby not found" });
    }

    if (
      gameRoom.creator.userId !== userName ||
      gameRoom.creator.password !== password
    ) {
      return res
        .status(403)
        .json({ error: "Only the lobby creator can update settings" });
    }

    // Merge the existing lobby settings with the new ones.
    gameRoom.lobby = { ...gameRoom.lobby, ...lobbySettings };

    // If the dimensions have changed, update the top-level width/height.
    if (lobbySettings.width) gameRoom.width = lobbySettings.width;
    if (lobbySettings.height) gameRoom.height = lobbySettings.height;

    await gameRoom.save();
    res.json({ message: "Lobby settings updated", lobby: gameRoom.lobby });
  } catch (error) {
    next(error);
  }
});

// Start the game from the lobby. Only the creator may trigger this.
router.post("/:id/start", async (req, res, next) => {
  try {
    const { userName, password } = req.body;
    const gameRoom = await GameRoom.findById(req.params.id);
    if (!gameRoom) {
      return res.status(404).json({ error: "Lobby not found" });
    }
    if (
      gameRoom.creator.userId !== userName ||
      gameRoom.creator.password !== password
    ) {
      return res
        .status(403)
        .json({ error: "Only the lobby creator can start the game" });
    }

    // Initialize game state first
    gameStateManager.addRoom(gameRoom._id.toString(), {
      tickCount: 0,
      lastActivity: Date.now(),
      width: gameRoom.width,
      height: gameRoom.height,
      gameState: {
        roomName: gameRoom.roomName,
        nations: [],
        players: gameRoom.players,
        creator: gameRoom.creator,
      },
    });

    // Generate map with lobby settings
    const lobbySettings = gameRoom.lobby;
    const mapData = await runMapGenerationWorker({
      width: lobbySettings.width,
      height: lobbySettings.height,
      erosion_passes: lobbySettings.erosion_passes,
      num_blobs: lobbySettings.num_blobs,
      seed: Math.random(),
    });

    // Save map data to game state manager
    gameStateManager.setMapData(gameRoom._id.toString(), mapData);

    // Start game loop only after map is generated and stored
    await gameLoop.startRoom(gameRoom._id.toString());

    // Update room status last
    gameRoom.status = "in-progress";
    await gameRoom.save();

    console.log(`Game room ${gameRoom._id} started successfully`);

    res.json({
      message: "Game started successfully",
      gameRoomId: gameRoom._id,
      players: gameRoom.players,
    });
  } catch (error) {
    // If anything fails, clean up
    try {
      await gameLoop.stopRoom(req.params.id);
      gameStateManager.removeRoom(req.params.id);
    } catch (cleanupError) {
      console.error("Error during cleanup:", cleanupError);
    }
    next(error);
  }
});

// -------------------------------------------------------------------
// Get game room metadata
// -------------------------------------------------------------------
router.get("/:id/metadata", async (req, res, next) => {
  try {
    // Get metadata from both MongoDB and memory
    const gameRoom = await GameRoom.findById(req.params.id)
      .select("width height status lobby") // Added lobby to selection
      .lean();

    if (!gameRoom) {
      return res.status(404).json({ error: "Game room not found" });
    }

    // Get game state for additional data
    const state = gameStateManager.getRoom(req.params.id);
    if (!state) {
      return res.status(404).json({ error: "Game state not found" });
    }

    // Always include width and height, either from game room or lobby settings
    const width = gameRoom.width || gameRoom.lobby?.width || state.width;
    const height = gameRoom.height || gameRoom.lobby?.height || state.height;

    res.json({
      map: {
        width,
        height,
        status: gameRoom.status,
      },
      config,
    });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------------
// Get map data chunks
// -------------------------------------------------------------------
router.get("/:id/data", async (req, res, next) => {
  try {
    const { startRow, endRow } = req.query;
    const start = parseInt(startRow, 10) || 0;
    const end = parseInt(endRow, 10) || start + 50;

    // Get map data from memory
    const mapData = gameStateManager.getMapData(req.params.id);
    if (!mapData) {
      return res.status(404).json({ error: "Map data not found" });
    }

    // Get the requested chunk
    const chunk = mapData.slice(start, Math.min(end, mapData.length));

    // Define the enums (these should match your client-side expectations)
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

    const RESOURCES = {
      food: 0,
      wood: 1,
      stone: 2,
      bronze: 3,
      steel: 4,
      horses: 5,
    };

    // Convert chunk to the optimized format the client expects
    const optimizedChunk = chunk.map((row) =>
      row.map((cell) => [
        cell.elevation,
        cell.moisture,
        cell.temperature,
        BIOMES[cell.biome] || 0,
        cell.isRiver ? 1 : 0,
        Array.isArray(cell.resources) ? cell.resources : [],
      ])
    );

    // Send response
    res.json({
      totalRows: mapData.length,
      startRow: start,
      endRow: Math.min(end, mapData.length),
      chunk: optimizedChunk,
      mappings:
        start === 0
          ? {
              biomes: Object.fromEntries(
                Object.entries(BIOMES).map(([k, v]) => [v, k])
              ),
              resources: Object.fromEntries(
                Object.entries(RESOURCES).map(([k, v]) => [v, k])
              ),
            }
          : undefined,
    });
  } catch (error) {
    console.error(`Error fetching map data:`, error);
    next(error);
  }
});

// -------------------------------------------------------------------
// Get game state
// -------------------------------------------------------------------
router.post("/:id/state", async (req, res, next) => {
  try {
    const { userId, password, full } = req.body;
    if (!userId || !password) {
      return res
        .status(400)
        .json({ error: "userId and password are required" });
    }

    // Verify credentials in MongoDB
    const gameRoom = await GameRoom.findById(req.params.id)
      .select("players creator")
      .lean();
    if (!gameRoom) {
      return res.status(404).json({ error: "Game room not found" });
    }

    const player = gameRoom.players.find(
      (p) => p.userId === userId && p.password === password
    );
    if (!player) {
      return res.status(403).json({ error: "Invalid credentials" });
    }

    // Get game state and update lastPoll time for this player
    const currentTime = Date.now();
    const gameState = gameStateManager.updateGameState(
      req.params.id,
      (state) => {
        if (!state) return null;

        // Just update lastPoll for this player
        if (state.gameState.nations) {
          const userNation = state.gameState.nations.find(
            (n) => n.owner === userId
          );
          if (userNation) {
            userNation.lastPoll = currentTime;
          }
        }

        return state;
      }
    );

    if (!gameState) {
      return res.status(404).json({ error: "Game state not found" });
    }

    // Filter nation data
    const filterNation = (nation) => {
      if (nation.status === "defeated") {
        return { owner: nation.owner, status: "defeated" };
      }

      if (full) {
        const { lastPoll, ...nationData } = nation;
        return {
          ...nationData,
          territoryLoyalty: nationData.territoryLoyalty || {},
          territoryDeltaForClient: {
            add: { x: [], y: [] },
            sub: { x: [], y: [] },
          },
          cachedBorderSet: null,
        };
      }

      const { territory, territoryLoyalty, lastPoll, ...rest } = nation;
      return {
        ...rest,
        territoryDeltaForClient: nation.territoryDeltaForClient || {
          add: { x: [], y: [] },
          sub: { x: [], y: [] },
        },
        cachedBorderSet: null,
      };
    };

    const filteredGameState = {
      ...gameState.gameState,
      players: gameState.gameState.players.map((p) => ({
        userId: p.userId,
      })),
      creator: {
        userId: gameState.gameState.creator.userId,
      },
      nations: (gameState.gameState.nations || []).map(filterNation),
      cachedBorderSet: null,
    };

    res.json({
      tickCount: gameState.tickCount,
      roomName: gameRoom.roomName,
      roomCreator: gameRoom.creator.userId,
      gameState: filteredGameState,
    });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------------
// Found a nation
// -------------------------------------------------------------------
router.post("/:id/foundNation", async (req, res, next) => {
  try {
    const { userId, password, x, y } = req.body;

    // Verify credentials in MongoDB
    const gameRoom = await GameRoom.findById(req.params.id)
      .select("players")
      .lean();
    if (!gameRoom) {
      return res.status(404).json({ error: "Game room not found" });
    }

    const player = gameRoom.players.find(
      (p) => p.userId === userId && p.password === password
    );
    if (!player) {
      return res.status(403).json({ error: "Invalid credentials" });
    }

    // Get and update game state in memory
    const updated = gameStateManager.updateGameState(req.params.id, (state) => {
      if (!state.gameState.nations) {
        state.gameState.nations = [];
      }

      // Filter out defeated nations
      state.gameState.nations = state.gameState.nations.filter(
        (nation) => nation.owner !== userId || nation.status !== "defeated"
      );

      // Check for existing nation
      if (state.gameState.nations.some((n) => n.owner === userId)) {
        throw new Error("Nation already exists for this user");
      }

      // Create new nation
      const newNation = {
        owner: userId,
        status: "active",
        startingCell: { x, y },
        territory: { x: [x], y: [y] },
        territoryLoyalty: { [`${x},${y}`]: LOYALTY.INITIAL },
        population: 100,
        nationalWill: 50,
        resources: {
          food: 1000,
          wood: 500,
          stone: 300,
          bronze: 0,
          steel: 0,
          horses: 0,
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
        expansionTarget: null,
        attackTarget: null,
      };

      state.gameState.nations.push(newNation);
      return state;
    });

    if (!updated) {
      return res.status(400).json({ error: "Failed to update game state" });
    }

    res.status(201).json({
      message: "Nation founded successfully",
      nation: updated.gameState.nations.find((n) => n.owner === userId),
    });
  } catch (error) {
    if (error.message === "Nation already exists for this user") {
      return res.status(400).json({ error: error.message });
    }
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
    if (!gameRoom) {
      return res.status(404).json({ error: "Game room not found" });
    }

    if (
      !gameRoom.creator ||
      gameRoom.creator.userId !== userName ||
      gameRoom.creator.password !== password
    ) {
      return res
        .status(403)
        .json({ error: "Invalid room creator credentials" });
    }

    // Stop game loop and remove from memory
    await gameLoop.stopRoom(gameRoom._id.toString());
    gameStateManager.removeRoom(gameRoom._id.toString());

    // Remove from database
    await GameRoom.findByIdAndDelete(req.params.id);

    res.json({ message: "Game room deleted successfully" });
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
    if (!gameRoom) {
      return res.status(404).json({ error: "Game room not found" });
    }

    // Stop game loop and remove from memory
    await gameLoop.stopRoom(gameRoom._id.toString());
    gameStateManager.removeRoom(gameRoom._id.toString());

    // Remove from database
    await GameRoom.findByIdAndDelete(req.params.id);

    res.json({ message: "Game session ended successfully" });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/pause - Pause a game session
// -------------------------------------------------------------------
router.post("/:id/pause", async (req, res, next) => {
  try {
    const gameRoom = await GameRoom.findById(req.params.id);
    if (!gameRoom) {
      return res.status(404).json({ error: "Game room not found" });
    }

    // Pause game loop
    await gameLoop.pauseRoom(gameRoom._id.toString());

    // Update status in database
    await GameRoom.findByIdAndUpdate(req.params.id, { status: "paused" });

    res.json({ message: "Game session paused successfully" });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/unpause - Unpause a game session
// -------------------------------------------------------------------
router.post("/:id/unpause", async (req, res, next) => {
  try {
    const gameRoom = await GameRoom.findById(req.params.id);
    if (!gameRoom) {
      return res.status(404).json({ error: "Game room not found" });
    }

    // Resume game loop
    await gameLoop.startRoom(gameRoom._id.toString());

    // Update status in database
    await GameRoom.findByIdAndUpdate(req.params.id, { status: "open" });

    res.json({ message: "Game session unpaused successfully" });
  } catch (error) {
    next(error);
  }
});

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

    // Verify credentials in MongoDB
    const gameRoom = await GameRoom.findById(req.params.id);
    if (!gameRoom) {
      return res.status(404).json({ error: "Game room not found" });
    }

    const player = gameRoom.players.find(
      (p) => p.userId === userId && p.password === password
    );
    if (!player) {
      return res.status(403).json({ error: "Invalid credentials" });
    }

    // Update game state in memory
    const updated = gameStateManager.updateGameState(req.params.id, (state) => {
      if (!state.gameState.nations) return state;

      // Remove the nation
      state.gameState.nations = state.gameState.nations.filter(
        (nation) => nation.owner !== userId
      );

      state.gameState.players = state.gameState.players.filter(
        (p) => p.userId !== userId
      );

      // Update remaining players count
      state.gameState.remainingPlayers = state.gameState.nations.length;
      state.gameState.nations.forEach((nation) => {
        delete nation.cachedBorderSet;
      });
      return state;
    });

    if (!updated) {
      return res.status(400).json({ error: "Failed to update game state" });
    }

    res.json({
      message: "Successfully quit the match",
      remainingPlayers: updated.gameState.remainingPlayers,
    });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/buildCity - Build a new city for a nation
// -------------------------------------------------------------------
router.post("/:id/buildCity", async (req, res, next) => {
  try {
    const { userId, password, x, y, cityType, cityName } = req.body;
    if (!userId || !password || x == null || y == null || !cityType) {
      return res.status(400).json({
        error: "userId, password, x, y, and cityType are required",
      });
    }

    // Verify credentials in MongoDB
    const gameRoom = await GameRoom.findById(req.params.id)
      .select("players")
      .lean();
    if (!gameRoom) {
      return res.status(404).json({ error: "Game room not found" });
    }

    const player = gameRoom.players.find(
      (p) => p.userId === userId && p.password === password
    );
    if (!player) {
      return res.status(403).json({ error: "Invalid credentials" });
    }

    // Update game state in memory
    const updated = gameStateManager.updateGameState(req.params.id, (state) => {
      const mapData = gameStateManager.getMapData(req.params.id);
      const nation = state.gameState.nations.find((n) => n.owner === userId);

      if (!nation) {
        throw new Error("Nation not found for this user");
      }

      // Check territory ownership
      const inTerritory = nation.territory.x.some(
        (tx, i) => tx === x && nation.territory.y[i] === y
      );
      if (!inTerritory) {
        throw new Error("Selected cell is not within your territory");
      }

      // Check city distance
      const tooClose = nation.cities?.some(
        (city) => Math.abs(city.x - x) + Math.abs(city.y - y) < 5
      );
      if (
        (tooClose && cityType === "town") ||
        cityType === "capital" ||
        cityType === "fort"
      ) {
        throw new Error("Cannot build city within 5 cells of an existing city");
      }

      // Check resource requirements
      const resourceStructureMapping = {
        farm: "food",
        "lumber mill": "wood",
        mine: ["stone", "bronze", "steel"],
        stable: "horses",
      };

      let producedResource = null;
      if (resourceStructureMapping[cityType]) {
        const cell = mapData[y]?.[x];
        if (!cell) {
          throw new Error("Invalid map cell");
        }

        const required = resourceStructureMapping[cityType];
        const validResource = Array.isArray(required)
          ? cell.resources.some((r) => required.includes(r))
          : cell.resources.includes(required);

        if (!validResource) {
          throw new Error(
            `Cannot build ${cityType} on this tile. Required resource not found.`
          );
        }

        producedResource = cell.resources[0];

        const alreadyBuilt = nation.cities?.some(
          (city) =>
            city.x === x && city.y === y && resourceStructureMapping[city.type]
        );
        if (alreadyBuilt) {
          throw new Error("A resource structure is already built on this tile");
        }
      }

      // Check build costs
      const cost = config.buildCosts.structures[cityType];
      if (!cost) {
        throw new Error("Invalid city type specified");
      }

      for (const resource in cost) {
        if ((nation.resources[resource] || 0) < cost[resource]) {
          throw new Error("Insufficient resources to build this city");
        }
      }

      // Deduct resources
      for (const resource in cost) {
        nation.resources[resource] -= cost[resource];
      }

      // Create new city
      const newCity = {
        name:
          cityName ||
          `${cityType.charAt(0).toUpperCase() + cityType.slice(1)} ${
            nation.cities.length + 1
          }`,
        x,
        y,
        population: 50,
        type: cityType,
        resource: producedResource,
      };

      if (!nation.cities) nation.cities = [];
      nation.cities.push(newCity);

      return state;
    });

    if (!updated) {
      return res.status(400).json({ error: "Failed to update game state" });
    }

    const nation = updated.gameState.nations.find((n) => n.owner === userId);
    const newCity = nation.cities[nation.cities.length - 1];

    res.status(201).json({
      message: "City built successfully",
      city: newCity,
    });
  } catch (error) {
    if (
      error.message.includes("Cannot build") ||
      error.message.includes("Insufficient") ||
      error.message.includes("Invalid") ||
      error.message.includes("within")
    ) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/raiseArmy - Raise an army
// -------------------------------------------------------------------
router.post("/:id/raiseArmy", async (req, res, next) => {
  try {
    const { userId, password, type } = req.body;
    if (!userId || !password || !type) {
      return res.status(400).json({
        error: "userId, password, and type are required",
      });
    }

    // Verify credentials in MongoDB
    const gameRoom = await GameRoom.findById(req.params.id)
      .select("players")
      .lean();
    if (!gameRoom) {
      return res.status(404).json({ error: "Game room not found" });
    }

    const player = gameRoom.players.find(
      (p) => p.userId === userId && p.password === password
    );
    if (!player) {
      return res.status(403).json({ error: "Invalid credentials" });
    }

    // Update game state in memory
    const updated = gameStateManager.updateGameState(req.params.id, (state) => {
      const nation = state.gameState.nations.find((n) => n.owner === userId);
      if (!nation) {
        throw new Error("Nation not found for this user");
      }

      // Validate army type and stats
      const armyStats = config.armies.stats[type];
      if (!armyStats) {
        throw new Error(`Army type '${type}' is not supported`);
      }

      // Check resource costs
      const armyCost = config.buildCosts.armies[type];
      for (const resource in armyCost) {
        const requiredAmount = armyCost[resource];
        if ((nation.resources[resource] || 0) < requiredAmount) {
          throw new Error(
            `Insufficient ${resource} to raise army of type '${type}'`
          );
        }
      }

      // Deduct costs
      for (const resource in armyCost) {
        nation.resources[resource] -= armyCost[resource];
      }

      // Determine starting position
      let startPos = null;
      if (nation.cities?.length > 0) {
        const capital =
          nation.cities.find((city) => city.type === "capital") ||
          nation.cities[0];
        startPos = { x: capital.x, y: capital.y };
      } else if (nation.startingCell) {
        startPos = { ...nation.startingCell };
      } else {
        throw new Error("No valid starting position for the army");
      }

      // Create new army
      const newArmy = {
        id: new mongoose.Types.ObjectId().toString(),
        type,
        speed: armyStats.speed,
        power: armyStats.power,
        position: startPos,
        attackTarget: null,
      };

      // Add to nation's armies
      if (!nation.armies) {
        nation.armies = [];
      }
      nation.armies.push(newArmy);

      return state;
    });

    if (!updated) {
      return res.status(400).json({ error: "Failed to update game state" });
    }

    const nation = updated.gameState.nations.find((n) => n.owner === userId);
    const newArmy = nation.armies[nation.armies.length - 1];

    res.status(201).json({
      message: "Army raised successfully",
      army: newArmy,
    });
  } catch (error) {
    if (
      error.message.includes("Insufficient") ||
      error.message.includes("Not enough") ||
      error.message.includes("No valid") ||
      error.message.includes("not supported")
    ) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/setAttackTarget - Set army attack target
// -------------------------------------------------------------------
router.post("/:id/setAttackTarget", async (req, res, next) => {
  try {
    const { userId, password, armyId, target } = req.body;
    if (!userId || !password || !armyId || !target) {
      return res.status(400).json({
        error:
          "userId, password, armyId, and target (with x and y) are required",
      });
    }

    // Verify coordinates
    if (target.x == null || target.y == null) {
      return res.status(400).json({
        error: "Invalid target coordinates provided",
      });
    }

    // Verify credentials in MongoDB
    const gameRoom = await GameRoom.findById(req.params.id)
      .select("players")
      .lean();
    if (!gameRoom) {
      return res.status(404).json({ error: "Game room not found" });
    }

    const player = gameRoom.players.find(
      (p) => p.userId === userId && p.password === password
    );
    if (!player) {
      return res.status(403).json({ error: "Invalid credentials" });
    }

    // Update game state in memory
    const updated = gameStateManager.updateGameState(req.params.id, (state) => {
      const nation = state.gameState.nations.find((n) => n.owner === userId);
      if (!nation) {
        throw new Error("Nation not found for this user");
      }

      if (!nation.armies || nation.armies.length === 0) {
        throw new Error("No armies found for this nation");
      }

      const army = nation.armies.find(
        (a) => a.id.toString() === armyId.toString()
      );
      if (!army) {
        throw new Error("Army not found");
      }

      // Set attack target
      army.attackTarget = {
        current: { ...army.position },
        final: { x: target.x, y: target.y },
      };

      return state;
    });

    if (!updated) {
      return res.status(400).json({ error: "Failed to update game state" });
    }

    const nation = updated.gameState.nations.find((n) => n.owner === userId);
    const army = nation.armies.find(
      (a) => a.id.toString() === armyId.toString()
    );

    res.json({
      message: "Attack target set successfully",
      army,
    });
  } catch (error) {
    if (
      error.message === "Nation not found for this user" ||
      error.message === "No armies found for this nation" ||
      error.message === "Army not found"
    ) {
      return res.status(404).json({ error: error.message });
    }
    next(error);
  }
});

export default router;
