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

    // Dynamic layers as Buffers
    ownership: Buffer.from(matrix.ownership.buffer, matrix.ownership.byteOffset, matrix.ownership.byteLength),
    loyalty: Buffer.from(matrix.loyalty.buffer, matrix.loyalty.byteOffset, matrix.loyalty.byteLength),
    populationDensity: Buffer.from(matrix.populationDensity.buffer, matrix.populationDensity.byteOffset, matrix.populationDensity.byteLength),
    defenseStrength: Buffer.from(matrix.defenseStrength.buffer, matrix.defenseStrength.byteOffset, matrix.defenseStrength.byteLength),
    resourceClaimProgress: Buffer.from(matrix.resourceClaimProgress.buffer, matrix.resourceClaimProgress.byteOffset, matrix.resourceClaimProgress.byteLength),
    resourceClaimOwner: Buffer.from(matrix.resourceClaimOwner.buffer, matrix.resourceClaimOwner.byteOffset, matrix.resourceClaimOwner.byteLength),
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
    const src = buf instanceof Buffer || buf instanceof Uint8Array
      ? new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
      : null;
    if (src && src.length === target.length) {
      target.set(src);
    }
  };

  restoreInt8(data.ownership, matrix.ownership);
  restoreFloat32(data.loyalty, matrix.loyalty);
  restoreFloat32(data.populationDensity, matrix.populationDensity);
  restoreFloat32(data.defenseStrength, matrix.defenseStrength);
  restoreFloat32(data.resourceClaimProgress, matrix.resourceClaimProgress);
  restoreInt8(data.resourceClaimOwner, matrix.resourceClaimOwner);

  return matrix;
}
