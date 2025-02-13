// gameWorkerManager.js
import { Worker } from "worker_threads";
import mongoose from "mongoose";

class GameWorkerManager {
  constructor() {
    this.workers = new Map();
    this.latestStates = new Map();
    this.updateInterval = 1000;
    this.updateIntervals = new Map();
    this.workerStarting = new Map();
    this.workerLocks = new Map(); // locks per room
    this.pausedWorkers = new Map(); // tracks paused rooms
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

  async ensureWorkerExists(roomId) {
    await this.acquireLock(roomId);
    try {
      if (this.workerStarting.get(roomId)) {
        while (this.workerStarting.get(roomId)) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      const worker = this.workers.get(roomId);
      if (!worker) {
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
      this.workerStarting.set(roomId, true);

      // Stop any existing worker.
      await this.stopWorker(roomId);

      // Load map data (assume loadMapData is defined elsewhere)
      const mapData = await this.loadMapData(gameRoom.map);

      // Build the initial state.
      const initialState = {
        roomId: roomId.toString(),
        gameState: gameRoom.gameState,
        tickCount: gameRoom.tickCount,
        mapData: mapData,
      };

      const worker = new Worker(new URL("./gameWorker.js", import.meta.url), {
        workerData: initialState,
      });

      // Save initial state in our cache.
      this.latestStates.set(roomId, {
        gameState: initialState.gameState,
        tickCount: initialState.tickCount,
      });

      worker.on("message", async (result) => {
        await this.acquireLock(roomId);
        try {
          // Retrieve the current cached state (or default to 0)
          const current = this.latestStates.get(roomId) || { tickCount: 0 };
          if (result.tickCount >= current.tickCount) {
            this.latestStates.set(roomId, result);
          }
        } finally {
          this.releaseLock(roomId);
        }
      });

      worker.on("error", async (error) => {
        console.error(`Error in worker for room ${roomId}:`, error);
        this.workerStarting.delete(roomId);
        await this.stopWorker(roomId);
      });

      worker.on("exit", async (code) => {
        this.workerStarting.delete(roomId);
        await this.stopWorker(roomId);
      });

      this.workers.set(roomId.toString(), worker);
      this.startPeriodicUpdates(roomId);
    } finally {
      this.workerStarting.delete(roomId);
      this.releaseLock(roomId);
    }
  }

  async stopWorker(roomId) {
    const worker = this.workers.get(roomId);
    if (worker) {
      const interval = this.updateIntervals.get(roomId);
      if (interval) {
        clearInterval(interval);
        this.updateIntervals.delete(roomId);
      }
      await worker.terminate();
      this.workers.delete(roomId);
    }
  }

  startPeriodicUpdates(roomId) {
    const existingInterval = this.updateIntervals.get(roomId);
    if (existingInterval) {
      clearInterval(existingInterval);
    }
    const interval = setInterval(async () => {
      try {
        const latestState = this.latestStates.get(roomId);
        if (latestState?.gameState?.nations) {
          const GameRoom = mongoose.model("GameRoom");
          const currentRoom = await GameRoom.findById(roomId).lean();
          if (
            !currentRoom?.gameState?.nations?.length ||
            latestState.gameState.nations.length > 0
          ) {
            await GameRoom.findByIdAndUpdate(
              roomId,
              {
                $set: {
                  gameState: latestState.gameState,
                  tickCount: latestState.tickCount,
                },
              },
              { new: true }
            );
          }
        }
      } catch (error) {
        console.error(`Error updating database for room ${roomId}:`, error);
      }
    }, this.updateInterval);
    this.updateIntervals.set(roomId, interval);
  }

  // Use the snapshot approach in updateWorkerState:
  async updateWorkerState(roomId, newState) {
    await this.acquireLock(roomId);
    try {
      // Ensure worker exists.
      const workerExists = await this.ensureWorkerExists(roomId);
      if (!workerExists) {
        console.error(`Could not recreate worker for room ${roomId}`);
        return;
      }

      const worker = this.workers.get(roomId);
      if (worker) {
        // Update the local state cache with the complete snapshot.
        this.latestStates.set(roomId, newState);

        // Send the complete snapshot to the worker.
        worker.postMessage({
          type: "UPDATE_STATE",
          gameState: newState.gameState,
          tickCount: newState.tickCount,
        });

        // Save to database.
        const GameRoom = mongoose.model("GameRoom");
        await GameRoom.findByIdAndUpdate(roomId, {
          $set: {
            gameState: newState.gameState,
            tickCount: newState.tickCount,
          },
        });
      }
    } catch (err) {
      console.log(err);
    } finally {
      this.releaseLock(roomId);
    }
  }

  getLatestState(roomId) {
    const state = this.latestStates.get(roomId);
    if (!state) return null;
    return {
      gameState: state.gameState,
      tickCount: state.tickCount,
    };
  }

  async loadMapData(mapId) {
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

  // -----------------------------
  // New Methods: Pause / Unpause
  // -----------------------------
  async pauseWorker(roomId) {
    const worker = this.workers.get(roomId);
    if (worker) {
      // Mark the worker as paused.
      this.pausedWorkers.set(roomId, true);
      // Send a pause command to the worker thread.
      worker.postMessage({ type: "PAUSE" });
      // Stop periodic database updates.
      const interval = this.updateIntervals.get(roomId);
      if (interval) {
        clearInterval(interval);
        this.updateIntervals.delete(roomId);
      }
    }
  }

  async unpauseWorker(roomId) {
    const worker = this.workers.get(roomId);
    if (worker) {
      // Remove the paused flag.
      this.pausedWorkers.delete(roomId);
      // Send an unpause command to the worker thread.
      worker.postMessage({ type: "UNPAUSE" });
      // Restart periodic database updates.
      this.startPeriodicUpdates(roomId);
    }
  }
}

export const gameWorkerManager = new GameWorkerManager();
