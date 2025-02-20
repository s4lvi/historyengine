// services/gameLoop.js
import { gameStateManager } from "./GameStateManager.js";
import { updateNation, checkWinCondition } from "../utils/gameLogic.js";

class GameLoop {
  constructor() {
    this.activeRooms = new Set();
    this.intervalIds = new Map();
    this.cacheCount = 0;
  }

  async startRoom(roomId) {
    if (this.activeRooms.has(roomId)) return;
    this.activeRooms.add(roomId);
    this.runLoop(roomId);
    console.log(`Started game loop for room ${roomId}`);
    this.cacheCount = 0;
  }

  async runLoop(roomId) {
    if (!this.activeRooms.has(roomId)) return;

    try {
      const state = gameStateManager.getRoom(roomId);
      if (!state) {
        console.error(`No state found for room ${roomId}`);
        this.stopRoom(roomId);
        return;
      }

      const mapData = gameStateManager.getMapData(roomId);
      if (!mapData) {
        console.error(`No map data found for room ${roomId}`);
        this.stopRoom(roomId);
        return;
      }

      // Update game state
      const updatedState = {
        ...state,
        tickCount: state.tickCount + 1,
        lastActivity: Date.now(),
      };

      // --- Pre-invalidate caches for all nations ---
      if (
        updatedState.invalidateBorderCache &&
        updatedState.gameState.nations
      ) {
        updatedState.gameState.nations.forEach((nation) => {
          delete nation.cachedBorderSet;
          delete nation.cachedConnectedCells;
          // Add any other cached properties that need clearing.
        });
      }

      // Update each nation
      if (updatedState.gameState.nations) {
        updatedState.gameState.nations = updatedState.gameState.nations.map(
          (nation) => updateNation(nation, mapData, updatedState.gameState)
        );
        // Check win conditions
        checkWinCondition(updatedState.gameState, mapData);
      }

      // --- Maintain the invalidation flag for at least 2 loops ---
      if (updatedState.invalidateBorderCache) {
        console.log(
          `Invalidating border cache for room ${roomId} on tick ${updatedState.tickCount}`
        );
        this.cacheCount += 1;
        if (this.cacheCount >= 2) {
          updatedState.invalidateBorderCache = false;
          this.cacheCount = 0;
        }
      } else {
        this.cacheCount = 0;
      }

      // Save updated state
      gameStateManager.updateGameState(roomId, () => updatedState);
      // Schedule next tick
      this.intervalIds.set(
        roomId,
        setTimeout(() => this.runLoop(roomId), 100)
      );
    } catch (error) {
      console.error(`Error in game loop for room ${roomId}:`, error);
      this.stopRoom(roomId);
    }
  }

  async stopRoom(roomId) {
    this.activeRooms.delete(roomId);
    const intervalId = this.intervalIds.get(roomId);
    if (intervalId) {
      clearTimeout(intervalId);
      this.intervalIds.delete(roomId);
    }
    console.log(`Stopped game loop for room ${roomId}`);
  }

  async pauseRoom(roomId) {
    await this.stopRoom(roomId);
    console.log(`Paused game loop for room ${roomId}`);
  }

  getMapData(roomId) {
    return gameStateManager.getMapData(roomId);
  }
}

export const gameLoop = new GameLoop();
