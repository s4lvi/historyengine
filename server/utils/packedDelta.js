/**
 * Packed Delta Format for efficient WebSocket transmission
 *
 * Instead of sending: { add: { x: [1,2,3], y: [4,5,6] }, sub: { x: [7], y: [8] } }
 * We send a compact binary-like format that's ~60% smaller
 *
 * Format: "a:x1,y1;x2,y2|s:x3,y3" where a=add, s=sub
 * Or for even more compression, we use base36 encoding for coordinates
 */

// Pack coordinates into a compact string format
// Returns null if no changes (saves bandwidth)
export function packTerritoryDelta(delta) {
  if (!delta) return null;

  const addX = delta.add?.x || [];
  const addY = delta.add?.y || [];
  const subX = delta.sub?.x || [];
  const subY = delta.sub?.y || [];

  if (addX.length === 0 && subX.length === 0) {
    return null; // No changes
  }

  const parts = [];

  if (addX.length > 0) {
    const coords = [];
    for (let i = 0; i < addX.length; i++) {
      // Use base36 for more compact representation (0-9, a-z)
      coords.push(`${addX[i].toString(36)},${addY[i].toString(36)}`);
    }
    parts.push(`a:${coords.join(';')}`);
  }

  if (subX.length > 0) {
    const coords = [];
    for (let i = 0; i < subX.length; i++) {
      coords.push(`${subX[i].toString(36)},${subY[i].toString(36)}`);
    }
    parts.push(`s:${coords.join(';')}`);
  }

  return parts.join('|');
}

// Unpack the compact string back to delta format (for client)
export function unpackTerritoryDelta(packed) {
  if (!packed) {
    return { add: { x: [], y: [] }, sub: { x: [], y: [] } };
  }

  const result = { add: { x: [], y: [] }, sub: { x: [], y: [] } };
  const parts = packed.split('|');

  for (const part of parts) {
    if (!part) continue;
    const [type, coordsStr] = part.split(':');
    if (!coordsStr) continue;

    const target = type === 'a' ? result.add : result.sub;
    const coords = coordsStr.split(';');

    for (const coord of coords) {
      const [xStr, yStr] = coord.split(',');
      if (xStr && yStr) {
        target.x.push(parseInt(xStr, 36));
        target.y.push(parseInt(yStr, 36));
      }
    }
  }

  return result;
}

// Pack multiple nations' deltas into a single object
// Returns { [owner]: packedDelta } only for nations with changes
export function packAllNationDeltas(nations) {
  const packed = {};

  for (const nation of nations) {
    if (!nation.territoryDeltaForClient) continue;
    const p = packTerritoryDelta(nation.territoryDeltaForClient);
    if (p) {
      packed[nation.owner] = p;
    }
  }

  return Object.keys(packed).length > 0 ? packed : null;
}

// Even more compact: pack into Uint16Array for binary transmission
// Format: [count, x1, y1, x2, y2, ...] where high bit of count indicates add(0) or sub(1)
export function packTerritoryDeltaBinary(delta) {
  if (!delta) return null;

  const addX = delta.add?.x || [];
  const addY = delta.add?.y || [];
  const subX = delta.sub?.x || [];
  const subY = delta.sub?.y || [];

  const totalCoords = addX.length + subX.length;
  if (totalCoords === 0) return null;

  // Format: [addCount, subCount, ...addCoords, ...subCoords]
  // Each coord is 2 uint16s (x, y)
  const buffer = new Uint16Array(2 + totalCoords * 2);
  buffer[0] = addX.length;
  buffer[1] = subX.length;

  let offset = 2;
  for (let i = 0; i < addX.length; i++) {
    buffer[offset++] = addX[i];
    buffer[offset++] = addY[i];
  }
  for (let i = 0; i < subX.length; i++) {
    buffer[offset++] = subX[i];
    buffer[offset++] = subY[i];
  }

  return buffer;
}

// Convert Uint16Array to base64 for JSON transmission
export function binaryDeltaToBase64(buffer) {
  if (!buffer) return null;
  const bytes = new Uint8Array(buffer.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Decode base64 back to Uint16Array (for client)
export function base64ToBinaryDelta(base64) {
  if (!base64) return null;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Uint16Array(bytes.buffer);
}

// Unpack binary delta
export function unpackTerritoryDeltaBinary(buffer) {
  if (!buffer || buffer.length < 2) {
    return { add: { x: [], y: [] }, sub: { x: [], y: [] } };
  }

  const addCount = buffer[0];
  const subCount = buffer[1];

  const result = {
    add: { x: new Array(addCount), y: new Array(addCount) },
    sub: { x: new Array(subCount), y: new Array(subCount) }
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
