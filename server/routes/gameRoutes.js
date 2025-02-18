// gameRoutes.js
import express from "express";
import mongoose from "mongoose";
import { gameLoop } from "../workers/gameLoop.js";
import { setExpansionTarget } from "../utils/gameLogic.js";
import config from "../config/config.js";
import { LOYALTY } from "../utils/loyaltySystem.js";

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

    // Define the resources enum
    const RESOURCES = {
      food: 0,
      wood: 1,
      stone: 2,
      bronze: 3,
      steel: 4,
      horses: 5,
    };

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
    const gameRoom = await GameRoom.findById(req.params.id);
    if (!gameRoom)
      return res.status(404).json({ error: "Game room not found" });

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
    await GameRoom.findByIdAndUpdate(req.params.id, { status: "open" });
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

    // Remove the nation and player in a single update operation
    const result = await GameRoom.findOneAndUpdate(
      { _id: req.params.id },
      {
        // Pull the nation from the nations array where owner matches userId
        $pull: {
          "gameState.nations": { owner: userId },
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
      res.json({
        message: "Rejoined game room successfully",
        userId: player.userId,
        config: config,
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

    // Modified filterNation to handle loyalty and defeated status
    const filterNation = (nation) => {
      // If nation is defeated, only send minimal info
      if (nation.status === "defeated") {
        return {
          owner: nation.owner,
          status: "defeated",
        };
      }

      if (full) {
        // When full is true, return the complete nation data including territory and loyalty
        return {
          ...nation,
          territoryLoyalty: nation.territoryLoyalty || {},
          // Clear the delta since we're sending full data
          territoryDeltaForClient: {
            add: { x: [], y: [] },
            sub: { x: [], y: [] },
          },
          cachedBorderSet: null,
        };
      } else {
        // When not full, remove full territory and send only delta
        const { territory, territoryLoyalty, ...rest } = nation;

        // For the owner of the nation, include loyalty data for their territory
        const shouldIncludeLoyalty = false; //nation.owner === userId;

        return {
          ...rest,
          cachedBorderSet: null,
          territoryDeltaForClient: nation.territoryDeltaForClient || {
            add: { x: [], y: [] },
            sub: { x: [], y: [] },
          },
          // Only include loyalty data if this is the nation owner
          ...(shouldIncludeLoyalty
            ? { territoryLoyalty: nation.territoryLoyalty || {} }
            : {}),
        };
      }
    };

    const filteredGameState = {
      ...gameRoom.gameState,
      nations: (gameRoom.gameState.nations || []).map(filterNation),
    };

    res.json({
      tickCount: gameRoom.tickCount,
      roomName: gameRoom.roomName,
      roomCreator: gameRoom.creator.userId,
      gameState: filteredGameState,
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

    // 4. Create new nation
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

    // 5. Save directly to DB
    await GameRoom.findByIdAndUpdate(req.params.id, {
      $push: { "gameState.nations": newNation },
    });

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
    await GameRoom.findOneAndUpdate(
      {
        _id: req.params.id,
        "gameState.nations.owner": userId,
      },
      {
        $push: { "gameState.nations.$.cities": newCity },
        $set: { "gameState.nations.$.resources": nation.resources },
      }
    );

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

    // Retrieve the map and its chunks to build the map data array
    const MapModel = mongoose.model("Map");
    const map = await MapModel.findById(gameRoom.map).lean();
    if (!map)
      return res
        .status(404)
        .json({ error: "Map not found for this game room" });

    const MapChunk = mongoose.model("MapChunk");
    const chunks = await MapChunk.find({ map: map._id }).lean();

    // Build the mapData 2D array from the chunks.
    // (Assumes that map.height and map.width are defined)
    const mapData = Array.from({ length: map.height }, () =>
      new Array(map.width).fill(null)
    );
    for (const chunk of chunks) {
      const startRow = chunk.startRow;
      chunk.rows.forEach((row, index) => {
        // Place each row at the correct global row index.
        mapData[startRow + index] = row;
      });
    }

    // Now pass mapData as the third argument.
    const result = setExpansionTarget(nation, target, mapData);
    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }

    // Save updated game state.
    await GameRoom.findOneAndUpdate(
      {
        _id: req.params.id,
        "gameState.nations.owner": userId,
      },
      {
        $set: { "gameState.nations.$.expansionTarget": nation.expansionTarget },
      }
    );

    res.json({
      message: "Expansion target set successfully",
      expansionTarget: nation.expansionTarget,
    });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/raiseArmy - Raise an army by recruiting men.
// -------------------------------------------------------------------
router.post("/:id/raiseArmy", async (req, res, next) => {
  try {
    const { userId, password, type } = req.body;
    if (!userId || !password || !type) {
      return res
        .status(400)
        .json({ error: "userId, password, and type are required" });
    }

    const gameRoom = await GameRoom.findById(req.params.id);
    if (!gameRoom)
      return res.status(404).json({ error: "Game room not found" });

    // Find the player's nation
    const nation = gameRoom.gameState?.nations?.find((n) => n.owner === userId);
    if (!nation)
      return res.status(404).json({ error: "Nation not found for this user" });

    // Retrieve the army stats from config using the provided type.
    const armyStats = config.armies.stats[type];
    if (!armyStats) {
      return res
        .status(400)
        .json({ error: `Army type '${type}' is not supported` });
    }

    // Check if the nation has enough population.
    // Use armyStats.populationCost if provided, otherwise default to 1000.
    const requiredPopulation = armyStats.populationCost || 1000;
    if (nation.population < requiredPopulation) {
      return res.status(400).json({
        error: `Not enough population to raise an army of type '${type}'. Required population: ${requiredPopulation}`,
      });
    }

    // Check if the nation has enough resources.
    // armyStats.cost is expected to be an object like { gold: 2, iron: 1 }
    const armyCost = config.buildCosts.armies[type];
    for (const resource in armyCost) {
      const requiredAmount = armyCost[resource];
      if ((nation.resources[resource] || 0) < requiredAmount) {
        return res.status(400).json({
          error: `Insufficient ${resource} to raise army of type '${type}'`,
        });
      }
    }

    // Deduct the resource costs and subtract the required population from the nation.
    for (const resource in armyCost) {
      const requiredAmount = armyCost[resource];
      nation.resources[resource] -= requiredAmount;
    }
    nation.population -= requiredPopulation;

    // Determine the starting position for the army.
    let startPos = null;
    if (nation.cities && nation.cities.length > 0) {
      const capital =
        nation.cities.find((city) => city.type === "capital") ||
        nation.cities[0];
      startPos = { x: capital.x, y: capital.y };
    } else if (nation.startingCell) {
      startPos = { ...nation.startingCell };
    } else {
      return res
        .status(400)
        .json({ error: "No valid starting position for the army" });
    }

    // Create the new army object using the stats from the config.
    const newArmy = {
      id: new mongoose.Types.ObjectId().toString(), // unique identifier for the army
      type,
      speed: armyStats.speed,
      power: armyStats.power,
      position: startPos,
      attackTarget: null, // will be set later via setAttackTarget
    };

    // Ensure the nation has an armies array, then add the new army.
    if (!nation.armies) {
      nation.armies = [];
    }
    nation.armies.push(newArmy);

    // Mark gameState as modified and update the worker state.
    await GameRoom.findOneAndUpdate(
      {
        _id: req.params.id,
        "gameState.nations.owner": userId,
      },
      {
        $push: { "gameState.nations.$.armies": newArmy },
        $set: {
          "gameState.nations.$.resources": nation.resources,
          "gameState.nations.$.population": nation.population,
        },
      }
    );

    res.status(201).json({
      message: "Army raised successfully",
      army: newArmy,
    });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------------
// POST /api/gamerooms/:id/setAttackTarget - Set an attack target for a specific army.
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
    const gameRoom = await GameRoom.findById(req.params.id);
    if (!gameRoom)
      return res.status(404).json({ error: "Game room not found" });

    // Find the player's nation
    const nation = gameRoom.gameState?.nations?.find((n) => n.owner === userId);
    if (!nation)
      return res.status(404).json({ error: "Nation not found for this user" });

    // Ensure that the nation has armies and find the specific army by its id.
    if (!nation.armies || nation.armies.length === 0) {
      return res.status(400).json({ error: "No armies found for this nation" });
    }
    // Compare army ids as strings.
    const army = nation.armies.find(
      (a) => a.id.toString() === armyId.toString()
    );
    if (!army) {
      return res.status(404).json({ error: "Army not found" });
    }
    if (target.x == null || target.y == null) {
      return res
        .status(400)
        .json({ error: "Invalid target coordinates provided" });
    }

    // Set the attack target on the army.
    // Store both the current position and the final target.
    army.attackTarget = {
      current: { ...army.position },
      final: { x: target.x, y: target.y },
      // You can add extra fields here (e.g., movement speed, etc.) if needed.
    };

    await GameRoom.findOneAndUpdate(
      {
        _id: req.params.id,
        "gameState.nations.owner": userId,
        "gameState.nations.armies.id": armyId,
      },
      {
        $set: {
          "gameState.nations.$[nation].armies.$[army].attackTarget":
            army.attackTarget,
        },
      },
      {
        arrayFilters: [{ "nation.owner": userId }, { "army.id": armyId }],
      }
    );

    res.json({
      message: "Attack target set successfully",
      army,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
