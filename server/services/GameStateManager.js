// services/GameStateManager.js

export class GameStateManager {
  constructor() {
    this.gameStates = new Map();
    this.mapData = new Map();
  }

  // Map data management
  setMapData(roomId, data) {
    this.mapData.set(roomId, data);
  }

  getMapData(roomId) {
    return this.mapData.get(roomId);
  }

  // Game state management
  getRoom(roomId) {
    return this.gameStates.get(roomId);
  }

  addRoom(roomId, initialState) {
    this.gameStates.set(roomId, initialState);
  }

  updateGameState(roomId, updater) {
    const currentState = this.gameStates.get(roomId);
    if (!currentState) return null;

    try {
      const newState = updater(currentState);
      this.gameStates.set(roomId, newState);
      return newState;
    } catch (error) {
      console.error(`Error updating game state for room ${roomId}:`, error);
      return null;
    }
  }

  removeRoom(roomId) {
    this.gameStates.delete(roomId);
    this.mapData.delete(roomId);
  }

  // Utility methods
  getActiveRoomCount() {
    return this.gameStates.size;
  }

  getAllRoomIds() {
    return Array.from(this.gameStates.keys());
  }
}
export const gameStateManager = new GameStateManager();
