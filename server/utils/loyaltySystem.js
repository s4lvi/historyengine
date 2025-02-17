// loyaltySystem.js
import _ from "lodash";
import { forEachTerritoryCell, isCellInTerritory } from "./gameLogic.js";

const LOYALTY_SETTINGS = {
  INITIAL: 50,
  MAX: 100,
  MIN: 0,
  CITY_BONUS: 1,
  CAPITAL_BONUS: 3,
  ARMY_BONUS: 3,
  OUTPOST_BONUS: 3,
  ENEMY_ARMY_PENALTY: -3,
  DISCONNECTED_PENALTY: -3,
  CITY_RANGE: 10,
  CAPITAL_RANGE: 15,
  ARMY_RANGE: 8,
  OUTPOST_RANGE: 8,
  DISTANCE_DECAY: 0.8,
};

export function initializeLoyalty(nation, x, y) {
  if (!nation.territoryLoyalty) {
    nation.territoryLoyalty = {};
  }
  const cellKey = `${x},${y}`;
  nation.territoryLoyalty[cellKey] = LOYALTY_SETTINGS.INITIAL;
}

function manhattanDistance(x1, y1, x2, y2) {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

function calculateLoyaltyModifiers(
  x,
  y,
  nation,
  gameState,
  connectedCells = null
) {
  let modifier = 0;
  if (nation.cities) {
    for (const city of nation.cities) {
      const distance = manhattanDistance(x, y, city.x, city.y);
      const isCapital = city.type === "capital";
      const range = isCapital
        ? LOYALTY_SETTINGS.CAPITAL_RANGE
        : LOYALTY_SETTINGS.CITY_RANGE;
      const baseBonus = isCapital
        ? LOYALTY_SETTINGS.CAPITAL_BONUS
        : LOYALTY_SETTINGS.CITY_BONUS;
      if (distance <= range) {
        const influence =
          baseBonus * Math.pow(LOYALTY_SETTINGS.DISTANCE_DECAY, distance);
        modifier += influence;
      }
    }
  }
  if (nation.armies) {
    for (const army of nation.armies) {
      const distance = manhattanDistance(
        x,
        y,
        army.position.x,
        army.position.y
      );
      if (distance <= LOYALTY_SETTINGS.ARMY_RANGE) {
        modifier +=
          LOYALTY_SETTINGS.ARMY_BONUS *
          Math.pow(LOYALTY_SETTINGS.DISTANCE_DECAY, distance);
      }
    }
  }
  if (gameState.nations) {
    for (const otherNation of gameState.nations) {
      if (otherNation.owner === nation.owner) continue;
      if (otherNation.armies) {
        for (const army of otherNation.armies) {
          const distance = manhattanDistance(
            x,
            y,
            army.position.x,
            army.position.y
          );
          if (distance <= LOYALTY_SETTINGS.ARMY_RANGE) {
            modifier +=
              LOYALTY_SETTINGS.ENEMY_ARMY_PENALTY *
              Math.pow(LOYALTY_SETTINGS.DISTANCE_DECAY, distance);
          }
        }
      }
    }
  }
  if (connectedCells) {
    if (!connectedCells.has(`${x},${y}`)) {
      modifier += LOYALTY_SETTINGS.DISCONNECTED_PENALTY;
    }
  } else {
    if (!isConnectedToCapital(x, y, nation)) {
      modifier += LOYALTY_SETTINGS.DISCONNECTED_PENALTY;
    }
  }
  return modifier;
}

function isConnectedToCapital(x, y, nation, visited = new Set()) {
  const capital =
    nation.cities && nation.cities.find((city) => city.type === "capital");
  if (!capital) return false;
  const cellKey = `${x},${y}`;
  if (visited.has(cellKey)) return false;
  visited.add(cellKey);
  if (x === capital.x && y === capital.y) return true;
  const directions = [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
  ];
  for (const [dx, dy] of directions) {
    const newX = x + dx;
    const newY = y + dy;
    if (isCellInTerritory(nation.territory, newX, newY)) {
      if (isConnectedToCapital(newX, newY, nation, visited)) {
        return true;
      }
    }
  }
  return false;
}

export function updateLoyalty(nation, gameState, connectedCells = null) {
  if (!nation.territoryLoyalty) {
    nation.territoryLoyalty = {};
  }
  if (!nation.territoryDelta) {
    nation.territoryDelta = { add: { x: [], y: [] }, sub: { x: [], y: [] } };
  }
  const lostCells = [];
  // Use cached connectivity if provided.
  if (!connectedCells) {
    connectedCells = new Set();
    forEachTerritoryCell(nation.territory, (x, y) => {
      connectedCells.add(`${x},${y}`);
    });
  }
  forEachTerritoryCell(nation.territory, (x, y) => {
    const cellKey = `${x},${y}`;
    let loyalty = nation.territoryLoyalty[cellKey] || LOYALTY_SETTINGS.INITIAL;
    const modifier = calculateLoyaltyModifiers(
      x,
      y,
      nation,
      gameState,
      connectedCells
    );
    loyalty = Math.min(
      LOYALTY_SETTINGS.MAX,
      Math.max(LOYALTY_SETTINGS.MIN, loyalty + modifier)
    );
    if (loyalty <= LOYALTY_SETTINGS.MIN) {
      lostCells.push({ x, y });
    } else {
      nation.territoryLoyalty[cellKey] = loyalty;
    }
  });
  if (lostCells.length > 0) {
    removeTerritory(nation, lostCells);
  }
  if (nation.territory.x.length === 0) {
    nation.status = "defeated";
    nation.armies = [];
    nation.cities = [];
  }
  nation.territoryDeltaForClient = {
    add: {
      x: [...nation.territoryDelta.add.x],
      y: [...nation.territoryDelta.add.y],
    },
    sub: {
      x: [...nation.territoryDelta.sub.x],
      y: [...nation.territoryDelta.sub.y],
    },
  };
  nation.territoryDelta = { add: { x: [], y: [] }, sub: { x: [], y: [] } };
  return lostCells;
}

function removeTerritory(nation, cellsToRemove) {
  const removedStructures = [];
  const removedCellsSet = new Set(
    cellsToRemove.map((cell) => `${cell.x},${cell.y}`)
  );
  const newTerritory = { x: [], y: [] };
  forEachTerritoryCell(nation.territory, (x, y) => {
    if (!removedCellsSet.has(`${x},${y}`)) {
      newTerritory.x.push(x);
      newTerritory.y.push(y);
    }
  });
  nation.territory = newTerritory;
  cellsToRemove.forEach((cell) => {
    nation.territoryDelta.sub.x.push(cell.x);
    nation.territoryDelta.sub.y.push(cell.y);
  });
  if (nation.cities) {
    nation.cities = nation.cities.filter((city) => {
      const isRemoved = removedCellsSet.has(`${city.x},${city.y}`);
      if (isRemoved) {
        removedStructures.push({ type: "city", ...city });
      }
      return !isRemoved;
    });
  }
  cellsToRemove.forEach((cell) => {
    delete nation.territoryLoyalty[`${cell.x},${cell.y}`];
  });
  return removedStructures;
}

export const LOYALTY = LOYALTY_SETTINGS;
