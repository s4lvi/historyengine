// gameWorkerManager.js
import { Worker } from "worker_threads";
import mongoose from "mongoose";

class GameWorkerManager {
  constructor() {
    this.workers = new Map();
    this.latestStates = new Map();
    this.updateInterval = 5000;
    this.updateIntervals = new Map();
    this.workerStarting = new Map();
    this.workerLocks = new Map(); // Add locks for worker operations
  }

  async acquireLock(roomId) {
    while (this.workerLocks.get(roomId)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    this.workerLocks.set(roomId, true);
  }

  releaseLock(roomId) {
    this.workerLocks.delete(roomId);
  }

  async loadMapData(mapId) {
    console.log("Loading map data for:", mapId);
    const MapChunk = mongoose.model("MapChunk");
    const chunks = await MapChunk.find({ map: mapId })
      .sort({ startRow: 1 })
      .lean();

    let mapData = [];
    for (const chunk of chunks) {
      chunk.rows.forEach((row, index) => {
        mapData[chunk.startRow + index] = row;
      });
    }
    return mapData;
  }

  async ensureWorkerExists(roomId) {
    await this.acquireLock(roomId);
    try {
      // If worker is currently starting, wait for it
      if (this.workerStarting.get(roomId)) {
        console.log(`Waiting for worker ${roomId} to start...`);
        while (this.workerStarting.get(roomId)) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      // Check if worker exists and is running
      const worker = this.workers.get(roomId);
      if (!worker) {
        console.log(`Worker missing for room ${roomId}, recreating...`);
        const GameRoom = mongoose.model("GameRoom");
        const gameRoom = await GameRoom.findById(roomId).lean();
        if (gameRoom) {
          await this.startWorker(roomId, gameRoom);
          return true;
        }
        return false;
      }

      return true;
    } finally {
      this.releaseLock(roomId);
    }
  }

  async startWorker(roomId, gameRoom) {
    await this.acquireLock(roomId);

    try {
      console.log(`Starting worker for room ${roomId}`);
      this.workerStarting.set(roomId, true);

      // Stop any existing worker
      await this.stopWorker(roomId);

      const mapData = await this.loadMapData(gameRoom.map);

      // Get fresh state from database
      const GameRoom = mongoose.model("GameRoom");
      const freshGameRoom = await GameRoom.findById(roomId).lean();

      const initialState = {
        gameState: freshGameRoom.gameState || { nations: [] },
        tickCount: freshGameRoom.tickCount || 0,
        mapData: mapData,
      };

      console.log(
        "Creating worker with initial state:",
        JSON.stringify(initialState, null, 2)
      );

      const worker = new Worker(new URL("./gameWorker.js", import.meta.url), {
        workerData: initialState,
      });

      // Store initial state
      this.latestStates.set(roomId, {
        gameState: initialState.gameState,
        tickCount: initialState.tickCount,
      });

      worker.on("message", async (result) => {
        if (
          result &&
          result.gameState &&
          Array.isArray(result.gameState.nations)
        ) {
          await this.acquireLock(roomId);
          try {
            const currentState = this.latestStates.get(roomId);
            const currentNations = currentState?.gameState?.nations || [];

            // Only update if new state has more information
            if (result.gameState.nations.length >= currentNations.length) {
              console.log(
                `Updating state for room ${roomId} with ${result.gameState.nations.length} nations`
              );
              this.latestStates.set(roomId, result);
            }
          } finally {
            this.releaseLock(roomId);
          }
        }
      });

      worker.on("error", async (error) => {
        console.error(`Error in worker for room ${roomId}:`, error);
        this.workerStarting.delete(roomId);
        await this.stopWorker(roomId);
      });

      worker.on("exit", async (code) => {
        console.log(`Worker for room ${roomId} exited with code ${code}`);
        this.workerStarting.delete(roomId);
        await this.stopWorker(roomId);
      });

      this.workers.set(roomId, worker);
      this.startPeriodicUpdates(roomId);
    } finally {
      this.workerStarting.delete(roomId);
      this.releaseLock(roomId);
    }
  }

  async updateWorkerState(roomId, newState) {
    await this.acquireLock(roomId);

    try {
      console.log(
        `Updating worker state for room ${roomId}:`,
        JSON.stringify(newState, null, 2)
      );

      // Ensure worker exists
      const workerExists = await this.ensureWorkerExists(roomId);
      if (!workerExists) {
        console.error(`Could not recreate worker for room ${roomId}`);
        return;
      }

      const worker = this.workers.get(roomId);
      if (worker) {
        // Get current state with fresh database query
        const GameRoom = mongoose.model("GameRoom");
        const currentRoom = await GameRoom.findById(roomId).lean();
        const currentState = this.latestStates.get(roomId) || {
          gameState: currentRoom?.gameState || { nations: [] },
        };

        // Merge states, preserving all nations
        const currentNations = currentState.gameState?.nations || [];
        const newNations = newState.gameState?.nations || [];

        // Combine nations, avoiding duplicates
        const allNations = [...currentNations];
        newNations.forEach((newNation) => {
          const existingIndex = allNations.findIndex(
            (n) => n.owner === newNation.owner
          );
          if (existingIndex === -1) {
            allNations.push(newNation);
          }
        });

        const updatedState = {
          gameState: {
            ...currentState.gameState,
            ...newState.gameState,
            nations: allNations,
          },
          tickCount: newState.tickCount || currentState.tickCount || 0,
        };

        // Update state immediately
        this.latestStates.set(roomId, updatedState);

        // Send to worker
        worker.postMessage({
          type: "UPDATE_STATE",
          ...updatedState,
        });

        // Save to database
        await GameRoom.findByIdAndUpdate(roomId, {
          $set: {
            gameState: updatedState.gameState,
            tickCount: updatedState.tickCount,
          },
        });
      }
    } finally {
      this.releaseLock(roomId);
    }
  }

  getLatestState(roomId) {
    const state = this.latestStates.get(roomId);
    if (!state) return null;

    return {
      gameState: state.gameState || { nations: [] },
      tickCount: state.tickCount || 0,
    };
  }
}

export const gameWorkerManager = new GameWorkerManager();
