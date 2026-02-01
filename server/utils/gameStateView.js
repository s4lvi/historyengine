export function buildGameStateResponse(gameRoom, userId, full = false) {
  if (process.env.DEBUG_GAMESTATE === "true") {
    const nations = gameRoom.gameState?.nations || [];
    const botCount = nations.filter((n) => n.isBot).length;
    console.log(
      `[GAMESTATE] room=${gameRoom._id} user=${userId} full=${full} nations=${nations.length} bots=${botCount}`
    );
  }
  const filterNation = (nation) => {
    if (nation.status === "defeated") {
      return {
        owner: nation.owner,
        status: "defeated",
      };
    }

    if (full) {
      return {
        ...nation,
        territoryLoyalty: nation.territoryLoyalty || {},
        territoryDeltaForClient: {
          add: { x: [], y: [] },
          sub: { x: [], y: [] },
        },
        cachedBorderSet: null,
      };
    }

    const { territory, territoryLoyalty, ...rest } = nation;
    const shouldIncludeLoyalty = false;
    return {
      ...rest,
      cachedBorderSet: null,
      territoryDeltaForClient: nation.territoryDeltaForClient || {
        add: { x: [], y: [] },
        sub: { x: [], y: [] },
      },
      ...(shouldIncludeLoyalty
        ? { territoryLoyalty: nation.territoryLoyalty || {} }
        : {}),
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
  };
}
