import { packTerritoryDelta } from "./packedDelta.js";

// Strip internal caches from nation object before sending to client
function stripInternalCaches(nation) {
  const {
    _territorySet,
    _borderSet,
    territoryDelta, // Internal delta, not for client
    ...clean
  } = nation;
  return clean;
}

export function buildGameStateResponse(gameRoom, userId, full = false) {
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

    if (full) {
      return {
        ...cleanNation,
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
