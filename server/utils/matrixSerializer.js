// matrixSerializer.js — MongoDB serialization for typed arrays via Buffer
// Static layers are NOT serialized (reconstructed from mapData).
// Only dynamic layers are persisted.

import { TerritoryMatrix, UNOWNED } from "./TerritoryMatrix.js";

/**
 * Serialize dynamic layers of a TerritoryMatrix for MongoDB BSON storage.
 * @param {TerritoryMatrix} matrix
 * @returns {object} Plain object with Buffer fields
 */
export function serializeMatrix(matrix) {
  return {
    width: matrix.width,
    height: matrix.height,
    maxNations: matrix.maxNations,
    nextNationSlot: matrix.nextNationSlot,

    // Nation registry
    ownerToIndex: Object.fromEntries(matrix.ownerToIndex),
    indexToOwner: [...matrix.indexToOwner],

    // Dynamic layers as Buffers (always copy to avoid shared-buffer issues)
    ownership: Buffer.from(new Uint8Array(matrix.ownership.buffer, matrix.ownership.byteOffset, matrix.ownership.byteLength)),
    loyalty: Buffer.from(new Uint8Array(matrix.loyalty.buffer, matrix.loyalty.byteOffset, matrix.loyalty.byteLength)),
    populationDensity: Buffer.from(new Uint8Array(matrix.populationDensity.buffer, matrix.populationDensity.byteOffset, matrix.populationDensity.byteLength)),
    defenseStrength: Buffer.from(new Uint8Array(matrix.defenseStrength.buffer, matrix.defenseStrength.byteOffset, matrix.defenseStrength.byteLength)),
    resourceClaimProgress: Buffer.from(new Uint8Array(matrix.resourceClaimProgress.buffer, matrix.resourceClaimProgress.byteOffset, matrix.resourceClaimProgress.byteLength)),
    resourceClaimOwner: Buffer.from(new Uint8Array(matrix.resourceClaimOwner.buffer, matrix.resourceClaimOwner.byteOffset, matrix.resourceClaimOwner.byteLength)),
    troopDensity: Buffer.from(new Uint8Array(matrix.troopDensity.buffer, matrix.troopDensity.byteOffset, matrix.troopDensity.byteLength)),
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
  const restoreInt8 = (buf, target) => {
    if (!buf) return;
    const src = buf instanceof Buffer || buf instanceof Uint8Array
      ? new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : null;
    if (src && src.length === target.length) {
      target.set(src);
    }
  };

  const restoreFloat32 = (buf, target) => {
    if (!buf) return;
    // Copy into an aligned Uint8Array first to avoid unaligned Float32Array view
    const bytes = new Uint8Array(buf.byteLength || buf.length);
    bytes.set(buf instanceof Buffer || buf instanceof Uint8Array
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf));
    const src = new Float32Array(bytes.buffer, 0, bytes.byteLength / 4);
    if (src.length === target.length) {
      target.set(src);
    }
  };

  restoreInt8(data.ownership, matrix.ownership);
  restoreFloat32(data.loyalty, matrix.loyalty);
  restoreFloat32(data.populationDensity, matrix.populationDensity);
  restoreFloat32(data.defenseStrength, matrix.defenseStrength);
  restoreFloat32(data.resourceClaimProgress, matrix.resourceClaimProgress);
  restoreInt8(data.resourceClaimOwner, matrix.resourceClaimOwner);
  restoreFloat32(data.troopDensity, matrix.troopDensity);

  return matrix;
}
