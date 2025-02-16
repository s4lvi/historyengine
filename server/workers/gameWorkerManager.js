// gameWorkerManager.js
class GameWorkerManager {
  constructor() {
    this.workers = new Map();
  }

  async startWorker(roomId, gameRoom) {
    // Stop any existing worker
    await this.stopWorker(roomId);

    // Load map data
    const mapData = await this.loadMapData(gameRoom.map);

    // Create new worker
    const worker = new Worker(new URL("./gameWorker.js", import.meta.url), {
      workerData: {
        roomId: roomId.toString(),
        mapData,
      },
    });

    worker.on("error", (error) => {
      console.error(`Error in worker for room ${roomId}:`, error);
      this.stopWorker(roomId);
    });

    this.workers.set(roomId.toString(), worker);
  }

  async stopWorker(roomId) {
    const worker = this.workers.get(roomId.toString());
    if (worker) {
      await worker.terminate();
      this.workers.delete(roomId.toString());
    }
  }

  async pauseWorker(roomId) {
    const worker = this.workers.get(roomId.toString());
    if (worker) {
      worker.postMessage({ type: "PAUSE" });
    }
  }

  async unpauseWorker(roomId) {
    const worker = this.workers.get(roomId.toString());
    if (worker) {
      worker.postMessage({ type: "UNPAUSE" });
    }
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
}

export const gameWorkerManager = new GameWorkerManager();
