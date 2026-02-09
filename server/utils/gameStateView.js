import { packTerritoryDelta } from "./packedDelta.js";
import { buildTroopDensityPayload } from "./matrixTroopDensity.js";

// Strip internal caches from nation object before sending to client
function stripInternalCaches(nation) {
  const {
    _territorySet,
    _borderSet,
    _disconnectedCells,
    _cachedDensityMap,
    territoryDelta, // Internal delta, not for client
    ...clean
  } = nation;
  return clean;
}

export function buildGameStateResponse(gameRoom, userId, full = false, matrix = null) {
  if (process.env.DEBUG_GAMESTATE === "true") {
    const nations = gameRoom.gameState?.nations || [];
    const botCount = nations.filter((n) => n.isBot).length;
    console.log(
      `[GAMESTATE] room=${gameRoom._id} user=${userId} full=${full} nations=${nations.length} bots=${botCount}`
    );
  }

  // Use packed deltas for smaller payloads (enable via env var)
  const usePackedDeltas = process.env.USE_PACKED_DELTAS === "true";

  const filterNation = (nation) => {
    if (nation.status === "defeated") {
      return {
        owner: nation.owner,
        status: "defeated",
      };
    }

    const cleanNation = stripInternalCaches(nation);
    const isOwner = nation.owner === userId;

    // Strip sensitive data from enemy nations
    if (!isOwner) {
      const {
        arrowOrders,
        resources,
        population,
        maxPopulation,
        nationalWill,
        _currentTick,
        lastBotOrderTick,
        troopCount,
        troopTarget,
        ...publicNation
      } = cleanNation;

      if (full) {
        return {
          ...publicNation,
          territoryDeltaForClient: null,
          packedDelta: null,
        };
      }

      const { territory, territoryLoyalty, ...rest } = publicNation;
      const delta = nation.territoryDeltaForClient || {
        add: { x: [], y: [] },
        sub: { x: [], y: [] },
      };
      const packedDelta = usePackedDeltas ? packTerritoryDelta(delta) : null;

      return {
        ...rest,
        ...(usePackedDeltas
          ? { packedDelta }
          : { territoryDeltaForClient: delta }),
      };
    }

    // Add troop density data for the player's own nation
    // Throttle density map to every 5 ticks to prevent heatmap flashing
    let troopDensityData = {};
    if (matrix && nation.troopCount != null) {
      const nIdx = matrix.ownerToIndex?.get(nation.owner);
      if (nIdx !== undefined) {
        const maxDensity = 50; // config.troopDensity.maxDensityPerCell
        const tickCount = gameRoom.tickCount || 0;
        const shouldUpdateMap = tickCount % 5 === 0 || full;
        let densityMap;
        if (shouldUpdateMap) {
          densityMap = buildTroopDensityPayload(matrix, nIdx, maxDensity, 0.1);
          // Cache on nation for subsequent ticks
          nation._cachedDensityMap = densityMap;
        } else {
          densityMap = nation._cachedDensityMap || null;
        }
        troopDensityData = {
          troopCount: Math.round(nation.troopCount),
          troopTarget: nation.troopTarget ?? 0.2,
          ...(densityMap ? { troopDensityMap: densityMap } : {}),
        };
      }
    }

    if (full) {
      return {
        ...cleanNation,
        ...troopDensityData,
        territoryLoyalty: nation.territoryLoyalty || {},
        territoryDeltaForClient: null, // Full mode sends complete territory
        packedDelta: null,
      };
    }

    const { territory, territoryLoyalty, ...rest } = cleanNation;
    const delta = nation.territoryDeltaForClient || {
      add: { x: [], y: [] },
      sub: { x: [], y: [] },
    };

    // Pack delta for smaller payload if enabled
    const packedDelta = usePackedDeltas ? packTerritoryDelta(delta) : null;

    return {
      ...rest,
      ...troopDensityData,
      // Send packed format if enabled, otherwise send original format
      ...(usePackedDeltas
        ? { packedDelta }
        : { territoryDeltaForClient: delta }),
    };
  };

  const filteredGameState = {
    ...gameRoom.gameState,
    nations: (gameRoom.gameState?.nations || []).map(filterNation),
  };

  return {
    tickCount: gameRoom.tickCount,
    roomName: gameRoom.roomName,
    roomCreator: gameRoom.creator.userId,
    gameState: filteredGameState,
    usePackedDeltas, // Tell client which format we're using
  };
}
