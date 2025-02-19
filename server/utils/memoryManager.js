// utils/memoryManager.js
import { gameStateManager } from "../services/GameStateManager.js";

export function checkMemoryUsage() {
  const used = process.memoryUsage();
  const heapTotal = Math.round(used.heapTotal / 1024 / 1024);
  const heapUsed = Math.round(used.heapUsed / 1024 / 1024);
  const rss = Math.round(used.rss / 1024 / 1024);

  // Calculate heap used percentage
  const heapUsedPercentage = Math.round((heapUsed / heapTotal) * 100);

  const stats = {
    heapTotal: `${heapTotal} MB`,
    heapUsed: `${heapUsed} MB`,
    rss: `${rss} MB`,
    heapUsedPercentage,
  };

  // Log the stats
  console.log(stats);

  return stats;
}

export function cleanupInactiveRooms() {
  const INACTIVE_THRESHOLD = 1000 * 60 * 60; // 1 hour
  const now = Date.now();

  gameStateManager.gameStates.forEach((state, roomId) => {
    if (now - state.lastActivity > INACTIVE_THRESHOLD) {
      gameStateManager.removeRoom(roomId);
    }
  });
}
