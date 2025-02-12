// gameRoutes.js
import express from "express";
import mongoose from "mongoose";

const router = express.Router();

// -------------------------------------------------------------------
// GameRoom Model (unchanged)
// -------------------------------------------------------------------
const gameRoomSchema = new mongoose.Schema({
  map: { type: mongoose.Schema.Types.ObjectId, ref: "Map", required: true },
  roomName: { type: String, default: "Game Room" },
  joinCode: { type: String, required: true },
  status: { type: String, enum: ["open", "ended"], default: "open" },
  creator: {
    userId: { type: String, required: true },
    password: { type: String, required: true },
  },
  players: [
    {
      userId: { type: String, required: true },
      password: { type: String, required: true },
      userState: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
  ],
  gameState: { type: mongoose.Schema.Types.Mixed, default: {} },
  tickCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});
const GameRoom = mongoose.model("GameRoom", gameRoomSchema);

// -------------------------------------------------------------------
// POST /api/gamerooms - Create a game room with its own copy of the map
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

    // Retrieve the original map (assumes Map model is registered)
    const Map = mongoose.model("Map");
    const originalMap = await Map.findById(mapId).lean();
    if (!originalMap)
      return res.status(404).json({ error: "Original map not found" });

    // Create a copy of the original map
    const mapCopyData = {
      name: "Room:" + creatorName,
      width: originalMap.width,
      height: originalMap.height,
    };
    const gameMap = new Map(mapCopyData);
    await gameMap.save();

    // Copy associated map chunks
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

    // Generate a join code if not provided
    const generatedJoinCode =
      joinCode || Math.random().toString(36).substring(2, 8).toUpperCase();

    // Create the game room with empty game state
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
        nations: [], // Nations will be added when players use the foundNation endpoint
      },
      tickCount: 0,
    });

    await gameRoom.save();

    res.status(201).json(gameRoom);
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------------
// (Other endpoints remain unchanged)
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

    // Verify that the provided credentials match the room creator’s credentials.
    if (
      !gameRoom.creator ||
      gameRoom.creator.userId !== userName ||
      gameRoom.creator.password !== password
    ) {
      return res
        .status(403)
        .json({ error: "Invalid room creator credentials" });
    }

    // Remove the associated map and its map chunks.
    const MapModel = mongoose.model("Map");
    const MapChunk = mongoose.model("MapChunk");

    // Delete all map chunks for the game room's map.
    await MapChunk.deleteMany({ map: gameRoom.map });
    // Delete the map copy.
    await MapModel.findByIdAndDelete(gameRoom.map);
    // Finally, delete the game room itself.
    await GameRoom.findByIdAndDelete(req.params.id);

    res.json({
      message: "Game room and associated map data deleted successfully",
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/end", async (req, res, next) => {
  try {
    const gameRoom = await GameRoom.findById(req.params.id);
    if (!gameRoom)
      return res.status(404).json({ error: "Game room not found" });
    gameRoom.status = "ended";
    await gameRoom.save();
    res.json({ message: "Game session ended successfully" });
  } catch (error) {
    next(error);
  }
});

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

    // Look for an existing player with this name
    let player = gameRoom.players.find((p) => p.userId === userName);
    if (player) {
      // Existing player: verify the password
      if (player.password !== password) {
        return res
          .status(403)
          .json({ error: "Invalid password for existing user" });
      }
      // Return success for existing player
      res.json({
        message: "Rejoined game room successfully",
        userId: player.userId,
      });
    } else {
      // New player: add them to the players array with userName as userId
      player = {
        userId: userName, // Use userName as the userId for consistency
        password: password,
        userState: {},
      };
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

// Updated GET /api/gamerooms/:id/state endpoint
router.post("/:id/state", async (req, res, next) => {
  try {
    const { userId, password } = req.body;
    if (!userId || !password) {
      return res
        .status(400)
        .json({ error: "userId and password are required" });
    }

    // Retrieve the game room
    const gameRoom = await GameRoom.findById(req.params.id).lean();
    if (!gameRoom)
      return res.status(404).json({ error: "Game room not found" });

    // Find the player in the room's players array
    const player = gameRoom.players.find(
      (p) => p.userId === userId && p.password === password
    );
    if (!player) {
      return res.status(403).json({ error: "Invalid credentials" });
    }

    // No need to sanitize the game state since each player should see all nations
    // but we'll ensure the gameState object exists
    const gameState = gameRoom.gameState || { nations: [] };

    // Return the complete game state along with tickCount
    res.json({
      tickCount: gameRoom.tickCount,
      gameState: gameState,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/user/:userId", async (req, res, next) => {
  try {
    const gameRoom = await GameRoom.findById(req.params.id).lean();
    if (!gameRoom)
      return res.status(404).json({ error: "Game room not found" });
    const user = gameRoom.players.find((p) => p.userId === req.params.userId);
    if (!user)
      return res
        .status(404)
        .json({ error: "User not found in this game room" });
    res.json(user);
  } catch (error) {
    next(error);
  }
});

// gameRoutes.js (additional endpoint)
// In gameRoutes.js
router.post("/:id/foundNation", async (req, res, next) => {
  try {
    const { userId, password, x, y } = req.body;
    if (!userId || !password || x == null || y == null) {
      return res
        .status(400)
        .json({ error: "userId, password, x, and y are required" });
    }

    const gameRoom = await GameRoom.findById(req.params.id);
    if (!gameRoom)
      return res.status(404).json({ error: "Game room not found" });

    // Verify the player's credentials
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

    // Prevent founding more than one nation per player
    if (gameRoom.gameState.nations?.find((n) => n.owner === userId)) {
      return res
        .status(400)
        .json({ error: "Nation already founded for this user" });
    }

    // Create a new nation with all fields expected by gameLogic.js
    const newNation = {
      owner: userId,
      startingCell: { x, y },
      territory: [{ x, y }],
      population: 100,
      nationalWill: 50,
      resources: {
        "iron ore": 0,
        "precious metals": 0,
        gems: 0,
        stone: 0,
        "copper ore": 0,
        "fresh water": 0,
        fish: 0,
        "medicinal plants": 0,
        "wild fruits": 0,
        "game animals": 0,
        "arable land": 0,
        pastures: 0,
        "grazing animals": 0,
        timber: 0,
        salt: 0,
        "date palm": 0,
        "fur animals": 0,
        "fertile soil": 0,
        herbs: 0,
      },
      cities: [],
      structures: [],
    };

    // Add the nation to the game state
    gameRoom.gameState.nations.push(newNation);

    // Mark the document as modified since we're updating a nested array
    gameRoom.markModified("gameState.nations");

    await gameRoom.save();

    res.status(201).json({
      message: "Nation founded successfully",
      nation: newNation,
    });
  } catch (error) {
    next(error);
  }
});

// New endpoint: POST /api/gamerooms/:id/playerState
router.post("/:id/playerState", async (req, res, next) => {
  try {
    const { userName, password } = req.body;
    if (!userName || !password)
      return res
        .status(400)
        .json({ error: "userName and password are required" });

    // Retrieve the game room (using lean() here for read-only access)
    const gameRoom = await GameRoom.findById(req.params.id).lean();
    if (!gameRoom)
      return res.status(404).json({ error: "Game room not found" });

    // Find the matching player in the room
    const player = gameRoom.players.find((p) => p.userId === userName);
    if (!player || player.password !== password) {
      return res.status(403).json({ error: "Invalid credentials" });
    }

    // Return game state data along with the player’s own state.
    res.json({
      gameState: gameRoom.gameState,
      tickCount: gameRoom.tickCount,
      playerState: player.userState,
      // Optionally include other player-specific data (nation info, cities, etc.)
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/gamerooms/:id/metadata
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

// GET /api/gamerooms/:id/data - Retrieve only the requested map data rows
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

    // Retrieve only the chunks that overlap the requested rows using the copied map's _id
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
    // Each cell is converted into an array:
    // [ elevation, moisture, temperature, biome (number), isRiver (flag), features (array of numbers), resources (array of numbers) ]
    const optimizedChunk = rows.map((row) =>
      row.map((cell) => [
        cell.elevation, // 0: elevation (number)
        cell.moisture, // 1: moisture (number)
        cell.temperature, // 2: temperature (number)
        BIOMES[cell.biome], // 3: biome (number)
        cell.isRiver ? 1 : 0, // 4: isRiver flag (number)
        cell.features.map((f) => FEATURES[f]), // 5: features (array of numbers)
        cell.resources.map((r) => RESOURCES[r]), // 6: resources (array of numbers)
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

// Example cost to build a city:
const CITY_COST = {
  stone: 10,
  "arable land": 20,
};

router.post("/:id/buildCity", async (req, res, next) => {
  try {
    const { userId, x, y, cityName } = req.body;
    if (userId == null || x == null || y == null) {
      return res.status(400).json({ error: "userId, x, and y are required" });
    }

    // Get the game room.
    const GameRoom = mongoose.model("GameRoom");
    const gameRoom = await GameRoom.findById(req.params.id);
    if (!gameRoom)
      return res.status(404).json({ error: "Game room not found" });

    // Ensure gameState and nations array exist.
    if (!gameRoom.gameState) gameRoom.gameState = {};
    if (!gameRoom.gameState.nations) gameRoom.gameState.nations = [];

    // Find the nation owned by this user.
    const nation = gameRoom.gameState.nations.find((n) => n.owner === userId);
    if (!nation) {
      return res.status(404).json({ error: "Nation not found for this user" });
    }

    // Check if a city already exists at (x, y) or too near another city.
    // (This is a naive check; you can expand it to enforce proper distance.)
    if (
      nation.cities &&
      nation.cities.some((city) => city.x === x && city.y === y)
    ) {
      return res
        .status(400)
        .json({ error: "A city already exists at this location" });
    }

    // Check if the nation has sufficient resources.
    // (For simplicity, we assume resources are stored as key/value pairs in nation.resources.)
    nation.resources = nation.resources || {};
    for (let resource in CITY_COST) {
      if ((nation.resources[resource] || 0) < CITY_COST[resource]) {
        return res
          .status(400)
          .json({ error: `Insufficient ${resource} to build a city` });
      }
    }
    // Deduct the resource cost.
    for (let resource in CITY_COST) {
      nation.resources[resource] -= CITY_COST[resource];
    }

    // Create the city. You can add more properties as needed.
    const newCity = {
      name: cityName || "New City",
      x,
      y,
      population: 50, // starting population for a city
      // Other city-specific stats can go here.
    };

    // Initialize the cities array if needed.
    if (!nation.cities) nation.cities = [];
    nation.cities.push(newCity);

    await gameRoom.save();
    res.status(201).json({ message: "City built successfully", city: newCity });
  } catch (error) {
    next(error);
  }
});

export default router;
