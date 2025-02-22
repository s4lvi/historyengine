// services/gameLoop.js
import { gameStateManager } from "./GameStateManager.js";
import { updateNation, checkWinCondition } from "../utils/gameLogic.js";

class GameLoop {
  constructor() {
    this.activeRooms = new Set();
    this.intervalIds = new Map();
    this.cacheCount = 0;
    this.INACTIVE_TIMEOUT = 600000;
  }

  async startRoom(roomId, invalidateCache = true) {
    if (this.activeRooms.has(roomId)) return;
    this.activeRooms.add(roomId);

    // Clear caches immediately when starting/resuming the room.
    const state = gameStateManager.getRoom(roomId);
    if (state && state.gameState && state.gameState.nations) {
      state.gameState.nations.forEach((nation) => {
        delete nation.cachedBorderSet;
        delete nation.cachedConnectedCells;
        nation.territoryDelta = {
          add: { x: [], y: [] },
          sub: { x: [], y: [] },
        };
      });
      // Mark that we just resumed so the first tick will force a full cache reset.
      state.justResumed = true;
      state.invalidateBorderCache = true;
      gameStateManager.updateGameState(roomId, () => state);
    }

    this.runLoop(roomId, invalidateCache);
    console.log(`Started game loop for room ${roomId}`);
    this.cacheCount = 0;
  }

  async runLoop(roomId, invalidateCache = false) {
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

      const currentTime = Date.now();
      const updatedState = {
        ...state,
        tickCount: state.tickCount + 1,
        lastActivity: currentTime,
      };

      // If the game just resumed, force cache invalidation for all nations.
      if (updatedState.justResumed && updatedState.gameState.nations) {
        updatedState.gameState.nations.forEach((nation) => {
          delete nation.cachedBorderSet;
          delete nation.cachedConnectedCells;
          nation.territoryDelta = {
            add: { x: [], y: [] },
            sub: { x: [], y: [] },
          };
        });
        // Clear the flag so this only happens on the first tick.
        updatedState.justResumed = false;
      }

      // Also, if the invalidate flag is set, clear caches.
      if (
        updatedState.invalidateBorderCache &&
        updatedState.gameState.nations
      ) {
        updatedState.gameState.nations.forEach((nation) => {
          delete nation.cachedBorderSet;
          delete nation.cachedConnectedCells;
        });
      }

      // Update each active nation.
      if (updatedState.gameState.nations) {
        const activeNations = updatedState.gameState.nations.filter(
          (nation) => nation.status !== "defeated"
        );
        updatedState.gameState.nations = [
          ...activeNations.map((nation) =>
            updateNation(nation, mapData, updatedState.gameState)
          ),
          ...updatedState.gameState.nations.filter(
            (nation) => nation.status === "defeated"
          ),
        ];

        // Check win conditions.
        checkWinCondition(updatedState.gameState, mapData);
      }

      // Maintain the invalidation flag for at least 2 loops.
      if (updatedState.invalidateBorderCache) {
        this.cacheCount += 1;
        if (this.cacheCount >= 2) {
          updatedState.invalidateBorderCache = false;
          this.cacheCount = 0;
        }
      } else {
        this.cacheCount = 0;
      }
      if (invalidateCache) {
        updatedState.invalidateBorderCache = true;
        this.cacheCount = 0;
        invalidateCache = false;
      }

      // Save the updated state.
      gameStateManager.updateGameState(roomId, () => updatedState);

      // Schedule the next tick.
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
