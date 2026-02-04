/**
 * Client-side unpacking utilities for packed territory deltas
 * Matches the server-side packedDelta.js format
 */

// Unpack the compact string format back to delta object
export function unpackTerritoryDelta(packed) {
  if (!packed) {
    return { add: { x: [], y: [] }, sub: { x: [], y: [] } };
  }

  const result = { add: { x: [], y: [] }, sub: { x: [], y: [] } };
  const parts = packed.split("|");

  for (const part of parts) {
    if (!part) continue;
    const [type, coordsStr] = part.split(":");
    if (!coordsStr) continue;

    const target = type === "a" ? result.add : result.sub;
    const coords = coordsStr.split(";");

    for (const coord of coords) {
      const [xStr, yStr] = coord.split(",");
      if (xStr && yStr) {
        target.x.push(parseInt(xStr, 36));
        target.y.push(parseInt(yStr, 36));
      }
    }
  }

  return result;
}

// Decode base64 back to Uint16Array (for binary format)
export function base64ToBinaryDelta(base64) {
  if (!base64) return null;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Uint16Array(bytes.buffer);
}

// Unpack binary delta format
export function unpackTerritoryDeltaBinary(buffer) {
  if (!buffer || buffer.length < 2) {
    return { add: { x: [], y: [] }, sub: { x: [], y: [] } };
  }

  const addCount = buffer[0];
  const subCount = buffer[1];

  const result = {
    add: { x: new Array(addCount), y: new Array(addCount) },
    sub: { x: new Array(subCount), y: new Array(subCount) },
  };

  let offset = 2;
  for (let i = 0; i < addCount; i++) {
    result.add.x[i] = buffer[offset++];
    result.add.y[i] = buffer[offset++];
  }
  for (let i = 0; i < subCount; i++) {
    result.sub.x[i] = buffer[offset++];
    result.sub.y[i] = buffer[offset++];
  }

  return result;
}

// Helper to process nation data and unpack deltas if needed
export function processNationDelta(nation, usePackedDeltas) {
  if (!nation) return nation;

  // If using packed deltas, unpack them
  if (usePackedDeltas && nation.packedDelta) {
    nation.territoryDeltaForClient = unpackTerritoryDelta(nation.packedDelta);
    delete nation.packedDelta;
  }

  return nation;
}

// Process all nations in game state
export function processGameStateDeltas(gameState, usePackedDeltas) {
  if (!gameState?.nations) return gameState;

  gameState.nations = gameState.nations.map((nation) =>
    processNationDelta(nation, usePackedDeltas)
  );

  return gameState;
}
