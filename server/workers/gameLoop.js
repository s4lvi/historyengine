// gameLoop.js
import mongoose from "mongoose";
import { updateNation } from "../utils/gameLogic.js";
import { assignResourcesToMap } from "../utils/resourceManagement.js";

class GameLoop {
  constructor() {
    this.timers = new Map(); // roomId -> timer
    this.cachedMapData = new Map(); // roomId -> cached mapData
    this.targetTickRate = 100; // Target milliseconds between ticks
  }

  async initializeMapData(roomId) {
    console.log(`Initializing map data for room ${roomId}`);
    try {
      const GameRoom = mongoose.model("GameRoom");
      const MapModel = mongoose.model("Map");
      const MapChunk = mongoose.model("MapChunk");

      const gameRoom = await GameRoom.findById(roomId);
      if (!gameRoom) {
        console.error(`Game room ${roomId} not found during initialization`);
        return null;
      }

      const gameMap = await MapModel.findById(gameRoom.map).lean();
      if (!gameMap) {
        console.error(`Map not found for game room ${roomId}`);
        return null;
      }

      // Initialize empty map data as a proper 2D array
      let mapData = Array.from({ length: gameMap.height }, () =>
        Array.from({ length: gameMap.width }, () => null)
      );

      const chunks = await MapChunk.find({ map: gameMap._id }).lean();

      // Process chunks and ensure we maintain array structure
      chunks.forEach((chunk) => {
        const startRow = chunk.startRow;
        chunk.rows.forEach((row, rowIndex) => {
          if (startRow + rowIndex < mapData.length) {
            // Ensure row is an array
            const processedRow = Array.isArray(row)
              ? row
              : Object.keys(row)
                  .filter((key) => !isNaN(key))
                  .sort((a, b) => parseInt(a) - parseInt(b))
                  .map((key) => row[key]);

            mapData[startRow + rowIndex] = processedRow.map((cell) => ({
              ...cell,
              resources: Array.isArray(cell.resources) ? cell.resources : [],
            }));
          }
        });
      });

      // Process resources for the map
      mapData = assignResourcesToMap(mapData);

      // Verify array structure before caching
      mapData = mapData.map((row) => {
        if (!Array.isArray(row)) {
          console.warn("Converting non-array row to array");
          return Object.keys(row)
            .filter((key) => !isNaN(key))
            .sort((a, b) => parseInt(a) - parseInt(b))
            .map((key) => row[key]);
        }
        return row;
      });

      // Store in cache
      this.cachedMapData.set(roomId, mapData);
      console.log(
        `Map data cached successfully for room ${roomId}. Dimensions: ${mapData.length}x${mapData[0].length}`
      );

      return mapData;
    } catch (error) {
      console.error(`Error initializing map data for room ${roomId}:`, error);
      return null;
    }
  }

  async getMapData(roomId) {
    let mapData = this.cachedMapData.get(roomId);
    if (!mapData) {
      console.log(`Cache miss for room ${roomId}, initializing map data`);
      mapData = await this.initializeMapData(roomId);
    }
    return mapData;
  }

  async processRoom(roomId) {
    const startTime = process.hrtime();
    try {
      const GameRoom = mongoose.model("GameRoom");
      const gameRoom = await GameRoom.findById(roomId);
      if (
        !gameRoom ||
        gameRoom.status !== "open" ||
        !gameRoom?.gameState?.nations
      ) {
        return;
      }

      // Get or initialize the cached mapData
      let mapData = await this.getMapData(roomId);
      if (!mapData) {
        console.error(`Failed to get map data for room ${roomId}`);
        return;
      }

      // Process each nation using the cached mapData
      const updatedNations = gameRoom.gameState.nations.map((nation) => {
        console.log(`Updating nation ${nation.owner} in room ${roomId}`);
        return updateNation(nation, mapData, gameRoom.gameState);
      });

      gameRoom.gameState.nations = updatedNations;
      gameRoom.tickCount += 1;
      gameRoom.markModified("gameState.nations");
      await gameRoom.save();

      // Calculate processing time
      const elapsed = process.hrtime(startTime);
      const elapsedMs = elapsed[0] * 1000 + elapsed[1] / 1e6;
      console.log(`Room ${roomId} processed in ${elapsedMs.toFixed(2)} ms`);

      // Return processing time for tick rate adjustment
      return elapsedMs;
    } catch (error) {
      if (error.name === "VersionError") {
        console.warn(
          `Tick update skipped for room ${roomId} due to manual update conflict: ${error.message}`
        );
      } else {
        console.error(`Error processing room ${roomId}:`, error);
      }
      return 0; // Return 0 for error cases to maintain tick rate
    }
  }

  async startRoom(roomId) {
    if (this.timers.has(roomId)) {
      console.log(`Room ${roomId} already has an active timer`);
      return;
    }

    // Initialize map data before starting the game loop
    const mapData = await this.initializeMapData(roomId);
    if (!mapData) {
      console.error(`Failed to initialize map data for room ${roomId}`);
      return;
    }

    const tick = async () => {
      if (!this.timers.has(roomId)) return;

      const startTime = Date.now();
      const processingTime = await this.processRoom(roomId);

      if (!this.timers.has(roomId)) return;

      // Calculate the time until the next tick should occur
      const elapsedTime = Date.now() - startTime;
      const remainingTime = Math.max(0, this.targetTickRate - elapsedTime);

      // Log if we're falling behind
      if (elapsedTime > this.targetTickRate) {
        console.warn(
          `Room ${roomId} tick processing took ${elapsedTime}ms, exceeding target tick rate of ${this.targetTickRate}ms`
        );
      }

      // Schedule the next tick
      const timer = setTimeout(tick, remainingTime);
      this.timers.set(roomId, timer);
    };

    const timer = setTimeout(tick, 0);
    this.timers.set(roomId, timer);
    console.log(`Started game loop for room ${roomId}`);
  }

  stopRoom(roomId) {
    const timer = this.timers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(roomId);
      this.cachedMapData.delete(roomId);
      console.log(`Stopped game loop and cleared cache for room ${roomId}`);
    }
  }
}

export const gameLoop = new GameLoop();
