// services/gameLoop.js
import { gameStateManager } from "./GameStateManager.js";
import { updateNation, checkWinCondition } from "../utils/gameLogic.js";

class GameLoop {
  constructor() {
    this.activeRooms = new Set();
    this.intervalIds = new Map();
    this.cacheCount = 0;
    this.INACTIVE_TIMEOUT = 2000;
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
      const currentTime = Date.now();
      const updatedState = {
        ...state,
        tickCount: state.tickCount + 1,
        lastActivity: currentTime,
      };

      // Remove inactive nations (haven't polled in 2 seconds)
      if (updatedState.gameState.nations) {
        const inactiveNations = updatedState.gameState.nations.filter(
          (nation) => {
            return (
              nation.status !== "defeated" &&
              (!nation.lastPoll ||
                currentTime - nation.lastPoll > this.INACTIVE_TIMEOUT)
            );
          }
        );

        if (inactiveNations.length > 0) {
          console.log(
            `Removing inactive nations:`,
            inactiveNations.map((n) => n.owner)
          );

          // Filter out inactive nations
          updatedState.gameState.nations =
            updatedState.gameState.nations.filter(
              (nation) =>
                nation.status === "defeated" ||
                !inactiveNations.find(
                  (inactive) => inactive.owner === nation.owner
                )
            );

          // Filter out the corresponding players
          updatedState.gameState.players =
            updatedState.gameState.players.filter(
              (player) =>
                !inactiveNations.find(
                  (inactive) => inactive.owner === player.userId
                )
            );
        }
      }

      // Pre-invalidate caches for all nations
      if (
        updatedState.invalidateBorderCache &&
        updatedState.gameState.nations
      ) {
        updatedState.gameState.nations.forEach((nation) => {
          delete nation.cachedBorderSet;
          delete nation.cachedConnectedCells;
        });
      }

      // Update each active nation
      if (updatedState.gameState.nations) {
        const activeNations = updatedState.gameState.nations.filter(
          (nation) => nation.status !== "defeated"
        );

        updatedState.gameState.nations = [
          ...activeNations.map((nation) =>
            updateNation(nation, mapData, updatedState.gameState)
          ),
          // Keep defeated nations in the list without updating them
          ...updatedState.gameState.nations.filter(
            (nation) => nation.status === "defeated"
          ),
        ];

        // Check win conditions
        checkWinCondition(updatedState.gameState, mapData);
      }

      // Maintain the invalidation flag for at least 2 loops
      if (updatedState.invalidateBorderCache) {
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
