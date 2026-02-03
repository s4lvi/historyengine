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

/**
 * Handle structure capture/destroy when territory changes hands
 * - Cities (town, capital) are transferred to the captor
 * - Towers are destroyed
 */
function handleStructureCapture(gameState, ownershipMap, nationsByOwner) {
  if (!gameState?.nations) return;

  for (const nation of gameState.nations) {
    if (!nation.cities || nation.cities.length === 0) continue;

    // Check each city/structure
    const citiesToRemove = [];
    const citiesToTransfer = [];

    for (let i = 0; i < nation.cities.length; i++) {
      const city = nation.cities[i];
      const key = `${city.x},${city.y}`;
      const tileOwner = ownershipMap.get(key);

      // If the tile is no longer owned by this nation
      if (!tileOwner || tileOwner.owner !== nation.owner) {
        if (city.type === "tower") {
          // Towers are destroyed
          citiesToRemove.push(i);
          console.log(`[STRUCTURE] Tower "${city.name}" at (${city.x},${city.y}) destroyed - territory lost by ${nation.owner}`);
        } else if (city.type === "town" || city.type === "capital") {
          // Cities are transferred to the captor
          if (tileOwner && tileOwner.owner) {
            citiesToTransfer.push({ cityIndex: i, newOwner: tileOwner.owner });
            console.log(`[STRUCTURE] City "${city.name}" at (${city.x},${city.y}) captured by ${tileOwner.owner} from ${nation.owner}`);
          } else {
            // No owner - destroy the city
            citiesToRemove.push(i);
          }
        }
      }
    }

    // Process transfers (cities go to new owner)
    for (const transfer of citiesToTransfer) {
      const city = nation.cities[transfer.cityIndex];
      const newOwnerNation = nationsByOwner.get(transfer.newOwner);
      if (newOwnerNation) {
        // Add to new owner (as a town, not capital)
        const transferredCity = {
          ...city,
          type: city.type === "capital" ? "town" : city.type
        };
        newOwnerNation.cities = newOwnerNation.cities || [];
        newOwnerNation.cities.push(transferredCity);
      }
    }

    // Remove captured/destroyed structures (in reverse order to preserve indices)
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
 * Apply city auto-expansion for towns
 * Towns slowly expand into adjacent unowned, non-ocean tiles
 */
function applyCityAutoExpansion(gameState, mapData, ownershipMap) {
  if (!gameState?.nations || !mapData) return;

  const townConfig = config?.structures?.town || {
    autoExpansionRadius: 3,
    autoExpansionRate: 0.3
  };
  const expansionRadius = townConfig.autoExpansionRadius;
  const expansionRate = townConfig.autoExpansionRate;

  if (expansionRate <= 0) return;

  const width = mapData[0]?.length || 0;
  const height = mapData.length || 0;
  const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  for (const nation of gameState.nations) {
    if (nation.status === "defeated") continue;
    if (!nation.cities) continue;

    // Find towns (not capitals - capitals don't auto-expand)
    const towns = nation.cities.filter((c) => c.type === "town");
    if (towns.length === 0) continue;

    for (const town of towns) {
      // Random chance based on expansion rate
      if (Math.random() > expansionRate) continue;

      // Find adjacent unowned tiles within expansion radius
      const candidates = [];
      for (let dy = -expansionRadius; dy <= expansionRadius; dy++) {
        for (let dx = -expansionRadius; dx <= expansionRadius; dx++) {
          const nx = town.x + dx;
          const ny = town.y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

          const key = `${nx},${ny}`;
          const tileOwner = ownershipMap.get(key);

          // Skip if already owned
          if (tileOwner) continue;

          // Check if it's valid terrain
          const cell = mapData[ny]?.[nx];
          if (!cell || cell.biome === "OCEAN") continue;

          // Check if adjacent to owned territory
          let adjacentToOwned = false;
          for (const [ddx, ddy] of neighbors) {
            const ax = nx + ddx;
            const ay = ny + ddy;
            const aKey = `${ax},${ay}`;
            if (ownershipMap.get(aKey)?.owner === nation.owner) {
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

      // Pick the closest candidate
      if (candidates.length > 0) {
        candidates.sort((a, b) => a.distance - b.distance);
        const target = candidates[0];
        addTerritoryCellToNation(nation, target.x, target.y);
        ownershipMap.set(`${target.x},${target.y}`, nation);
      }
    }
  }
}

function updateEncircledTerritory(gameState, mapData, ownershipMap) {
  if (!gameState || !mapData || !ownershipMap) return;
  const width = mapData[0]?.length || 0;
  const height = mapData.length || 0;
  if (!width || !height) return;

  const visited = new Set();
  const encircledUnowned = new Map(); // key -> encircler owner (for unowned cells)
  const encircledOwned = new Map(); // key -> { owner, encircler } (for enemy cells)
  const nationsByOwner = new Map(
    (gameState.nations || []).map((n) => [n.owner, n])
  );

  // Build a set of capital/city locations for each nation
  const capitalLocations = new Map(); // owner -> Set of "x,y" keys
  for (const nation of gameState.nations || []) {
    const citySet = new Set();
    for (const city of nation.cities || []) {
      citySet.add(`${city.x},${city.y}`);
    }
    capitalLocations.set(nation.owner, citySet);
  }

  const neighbors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  // Find all cells that don't connect to the map edge
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = mapData?.[y]?.[x];
      if (!cell || cell.biome === "OCEAN") continue;
      const key = `${x},${y}`;
      if (visited.has(key)) continue;
      const ownerId = ownershipMap.get(key)?.owner ?? null;
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

      if (!ownerId) {
        // Unowned territory - instant capture
        for (const cellKey of component) {
          encircledUnowned.set(cellKey, encircler);
        }
      } else {
        // Owned territory - check if it contains a capital
        const ownerCities = capitalLocations.get(ownerId) || new Set();
        let hasCapital = false;
        for (const cellKey of component) {
          if (ownerCities.has(cellKey)) {
            hasCapital = true;
            break;
          }
        }

        if (hasCapital) {
          // Has capital - mark for attack bonus only
          const nation = nationsByOwner.get(ownerId);
          if (nation) {
            nation.isEncircled = true;
            nation.encircledBy = encircler;
          }
        } else {
          // No capital - instant capture!
          for (const cellKey of component) {
            encircledOwned.set(cellKey, { owner: ownerId, encircler });
          }
        }
      }
    }
  }

  // Instant capture for unowned territory
  for (const [cellKey, encircler] of encircledUnowned.entries()) {
    const [xStr, yStr] = cellKey.split(",");
    const x = Number(xStr);
    const y = Number(yStr);

    const targetNation = nationsByOwner.get(encircler);
    if (targetNation) {
      addTerritoryCellToNation(targetNation, x, y);
      ownershipMap.set(cellKey, targetNation);
    }
  }

  // Instant capture for enemy territory WITHOUT capital
  for (const [cellKey, data] of encircledOwned.entries()) {
    const [xStr, yStr] = cellKey.split(",");
    const x = Number(xStr);
    const y = Number(yStr);

    // Remove from current owner
    const currentNation = nationsByOwner.get(data.owner);
    if (currentNation) {
      removeTerritoryCellFromNation(currentNation, x, y);
    }

    // Add to encircler
    const targetNation = nationsByOwner.get(data.encircler);
    if (targetNation) {
      addTerritoryCellToNation(targetNation, x, y);
      ownershipMap.set(cellKey, targetNation);
    } else {
      ownershipMap.delete(cellKey);
    }
  }

  if (encircledOwned.size > 0) {
    console.log(`[ENCIRCLE] Captured ${encircledOwned.size} enemy cells without capital`);
  }

  // Clear encircled flag for nations that are no longer encircled
  for (const nation of gameState.nations || []) {
    // Only clear if we didn't just set it above
    if (!nation.isEncircled) {
      nation.encircledBy = null;
    }
  }

  gameState.encirclementClaims = {};
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

function updateResourceNodeClaims(gameState, mapData, ownershipMapParam = null) {
  if (!gameState || !Array.isArray(mapData)) return;
  const claims = gameState.resourceNodeClaims || {};
  const captureTicks = config?.territorial?.resourceCaptureTicks ?? 20;
  // OPTIMIZATION 1: Use passed ownership map if available, otherwise build (fallback)
  const ownershipMap = ownershipMapParam || buildOwnershipMap(gameState.nations);
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
    this.cachedOwnershipMap = new Map(); // roomId -> Map<"x,y", nation> (OPTIMIZATION 1)
    this.cachedNationCount = new Map(); // roomId -> nation count for cache invalidation
    this.cachedFrontierSets = new Map(); // roomId -> Map<owner, Set<"x,y">> (OPTIMIZATION 3)
    this.lastSaveTick = new Map(); // roomId -> tick number (OPTIMIZATION 2)
    this.roomDirtyFlags = new Map(); // roomId -> boolean (OPTIMIZATION 2)
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
    this.dbSaveIntervalTicks = config?.territorial?.dbSaveIntervalTicks ?? 5; // OPTIMIZATION 2
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
              sampleCell = {
                x,
                y,
                biome: cell.biome,
                resources: resList,
                resourceNode: cell.resourceNode || null,
              };
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

  // Build ownership map from nations AND clean up any duplicate ownership
  // (tiles that exist in multiple nations' territory arrays)
  buildInitialOwnershipMap(nations) {
    const ownership = new Map();
    if (!Array.isArray(nations)) return ownership;

    // First pass: detect and collect all tiles and their claimants
    const tileClaims = new Map(); // key -> [nation1, nation2, ...]
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

    // Second pass: resolve conflicts and build ownership map
    for (const [key, claimants] of tileClaims.entries()) {
      if (claimants.length > 1) {
        // Multiple nations claim this tile - keep the first, remove from others
        const [xStr, yStr] = key.split(",");
        const x = Number(xStr);
        const y = Number(yStr);

        // Keep the first claimant (arbitrary but consistent)
        const winner = claimants[0].nation;
        ownership.set(key, winner);

        // Remove from all other claimants (in reverse index order to preserve indices)
        for (let i = claimants.length - 1; i >= 1; i--) {
          const loser = claimants[i].nation;
          // Find and remove this tile from the loser's territory
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
        // Only one claimant - normal case
        ownership.set(key, claimants[0].nation);
      }
    }

    return ownership;
  }

  // Get ownership map for a room - use cache when possible, rebuild when nation count changes
  getOwnershipMap(roomKey, nations, forceRebuild = false) {
    let ownershipMap = this.cachedOwnershipMap.get(roomKey);
    const cachedCount = this.cachedNationCount.get(roomKey) ?? 0;
    const currentCount = (nations || []).length;

    // Only rebuild if no cache, forced, or nation count changed
    if (!ownershipMap || forceRebuild || cachedCount !== currentCount) {
      ownershipMap = this.buildInitialOwnershipMap(nations);
      this.cachedOwnershipMap.set(roomKey, ownershipMap);
      this.cachedNationCount.set(roomKey, currentCount);
    }
    return ownershipMap;
  }

  // OPTIMIZATION 1: Update ownership map incrementally from territory deltas
  updateOwnershipMapFromDeltas(ownershipMap, nations) {
    for (const nation of nations) {
      const delta = nation.territoryDelta;
      if (!delta) continue;

      // Process additions
      if (delta.add?.x && delta.add?.y) {
        for (let i = 0; i < delta.add.x.length; i++) {
          const key = `${delta.add.x[i]},${delta.add.y[i]}`;
          ownershipMap.set(key, nation);
        }
      }

      // Process removals
      if (delta.sub?.x && delta.sub?.y) {
        for (let i = 0; i < delta.sub.x.length; i++) {
          const key = `${delta.sub.x[i]},${delta.sub.y[i]}`;
          // Only delete if this nation still owns it (might have been taken by another)
          if (ownershipMap.get(key) === nation) {
            ownershipMap.delete(key);
          }
        }
      }
    }
  }

  // OPTIMIZATION 3: Build initial frontier set for a nation
  buildFrontierSetForNation(nation, mapData, ownershipMap) {
    const frontier = new Set();
    if (!nation?.territory?.x || !nation?.territory?.y) return frontier;

    const width = mapData[0]?.length || 0;
    const height = mapData.length || 0;
    const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    for (let i = 0; i < nation.territory.x.length; i++) {
      const x = nation.territory.x[i];
      const y = nation.territory.y[i];

      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

        const key = `${nx},${ny}`;
        const owner = ownershipMap.get(key);
        if (owner?.owner === nation.owner) continue;

        const cell = mapData[ny]?.[nx];
        if (!cell || cell.biome === "OCEAN") continue;

        frontier.add(key);
      }
    }
    return frontier;
  }

  // OPTIMIZATION 3: Get or create cached frontier sets for a room
  getFrontierSets(roomKey, nations, mapData, ownershipMap) {
    let frontierSets = this.cachedFrontierSets.get(roomKey);
    if (!frontierSets) {
      frontierSets = new Map();
      this.cachedFrontierSets.set(roomKey, frontierSets);
    }

    // Check for any nations that don't have a frontier set yet (newly founded nations)
    for (const nation of nations) {
      if (nation.status === "defeated") continue;
      if (!frontierSets.has(nation.owner)) {
        const frontier = this.buildFrontierSetForNation(nation, mapData, ownershipMap);
        frontierSets.set(nation.owner, frontier);
      }
    }

    return frontierSets;
  }

  // OPTIMIZATION 3: Update frontier sets incrementally from territory deltas
  updateFrontierSetsFromDeltas(frontierSets, nations, mapData, ownershipMap) {
    const width = mapData[0]?.length || 0;
    const height = mapData.length || 0;
    const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    for (const nation of nations) {
      const delta = nation.territoryDelta;
      if (!delta) continue;

      let frontier = frontierSets.get(nation.owner);
      if (!frontier) {
        frontier = new Set();
        frontierSets.set(nation.owner, frontier);
      }

      // Process added tiles - they are no longer frontier, but their neighbors might be
      if (delta.add?.x && delta.add?.y) {
        for (let i = 0; i < delta.add.x.length; i++) {
          const x = delta.add.x[i];
          const y = delta.add.y[i];
          const key = `${x},${y}`;

          // This tile is no longer frontier for this nation
          frontier.delete(key);

          // Check neighbors - they might become frontier
          for (const [dx, dy] of neighbors) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

            const nKey = `${nx},${ny}`;
            const owner = ownershipMap.get(nKey);

            // If neighbor is not owned by this nation and is valid terrain, it's frontier
            if (owner?.owner !== nation.owner) {
              const cell = mapData[ny]?.[nx];
              if (cell && cell.biome !== "OCEAN") {
                frontier.add(nKey);
              }
            }
          }

          // This tile might become frontier for other nations
          for (const otherNation of nations) {
            if (otherNation.owner === nation.owner) continue;
            const otherFrontier = frontierSets.get(otherNation.owner);
            if (!otherFrontier) continue;

            // Check if any of the other nation's territory is adjacent
            let isAdjacentToOther = false;
            for (const [dx, dy] of neighbors) {
              const nx = x + dx;
              const ny = y + dy;
              const nKey = `${nx},${ny}`;
              if (ownershipMap.get(nKey)?.owner === otherNation.owner) {
                isAdjacentToOther = true;
                break;
              }
            }
            if (isAdjacentToOther) {
              otherFrontier.add(key);
            }
          }
        }
      }

      // Process removed tiles - they might become frontier again
      if (delta.sub?.x && delta.sub?.y) {
        for (let i = 0; i < delta.sub.x.length; i++) {
          const x = delta.sub.x[i];
          const y = delta.sub.y[i];
          const key = `${x},${y}`;

          // Check if this removed tile should become frontier
          let isAdjacentToOwned = false;
          for (const [dx, dy] of neighbors) {
            const nx = x + dx;
            const ny = y + dy;
            const nKey = `${nx},${ny}`;
            if (ownershipMap.get(nKey)?.owner === nation.owner) {
              isAdjacentToOwned = true;
              break;
            }
          }

          const cell = mapData[y]?.[x];
          if (isAdjacentToOwned && cell && cell.biome !== "OCEAN") {
            frontier.add(key);
          }

          // Neighbors might no longer be frontier if they were only adjacent via this tile
          for (const [dx, dy] of neighbors) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const nKey = `${nx},${ny}`;

            // If neighbor is in frontier, check if it's still valid
            if (frontier.has(nKey)) {
              let stillFrontier = false;
              for (const [ddx, ddy] of neighbors) {
                const nnx = nx + ddx;
                const nny = ny + ddy;
                const nnKey = `${nnx},${nny}`;
                if (ownershipMap.get(nnKey)?.owner === nation.owner) {
                  stillFrontier = true;
                  break;
                }
              }
              if (!stillFrontier) {
                frontier.delete(nKey);
              }
            }
          }
        }
      }
    }
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

      // OPTIMIZATION 1: Use cached ownership map instead of rebuilding
      const ownershipMap = this.getOwnershipMap(roomKey, gameRoom.gameState.nations);

      // OPTIMIZATION 3: Get cached frontier sets
      const frontierSets = this.getFrontierSets(roomKey, gameRoom.gameState.nations, mapData, ownershipMap);

      const bonusesByOwner = computeBonusesByOwner(
        gameRoom.gameState.nations,
        mapData,
        gameRoom.gameState?.resourceUpgrades || null,
        gameRoom.gameState?.resourceNodeClaims || null
      );

      const nationOrder = [...gameRoom.gameState.nations];
      const botCount = nationOrder.filter(n => n.isBot && n.status !== 'defeated').length;
      const activeArrows = nationOrder.filter(n => n.arrowOrders?.attack || n.arrowOrders?.defend).length;

      // Log nation counts every 50 ticks
      if (gameRoom.tickCount % 50 === 0) {
        console.log(`[TICK ${gameRoom.tickCount}] Nations: ${nationOrder.length}, Active bots: ${botCount}, Active arrows: ${activeArrows}`);
      }

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
          gameRoom.tickCount,
          frontierSets.get(nation.owner) // OPTIMIZATION 3: Pass frontier set
        )
      );

      // OPTIMIZATION 1 & 3: Update caches incrementally from deltas
      this.updateOwnershipMapFromDeltas(ownershipMap, updatedNations);
      this.updateFrontierSetsFromDeltas(frontierSets, updatedNations, mapData, ownershipMap);

      // Track if any changes occurred (OPTIMIZATION 2) - must check BEFORE resetting deltas
      const hasChanges = updatedNations.some(n =>
        (n.territoryDelta?.add?.x?.length || 0) > 0 ||
        (n.territoryDelta?.sub?.x?.length || 0) > 0
      );
      if (hasChanges) {
        this.roomDirtyFlags.set(roomKey, true);
      }

      // Reset territory deltas after they've been used for cache updates and change detection
      for (const nation of updatedNations) {
        if (nation.territoryDelta) {
          nation.territoryDelta = { add: { x: [], y: [] }, sub: { x: [], y: [] } };
        }
      }

      gameRoom.gameState.nations = updatedNations;

      // Build nationsByOwner map for structure handling
      const nationsByOwner = new Map(
        updatedNations.map((n) => [n.owner, n])
      );

      // Handle structure capture/destroy when territory changes hands
      if (hasChanges) {
        handleStructureCapture(gameRoom.gameState, ownershipMap, nationsByOwner);
      }

      // Apply city auto-expansion (slow passive expansion from towns)
      applyCityAutoExpansion(gameRoom.gameState, mapData, ownershipMap);
      // Only run encirclement check when territory actually changed (performance optimization)
      const encirclementInterval = config?.territorial?.encirclementCheckIntervalTicks ?? 6;
      if (
        hasChanges &&
        gameRoom.tickCount % encirclementInterval === 0
      ) {
        updateEncircledTerritory(
          gameRoom.gameState,
          mapData,
          ownershipMap
        );
      }
      updateResourceNodeClaims(gameRoom.gameState, mapData, ownershipMap); // Pass ownershipMap to avoid rebuild
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

      // OPTIMIZATION 2: Batched MongoDB saves - only save every N ticks or when dirty
      const lastSave = this.lastSaveTick.get(roomKey) || 0;
      const ticksSinceLastSave = gameRoom.tickCount - lastSave;
      const isDirty = this.roomDirtyFlags.get(roomKey) || false;

      if (ticksSinceLastSave >= this.dbSaveIntervalTicks || (isDirty && ticksSinceLastSave >= 1)) {
        gameRoom.markModified("gameState.nations");
        // Fire-and-forget save to avoid blocking the game loop
        gameRoom.save()
          .then(() => {
            if (process.env.DEBUG_TICKS === "true") {
              console.log(`[DB] Saved room ${roomKey} at tick ${gameRoom.tickCount}`);
            }
          })
          .catch((err) => console.error(`[DB] Error saving room ${roomKey}:`, err.message));
        this.lastSaveTick.set(roomKey, gameRoom.tickCount);
        this.roomDirtyFlags.set(roomKey, false);
      }

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
      let processingTime = 0;

      try {
        processingTime = await this.processRoom(roomKey);
      } catch (tickError) {
        // Catch any errors that escape processRoom's try-catch
        console.error(`[TICK] Unhandled error in room ${roomKey}:`, tickError);
      }

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
      this.cachedOwnershipMap.delete(roomKey); // OPTIMIZATION 1
      this.cachedNationCount.delete(roomKey); // OPTIMIZATION 1
      this.cachedFrontierSets.delete(roomKey); // OPTIMIZATION 3
      this.lastSaveTick.delete(roomKey); // OPTIMIZATION 2
      this.roomDirtyFlags.delete(roomKey); // OPTIMIZATION 2
      this.lastBroadcast.delete(roomKey);
      console.log(`Stopped game loop and cleared cache for room ${roomKey}`);
    }
  }
}

export const gameLoop = new GameLoop();
