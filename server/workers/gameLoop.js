// gameLoop.js
import mongoose from "mongoose";
import { updateNation, checkWinCondition } from "../utils/gameLogic.js";
import {
  computeBonusesByOwner,
  getNodeMultiplier,
} from "../utils/territorialUtils.js";
import { broadcastRoomUpdate } from "../wsHub.js";
import config from "../config/config.js";
import { TerritoryMatrix, UNOWNED } from "../utils/TerritoryMatrix.js";
import { detectEncirclement, passiveConcavityFill } from "../utils/matrixKernels.js";
import { applyMatrixToNations } from "../utils/matrixCompat.js";
import { tickLoyaltyDiffusion } from "../utils/matrixLoyalty.js";
import { tickPopulationDensity, computeDefenseStrength } from "../utils/matrixPopulation.js";
import { tickMobilization, tickTroopDensityDiffusion } from "../utils/matrixTroopDensity.js";
import { deriveOwnershipFromLoyalty } from "../utils/matrixKernels.js";
import { serializeMatrix, deserializeMatrix } from "../utils/matrixSerializer.js";
import { generateRegions } from "../utils/regionGenerator.js";
import { debug, debugWarn } from "../utils/debug.js";

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
          debug(`[STRUCTURE] Tower "${city.name}" at (${city.x},${city.y}) destroyed - territory lost by ${nation.owner}`);
        } else if (city.type === "town" || city.type === "capital") {
          if (tileOwnerStr) {
            citiesToTransfer.push({ cityIndex: i, newOwner: tileOwnerStr });
            debug(`[STRUCTURE] City "${city.name}" at (${city.x},${city.y}) captured by ${tileOwnerStr} from ${nation.owner}`);
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

    if (allToRemove.length > 0) {
      for (const idx of allToRemove) {
        nation.cities.splice(idx, 1);
      }
      // Invalidate loyalty city bonus cache
      matrix._cityBonusVersion = (matrix._cityBonusVersion || 0) + 1;
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
        matrix.setOwnerByIndex(ci, encirclerIdx);
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
        matrix.setOwnerByIndex(ci, encirclerIdx);
        // Heavily reduce old owner's loyalty and set encircler's loyalty
        matrix.loyalty[ownerIdx * matrix.size + ci] *= 0.15;
        matrix.loyalty[encirclerIdx * matrix.size + ci] = 1.0;
      }
      debug(`[ENCIRCLE] Captured ${cells.length} enemy cells without capital`);
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
// Cached resource node positions — extracted once per map instead of scanning each tick
const cachedResourceNodes = new Map(); // mapKey -> [{x, y, type}]

function getResourceNodePositions(mapData, width, height, mapKey) {
  if (cachedResourceNodes.has(mapKey)) return cachedResourceNodes.get(mapKey);
  const nodes = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = mapData?.[y]?.[x];
      if (cell?.resourceNode?.type) {
        nodes.push({ x, y, type: cell.resourceNode.type });
      }
    }
  }
  cachedResourceNodes.set(mapKey, nodes);
  return nodes;
}

function updateResourceNodeClaimsMatrix(gameState, mapData, matrix, mapKey) {
  if (!gameState || !Array.isArray(mapData)) return;
  const claims = gameState.resourceNodeClaims || {};
  const captureTicks = config?.territorial?.resourceCaptureTicks ?? 20;

  // Use cached node positions — O(nodes) instead of O(width*height)
  const nodes = getResourceNodePositions(mapData, matrix.width, matrix.height, mapKey);

  const seen = new Set();

  for (const node of nodes) {
    const { x, y, type } = node;
    const ownerIdx = matrix.getOwner(x, y);
    if (ownerIdx === UNOWNED) continue;

    const ownerId = matrix.getOwnerByIndex(ownerIdx);
    if (!ownerId) continue;

    const key = `${x},${y}`;
    seen.add(key);

    let claim = claims[key];
    if (!claim) {
      claim = {
        type,
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
      claim.type = type;
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
    claim.type = type;
    claims[key] = claim;
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

function normalizeRuntimeCell(cell) {
  if (!cell || typeof cell !== "object") return null;

  const nodeType = cell.resourceNode?.type || null;
  const nodeLevel = Number(cell.resourceNode?.level) || 0;

  return {
    biome: cell.biome || "OCEAN",
    elevation: Number(cell.elevation) || 0,
    moisture: Number(cell.moisture) || 0,
    temperature: Number(cell.temperature) || 0,
    isRiver: !!cell.isRiver,
    ...(Array.isArray(cell.resources) && cell.resources.length > 0
      ? { resources: cell.resources.filter(Boolean) }
      : {}),
    ...(nodeType ? { resourceNode: { type: nodeType, level: nodeLevel } } : {}),
  };
}

class GameLoop {
  constructor() {
    this.timers = new Map();
    this.cachedMapData = new Map();
    this.cachedMapStats = new Map();
    this.cachedGameRoom = new Map();
    this.cachedMatrix = new Map(); // roomId -> TerritoryMatrix
    this.cachedRegionData = new Map(); // roomId -> { seeds, assignment, regionCount, width, height }
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
  getMatrix(roomKey, mapData, nations, matrixState) {
    let matrix = this.cachedMatrix.get(roomKey);
    if (!matrix) {
      // Try to restore from persisted matrixState first
      if (matrixState) {
        try {
          matrix = deserializeMatrix(matrixState, mapData, config?.matrix);
          if (matrix) {
            // Ensure all active nations are registered in the restored matrix
            for (const nation of nations) {
              if (nation.status === "defeated") continue;
              if (!matrix.ownerToIndex.has(nation.owner)) {
                matrix.getNationIndex(nation.owner);
              }
            }
            this.cachedMatrix.set(roomKey, matrix);
            debug(`[MATRIX] Restored ${matrix.width}x${matrix.height} matrix for room ${roomKey} from DB (${matrix.nextNationSlot} nations)`);
            return matrix;
          }
        } catch (err) {
          debugWarn(`[MATRIX] Failed to deserialize matrix for room ${roomKey}, building from scratch:`, err.message);
        }
      }

      const height = mapData.length;
      const width = mapData[0]?.length || 0;
      const configuredMaxNations = Math.max(
        1,
        Number(config?.matrix?.maxNations) || 64
      );
      const activeNationCount = Math.max(
        1,
        (nations || []).filter((n) => n?.status !== "defeated").length
      );
      const desiredNationSlots = Math.max(16, activeNationCount + 8);
      const maxNations = Math.min(configuredMaxNations, desiredNationSlots);
      matrix = new TerritoryMatrix(width, height, maxNations);
      matrix.initFromMapData(mapData, config?.matrix);
      matrix.populateFromNations(nations);
      this.cachedMatrix.set(roomKey, matrix);
      debug(`[MATRIX] Created ${width}x${height} matrix for room ${roomKey} (${matrix.nextNationSlot} nations)`);
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

  /** Get the cached matrix for a room (or null if not yet created) */
  getCachedMatrix(roomKey) {
    return this.cachedMatrix.get(roomKey) || null;
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
        matrix.setOwnerByIndex(i, UNOWNED);
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
    debug(`Initializing map data for room ${roomKey}`);
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

            mapData[startRow + rowIndex] = processedRow.map((cell) =>
              normalizeRuntimeCell(cell)
            );
          }
        });
      });

      mapData = mapData.map((row) => {
        if (!Array.isArray(row)) {
          debugWarn("Converting non-array row to array");
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
        debug(`[RESOURCES] init room=${roomKey} counts`, resourceCounts);
        debug(`[RESOURCES] init room=${roomKey} sample`, sampleCell);
        debug(`[RESOURCES] init room=${roomKey} biomeCounts`, biomeCounts);
      }
      for (let y = 0; y < mapData.length; y++) {
        for (let x = 0; x < mapData[0].length; x++) {
          const cell = mapData[y][x];
          if (cell && cell.biome !== "OCEAN") totalClaimable++;
        }
      }
      this.cachedMapStats.set(roomKey, { totalClaimable });
      debug(
        `Map data cached successfully for room ${roomKey}. Dimensions: ${mapData.length}x${mapData[0].length}`
      );

      // Lazy-generate region data if not already persisted
      if (config?.regions?.enabled !== false) {
        try {
          const MapRegion = mongoose.model("MapRegion");
          let regionDoc = await MapRegion.findOne({ map: gameMap._id }).lean();
          if (!regionDoc) {
            debug(`[REGIONS] Generating regions for map ${gameMap._id}`);
            const regionData = generateRegions(mapData, gameMap.width, gameMap.height, gameMap.seed || 0, config.regions);
            regionDoc = await MapRegion.create({
              map: gameMap._id,
              width: gameMap.width,
              height: gameMap.height,
              regionCount: regionData.regionCount,
              seeds: regionData.seeds,
              assignmentBuffer: Buffer.from(regionData.assignment.buffer),
            });
            debug(`[REGIONS] Generated ${regionData.regionCount} regions for map ${gameMap._id}`);
          }
          // Cache the assignment as Uint16Array
          const assignment = new Uint16Array(
            regionDoc.assignmentBuffer.buffer.slice(
              regionDoc.assignmentBuffer.byteOffset,
              regionDoc.assignmentBuffer.byteOffset + regionDoc.assignmentBuffer.byteLength
            )
          );
          this.cachedRegionData.set(roomKey, {
            seeds: regionDoc.seeds,
            assignment,
            regionCount: regionDoc.regionCount,
            width: regionDoc.width,
            height: regionDoc.height,
          });
        } catch (regionErr) {
          console.error(`[REGIONS] Error loading/generating regions for room ${roomKey}:`, regionErr);
        }
      }

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
      debug(`Cache miss for room ${roomKey}, initializing map data`);
      mapData = await this.initializeMapData(roomKey);
    }
    return mapData;
  }

  getRegionData(roomId) {
    const roomKey = roomId?.toString();
    return this.cachedRegionData.get(roomKey) || null;
  }

  getCachedGameRoom(roomId) {
    const roomKey = roomId?.toString();
    return this.cachedGameRoom.get(roomKey) || null;
  }

  async getLiveGameRoom(roomId) {
    const roomKey = roomId?.toString();
    let gameRoom = this.cachedGameRoom.get(roomKey);
    if (
      gameRoom &&
      (gameRoom.status === "initializing" || gameRoom.status === "error")
    ) {
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
              debug(`[CLEANUP] Removed duplicate tile (${x},${y}) from ${loser.owner} (kept by ${winner.owner})`);
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
      debugWarn(`[LOCK] Skipping room ${roomKey} - already being processed`);
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

      const matrix = this.getMatrix(roomKey, mapData, gameRoom.gameState.nations, gameRoom.matrixState);

      // ── Tick profiling ──
      const _perf = {};
      let _t = performance.now();

      // 1. Snapshot ownership for delta derivation at end of tick
      matrix.snapshotOwnership();

      // 2. Compute bonuses
      const bonusesByOwner = computeBonusesByOwner(
        gameRoom.gameState.nations,
        mapData,
        gameRoom.gameState?.resourceUpgrades || null,
        gameRoom.gameState?.resourceNodeClaims || null
      );
      _perf.bonuses = performance.now() - _t; _t = performance.now();

      // 3. Loyalty diffusion + derive ownership from loyalty
      if (loyaltyEnabled) {
        tickLoyaltyDiffusion(matrix, config.loyalty, gameRoom.gameState.nations);
        deriveOwnershipFromLoyalty(matrix, config.loyalty?.ownershipThreshold || 0.6);
      }
      _perf.loyalty = performance.now() - _t; _t = performance.now();

      // 4. Population density diffusion (every 2 ticks — diffusion doesn't need per-tick resolution)
      const regionData = this.cachedRegionData.get(roomKey) || null;
      const runDiffusion = currentTick % 2 === 0;
      if (popDensityEnabled && runDiffusion) {
        tickPopulationDensity(matrix, config.populationDensity, gameRoom.gameState.nations, regionData, config.regions);
      }
      _perf.popDensity = performance.now() - _t; _t = performance.now();

      // 4.5 Troop density: mobilization + diffusion every tick (sub-steps handle speed)
      if (troopDensityEnabled) {
        tickMobilization(matrix, config.troopDensity, gameRoom.gameState.nations);
        _perf.mobilization = performance.now() - _t; _t = performance.now();
        tickTroopDensityDiffusion(matrix, config.troopDensity, gameRoom.gameState.nations);
      }
      _perf.troopDensity = performance.now() - _t; _t = performance.now();

      // 4.6 Defense strength (every 2 ticks — recompute after diffusion ticks)
      if (popDensityEnabled && runDiffusion) {
        computeDefenseStrength(
          matrix,
          gameRoom.gameState.nations,
          config.structures,
          config.populationDensity?.densityDefenseScale || 0.5,
          troopDensityEnabled ? (config.troopDensity?.troopDefenseScale || 0.8) : 0,
          regionData,
          config.regions
        );
      }
      _perf.defense = performance.now() - _t; _t = performance.now();

      // 4.7 Chunk maintenance: rebuild border flags periodically, tick sleep counters
      if (currentTick % 5 === 0) {
        matrix.rebuildChunkBorderFlags();
      }
      matrix.tickChunkSleep();

      // 5. Build ownershipMap for gameLogic.js compatibility
      const ownershipMap = matrix
        ? null
        : this.getOwnershipMap(roomKey, gameRoom.gameState.nations);
      const nationOrder = [...gameRoom.gameState.nations];
      const botCount = nationOrder.filter(n => n.isBot && n.status !== 'defeated').length;
      const activeArrows = nationOrder.filter(n => n.arrowOrders?.attacks?.length > 0 || n.arrowOrders?.attack || n.arrowOrders?.defend).length;
      const botArrows = nationOrder.filter(n => n.isBot && (n.arrowOrders?.attacks?.length > 0 || n.arrowOrders?.attack)).length;

      const logInterval = process.env.DEBUG_TICKS === "true" ? 10 : 50;
      if (currentTick % logInterval === 0) {
        debug(`[TICK ${currentTick}] Nations: ${nationOrder.length}, Bots: ${botCount}, BotArrows: ${botArrows}, PlayerArrows: ${activeArrows - botArrows}`);
      }

      // ═══ HYPOTHESIS DIAGNOSTICS (every 10 ticks, gated) ═══
      if (process.env.DEBUG_ARROWS === "true" && currentTick % 10 === 0) {
        for (const n of nationOrder) {
          const ao = n.arrowOrders;
          const attacksLen = ao?.attacks?.length || 0;
          const hasLegacySingular = !!ao?.attack;
          const hasDefend = !!ao?.defend;
          if (attacksLen > 0 || hasLegacySingular || hasDefend) {
            debug(`[H-DIAG ${currentTick}] ${n.isBot ? 'BOT' : 'PLAYER'} "${n.name || n.owner}": attacks[]=${attacksLen}, attack(singular)=${hasLegacySingular}, defend=${hasDefend}${hasLegacySingular ? ' *** LEGACY FIELD PRESENT ***' : ''}`);
            if (attacksLen > 0) {
              ao.attacks.forEach((a, i) => {
                debug(`  arrow[${i}] id=${a.id} power=${a.remainingPower?.toFixed(0)} status=${a.status} idx=${a.currentIndex}/${a.path?.length} age=${a.createdAt ? Date.now() - new Date(a.createdAt).getTime() : '?'}ms`);
              });
            }
            if (hasLegacySingular) {
              debug(`  *** LEGACY attack(singular): id=${ao.attack?.id} power=${ao.attack?.remainingPower?.toFixed(0)} path=${ao.attack?.path?.length}`);
            }
          }
        }
      }

      for (let i = nationOrder.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [nationOrder[i], nationOrder[j]] = [nationOrder[j], nationOrder[i]];
      }

      _perf.ownershipMap = performance.now() - _t; _t = performance.now();

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
          matrix,
          regionData
        )
      );
      _perf.updateNations = performance.now() - _t; _t = performance.now();

      // 7. Sync string-key caches from gameLogic.js changes (territory deltas)
      if (ownershipMap) {
        this.updateOwnershipMapFromDeltas(ownershipMap, updatedNations);
      }
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
          debug(`[TICK ${currentTick}] Territory changes: ${changeDetails}`);
        } else {
          debug(`[TICK ${currentTick}] No territory changes`);
        }
      }

      // Territory deltas are consumed by updateOwnershipMapFromDeltas/updateFrontierSetsFromDeltas
      // above, then reset by applyMatrixToNations at step 12. No explicit reset needed here.

      // 7.5 Passive concavity fill — fill gaps between tendrils (every 3 ticks)
      if (currentTick % 3 === 0) {
        const concavityMinNeighbors = config?.loyalty?.concavityFillMinNeighbors ?? 5;
        const concavityMaxPasses = config?.loyalty?.concavityFillMaxPasses ?? 3;
        passiveConcavityFill(matrix, updatedNations, concavityMinNeighbors, concavityMaxPasses);
      }
      _perf.concavity = performance.now() - _t; _t = performance.now();

      gameRoom.gameState.nations = updatedNations;

      // 8. City auto-expansion (modifies matrix directly)
      applyCityAutoExpansionMatrix(gameRoom.gameState, matrix);

      // 9. Encirclement (runs before structure capture so encircled structures get handled)
      const encirclementInterval = config?.territorial?.encirclementCheckIntervalTicks ?? 6;
      if (currentTick % encirclementInterval === 0) {
        updateEncircledTerritoryMatrix(gameRoom.gameState, matrix);
      }
      _perf.encirclement = performance.now() - _t; _t = performance.now();

      // 9.5 ownershipMap no longer force-rebuilt every tick.
      // Matrix typed-array lookups replaced all hot-path ownershipMap reads in gameLogic.js.
      // The cached ownershipMap is still kept for cold paths (legacy fallback, buildCellInfo, etc.)
      // and updated via delta sync at step 7.

      // 10. Structure capture (after encirclement so encircled structures are correctly handled)
      handleStructureCaptureMatrix(gameRoom.gameState, matrix);

      // 11. Resource claims
      updateResourceNodeClaimsMatrix(gameRoom.gameState, mapData, matrix, roomKey);
      applyResourceNodeIncome(gameRoom.gameState, mapData);
      _perf.resources = performance.now() - _t; _t = performance.now();

      // 12. Derive client-compatible deltas from matrix snapshot diff
      const stats = this.cachedMapStats.get(roomKey);
      applyMatrixToNations(matrix, updatedNations, stats?.totalClaimable || 0);
      _perf.matrixSync = performance.now() - _t; _t = performance.now();

      gameRoom.markModified("gameState.resourceNodeClaims");
      gameRoom.markModified("gameState.encirclementClaims");
      gameRoom.markModified("gameState.nations");

      if (process.env.DEBUG_BOTS === "true") {
        const bc = (gameRoom.gameState.nations || []).filter((n) => n.isBot).length;
        debug(`[BOTS] tick room=${roomKey} nations=${gameRoom.gameState.nations.length} bots=${bc}`);
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
            debug(`[DB] Saved room ${roomKey} at tick ${nextTick}`);
          })
          .catch((err) => {
            this.savingRooms.delete(roomKey);
            if (err.name === "VersionError") {
              // Only invalidate the gameRoom and ownershipMap caches.
              // The matrix holds accumulated loyalty/density state that is
              // independent of Mongoose versioning — preserve it.
              this.cachedGameRoom.delete(roomKey);
              this.cachedOwnershipMap.delete(roomKey);
              debug(`[DB] Version conflict for room ${roomKey}, gameRoom cache invalidated (matrix preserved)`);
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
              debug(`[H1-BROADCAST] PLAYER "${n.name || n.owner}": broadcasting attacks[]=${atkCount} attack(singular)=${legacyAtk} defend=${defend}`);
            }
          }
        }
        broadcastRoomUpdate(roomKey, gameRoom, troopDensityEnabled ? matrix : null);
      }
      _perf.broadcast = performance.now() - _t;

      const elapsed = process.hrtime(startTime);
      const elapsedMs = elapsed[0] * 1000 + elapsed[1] / 1e6;

      // ── Tick profiling summary ──
      const perfThreshold = Number(process.env.PERF_THRESHOLD_MS) || 50;
      const perfInterval = Number(process.env.PERF_LOG_INTERVAL) || 50;
      if (elapsedMs > perfThreshold || currentTick % perfInterval === 0) {
        const parts = Object.entries(_perf)
          .filter(([, ms]) => ms >= 0.1)
          .sort((a, b) => b[1] - a[1])
          .map(([k, ms]) => `${k}=${ms.toFixed(1)}`)
          .join(' ');
        const nCount = gameRoom.gameState.nations?.length || 0;
        debug(`[PERF tick=${currentTick}] ${elapsedMs.toFixed(1)}ms | nations=${nCount} | ${parts}`);
      }

      if (process.env.DEBUG_TICKS === "true") {
        debug(`Room ${roomId} processed in ${elapsedMs.toFixed(2)} ms`);
      }

      return elapsedMs;
    } catch (error) {
      if (error.name === "VersionError") {
        debugWarn(
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
    debug(`[LOOP] startRoom called for ${roomKey}`);

    if (this.timers.has(roomKey) || this.loopIds.has(roomKey)) {
      debug(`[LOOP] Room ${roomKey} already has a running loop, skipping`);
      return;
    }
    if (this.pendingRooms.has(roomKey)) {
      debug(`[LOOP] Room ${roomKey} is already being initialized, skipping`);
      return;
    }
    this.pendingRooms.add(roomKey);
    debug(`[LOOP] Initializing map data for room ${roomKey}`);

    const mapData = await this.initializeMapData(roomKey);
    if (!mapData) {
      console.error(`Failed to initialize map data for room ${roomKey}`);
      this.pendingRooms.delete(roomKey);
      return;
    }

    if (this.timers.has(roomKey)) {
      debug(`[LOOP] Room ${roomKey} timer was created while initializing, skipping`);
      this.pendingRooms.delete(roomKey);
      return;
    }

    // Initialize matrix (restore from DB if available)
    const gameRoom = await this.getLiveGameRoom(roomKey);
    if (gameRoom?.gameState?.nations) {
      this.getMatrix(roomKey, mapData, gameRoom.gameState.nations, gameRoom.matrixState);
    }

    const loopId = Date.now() + Math.random();
    this.loopIds.set(roomKey, loopId);

    const tick = async () => {
      if (this.loopIds.get(roomKey) !== loopId) {
        debug(`[LOOP] Old loop detected for ${roomKey}, stopping`);
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
        debugWarn(`Room ${roomKey} tick processing took ${elapsedTime}ms, exceeding target tick rate of ${this.targetTickRate}ms`);
      }

      const timer = setTimeout(tick, remainingTime);
      this.timers.set(roomKey, timer);
    };

    const timer = setTimeout(tick, 0);
    this.timers.set(roomKey, timer);
    this.pendingRooms.delete(roomKey);
    debug(`[LOOP] Started room ${roomKey} (loopId: ${loopId.toFixed(0)}) [MATRIX]`);
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
        debug(`[LOOP] Cache refreshed for room ${roomKey}`);
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
      this.cachedRegionData.delete(roomKey);
      this.lastSaveTick.delete(roomKey);
      this.lastBroadcast.delete(roomKey);
      cachedResourceNodes.delete(roomKey);
      debug(`[LOOP] Stopped room ${roomKey}`);
    }
  }

  /** Graceful shutdown: save all active rooms to DB, then stop loops */
  async stopAllRooms() {
    const roomKeys = [...this.timers.keys()];
    debug(`[LOOP] stopAllRooms: saving ${roomKeys.length} active room(s)...`);

    // Stop all tick timers FIRST to prevent races during serialization
    for (const roomKey of roomKeys) {
      const timer = this.timers.get(roomKey);
      if (timer) clearTimeout(timer);
      this.timers.delete(roomKey);
      this.pendingRooms.delete(roomKey);
      this.processingRooms.delete(roomKey);
    }

    // Now safely serialize and save each room
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
          debug(`[LOOP] Saved room ${roomKey} during shutdown`);
        }
      } catch (err) {
        console.error(`[LOOP] Error saving room ${roomKey} during shutdown:`, err.message);
      }
      // Clean up remaining caches
      this.cachedGameRoom.delete(roomKey);
      this.cachedMapData.delete(roomKey);
      this.cachedMapStats.delete(roomKey);
      this.cachedOwnershipMap.delete(roomKey);
      this.cachedNationCount.delete(roomKey);
      this.cachedMatrix.delete(roomKey);
      this.lastSaveTick.delete(roomKey);
      this.lastBroadcast.delete(roomKey);
      this.savingRooms.delete(roomKey);
      this.roomMutationLocks.delete(roomKey);
      this.loopIds.delete(roomKey);
      this.roomTickCount.delete(roomKey);
      cachedResourceNodes.delete(roomKey);
      debug(`[LOOP] Stopped room ${roomKey}`);
    }
    debug(`[LOOP] All rooms stopped`);
  }
}

export const gameLoop = new GameLoop();
