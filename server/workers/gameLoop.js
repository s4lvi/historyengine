// gameLoop.js
import mongoose from "mongoose";
import { updateNation, checkWinCondition } from "../utils/gameLogic.js";
import {
  computeBonusesByOwner,
  getNodeMultiplier,
} from "../utils/territorialUtils.js";
import { assignResourcesToMap } from "../utils/resourceManagement.js";
import { broadcastRoomUpdate } from "../wsHub.js";
import config from "../config/config.js";
import { TerritoryMatrix, UNOWNED } from "../utils/TerritoryMatrix.js";
import { detectEncirclement, passiveConcavityFill } from "../utils/matrixKernels.js";
import { applyMatrixToNations } from "../utils/matrixCompat.js";
import { tickLoyaltyDiffusion } from "../utils/matrixLoyalty.js";
import { tickPopulationDensity, computeDefenseStrength } from "../utils/matrixPopulation.js";
import { tickMobilization, tickTroopDensityDiffusion } from "../utils/matrixTroopDensity.js";
import { deriveOwnershipFromLoyalty } from "../utils/matrixKernels.js";
import { serializeMatrix } from "../utils/matrixSerializer.js";

const loyaltyEnabled = config?.loyalty?.enabled !== false;
const popDensityEnabled = config?.populationDensity?.enabled !== false;
const troopDensityEnabled = config?.troopDensity?.enabled === true;

/**
 * Handle structure capture/destroy when territory changes hands
 * Matrix-aware version: reads ownership from matrix instead of string-key map
 */
function handleStructureCaptureMatrix(gameState, matrix) {
  if (!gameState?.nations) return;

  const nationsByOwner = new Map(
    (gameState.nations || []).map((n) => [n.owner, n])
  );

  for (const nation of gameState.nations) {
    if (!nation.cities || nation.cities.length === 0) continue;

    const nIdx = matrix.ownerToIndex.get(nation.owner);
    const citiesToRemove = [];
    const citiesToTransfer = [];

    for (let i = 0; i < nation.cities.length; i++) {
      const city = nation.cities[i];
      const tileOwnerIdx = matrix.getOwner(city.x, city.y);

      if (tileOwnerIdx === UNOWNED || tileOwnerIdx !== nIdx) {
        const tileOwnerStr = tileOwnerIdx !== UNOWNED ? matrix.getOwnerByIndex(tileOwnerIdx) : null;

        if (city.type === "tower") {
          citiesToRemove.push(i);
          console.log(`[STRUCTURE] Tower "${city.name}" at (${city.x},${city.y}) destroyed - territory lost by ${nation.owner}`);
        } else if (city.type === "town" || city.type === "capital") {
          if (tileOwnerStr) {
            citiesToTransfer.push({ cityIndex: i, newOwner: tileOwnerStr });
            console.log(`[STRUCTURE] City "${city.name}" at (${city.x},${city.y}) captured by ${tileOwnerStr} from ${nation.owner}`);
          } else {
            citiesToRemove.push(i);
          }
        }
      }
    }

    for (const transfer of citiesToTransfer) {
      const city = nation.cities[transfer.cityIndex];
      const newOwnerNation = nationsByOwner.get(transfer.newOwner);
      if (newOwnerNation) {
        const transferredCity = {
          ...city,
          type: city.type === "capital" ? "town" : city.type
        };
        newOwnerNation.cities = newOwnerNation.cities || [];
        newOwnerNation.cities.push(transferredCity);
      }
    }

    const allToRemove = [
      ...citiesToRemove,
      ...citiesToTransfer.map((t) => t.cityIndex)
    ].sort((a, b) => b - a);

    for (const idx of allToRemove) {
      nation.cities.splice(idx, 1);
    }
  }
}

/**
 * Apply city auto-expansion using matrix ownership
 */
function applyCityAutoExpansionMatrix(gameState, matrix) {
  if (!gameState?.nations) return;

  const townConfig = config?.structures?.town || {
    autoExpansionRadius: 3,
    autoExpansionRate: 0.3
  };
  const expansionRadius = townConfig.autoExpansionRadius;
  const expansionRate = townConfig.autoExpansionRate;
  if (expansionRate <= 0) return;

  const { width, height } = matrix;
  const DX = [1, -1, 0, 0];
  const DY = [0, 0, 1, -1];

  for (const nation of gameState.nations) {
    if (nation.status === "defeated") continue;
    if (!nation.cities) continue;
    const nIdx = matrix.ownerToIndex.get(nation.owner);
    if (nIdx === undefined) continue;

    const towns = nation.cities.filter((c) => c.type === "town");
    if (towns.length === 0) continue;

    for (const town of towns) {
      if (Math.random() > expansionRate) continue;

      const candidates = [];
      for (let dy = -expansionRadius; dy <= expansionRadius; dy++) {
        for (let dx = -expansionRadius; dx <= expansionRadius; dx++) {
          const nx = town.x + dx;
          const ny = town.y + dy;
          if (!matrix.inBounds(nx, ny)) continue;
          if (matrix.isOcean(nx, ny)) continue;
          if (matrix.getOwner(nx, ny) !== UNOWNED) continue;

          // Check if adjacent to owned territory
          let adjacentToOwned = false;
          for (let d = 0; d < 4; d++) {
            const ax = nx + DX[d];
            const ay = ny + DY[d];
            if (matrix.isOwnedBy(ax, ay, nIdx)) {
              adjacentToOwned = true;
              break;
            }
          }

          if (adjacentToOwned) {
            const distance = Math.abs(dx) + Math.abs(dy);
            candidates.push({ x: nx, y: ny, distance });
          }
        }
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => a.distance - b.distance);
        const target = candidates[0];
        matrix.setOwner(target.x, target.y, nIdx);
      }
    }
  }
}

/**
 * Encirclement detection and capture using matrix
 */
function updateEncircledTerritoryMatrix(gameState, matrix) {
  if (!gameState?.nations) return;

  // Reset encirclement flags
  for (const nation of gameState.nations || []) {
    nation.isEncircled = false;
    nation.encircledBy = null;
  }

  const results = detectEncirclement(matrix, gameState.nations);
  const nationsByOwner = new Map(
    (gameState.nations || []).map((n) => [n.owner, n])
  );

  for (const result of results) {
    const { cells, ownerIdx, encirclerIdx, hasCapital } = result;
    const encirclerOwner = matrix.getOwnerByIndex(encirclerIdx);

    if (ownerIdx === UNOWNED) {
      // Unowned territory — instant capture with loyalty
      for (const ci of cells) {
        matrix.ownership[ci] = encirclerIdx;
        matrix.loyalty[encirclerIdx * matrix.size + ci] = 1.0;
      }
    } else if (hasCapital) {
      // Has capital — mark for attack bonus only
      const ownerStr = matrix.getOwnerByIndex(ownerIdx);
      const nation = nationsByOwner.get(ownerStr);
      if (nation) {
        nation.isEncircled = true;
        nation.encircledBy = encirclerOwner;
      }
    } else {
      // No capital — instant capture; transfer loyalty to prevent flicker
      for (const ci of cells) {
        matrix.ownership[ci] = encirclerIdx;
        // Heavily reduce old owner's loyalty and set encircler's loyalty
        matrix.loyalty[ownerIdx * matrix.size + ci] *= 0.15;
        matrix.loyalty[encirclerIdx * matrix.size + ci] = 1.0;
      }
      console.log(`[ENCIRCLE] Captured ${cells.length} enemy cells without capital`);
    }
  }

  gameState.encirclementClaims = {};
}

function applyResourceNodeIncome(gameState, mapData) {
  if (!gameState || !Array.isArray(mapData)) return;
  const claims = gameState.resourceNodeClaims || {};
  if (!claims || Object.keys(claims).length === 0) return;

  const baseYield = config?.territorial?.resourceYieldPerTick ?? 0;
  if (baseYield <= 0) return;
  const yieldByType = config?.territorial?.resourceYieldByType || {};
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

/**
 * Resource node claims using matrix ownership
 */
function updateResourceNodeClaimsMatrix(gameState, mapData, matrix) {
  if (!gameState || !Array.isArray(mapData)) return;
  const claims = gameState.resourceNodeClaims || {};
  const captureTicks = config?.territorial?.resourceCaptureTicks ?? 20;
  const { width, height } = matrix;

  const seen = new Set();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = mapData?.[y]?.[x];
      if (!cell?.resourceNode?.type) continue;
      const ownerIdx = matrix.getOwner(x, y);
      if (ownerIdx === UNOWNED) continue;

      const ownerId = matrix.getOwnerByIndex(ownerIdx);
      if (!ownerId) continue;

      const key = `${x},${y}`;
      seen.add(key);

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
        continue;
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
    }
  }

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
    this.timers = new Map();
    this.cachedMapData = new Map();
    this.cachedMapStats = new Map();
    this.cachedGameRoom = new Map();
    this.cachedMatrix = new Map(); // roomId -> TerritoryMatrix
    // String-key caches used by gameLogic.js updateNation() for compatibility
    this.cachedOwnershipMap = new Map();
    this.cachedNationCount = new Map();
    this.lastSaveTick = new Map();
    this.savingRooms = new Set();
    this.pendingRooms = new Set();
    this.processingRooms = new Set();
    this.roomMutationLocks = new Set();
    this.loopIds = new Map();
    this.roomTickCount = new Map();
    const tickRate =
      Number(process.env.TICK_RATE_MS) ||
      Number(config?.territorial?.tickRateMs);
    const broadcastRate =
      Number(process.env.BROADCAST_INTERVAL_MS) ||
      Number(config?.territorial?.broadcastIntervalMs);
    this.targetTickRate = Number.isFinite(tickRate) ? tickRate : 100;
    const configuredBroadcastRate = Number.isFinite(broadcastRate)
      ? broadcastRate
      : this.targetTickRate;
    this.broadcastIntervalMs = Math.max(
      10,
      Math.min(configuredBroadcastRate, this.targetTickRate)
    );
    this.lastBroadcast = new Map();
    this.dbSaveIntervalTicks = config?.territorial?.dbSaveIntervalTicks ?? 5;
  }

  // ─── Matrix management ──────────────────────────────────────────

  /** Get or create the TerritoryMatrix for a room */
  getMatrix(roomKey, mapData, nations) {
    let matrix = this.cachedMatrix.get(roomKey);
    if (!matrix) {
      const height = mapData.length;
      const width = mapData[0]?.length || 0;
      const maxNations = config?.matrix?.maxNations || 64;
      matrix = new TerritoryMatrix(width, height, maxNations);
      matrix.initFromMapData(mapData, config?.matrix);
      matrix.populateFromNations(nations);
      this.cachedMatrix.set(roomKey, matrix);
      console.log(`[MATRIX] Created ${width}x${height} matrix for room ${roomKey} (${matrix.nextNationSlot} nations)`);
    } else {
      // Ensure any new nations are registered
      for (const nation of nations) {
        if (nation.status === "defeated") continue;
        if (!matrix.ownerToIndex.has(nation.owner)) {
          matrix.getNationIndex(nation.owner);
        }
      }
    }
    return matrix;
  }

  /**
   * Sync matrix ownership from nations' territory arrays.
   * Used after route mutations (foundNation, quit) to keep matrix in sync.
   */
  syncMatrixFromNations(roomKey, nations) {
    const matrix = this.cachedMatrix.get(roomKey);
    if (!matrix) return;

    // Build set of active nation owners for targeted cleanup
    const activeOwners = new Set();
    for (const nation of nations) {
      if (nation.status !== "defeated" && nation.owner) {
        activeOwners.add(nation.owner);
      }
    }

    // Clear ownership for removed/defeated nations only, preserve loyalty for active nations
    for (let i = 0; i < matrix.size; i++) {
      const ownerIdx = matrix.ownership[i];
      if (ownerIdx === UNOWNED) continue;
      const ownerStr = matrix.getOwnerByIndex(ownerIdx);
      if (!ownerStr || !activeOwners.has(ownerStr)) {
        matrix.ownership[i] = UNOWNED;
        // Clear loyalty for removed nations at this cell
        if (ownerIdx >= 0 && ownerIdx < matrix.maxNations) {
          matrix.loyalty[ownerIdx * matrix.size + i] = 0;
        }
      }
    }

    // Re-populate from nation territories (sets ownership + loyalty=1.0 for owned cells)
    matrix.populateFromNations(nations);
  }

  // ─── Map data management ────────────────────────────────────────

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

      let mapData = Array.from({ length: gameMap.height }, () =>
        Array.from({ length: gameMap.width }, () => null)
      );

      const chunks = await MapChunk.find({ map: gameMap._id }).lean();

      chunks.forEach((chunk) => {
        const startRow = chunk.startRow;
        chunk.rows.forEach((row, rowIndex) => {
          if (startRow + rowIndex < mapData.length) {
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

      mapData = assignResourcesToMap(mapData, gameMap.seed || gameMap._id.toString());

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

      this.cachedMapData.set(roomKey, mapData);
      let totalClaimable = 0;
      if (process.env.DEBUG_RESOURCES === "true") {
        const resourceCounts = {};
        const biomeCounts = {};
        let sampleCell = null;
        for (let y = 0; y < mapData.length; y++) {
          for (let x = 0; x < mapData[0].length; x++) {
            const cell = mapData[y][x];
            if (!cell) continue;
            const biome = cell.biome || "UNKNOWN";
            biomeCounts[biome] = (biomeCounts[biome] || 0) + 1;
            const nodeType = cell.resourceNode?.type;
            const resList = Array.isArray(cell.resources) ? cell.resources : [];
            if (nodeType) resourceCounts[nodeType] = (resourceCounts[nodeType] || 0) + 1;
            if (!nodeType) {
              for (const r of resList) {
                resourceCounts[r] = (resourceCounts[r] || 0) + 1;
              }
            }
            if (!sampleCell && cell.biome !== "OCEAN") {
              sampleCell = { x, y, biome: cell.biome, resources: resList, resourceNode: cell.resourceNode || null };
            }
          }
        }
        console.log(`[RESOURCES] init room=${roomKey} counts`, resourceCounts);
        console.log(`[RESOURCES] init room=${roomKey} sample`, sampleCell);
        console.log(`[RESOURCES] init room=${roomKey} biomeCounts`, biomeCounts);
      }
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

  getCachedGameRoom(roomId) {
    const roomKey = roomId?.toString();
    return this.cachedGameRoom.get(roomKey) || null;
  }

  async getLiveGameRoom(roomId) {
    const roomKey = roomId?.toString();
    let gameRoom = this.cachedGameRoom.get(roomKey);
    if (gameRoom && gameRoom.status !== "open") {
      const GameRoom = mongoose.model("GameRoom");
      const fresh = await GameRoom.findById(roomKey);
      if (fresh) {
        this.cachedGameRoom.set(roomKey, fresh);
        return fresh;
      }
      return gameRoom;
    }
    if (gameRoom) return gameRoom;

    const GameRoom = mongoose.model("GameRoom");
    gameRoom = await GameRoom.findById(roomKey);
    if (gameRoom) {
      this.cachedGameRoom.set(roomKey, gameRoom);
    }
    return gameRoom || null;
  }

  isRoomRunning(roomId) {
    const roomKey = roomId?.toString();
    return this.timers.has(roomKey);
  }

  async withRoomMutationLock(roomId, mutateFn, timeoutMs = 2000) {
    const roomKey = roomId?.toString();
    const start = Date.now();
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    while (this.roomMutationLocks.has(roomKey)) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Timed out waiting for mutation lock on room ${roomKey}`);
      }
      await sleep(2);
    }

    this.roomMutationLocks.add(roomKey);
    try {
      while (this.processingRooms.has(roomKey)) {
        if (Date.now() - start > timeoutMs) {
          throw new Error(`Timed out waiting for room ${roomKey} tick processing`);
        }
        await sleep(2);
      }
      return await mutateFn();
    } finally {
      this.roomMutationLocks.delete(roomKey);
    }
  }

  // ─── String-key ownership map methods (used by gameLogic.js) ───

  buildInitialOwnershipMap(nations) {
    const ownership = new Map();
    if (!Array.isArray(nations)) return ownership;

    const tileClaims = new Map();
    for (const nation of nations) {
      if (!nation?.territory?.x || !nation?.territory?.y) continue;
      for (let i = 0; i < nation.territory.x.length; i++) {
        const key = `${nation.territory.x[i]},${nation.territory.y[i]}`;
        if (!tileClaims.has(key)) {
          tileClaims.set(key, []);
        }
        tileClaims.get(key).push({ nation, index: i });
      }
    }

    for (const [key, claimants] of tileClaims.entries()) {
      if (claimants.length > 1) {
        const [xStr, yStr] = key.split(",");
        const x = Number(xStr);
        const y = Number(yStr);
        const winner = claimants[0].nation;
        ownership.set(key, winner);

        for (let i = claimants.length - 1; i >= 1; i--) {
          const loser = claimants[i].nation;
          for (let j = loser.territory.x.length - 1; j >= 0; j--) {
            if (loser.territory.x[j] === x && loser.territory.y[j] === y) {
              loser.territory.x.splice(j, 1);
              loser.territory.y.splice(j, 1);
              console.log(`[CLEANUP] Removed duplicate tile (${x},${y}) from ${loser.owner} (kept by ${winner.owner})`);
              break;
            }
          }
        }
      } else {
        ownership.set(key, claimants[0].nation);
      }
    }

    return ownership;
  }

  getOwnershipMap(roomKey, nations, forceRebuild = false) {
    let ownershipMap = this.cachedOwnershipMap.get(roomKey);
    const cachedCount = this.cachedNationCount.get(roomKey) ?? 0;
    const currentCount = (nations || []).length;

    if (!ownershipMap || forceRebuild || cachedCount !== currentCount) {
      ownershipMap = this.buildInitialOwnershipMap(nations);
      this.cachedOwnershipMap.set(roomKey, ownershipMap);
      this.cachedNationCount.set(roomKey, currentCount);
    }
    return ownershipMap;
  }

  updateOwnershipMapFromDeltas(ownershipMap, nations) {
    for (const nation of nations) {
      const delta = nation.territoryDelta;
      if (!delta) continue;

      if (delta.add?.x && delta.add?.y) {
        for (let i = 0; i < delta.add.x.length; i++) {
          const key = `${delta.add.x[i]},${delta.add.y[i]}`;
          ownershipMap.set(key, nation);
        }
      }

      if (delta.sub?.x && delta.sub?.y) {
        for (let i = 0; i < delta.sub.x.length; i++) {
          const key = `${delta.sub.x[i]},${delta.sub.y[i]}`;
          if (ownershipMap.get(key) === nation) {
            ownershipMap.delete(key);
          }
        }
      }
    }
  }


  // ─── Process room ───────────────────────────────────────────────

  async processRoom(roomId) {
    const roomKey = roomId?.toString();

    if (this.roomMutationLocks.has(roomKey)) {
      return 0;
    }

    if (this.processingRooms.has(roomKey)) {
      console.warn(`[LOCK] Skipping room ${roomKey} - already being processed`);
      return 0;
    }
    this.processingRooms.add(roomKey);

    const startTime = process.hrtime();
    try {
      let gameRoom = this.cachedGameRoom.get(roomKey);
      if (!gameRoom) {
        const GameRoom = mongoose.model("GameRoom");
        gameRoom = await GameRoom.findById(roomKey);
        if (gameRoom) {
          this.cachedGameRoom.set(roomKey, gameRoom);
        }
      }
      if (!gameRoom || gameRoom.status !== "open" || !gameRoom?.gameState?.nations) {
        return;
      }

      if (!this.roomTickCount.has(roomKey)) {
        this.roomTickCount.set(roomKey, gameRoom.tickCount || 0);
      }
      const currentTick = this.roomTickCount.get(roomKey);

      let mapData = await this.getMapData(roomKey);
      if (!mapData) {
        console.error(`Failed to get map data for room ${roomKey}`);
        return;
      }

      const matrix = this.getMatrix(roomKey, mapData, gameRoom.gameState.nations);

      // 1. Snapshot ownership for delta derivation at end of tick
      matrix.snapshotOwnership();

      // 2. Compute bonuses
      const bonusesByOwner = computeBonusesByOwner(
        gameRoom.gameState.nations,
        mapData,
        gameRoom.gameState?.resourceUpgrades || null,
        gameRoom.gameState?.resourceNodeClaims || null
      );

      // 3. Loyalty diffusion + derive ownership from loyalty
      if (loyaltyEnabled) {
        tickLoyaltyDiffusion(matrix, config.loyalty, gameRoom.gameState.nations);
        deriveOwnershipFromLoyalty(matrix, config.loyalty?.ownershipThreshold || 0.6);
      }

      // 4. Population density + defense strength
      if (popDensityEnabled) {
        tickPopulationDensity(matrix, config.populationDensity, gameRoom.gameState.nations);
        computeDefenseStrength(
          matrix,
          gameRoom.gameState.nations,
          config.structures,
          config.populationDensity?.densityDefenseScale || 0.5,
          troopDensityEnabled ? (config.troopDensity?.troopDefenseScale || 0.8) : 0
        );
      }

      // 4.5 Troop density: mobilization + diffusion
      if (troopDensityEnabled) {
        tickMobilization(matrix, config.troopDensity, gameRoom.gameState.nations);
        tickTroopDensityDiffusion(matrix, config.troopDensity, gameRoom.gameState.nations);
      }

      // 5. Build ownershipMap for gameLogic.js compatibility
      const ownershipMap = this.getOwnershipMap(roomKey, gameRoom.gameState.nations);
      const nationOrder = [...gameRoom.gameState.nations];
      const botCount = nationOrder.filter(n => n.isBot && n.status !== 'defeated').length;
      const activeArrows = nationOrder.filter(n => n.arrowOrders?.attacks?.length > 0 || n.arrowOrders?.attack || n.arrowOrders?.defend).length;
      const botArrows = nationOrder.filter(n => n.isBot && (n.arrowOrders?.attacks?.length > 0 || n.arrowOrders?.attack)).length;

      const logInterval = process.env.DEBUG_TICKS === "true" ? 10 : 50;
      if (currentTick % logInterval === 0) {
        console.log(`[TICK ${currentTick}] Nations: ${nationOrder.length}, Bots: ${botCount}, BotArrows: ${botArrows}, PlayerArrows: ${activeArrows - botArrows}`);
      }

      // ═══ HYPOTHESIS DIAGNOSTICS (every 10 ticks, gated) ═══
      if (process.env.DEBUG_ARROWS === "true" && currentTick % 10 === 0) {
        for (const n of nationOrder) {
          const ao = n.arrowOrders;
          const attacksLen = ao?.attacks?.length || 0;
          const hasLegacySingular = !!ao?.attack;
          const hasDefend = !!ao?.defend;
          if (attacksLen > 0 || hasLegacySingular || hasDefend) {
            console.log(`[H-DIAG ${currentTick}] ${n.isBot ? 'BOT' : 'PLAYER'} "${n.name || n.owner}": attacks[]=${attacksLen}, attack(singular)=${hasLegacySingular}, defend=${hasDefend}${hasLegacySingular ? ' *** LEGACY FIELD PRESENT ***' : ''}`);
            if (attacksLen > 0) {
              ao.attacks.forEach((a, i) => {
                console.log(`  arrow[${i}] id=${a.id} power=${a.remainingPower?.toFixed(0)} status=${a.status} idx=${a.currentIndex}/${a.path?.length} age=${a.createdAt ? Date.now() - new Date(a.createdAt).getTime() : '?'}ms`);
              });
            }
            if (hasLegacySingular) {
              console.log(`  *** LEGACY attack(singular): id=${ao.attack?.id} power=${ao.attack?.remainingPower?.toFixed(0)} path=${ao.attack?.path?.length}`);
            }
          }
        }
      }

      for (let i = nationOrder.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [nationOrder[i], nationOrder[j]] = [nationOrder[j], nationOrder[i]];
      }

      // 6. Update nations (arrows write to both matrix and ownershipMap via gameLogic.js)
      const updatedNations = nationOrder.map((nation) =>
        updateNation(
          nation,
          mapData,
          gameRoom.gameState,
          ownershipMap,
          bonusesByOwner,
          currentTick,
          null,
          matrix
        )
      );

      // 7. Sync string-key caches from gameLogic.js changes (territory deltas)
      this.updateOwnershipMapFromDeltas(ownershipMap, updatedNations);
      const hasChanges = updatedNations.some(n =>
        (n.territoryDelta?.add?.x?.length || 0) > 0 ||
        (n.territoryDelta?.sub?.x?.length || 0) > 0
      );

      if (process.env.DEBUG_TICKS === "true" && currentTick % 10 === 0) {
        const changeDetails = updatedNations
          .filter(n => (n.territoryDelta?.add?.x?.length || 0) > 0)
          .map(n => `${n.isBot ? 'BOT' : 'PLAYER'}:${n.owner?.substring(0,8)}(+${n.territoryDelta.add.x.length})`)
          .join(', ');
        if (changeDetails) {
          console.log(`[TICK ${currentTick}] Territory changes: ${changeDetails}`);
        } else {
          console.log(`[TICK ${currentTick}] No territory changes`);
        }
      }

      // Territory deltas are consumed by updateOwnershipMapFromDeltas/updateFrontierSetsFromDeltas
      // above, then reset by applyMatrixToNations at step 12. No explicit reset needed here.

      // 7.5 Passive concavity fill — fill gaps between tendrils (cascading passes)
      const concavityMinNeighbors = config?.loyalty?.concavityFillMinNeighbors ?? 5;
      const concavityMaxPasses = config?.loyalty?.concavityFillMaxPasses ?? 3;
      passiveConcavityFill(matrix, updatedNations, concavityMinNeighbors, concavityMaxPasses);

      gameRoom.gameState.nations = updatedNations;

      // 8. Structure capture
      if (hasChanges) {
        handleStructureCaptureMatrix(gameRoom.gameState, matrix);
      }

      // 9. City auto-expansion
      applyCityAutoExpansionMatrix(gameRoom.gameState, matrix);

      // 10. Encirclement
      const encirclementInterval = config?.territorial?.encirclementCheckIntervalTicks ?? 6;
      if (hasChanges && currentTick % encirclementInterval === 0) {
        updateEncircledTerritoryMatrix(gameRoom.gameState, matrix);
      }

      // 11. Resource claims
      updateResourceNodeClaimsMatrix(gameRoom.gameState, mapData, matrix);
      applyResourceNodeIncome(gameRoom.gameState, mapData);

      // 12. Derive client-compatible deltas from matrix snapshot diff
      const stats = this.cachedMapStats.get(roomKey);
      applyMatrixToNations(matrix, updatedNations, stats?.totalClaimable || 0);

      gameRoom.markModified("gameState.resourceNodeClaims");
      gameRoom.markModified("gameState.encirclementClaims");
      gameRoom.markModified("gameState.nations");

      if (process.env.DEBUG_BOTS === "true") {
        const bc = (gameRoom.gameState.nations || []).filter((n) => n.isBot).length;
        console.log(`[BOTS] tick room=${roomKey} nations=${gameRoom.gameState.nations.length} bots=${bc}`);
      }

      const winCheckInterval = config?.territorial?.winConditionCheckIntervalTicks ?? 5;
      if (currentTick % winCheckInterval === 0) {
        const stats = this.cachedMapStats.get(roomKey);
        checkWinCondition(gameRoom.gameState, mapData, stats?.totalClaimable);
      }

      const nextTick = currentTick + 1;
      this.roomTickCount.set(roomKey, nextTick);
      gameRoom.tickCount = nextTick;

      const lastSave = this.lastSaveTick.get(roomKey) || 0;
      const ticksSinceLastSave = nextTick - lastSave;

      if (ticksSinceLastSave >= this.dbSaveIntervalTicks && !this.savingRooms.has(roomKey)) {
        this.savingRooms.add(roomKey);
        gameRoom.markModified("gameState.nations");

        // Serialize matrix state for persistence
        const matrix = this.cachedMatrix.get(roomKey);
        if (matrix) {
          gameRoom.matrixState = serializeMatrix(matrix);
          gameRoom.markModified("matrixState");
        }

        gameRoom.save()
          .then(() => {
            this.savingRooms.delete(roomKey);
            console.log(`[DB] Saved room ${roomKey} at tick ${nextTick}`);
          })
          .catch((err) => {
            this.savingRooms.delete(roomKey);
            if (err.name === "VersionError") {
              this.cachedGameRoom.delete(roomKey);
              this.cachedOwnershipMap.delete(roomKey);
              this.cachedMatrix.delete(roomKey);
              console.log(`[DB] Version conflict for room ${roomKey}, cache invalidated`);
            } else {
              console.error(`[DB] Error saving room ${roomKey}:`, err.message);
              // Reset lastSaveTick so we retry on the next interval instead of waiting
              this.lastSaveTick.set(roomKey, nextTick - this.dbSaveIntervalTicks + 5);
            }
          });
        this.lastSaveTick.set(roomKey, nextTick);
      }

      const now = Date.now();
      const last = this.lastBroadcast.get(roomKey) || 0;
      if (now - last >= this.broadcastIntervalMs) {
        this.lastBroadcast.set(roomKey, now);
        if (process.env.DEBUG_ARROWS === "true" && currentTick % 10 === 0) {
          for (const n of gameRoom.gameState.nations) {
            if (n.isBot) continue;
            const ao = n.arrowOrders;
            const atkCount = ao?.attacks?.length || 0;
            const legacyAtk = !!ao?.attack;
            const defend = !!ao?.defend;
            if (atkCount > 0 || legacyAtk || defend) {
              console.log(`[H1-BROADCAST] PLAYER "${n.name || n.owner}": broadcasting attacks[]=${atkCount} attack(singular)=${legacyAtk} defend=${defend}`);
            }
          }
        }
        broadcastRoomUpdate(roomKey, gameRoom, troopDensityEnabled ? matrix : null);
      }

      const elapsed = process.hrtime(startTime);
      const elapsedMs = elapsed[0] * 1000 + elapsed[1] / 1e6;
      if (process.env.DEBUG_TICKS === "true") {
        console.log(`Room ${roomId} processed in ${elapsedMs.toFixed(2)} ms`);
      }

      return elapsedMs;
    } catch (error) {
      if (error.name === "VersionError") {
        console.warn(
          `Tick update skipped for room ${roomKey} due to manual update conflict: ${error.message}`
        );
      } else {
        console.error(`Error processing room ${roomKey}:`, error);
      }
      return 0;
    } finally {
      this.processingRooms.delete(roomKey);
    }
  }

  async startRoom(roomId) {
    const roomKey = roomId?.toString();
    console.log(`[LOOP] startRoom called for ${roomKey}`);

    if (this.timers.has(roomKey) || this.loopIds.has(roomKey)) {
      console.log(`[LOOP] Room ${roomKey} already has a running loop, skipping`);
      return;
    }
    if (this.pendingRooms.has(roomKey)) {
      console.log(`[LOOP] Room ${roomKey} is already being initialized, skipping`);
      return;
    }
    this.pendingRooms.add(roomKey);
    console.log(`[LOOP] Initializing map data for room ${roomKey}`);

    const mapData = await this.initializeMapData(roomKey);
    if (!mapData) {
      console.error(`Failed to initialize map data for room ${roomKey}`);
      this.pendingRooms.delete(roomKey);
      return;
    }

    if (this.timers.has(roomKey)) {
      console.log(`[LOOP] Room ${roomKey} timer was created while initializing, skipping`);
      this.pendingRooms.delete(roomKey);
      return;
    }

    // Initialize matrix
    const gameRoom = await this.getLiveGameRoom(roomKey);
    if (gameRoom?.gameState?.nations) {
      this.getMatrix(roomKey, mapData, gameRoom.gameState.nations);
    }

    const loopId = Date.now() + Math.random();
    this.loopIds.set(roomKey, loopId);

    const tick = async () => {
      if (this.loopIds.get(roomKey) !== loopId) {
        console.log(`[LOOP] Old loop detected for ${roomKey}, stopping`);
        return;
      }
      if (!this.timers.has(roomKey)) return;

      const startTime = Date.now();
      let result = 0;
      try {
        result = await this.processRoom(roomKey);
      } catch (tickError) {
        console.error(`[TICK] Unhandled error in room ${roomKey}:`, tickError);
      }

      if (this.loopIds.get(roomKey) !== loopId || !this.timers.has(roomKey)) return;

      const elapsedTime = Date.now() - startTime;
      const remainingTime = Math.max(0, this.targetTickRate - elapsedTime);

      if (elapsedTime > this.targetTickRate) {
        console.warn(`Room ${roomKey} tick processing took ${elapsedTime}ms, exceeding target tick rate of ${this.targetTickRate}ms`);
      }

      const timer = setTimeout(tick, remainingTime);
      this.timers.set(roomKey, timer);
    };

    const timer = setTimeout(tick, 0);
    this.timers.set(roomKey, timer);
    this.pendingRooms.delete(roomKey);
    console.log(`[LOOP] Started room ${roomKey} (loopId: ${loopId.toFixed(0)}) [MATRIX]`);
  }

  async refreshRoomCache(roomId) {
    const roomKey = roomId?.toString();
    try {
      const GameRoom = mongoose.model("GameRoom");
      const freshRoom = await GameRoom.findById(roomKey);
      if (freshRoom) {
        this.cachedGameRoom.set(roomKey, freshRoom);
        this.cachedOwnershipMap.delete(roomKey);
        // Invalidate matrix cache so it gets rebuilt with new nation data
        this.cachedMatrix.delete(roomKey);
        console.log(`[LOOP] Cache refreshed for room ${roomKey}`);
      }
    } catch (err) {
      console.error(`[LOOP] Failed to refresh cache for room ${roomKey}:`, err.message);
    }
  }

  stopRoom(roomId) {
    const roomKey = roomId?.toString();
    this.pendingRooms.delete(roomKey);
    this.processingRooms.delete(roomKey);
    this.savingRooms.delete(roomKey);
    this.roomMutationLocks.delete(roomKey);
    this.loopIds.delete(roomKey);
    this.roomTickCount.delete(roomKey);
    const timer = this.timers.get(roomKey);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(roomKey);
      this.cachedGameRoom.delete(roomKey);
      this.cachedMapData.delete(roomKey);
      this.cachedMapStats.delete(roomKey);
      this.cachedOwnershipMap.delete(roomKey);
      this.cachedNationCount.delete(roomKey);
      this.cachedMatrix.delete(roomKey);
      this.lastSaveTick.delete(roomKey);
      this.lastBroadcast.delete(roomKey);
      console.log(`[LOOP] Stopped room ${roomKey}`);
    }
  }

  /** Graceful shutdown: save all active rooms to DB, then stop loops */
  async stopAllRooms() {
    const roomKeys = [...this.timers.keys()];
    console.log(`[LOOP] stopAllRooms: saving ${roomKeys.length} active room(s)...`);
    const GameRoomModel = mongoose.model("GameRoom");

    for (const roomKey of roomKeys) {
      try {
        const gameRoom = this.cachedGameRoom.get(roomKey);
        if (gameRoom) {
          // Serialize matrix state before saving
          const matrix = this.cachedMatrix.get(roomKey);
          if (matrix) {
            gameRoom.matrixState = serializeMatrix(matrix);
            gameRoom.markModified("matrixState");
          }
          gameRoom.markModified("gameState.nations");
          await gameRoom.save();
          console.log(`[LOOP] Saved room ${roomKey} during shutdown`);
        }
      } catch (err) {
        console.error(`[LOOP] Error saving room ${roomKey} during shutdown:`, err.message);
      }
      this.stopRoom(roomKey);
    }
    console.log(`[LOOP] All rooms stopped`);
  }
}

export const gameLoop = new GameLoop();
