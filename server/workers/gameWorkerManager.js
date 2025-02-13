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
        // console.log(`Waiting for worker ${roomId} to start...`);
        while (this.workerStarting.get(roomId)) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      const worker = this.workers.get(roomId);
      if (!worker) {
        // console.log(`Worker missing for room ${roomId}, recreating...`);
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
      // console.log(`Starting worker for room ${roomId}`);
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

      // console.log(
      //   "Creating worker with initial state:",
      //   JSON.stringify(initialState, null, 2)
      // );

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
            // console.log(
            //   `(WORKER->MANAGER) Accepting state from tick ${result.tickCount} (cached tick: ${current.tickCount})`
            // );
            this.latestStates.set(roomId, result);
          } else {
            // console.log(
            //   `(WORKER->MANAGER) Ignoring stale tick message with tickCount ${result.tickCount} (cached tick: ${current.tickCount})`
            // );
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
        // console.log(`Worker for room ${roomId} exited with code ${code}`);
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

  async stopWorker(roomId) {
    // console.log(`Stopping worker for room ${roomId}`);
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
    // console.log(`Starting periodic updates for room ${roomId}`);
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
            // console.log(
            //   `Updating database for room ${roomId} with ${latestState.gameState.nations.length} nations`
            // );
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
      // console.log(
      //   `Updating worker state for room ${roomId}:`,
      //   JSON.stringify(newState, null, 2)
      // );

      // Ensure worker exists.
      const workerExists = await this.ensureWorkerExists(roomId);
      if (!workerExists) {
        console.error(`Could not recreate worker for room ${roomId}`);
        return;
      }

      const worker = this.workers.get(roomId);
      // console.log(`Worker found for room ${roomId}:`, worker);
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

        // console.log(
        //   `State updated successfully for room ${roomId}. Nation count: ${newState.gameState.nations.length}`
        // );
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
    // console.log("Loading map data for:", mapId);
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
}

export const gameWorkerManager = new GameWorkerManager();
