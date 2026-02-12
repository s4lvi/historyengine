// matrixSerializer.js — MongoDB serialization for typed arrays via Buffer
// Static layers are NOT serialized (reconstructed from mapData).
// Only dynamic layers are persisted.

import { TerritoryMatrix, UNOWNED } from "./TerritoryMatrix.js";

/**
 * Safely copy a typed array to a Buffer.
 * Uses .slice() to create an independent copy, avoiding "offset is out of bounds"
 * errors that can occur with the raw buffer/byteOffset/byteLength pattern.
 */
function safeBufferCopy(typedArray) {
  if (!typedArray || typedArray.byteLength === 0) {
    return Buffer.alloc(0);
  }
  // .slice() creates a new typed array with its own ArrayBuffer — always safe
  const copy = typedArray.slice();
  return Buffer.from(copy.buffer, 0, copy.byteLength);
}

/**
 * Serialize dynamic layers of a TerritoryMatrix for MongoDB BSON storage.
 * Loyalty is quantized from Float32 to Uint8 (4x reduction) to stay under
 * MongoDB's 16MB BSON document limit with many nations.
 * TroopDensity is NOT serialized — it reseeds from troopCount on load.
 *
 * @param {TerritoryMatrix} matrix
 * @returns {object} Plain object with Buffer fields
 */
export function serializeMatrix(matrix) {
  const usedSlots = matrix.nextNationSlot || 0;
  const size = matrix.size;

  // Quantize loyalty from Float32 [0,1] to Uint8 [0,255] — 4x size reduction
  const loyaltyLen = size * usedSlots;
  const loyaltyQuantized = new Uint8Array(loyaltyLen);
  for (let i = 0; i < loyaltyLen; i++) {
    loyaltyQuantized[i] = Math.round(matrix.loyalty[i] * 255);
  }

  return {
    width: matrix.width,
    height: matrix.height,
    maxNations: matrix.maxNations,
    nextNationSlot: usedSlots,
    // Track how many slots are serialized for deserializer
    serializedNationSlots: usedSlots,
    // Format version: 2 = quantized loyalty (Uint8), no troopDensity
    serializationVersion: 2,

    // Nation registry
    ownerToIndex: Object.fromEntries(matrix.ownerToIndex),
    indexToOwner: [...matrix.indexToOwner],

    // Per-cell layers
    ownership: safeBufferCopy(matrix.ownership),
    populationDensity: safeBufferCopy(matrix.populationDensity),
    resourceClaimProgress: safeBufferCopy(matrix.resourceClaimProgress),
    resourceClaimOwner: safeBufferCopy(matrix.resourceClaimOwner),

    // Per-nation-per-cell layers (quantized Uint8, trimmed to used slots)
    loyalty: safeBufferCopy(loyaltyQuantized),
    // troopDensity omitted — reseeded from troopCount via tickMobilization
  };
}

/**
 * Reconstruct a TerritoryMatrix from serialized data + mapData.
 * @param {object} data - Serialized data from serializeMatrix
 * @param {Array} mapData - 2D map data array for static layer reconstruction
 * @param {object} matrixConfig - matrix config section for noise/resistance params
 * @returns {TerritoryMatrix}
 */
export function deserializeMatrix(data, mapData, matrixConfig) {
  if (!data || !data.width || !data.height) return null;

  const matrix = new TerritoryMatrix(data.width, data.height, data.maxNations || 64);

  // Restore static layers from mapData (including diffusion resistance)
  if (mapData) {
    matrix.initFromMapData(mapData, matrixConfig);
  }

  // Restore nation registry
  matrix.nextNationSlot = data.nextNationSlot || 0;
  if (data.ownerToIndex) {
    const entries = data.ownerToIndex instanceof Map
      ? data.ownerToIndex
      : Object.entries(data.ownerToIndex);
    for (const [owner, idx] of entries) {
      matrix.ownerToIndex.set(owner, Number(idx));
    }
  }
  if (Array.isArray(data.indexToOwner)) {
    matrix.indexToOwner = [...data.indexToOwner];
  }

  // Restore dynamic layers from Buffers
  // Mongoose Buffers share a large ArrayBuffer pool slab, so buf.buffer is NOT
  // exclusive to this field.  We must use Uint8Array.prototype.slice() to create
  // an independent copy whose .buffer starts at offset 0 — only then is it safe
  // to reinterpret as Int8Array / Float32Array.
  const safeBytes = (buf) => {
    if (!buf) return null;
    // Buffer / Uint8Array — extract the relevant slice into a fresh ArrayBuffer
    if (buf instanceof Uint8Array || Buffer.isBuffer(buf)) {
      return new Uint8Array(buf).slice();            // always copies, offset-safe
    }
    return new Uint8Array(buf).slice();
  };

  const restoreInt8 = (buf, target) => {
    const bytes = safeBytes(buf);
    if (!bytes || bytes.byteLength === 0) return;
    const src = new Int8Array(bytes.buffer, 0, bytes.byteLength);
    if (src.length === target.length) {
      target.set(src);
    }
  };

  const restoreFloat32 = (buf, target) => {
    const bytes = safeBytes(buf);
    if (!bytes || bytes.byteLength === 0) return;
    // Ensure byte length is a multiple of 4 (Float32 alignment)
    const usableBytes = bytes.byteLength - (bytes.byteLength % 4);
    if (usableBytes === 0) return;
    const src = new Float32Array(bytes.buffer, 0, usableBytes / 4);
    if (src.length === target.length) {
      // Exact match — full array was serialized
      target.set(src);
    } else if (src.length < target.length) {
      // Trimmed array (only first N nation slots) — restore into beginning of target
      target.set(src);
      // Remaining slots stay zeroed from constructor
    }
  };

  restoreInt8(data.ownership, matrix.ownership);
  restoreFloat32(data.populationDensity, matrix.populationDensity);
  // defenseStrength is recomputed every tick, but handle old saves that included it
  if (data.defenseStrength) {
    restoreFloat32(data.defenseStrength, matrix.defenseStrength);
  }
  restoreFloat32(data.resourceClaimProgress, matrix.resourceClaimProgress);
  restoreInt8(data.resourceClaimOwner, matrix.resourceClaimOwner);

  // Loyalty: v2 uses quantized Uint8 [0,255] → Float32 [0,1]; v1 uses Float32 directly
  if (data.serializationVersion >= 2) {
    const bytes = safeBytes(data.loyalty);
    if (bytes && bytes.byteLength > 0) {
      const src = new Uint8Array(bytes.buffer, 0, bytes.byteLength);
      const loyaltyLen = Math.min(src.length, matrix.loyalty.length);
      for (let i = 0; i < loyaltyLen; i++) {
        matrix.loyalty[i] = src[i] / 255;
      }
    }
  } else {
    // Legacy Float32 format
    restoreFloat32(data.loyalty, matrix.loyalty);
  }

  // TroopDensity: v2 omits it (reseeded by tickMobilization); v1 restores it
  if (data.troopDensity) {
    restoreFloat32(data.troopDensity, matrix.troopDensity);
  }
  // If troopDensity is missing, tickMobilization will reseed from troopCount

  // Rebuild running counters and bbox from restored ownership
  matrix.rebuildCountersFromOwnership();

  return matrix;
}
