// gameLoop.js
import mongoose from "mongoose";
import { updateNation, checkWinCondition } from "../utils/gameLogic.js";
import {
  buildOwnershipMap,
  computeBonusesByOwner,
  getNodeMultiplier,
} from "../utils/territorialUtils.js";
import { assignResourcesToMap } from "../utils/resourceManagement.js";
import { broadcastRoomUpdate } from "../wsHub.js";
import config from "../config/config.js";

function ensureTerritoryDelta(nation) {
  if (!nation.territoryDelta) {
    nation.territoryDelta = { add: { x: [], y: [] }, sub: { x: [], y: [] } };
  }
}

function addTerritoryCellToNation(nation, x, y) {
  if (!nation.territory) {
    nation.territory = { x: [], y: [] };
  }
  const tx = nation.territory.x;
  const ty = nation.territory.y;
  for (let i = 0; i < tx.length; i++) {
    if (tx[i] === x && ty[i] === y) return;
  }
  tx.push(x);
  ty.push(y);
  ensureTerritoryDelta(nation);
  nation.territoryDelta.add.x.push(x);
  nation.territoryDelta.add.y.push(y);
}

function removeTerritoryCellFromNation(nation, x, y) {
  if (!nation?.territory?.x || !nation?.territory?.y) return;
  const tx = nation.territory.x;
  const ty = nation.territory.y;
  for (let i = 0; i < tx.length; i++) {
    if (tx[i] === x && ty[i] === y) {
      tx.splice(i, 1);
      ty.splice(i, 1);
      ensureTerritoryDelta(nation);
      nation.territoryDelta.sub.x.push(x);
      nation.territoryDelta.sub.y.push(y);
      return;
    }
  }
}

function updateEncircledTerritory(gameState, mapData, ownershipMap) {
  if (!gameState || !mapData || !ownershipMap) return;
  const width = mapData[0]?.length || 0;
  const height = mapData.length || 0;
  if (!width || !height) return;

  const captureTicks =
    config?.territorial?.encirclementCaptureTicks ?? 10;
  const claims = gameState.encirclementClaims || {};
  const visited = new Set();
  const encircledNow = new Map(); // key -> owner
  const nationsByOwner = new Map(
    (gameState.nations || []).map((n) => [n.owner, n])
  );

  const neighbors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = mapData?.[y]?.[x];
      if (!cell || cell.biome === "OCEAN") continue;
      const key = `${x},${y}`;
      if (visited.has(key)) continue;
      const ownerId = ownershipMap.get(key)?.owner ?? null;
      if (ownerId) continue;
      const queue = [key];
      const component = [];
      const boundaryOwners = new Set();
      let touchesEdge = false;

      while (queue.length) {
        const current = queue.pop();
        if (visited.has(current)) continue;
        visited.add(current);
        component.push(current);
        const [xStr, yStr] = current.split(",");
        const cx = Number(xStr);
        const cy = Number(yStr);
        for (const [dx, dy] of neighbors) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            touchesEdge = true;
            continue;
          }
          const neighborCell = mapData?.[ny]?.[nx];
          if (!neighborCell || neighborCell.biome === "OCEAN") {
            touchesEdge = true;
            continue;
          }
          const nKey = `${nx},${ny}`;
          const neighborOwner = ownershipMap.get(nKey)?.owner ?? null;
          if (neighborOwner === ownerId) {
            if (!visited.has(nKey)) queue.push(nKey);
            continue;
          }
          boundaryOwners.add(neighborOwner);
        }
      }

      if (touchesEdge) continue;
      if (boundaryOwners.size !== 1) continue;
      const [encircler] = boundaryOwners;
      if (!encircler || encircler === ownerId) continue;
      for (const cellKey of component) {
        encircledNow.set(cellKey, encircler);
      }
    }
  }

  // Update claims and apply captures.
  for (const [cellKey, encircler] of encircledNow.entries()) {
    const claim = claims[cellKey] || {
      owner: encircler,
      progress: 0,
    };
    if (claim.owner !== encircler) {
      claim.owner = encircler;
      claim.progress = 0;
    }
    claim.progress += 1;
    claims[cellKey] = claim;
    if (claim.progress >= captureTicks) {
      const currentOwner = ownershipMap.get(cellKey);
      const [xStr, yStr] = cellKey.split(",");
      const x = Number(xStr);
      const y = Number(yStr);
      if (currentOwner?.owner && currentOwner.owner !== encircler) {
        removeTerritoryCellFromNation(currentOwner, x, y);
      }
      const targetNation = nationsByOwner.get(encircler);
      if (targetNation) {
        addTerritoryCellToNation(targetNation, x, y);
        ownershipMap.set(cellKey, targetNation);
      } else {
        ownershipMap.delete(cellKey);
      }
      delete claims[cellKey];
    }
  }

  // Clear claims that are no longer encircled.
  Object.keys(claims).forEach((cellKey) => {
    if (!encircledNow.has(cellKey)) {
      delete claims[cellKey];
    }
  });

  gameState.encirclementClaims = claims;
}

function applyResourceNodeIncome(gameState, mapData) {
  if (!gameState || !Array.isArray(mapData)) return;
  const claims = gameState.resourceNodeClaims || {};
  if (!claims || Object.keys(claims).length === 0) return;

  const baseYield =
    config?.territorial?.resourceYieldPerTick ?? 0;
  if (baseYield <= 0) return;
  const yieldByType =
    config?.territorial?.resourceYieldByType || {};
  const upgrades = gameState.resourceUpgrades || {};

  const totalsByOwner = {};
  Object.entries(claims).forEach(([key, claim]) => {
    if (!claim?.owner || !claim?.type) return;
    const [xStr, yStr] = key.split(",");
    const x = Number(xStr);
    const y = Number(yStr);
    const cell = mapData?.[y]?.[x];
    if (!cell?.resourceNode?.type) return;

    const level = upgrades?.[key]?.level ?? cell.resourceNode.level ?? 0;
    const mult = getNodeMultiplier(level);
    const typeYield = Number(yieldByType[claim.type] || baseYield);
    const totalYield = typeYield * mult;

    if (!totalsByOwner[claim.owner]) {
      totalsByOwner[claim.owner] = {};
    }
    totalsByOwner[claim.owner][claim.type] =
      (totalsByOwner[claim.owner][claim.type] || 0) + totalYield;
  });

  const nations = gameState.nations || [];
  nations.forEach((nation) => {
    const totals = totalsByOwner[nation.owner];
    if (!totals) return;
    nation.resources = nation.resources || {};
    Object.entries(totals).forEach(([resource, amount]) => {
      nation.resources[resource] =
        (nation.resources[resource] || 0) + amount;
    });
  });
}

function updateResourceNodeClaims(gameState, mapData) {
  if (!gameState || !Array.isArray(mapData)) return;
  const claims = gameState.resourceNodeClaims || {};
  const captureTicks = config?.territorial?.resourceCaptureTicks ?? 20;
  const ownershipMap = buildOwnershipMap(gameState.nations);
  const seen = new Set();

  ownershipMap.forEach((ownerNation, key) => {
    const [xStr, yStr] = key.split(",");
    const x = Number(xStr);
    const y = Number(yStr);
    const cell = mapData?.[y]?.[x];
    if (!cell?.resourceNode?.type) return;

    seen.add(key);
    const ownerId = ownerNation?.owner;
    if (!ownerId) return;

    let claim = claims[key];
    if (!claim) {
      claim = {
        type: cell.resourceNode.type,
        owner: null,
        progressOwner: null,
        progress: 0,
      };
    }

    if (claim.owner && claim.owner !== ownerId) {
      claim.owner = null;
      claim.progressOwner = null;
      claim.progress = 0;
    }

    if (claim.owner === ownerId) {
      claim.type = cell.resourceNode.type;
      claims[key] = claim;
      return;
    }

    if (claim.progressOwner !== ownerId) {
      claim.progressOwner = ownerId;
      claim.progress = 0;
    }

    claim.progress = Math.min(captureTicks, (claim.progress || 0) + 1);
    if (claim.progress >= captureTicks) {
      claim.owner = ownerId;
    }
    claim.type = cell.resourceNode.type;
    claims[key] = claim;
  });

  Object.keys(claims).forEach((key) => {
    if (seen.has(key)) return;
    const claim = claims[key];
    if (!claim) return;
    if (claim.owner || claim.progressOwner) {
      claim.owner = null;
      claim.progressOwner = null;
      claim.progress = 0;
    }
  });

  gameState.resourceNodeClaims = claims;
}

class GameLoop {
  constructor() {
    this.timers = new Map(); // roomId -> timer
    this.cachedMapData = new Map(); // roomId -> cached mapData
    this.cachedMapStats = new Map(); // roomId -> { totalClaimable }
    const tickRate =
      Number(process.env.TICK_RATE_MS) ||
      Number(config?.territorial?.tickRateMs);
    const broadcastRate =
      Number(process.env.BROADCAST_INTERVAL_MS) ||
      Number(config?.territorial?.broadcastIntervalMs);
    this.targetTickRate = Number.isFinite(tickRate) ? tickRate : 100;
    this.broadcastIntervalMs = Number.isFinite(broadcastRate)
      ? broadcastRate
      : 250;
    this.lastBroadcast = new Map(); // roomId -> timestamp
  }

  async initializeMapData(roomId) {
    const roomKey = roomId?.toString();
    console.log(`Initializing map data for room ${roomKey}`);
    try {
      const GameRoom = mongoose.model("GameRoom");
      const MapModel = mongoose.model("Map");
      const MapChunk = mongoose.model("MapChunk");

      const gameRoom = await GameRoom.findById(roomKey);
      if (!gameRoom) {
        console.error(`Game room ${roomKey} not found during initialization`);
        return null;
      }

      const gameMap = await MapModel.findById(gameRoom.map).lean();
      if (!gameMap) {
        console.error(`Map not found for game room ${roomKey}`);
        return null;
      }

      // Initialize empty map data as a proper 2D array
      let mapData = Array.from({ length: gameMap.height }, () =>
        Array.from({ length: gameMap.width }, () => null)
      );

      const chunks = await MapChunk.find({ map: gameMap._id }).lean();

      // Process chunks and ensure we maintain array structure
      chunks.forEach((chunk) => {
        const startRow = chunk.startRow;
        chunk.rows.forEach((row, rowIndex) => {
          if (startRow + rowIndex < mapData.length) {
            // Ensure row is an array
            const processedRow = Array.isArray(row)
              ? row
              : Object.keys(row)
                  .filter((key) => !isNaN(key))
                  .sort((a, b) => parseInt(a) - parseInt(b))
                  .map((key) => row[key]);

            mapData[startRow + rowIndex] = processedRow.map((cell) => ({
              ...cell,
              resources: Array.isArray(cell.resources) ? cell.resources : [],
            }));
          }
        });
      });

      // Process resources for the map
      mapData = assignResourcesToMap(mapData, gameMap.seed || gameMap._id.toString());

      // Verify array structure before caching
      mapData = mapData.map((row) => {
        if (!Array.isArray(row)) {
          console.warn("Converting non-array row to array");
          return Object.keys(row)
            .filter((key) => !isNaN(key))
            .sort((a, b) => parseInt(a) - parseInt(b))
            .map((key) => row[key]);
        }
        return row;
      });

      // Store in cache
      this.cachedMapData.set(roomKey, mapData);
      let totalClaimable = 0;
      for (let y = 0; y < mapData.length; y++) {
        for (let x = 0; x < mapData[0].length; x++) {
          const cell = mapData[y][x];
          if (cell && cell.biome !== "OCEAN") totalClaimable++;
        }
      }
      this.cachedMapStats.set(roomKey, { totalClaimable });
      console.log(
        `Map data cached successfully for room ${roomKey}. Dimensions: ${mapData.length}x${mapData[0].length}`
      );

      return mapData;
    } catch (error) {
      console.error(`Error initializing map data for room ${roomKey}:`, error);
      return null;
    }
  }

  async getMapData(roomId) {
    const roomKey = roomId?.toString();
    let mapData = this.cachedMapData.get(roomKey);
    if (!mapData) {
      console.log(`Cache miss for room ${roomKey}, initializing map data`);
      mapData = await this.initializeMapData(roomKey);
    }
    return mapData;
  }

  async processRoom(roomId) {
    const roomKey = roomId?.toString();
    const startTime = process.hrtime();
    try {
      const GameRoom = mongoose.model("GameRoom");
      const gameRoom = await GameRoom.findById(roomKey);
      if (
        !gameRoom ||
        gameRoom.status !== "open" ||
        !gameRoom?.gameState?.nations
      ) {
        return;
      }

      // Get or initialize the cached mapData
      let mapData = await this.getMapData(roomKey);
      if (!mapData) {
        console.error(`Failed to get map data for room ${roomKey}`);
        return;
      }

      // Process each nation using the cached mapData
      const ownershipMap = buildOwnershipMap(gameRoom.gameState.nations);
      const bonusesByOwner = computeBonusesByOwner(
        gameRoom.gameState.nations,
        mapData,
        gameRoom.gameState?.resourceUpgrades || null,
        gameRoom.gameState?.resourceNodeClaims || null
      );

      const nationOrder = [...gameRoom.gameState.nations];
      for (let i = nationOrder.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [nationOrder[i], nationOrder[j]] = [nationOrder[j], nationOrder[i]];
      }

      const updatedNations = nationOrder.map((nation) =>
        updateNation(
          nation,
          mapData,
          gameRoom.gameState,
          ownershipMap,
          bonusesByOwner,
          gameRoom.tickCount
        )
      );

      gameRoom.gameState.nations = updatedNations;
      if (
        gameRoom.tickCount %
          (config?.territorial?.encirclementCheckIntervalTicks ?? 6) ===
        0
      ) {
        updateEncircledTerritory(
          gameRoom.gameState,
          mapData,
          ownershipMap
        );
      }
      updateResourceNodeClaims(gameRoom.gameState, mapData);
      applyResourceNodeIncome(gameRoom.gameState, mapData);
      gameRoom.markModified("gameState.resourceNodeClaims");
      gameRoom.markModified("gameState.encirclementClaims");
      gameRoom.markModified("gameState.nations");
      if (process.env.DEBUG_BOTS === "true") {
        const botCount = updatedNations.filter((n) => n.isBot).length;
        console.log(
          `[BOTS] tick room=${roomKey} nations=${updatedNations.length} bots=${botCount}`
        );
      }

      const winCheckInterval =
        config?.territorial?.winConditionCheckIntervalTicks ?? 5;
      if ((gameRoom.tickCount ?? 0) % winCheckInterval === 0) {
        const stats = this.cachedMapStats.get(roomKey);
        checkWinCondition(
          gameRoom.gameState,
          mapData,
          stats?.totalClaimable
        );
      }
      gameRoom.tickCount += 1;
      gameRoom.markModified("gameState.nations");
      await gameRoom.save();
      const now = Date.now();
      const last = this.lastBroadcast.get(roomKey) || 0;
      if (now - last >= this.broadcastIntervalMs) {
        this.lastBroadcast.set(roomKey, now);
        broadcastRoomUpdate(roomKey, gameRoom);
      }

      // Calculate processing time
      const elapsed = process.hrtime(startTime);
      const elapsedMs = elapsed[0] * 1000 + elapsed[1] / 1e6;
      if (process.env.DEBUG_TICKS === "true") {
        console.log(`Room ${roomId} processed in ${elapsedMs.toFixed(2)} ms`);
      }

      // Return processing time for tick rate adjustment
      return elapsedMs;
    } catch (error) {
      if (error.name === "VersionError") {
        console.warn(
          `Tick update skipped for room ${roomKey} due to manual update conflict: ${error.message}`
        );
      } else {
        console.error(`Error processing room ${roomKey}:`, error);
      }
      return 0; // Return 0 for error cases to maintain tick rate
    }
  }

  async startRoom(roomId) {
    const roomKey = roomId?.toString();
    if (this.timers.has(roomKey)) {
      console.log(`Room ${roomKey} already has an active timer`);
      return;
    }

    // Initialize map data before starting the game loop
    const mapData = await this.initializeMapData(roomKey);
    if (!mapData) {
      console.error(`Failed to initialize map data for room ${roomKey}`);
      return;
    }

    const tick = async () => {
      if (!this.timers.has(roomKey)) return;

      const startTime = Date.now();
      const processingTime = await this.processRoom(roomKey);

      if (!this.timers.has(roomKey)) return;

      // Calculate the time until the next tick should occur
      const elapsedTime = Date.now() - startTime;
      const remainingTime = Math.max(0, this.targetTickRate - elapsedTime);

      // Log if we're falling behind
      if (elapsedTime > this.targetTickRate) {
        console.warn(
          `Room ${roomKey} tick processing took ${elapsedTime}ms, exceeding target tick rate of ${this.targetTickRate}ms`
        );
      }

      // Schedule the next tick
      const timer = setTimeout(tick, remainingTime);
      this.timers.set(roomKey, timer);
    };

    const timer = setTimeout(tick, 0);
    this.timers.set(roomKey, timer);
    console.log(`Started game loop for room ${roomKey}`);
  }

  stopRoom(roomId) {
    const roomKey = roomId?.toString();
    const timer = this.timers.get(roomKey);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(roomKey);
      this.cachedMapData.delete(roomKey);
      this.cachedMapStats.delete(roomKey);
      this.lastBroadcast.delete(roomKey);
      console.log(`Stopped game loop and cleared cache for room ${roomKey}`);
    }
  }
}

export const gameLoop = new GameLoop();
