// TerritoryMatrix.js — Core matrix class for the territory system
// Row-major typed arrays replacing per-nation parallel x[]/y[] arrays

import { debugWarn } from "./debug.js";

const UNOWNED = -1;

// ─── Noise functions for diffusion resistance ──────────────────────────
// Hash-based 2D value noise with FBM — no external dependencies

function hash2d(x, y, seed) {
  let h = seed | 0;
  h ^= (x * 374761393) | 0;
  h ^= (y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h & 0x7fffffff) / 0x7fffffff; // 0-1
}

function valueNoise2d(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  // Smoothstep
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hash2d(ix, iy, seed);
  const n10 = hash2d(ix + 1, iy, seed);
  const n01 = hash2d(ix, iy + 1, seed);
  const n11 = hash2d(ix + 1, iy + 1, seed);
  const nx0 = n00 + sx * (n10 - n00);
  const nx1 = n01 + sx * (n11 - n01);
  return nx0 + sy * (nx1 - nx0);
}

function fbm2d(x, y, octaves, frequency, seed) {
  let value = 0;
  let amplitude = 1;
  let totalAmplitude = 0;
  let freq = frequency;
  for (let o = 0; o < octaves; o++) {
    value += amplitude * valueNoise2d(x * freq, y * freq, seed + o * 7919);
    totalAmplitude += amplitude;
    amplitude *= 0.5;
    freq *= 2;
  }
  return value / totalAmplitude; // normalized 0-1
}

// Biome enum for biomeIndex
const BIOME_ENUM = {
  OCEAN: 0,
  COASTAL: 1,
  MOUNTAIN: 2,
  DESERT: 3,
  SAVANNA: 4,
  TROPICAL_FOREST: 5,
  RAINFOREST: 6,
  TUNDRA: 7,
  TAIGA: 8,
  GRASSLAND: 9,
  WOODLAND: 10,
  FOREST: 11,
  RIVER: 12,
};

const BIOME_NAMES = Object.fromEntries(
  Object.entries(BIOME_ENUM).map(([k, v]) => [v, k]),
);

// Resource type enum for resourceType layer
const RESOURCE_ENUM = {
  none: 0,
  food: 1,
  wood: 2,
  stone: 3,
  iron: 4,
  gold: 5,
};

const RESOURCE_NAMES = Object.fromEntries(
  Object.entries(RESOURCE_ENUM).map(([k, v]) => [v, k]),
);

// Default diffusion resistance per biome index (0-1, higher = harder to spread)
const DEFAULT_BIOME_RESISTANCE = new Float32Array(
  Object.keys(BIOME_ENUM).length,
);
DEFAULT_BIOME_RESISTANCE[BIOME_ENUM.OCEAN] = 1.0;
DEFAULT_BIOME_RESISTANCE[BIOME_ENUM.MOUNTAIN] = 0.7;
DEFAULT_BIOME_RESISTANCE[BIOME_ENUM.RIVER] = 0.5;
DEFAULT_BIOME_RESISTANCE[BIOME_ENUM.FOREST] = 0.3;
DEFAULT_BIOME_RESISTANCE[BIOME_ENUM.WOODLAND] = 0.25;
DEFAULT_BIOME_RESISTANCE[BIOME_ENUM.TAIGA] = 0.25;
DEFAULT_BIOME_RESISTANCE[BIOME_ENUM.TUNDRA] = 0.2;
DEFAULT_BIOME_RESISTANCE[BIOME_ENUM.TROPICAL_FOREST] = 0.25;
DEFAULT_BIOME_RESISTANCE[BIOME_ENUM.RAINFOREST] = 0.3;
DEFAULT_BIOME_RESISTANCE[BIOME_ENUM.COASTAL] = 0.15;
DEFAULT_BIOME_RESISTANCE[BIOME_ENUM.DESERT] = 0.05;
DEFAULT_BIOME_RESISTANCE[BIOME_ENUM.SAVANNA] = 0.05;
DEFAULT_BIOME_RESISTANCE[BIOME_ENUM.GRASSLAND] = 0.05;

/**
 * Map subclass that auto-stringifies keys to avoid ObjectId vs string mismatches.
 * Ensures consistent key lookup after MongoDB round-trip serialization.
 */
class StringKeyMap extends Map {
  get(key)    { return super.get(String(key)); }
  set(key, v) { return super.set(String(key), v); }
  has(key)    { return super.has(String(key)); }
  delete(key) { return super.delete(String(key)); }
}

export class TerritoryMatrix {
  /**
   * @param {number} width  - map width in cells
   * @param {number} height - map height in cells
   * @param {number} maxNations - max simultaneous nations (default 64)
   */
  constructor(width, height, maxNations = 64) {
    this.width = width;
    this.height = height;
    this.size = width * height;
    this.maxNations = maxNations;

    // --- Nation index registry ---
    // Bidirectional: ownerString <-> int index
    this.ownerToIndex = new StringKeyMap(); // ownerString -> int
    this.indexToOwner = []; // int -> ownerString|null
    this.nextNationSlot = 0;

    // --- Static layers (set once from mapData) ---
    this.biomeIndex = new Uint8Array(this.size);
    this.elevation = new Float32Array(this.size);
    this.moisture = new Float32Array(this.size);
    this.resourceType = new Uint8Array(this.size); // 0=none, 1-5=type
    this.resourceLevel = new Uint8Array(this.size); // upgrade level 0-3
    this.oceanMask = new Uint8Array(this.size); // 1=impassable

    // --- Dynamic layers (mutated per tick) ---
    this.ownership = new Int8Array(this.size).fill(UNOWNED);
    this.loyalty = new Float32Array(this.size * maxNations); // per-nation influence
    this.populationDensity = new Float32Array(this.size);
    this.defenseStrength = new Float32Array(this.size);
    this.resourceClaimProgress = new Float32Array(this.size);
    this.resourceClaimOwner = new Int8Array(this.size).fill(UNOWNED);

    // --- Diffusion resistance layer (set once from noise + terrain) ---
    this.diffusionResistance = new Float32Array(this.size);

    // --- Troop density layer (per-nation per-cell) ---
    this.troopDensity = new Float32Array(this.size * maxNations);

    // --- City bonus grid cache for loyalty diffusion ---
    this._cityBonusGrids = new Map(); // nIdx -> Float32Array(size)
    this._cityBonusVersion = 0; // bumped on city build/capture/destroy
    this._cityBonusBuiltVersion = -1; // version when grids were last built

    // --- Running counters per nation (updated by setOwnerByIndex) ---
    this.ownedCellCount = new Int32Array(maxNations);
    this.troopDensitySum = new Float64Array(maxNations);
    this.nationBBox = Array.from({ length: maxNations }, () => ({
      minX: Infinity, maxX: -1, minY: Infinity, maxY: -1, dirty: false,
    }));

    // --- Chunk-based active cell tracking (16x16 chunks) ---
    this.chunkW = 16;
    this.chunksX = Math.ceil(width / 16);
    this.chunksY = Math.ceil(height / 16);
    this.totalChunks = this.chunksX * this.chunksY;
    this.chunkDirty = new Uint8Array(this.totalChunks);
    this.chunkSleepCounter = new Uint16Array(this.totalChunks);
    this.chunkHasBorder = new Uint8Array(this.totalChunks);

    // --- Snapshot layer (for delta derivation) ---
    this.prevOwnership = new Int8Array(this.size).fill(UNOWNED);
  }

  // ─── Index helpers ──────────────────────────────────────────────

  /** Row-major index from (x, y) */
  idx(x, y) {
    return y * this.width + x;
  }

  /** Check bounds */
  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  // ─── Nation index registry ──────────────────────────────────────

  /** Get or allocate a nation index for an owner string */
  getNationIndex(owner) {
    if (!owner) return UNOWNED;
    let idx = this.ownerToIndex.get(owner);
    if (idx !== undefined) return idx;

    // Try to reuse a freed slot before bumping nextNationSlot
    let reuseIdx = -1;
    for (let i = 0; i < this.nextNationSlot; i++) {
      if (this.indexToOwner[i] === null) {
        reuseIdx = i;
        break;
      }
    }

    if (reuseIdx >= 0) {
      idx = reuseIdx;
    } else if (this.nextNationSlot >= this.maxNations) {
      debugWarn(
        `[MATRIX] Max nations (${this.maxNations}) reached, cannot allocate for ${owner}`,
      );
      return UNOWNED;
    } else {
      idx = this.nextNationSlot++;
    }

    this.ownerToIndex.set(owner, idx);
    this.indexToOwner[idx] = String(owner);
    return idx;
  }

  /** Get owner string from nation index */
  getOwnerByIndex(nIdx) {
    if (nIdx < 0 || nIdx >= this.indexToOwner.length) return null;
    return this.indexToOwner[nIdx] || null;
  }

  /** Remove a nation from the registry (e.g. on defeat/quit) */
  removeNation(owner) {
    const nIdx = this.ownerToIndex.get(owner);
    if (nIdx === undefined) return;
    // Clear all ownership and prevOwnership for this nation
    for (let i = 0; i < this.size; i++) {
      if (this.ownership[i] === nIdx) {
        this.setOwnerByIndex(i, UNOWNED);
      }
      if (this.prevOwnership[i] === nIdx) {
        this.prevOwnership[i] = UNOWNED;
      }
    }
    // Clear loyalty for this nation
    const loyaltyOffset = nIdx * this.size;
    for (let i = 0; i < this.size; i++) {
      this.loyalty[loyaltyOffset + i] = 0;
    }
    // Clear resource claims for this nation
    for (let i = 0; i < this.size; i++) {
      if (this.resourceClaimOwner[i] === nIdx) {
        this.resourceClaimOwner[i] = UNOWNED;
        this.resourceClaimProgress[i] = 0;
      }
    }
    // Clear troop density for this nation
    const troopOffset = nIdx * this.size;
    for (let i = 0; i < this.size; i++) {
      this.troopDensity[troopOffset + i] = 0;
    }
    // Reset counters/bbox for this nation
    this.ownedCellCount[nIdx] = 0;
    this.troopDensitySum[nIdx] = 0;
    this.nationBBox[nIdx] = { minX: Infinity, maxX: -1, minY: Infinity, maxY: -1, dirty: false };
    // Mark slot as available (but don't reuse to keep indices stable within a session)
    this.indexToOwner[nIdx] = null;
    this.ownerToIndex.delete(owner);
  }

  // ─── Static layer init ──────────────────────────────────────────

  /** Populate static layers from 2D mapData array */
  initFromMapData(mapData, matrixConfig) {
    if (!Array.isArray(mapData) || !Array.isArray(mapData[0])) return;
    for (let y = 0; y < this.height; y++) {
      const row = mapData[y];
      if (!row) continue;
      for (let x = 0; x < this.width; x++) {
        const cell = row[x];
        if (!cell) continue;
        const i = this.idx(x, y);

        // Biome
        const biomeVal = BIOME_ENUM[cell.biome];
        this.biomeIndex[i] = biomeVal !== undefined ? biomeVal : 0;

        // Elevation / moisture
        this.elevation[i] = cell.elevation || 0;
        this.moisture[i] = cell.moisture || 0;

        // Ocean mask
        this.oceanMask[i] = cell.biome === "OCEAN" ? 1 : 0;

        // Resource node
        if (cell.resourceNode?.type) {
          const resVal = RESOURCE_ENUM[cell.resourceNode.type];
          this.resourceType[i] = resVal !== undefined ? resVal : 0;
          this.resourceLevel[i] = cell.resourceNode.level || 0;
        }
      }
    }

    // Compute diffusion resistance from noise + elevation + biome
    this.computeDiffusionResistance(matrixConfig);
  }

  /** Compute per-cell diffusion resistance from noise, elevation, and biome */
  computeDiffusionResistance(matrixConfig) {
    const {
      noiseFrequency = 0.08,
      noiseOctaves = 3,
      noiseWeight = 0.35,
      elevationResistanceWeight = 0.25,
      biomeResistanceEnabled = true,
    } = matrixConfig || {};

    // Deterministic seed from map dimensions
    const seed = (this.width * 73856093) ^ (this.height * 19349663);

    for (let i = 0; i < this.size; i++) {
      if (this.oceanMask[i] === 1) {
        this.diffusionResistance[i] = 1.0;
        continue;
      }

      const x = i % this.width;
      const y = (i - x) / this.width;

      // Noise component
      const noiseVal = fbm2d(x, y, noiseOctaves, noiseFrequency, seed);

      // Elevation component (higher elevation = more resistance)
      const elev = this.elevation[i];

      // Biome component
      const biomeR = biomeResistanceEnabled
        ? DEFAULT_BIOME_RESISTANCE[this.biomeIndex[i]] || 0
        : 0;
      const biomeWeight = biomeResistanceEnabled
        ? Math.max(0, 1 - noiseWeight - elevationResistanceWeight)
        : 0;

      let resistance =
        noiseWeight * noiseVal +
        elevationResistanceWeight * elev +
        biomeWeight * biomeR;

      // Clamp 0-0.9 (never fully block non-ocean cells)
      this.diffusionResistance[i] = Math.max(0, Math.min(0.99, resistance));
    }
  }

  // ─── Ownership accessors ────────────────────────────────────────

  /** Get the nation index that owns cell (x,y). Returns UNOWNED (-1) if unowned. */
  getOwner(x, y) {
    if (!this.inBounds(x, y)) return UNOWNED;
    return this.ownership[this.idx(x, y)];
  }

  /** Get owner string for cell (x,y). Returns null if unowned. */
  getOwnerString(x, y) {
    const nIdx = this.getOwner(x, y);
    return nIdx === UNOWNED ? null : this.getOwnerByIndex(nIdx);
  }

  /** Set owner of flat index i to nation index newIdx (centralized mutation) */
  setOwnerByIndex(i, newIdx) {
    const oldIdx = this.ownership[i];
    if (oldIdx === newIdx) return;
    this.ownership[i] = newIdx;

    // Update running counters
    if (oldIdx >= 0) {
      this.ownedCellCount[oldIdx]--;
      this.nationBBox[oldIdx].dirty = true;
    }
    if (newIdx >= 0) {
      this.ownedCellCount[newIdx]++;
      const x = i % this.width, y = (i / this.width) | 0;
      const bb = this.nationBBox[newIdx];
      if (x < bb.minX) bb.minX = x;
      if (x > bb.maxX) bb.maxX = x;
      if (y < bb.minY) bb.minY = y;
      if (y > bb.maxY) bb.maxY = y;
    }

    // Mark chunk dirty
    const cx = (i % this.width) >> 4;
    const cy = ((i / this.width) | 0) >> 4;
    const ci = cy * this.chunksX + cx;
    this.chunkDirty[ci] = 1;
    this.chunkSleepCounter[ci] = 0;
  }

  /** Set owner of cell (x,y) to nation index nIdx */
  setOwner(x, y, nIdx) {
    if (!this.inBounds(x, y)) return;
    this.setOwnerByIndex(this.idx(x, y), nIdx);
  }

  /** Check if cell (x,y) is owned by nIdx */
  isOwnedBy(x, y, nIdx) {
    if (!this.inBounds(x, y)) return false;
    return this.ownership[this.idx(x, y)] === nIdx;
  }

  /** Check if cell is ocean */
  isOcean(x, y) {
    if (!this.inBounds(x, y)) return true;
    return this.oceanMask[this.idx(x, y)] === 1;
  }

  /** Get biome name at (x,y) */
  getBiome(x, y) {
    if (!this.inBounds(x, y)) return "OCEAN";
    return BIOME_NAMES[this.biomeIndex[this.idx(x, y)]] || "OCEAN";
  }

  // ─── Loyalty accessors ──────────────────────────────────────────

  /** Get loyalty value for nation nIdx at cell (x,y) */
  getLoyalty(x, y, nIdx) {
    if (!this.inBounds(x, y) || nIdx < 0 || nIdx >= this.maxNations) return 0;
    return this.loyalty[nIdx * this.size + this.idx(x, y)];
  }

  /** Set loyalty value for nation nIdx at cell (x,y) */
  setLoyalty(x, y, nIdx, val) {
    if (!this.inBounds(x, y) || nIdx < 0 || nIdx >= this.maxNations) return;
    this.loyalty[nIdx * this.size + this.idx(x, y)] = Math.max(
      0,
      Math.min(1, val),
    );
  }

  /** Add to loyalty value for nation nIdx at cell (x,y), clamped 0-1 */
  addLoyalty(x, y, nIdx, delta) {
    if (!this.inBounds(x, y) || nIdx < 0 || nIdx >= this.maxNations) return;
    const offset = nIdx * this.size + this.idx(x, y);
    this.loyalty[offset] = Math.max(
      0,
      Math.min(1, this.loyalty[offset] + delta),
    );
  }

  // ─── Snapshot / Delta support ───────────────────────────────────

  /** Save current ownership state for later delta derivation */
  snapshotOwnership() {
    this.prevOwnership.set(this.ownership);
  }

  // ─── Territory queries ──────────────────────────────────────────

  /** Count cells owned by nation nIdx (O(1) from running counter) */
  countTerritory(nIdx) {
    if (nIdx >= 0 && nIdx < this.maxNations) {
      return this.ownedCellCount[nIdx];
    }
    return 0;
  }

  /** Get all cells for a nation as {x[], y[]} (for compat layer) */
  getCellsForNation(nIdx) {
    const xs = [];
    const ys = [];
    for (let i = 0; i < this.size; i++) {
      if (this.ownership[i] === nIdx) {
        xs.push(i % this.width);
        ys.push(Math.floor(i / this.width));
      }
    }
    return { x: xs, y: ys };
  }

  /** Get all cells for all nations in a single O(size) pass.
   *  Returns Map<nIdx, {x: number[], y: number[]}> */
  getAllNationCells() {
    const result = new Map();
    for (let i = 0; i < this.size; i++) {
      const owner = this.ownership[i];
      if (owner === UNOWNED) continue;
      let cells = result.get(owner);
      if (!cells) {
        cells = { x: [], y: [] };
        result.set(owner, cells);
      }
      cells.x.push(i % this.width);
      cells.y.push(Math.floor(i / this.width));
    }
    return result;
  }

  /** Get the total number of claimable (non-ocean) cells */
  getTotalClaimable() {
    let count = 0;
    for (let i = 0; i < this.size; i++) {
      if (this.oceanMask[i] === 0) count++;
    }
    return count;
  }

  /** Populate ownership from existing nation territories (for migration/init) */
  populateFromNations(nations) {
    if (!Array.isArray(nations)) return;
    for (const nation of nations) {
      if (!nation?.territory?.x || !nation?.territory?.y) continue;
      if (nation.status === "defeated") continue;
      const nIdx = this.getNationIndex(nation.owner);
      if (nIdx === UNOWNED) continue;
      for (let i = 0; i < nation.territory.x.length; i++) {
        const x = nation.territory.x[i];
        const y = nation.territory.y[i];
        if (this.inBounds(x, y)) {
          const cellIdx = this.idx(x, y);
          // Only claim if unclaimed (first writer wins, like buildInitialOwnershipMap)
          if (this.ownership[cellIdx] === UNOWNED) {
            this.setOwnerByIndex(cellIdx, nIdx);
            // Set full loyalty so deriveOwnershipFromLoyalty doesn't wipe ownership
            this.loyalty[nIdx * this.size + cellIdx] = 1.0;
          }
        }
      }
    }
  }

  /** Rebuild ownedCellCount and nationBBox from current ownership (for deserialization) */
  rebuildCountersFromOwnership() {
    this.ownedCellCount.fill(0);
    for (let n = 0; n < this.maxNations; n++) {
      this.nationBBox[n] = { minX: Infinity, maxX: -1, minY: Infinity, maxY: -1, dirty: false };
    }
    for (let i = 0; i < this.size; i++) {
      const o = this.ownership[i];
      if (o < 0) continue;
      this.ownedCellCount[o]++;
      const x = i % this.width, y = (i / this.width) | 0;
      const bb = this.nationBBox[o];
      if (x < bb.minX) bb.minX = x;
      if (x > bb.maxX) bb.maxX = x;
      if (y < bb.minY) bb.minY = y;
      if (y > bb.maxY) bb.maxY = y;
    }
  }

  /** Rebuild chunkHasBorder flags from current ownership */
  rebuildChunkBorderFlags() {
    this.chunkHasBorder.fill(0);
    const { width, height, ownership, oceanMask, chunksX } = this;
    for (let i = 0; i < this.size; i++) {
      const o = ownership[i];
      if (o === UNOWNED) continue;
      const x = i % width, y = (i / width) | 0;
      let isBorder = false;
      if (x > 0 && ownership[i - 1] !== o) isBorder = true;
      else if (x < width - 1 && ownership[i + 1] !== o) isBorder = true;
      else if (y > 0 && ownership[i - width] !== o) isBorder = true;
      else if (y < height - 1 && ownership[i + width] !== o) isBorder = true;
      if (isBorder) {
        this.chunkHasBorder[(y >> 4) * chunksX + (x >> 4)] = 1;
      }
    }
  }

  /** Tick chunk sleep counters; call once per tick after diffusion */
  tickChunkSleep() {
    for (let ci = 0; ci < this.totalChunks; ci++) {
      if (this.chunkDirty[ci]) {
        this.chunkDirty[ci] = 0;
        this.chunkSleepCounter[ci] = 0;
      } else if (this.chunkSleepCounter[ci] < 65535) {
        this.chunkSleepCounter[ci]++;
      }
    }
  }
}

// Export constants
export { UNOWNED, BIOME_ENUM, BIOME_NAMES, RESOURCE_ENUM, RESOURCE_NAMES };
