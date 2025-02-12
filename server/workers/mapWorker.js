// mapWorker.js
import { parentPort, workerData } from "worker_threads";
import { generateWorldMap } from "../utils/mapUtils.js";

// Extract parameters passed from the main thread
const { width, height, erosion_passes, num_blobs, seed } = workerData;

// Perform the heavy computation
const mapData = generateWorldMap(
  width,
  height,
  erosion_passes,
  num_blobs,
  seed
);

// Send the result back to the main thread
parentPort.postMessage(mapData);
