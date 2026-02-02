// mapUtils.js
const DEBUG_MAP = process.env.DEBUG_MAP === "true";

// Standard linear interpolation
export function lerp(t, a, b) {
  try {
    if (
      typeof t !== "number" ||
      typeof a !== "number" ||
      typeof b !== "number"
    ) {
      console.error("Invalid parameters for lerp:", { t, a, b });
      throw new Error("Invalid parameters for lerp");
    }
    return a + t * (b - a);
  } catch (error) {
    console.error("Error in lerp:", error);
    throw error;
  }
}

// A smooth step function for smooth transitions
export function smoothStep(edge0, edge1, x) {
  try {
    const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
    return t * t * (3 - 2 * t);
  } catch (error) {
    console.error("Error in smoothStep:", error, { edge0, edge1, x });
    throw error;
  }
}

// Improved noise function (Perlin-like noise)
export function createNoise2D(seed) {
  try {
    const permutation = Array.from({ length: 256 }, (_, i) => i);
    for (let i = permutation.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [permutation[i], permutation[j]] = [permutation[j], permutation[i]];
    }
    const p = [...permutation, ...permutation];
    return (x, y) => {
      try {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        x -= Math.floor(x);
        y -= Math.floor(y);
        const u = x * x * x * (x * (x * 6 - 15) + 10);
        const v = y * y * y * (y * (y * 6 - 15) + 10);
        const A = p[X] + Y;
        const B = p[X + 1] + Y;
        const hash = (h, x, y) => {
          const vec = [
            [1, 1],
            [-1, 1],
            [1, -1],
            [-1, -1],
            [1, 0],
            [-1, 0],
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
            [0, 1],
            [0, -1],
          ][h % 12];
          return vec[0] * x + vec[1] * y;
        };
        return lerp(
          v,
          lerp(u, hash(p[A], x, y), hash(p[B], x - 1, y)),
          lerp(u, hash(p[A + 1], x, y - 1), hash(p[B + 1], x - 1, y - 1))
        );
      } catch (error) {
        console.error("Error in noise2D function:", error, { x, y });
        throw error;
      }
    };
  } catch (error) {
    console.error("Error in noise2D:", error);
    throw error;
  }
}

export function simulateErosion(heightMap, iterations = 10) {
  try {
    const newMap = heightMap.map((row) => row.map((cell) => ({ ...cell })));
    const width = newMap[0].length;
    const height = newMap.length;
    for (let iter = 0; iter < iterations; iter++) {
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          let erosionAmount = 0;
          // Check neighboring cells
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const neighbor = newMap[y + dy][x + dx];
              const diff = newMap[y][x].elevation - neighbor.elevation;
              if (diff > 0) {
                // Transfer a small fraction of the difference
                erosionAmount += diff * 0.05;
              }
            }
          }
          newMap[y][x].elevation = Math.max(
            0,
            newMap[y][x].elevation - erosionAmount
          );
        }
      }
    }
    return newMap;
  } catch (error) {
    console.error("Error in simulateErosion:", error);
    throw error;
  }
}

export function computeDistanceToSea(
  heightMap,
  seaLevel = 0.3,
  useDiagonal = false
) {
  const height = heightMap.length;
  const width = heightMap[0].length;
  const distanceMap = Array.from({ length: height }, () =>
    Array(width).fill(Infinity)
  );
  const queue = [];
  let queueIndex = 0;
  const directions = useDiagonal
    ? [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
        { dx: 1, dy: 1 },
        { dx: 1, dy: -1 },
        { dx: -1, dy: 1 },
        { dx: -1, dy: -1 },
      ]
    : [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
      ];

  // Seed the BFS with sea cells.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (heightMap[y][x].elevation < seaLevel) {
        distanceMap[y][x] = 0;
        queue.push({ x, y });
      }
    }
  }

  while (queueIndex < queue.length) {
    const { x, y } = queue[queueIndex++];
    const currentDist = distanceMap[y][x];

    for (const { dx, dy } of directions) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        if (distanceMap[ny][nx] > currentDist + 1) {
          distanceMap[ny][nx] = currentDist + 1;
          queue.push({ x: nx, y: ny });
        }
      }
    }
  }
  return distanceMap;
}

export function aStarRiverPath(start, heightMap, distanceMap, seaLevel = 0.3) {
  const height = heightMap.length;
  const width = heightMap[0].length;
  const openSet = [];
  const closedSet = new Set();

  // Helper to generate a unique key for a cell.
  function nodeKey(x, y) {
    return `${x},${y}`;
  }

  // The starting node.
  const startNode = {
    x: start.x,
    y: start.y,
    g: 0,
    // f = g + h, where h is the precomputed distance-to-sea.
    f: distanceMap[start.y][start.x],
    parent: null,
  };
  openSet.push(startNode);

  const directions = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  // Parameters to control the cost function.
  const uphillWeight = 999; // Extra cost for moving uphill.
  const downhillReward = 35; // Reward (cost reduction) for moving downhill.
  const heuristicWeight = 0.4; // Scale factor to reduce the influence of the distance-to-sea heuristic.

  while (openSet.length > 0) {
    // Get the node with the lowest f value.
    openSet.sort((a, b) => a.f - b.f);
    const current = openSet.shift();
    const currentKey = nodeKey(current.x, current.y);

    if (closedSet.has(currentKey)) continue;
    closedSet.add(currentKey);

    // Check if we've reached the sea.
    if (heightMap[current.y][current.x].elevation < seaLevel) {
      // Reconstruct the path from start to current.
      const path = [];
      let node = current;
      while (node) {
        path.push({ x: node.x, y: node.y });
        node = node.parent;
      }
      path.reverse();
      return path;
    }

    // Expand neighbors.
    for (const { dx, dy } of directions) {
      const nx = current.x + dx;
      const ny = current.y + dy;

      // Ensure neighbor is within bounds.
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const neighborKey = nodeKey(nx, ny);
      if (closedSet.has(neighborKey)) continue;

      // Compute the cost to move to the neighbor.
      let stepCost = 1; // Base cost per step.
      const elevationDiff =
        heightMap[ny][nx].elevation - heightMap[current.y][current.x].elevation;
      if (elevationDiff > 0) {
        // Penalize uphill movement.
        stepCost += elevationDiff * uphillWeight;
      } else {
        // Reward downhill moves by reducing the cost.
        // (Be sure not to reduce below a minimum cost.)
        stepCost = Math.max(0.1, stepCost - -elevationDiff * downhillReward);
      }
      const tentative_g = current.g + stepCost;
      const h = distanceMap[ny][nx]; // heuristic: steps from neighbor to sea.
      const f = tentative_g + heuristicWeight * h;

      // See if we already have an entry for this neighbor.
      const existingIndex = openSet.findIndex(
        (node) => node.x === nx && node.y === ny
      );
      if (existingIndex !== -1) {
        if (tentative_g < openSet[existingIndex].g) {
          // Found a better path to the neighbor.
          openSet[existingIndex].g = tentative_g;
          openSet[existingIndex].f = f;
          openSet[existingIndex].parent = current;
        }
      } else {
        openSet.push({ x: nx, y: ny, g: tentative_g, f, parent: current });
      }
    }
  }

  // If openSet is empty and no sea cell was reached, return null.
  return null;
}

// Generate rivers and build an erosion map
export function generateRivers(heightMap, width, height, options = {}) {
  try {
    const seaLevel = options.seaLevel ?? 0.3;
    const noise2D = options.noise2D || null;
    const flowThreshold =
      options.flowThreshold ??
      Math.max(80, Math.round(Math.sqrt(width * height) * 1.5));
    const rainNoise = options.rainNoise ?? 0.45;
    const rainElevationBonus = options.rainElevationBonus ?? 0.6;
    const elevWeight = options.elevWeight ?? 1.4;
    const distWeight = options.distWeight ?? 0.7;
    const meanderWeight = options.meanderWeight ?? 0.35;
    const dirFieldWeight = options.dirFieldWeight ?? 0.4;
    const slopeWeight = options.slopeWeight ?? 0.6;
    const candidateTop = Math.max(2, options.candidateTop ?? 4);
    const dirNoiseScale = options.dirNoiseScale ?? 0.02;
    const pickNoiseScale = options.pickNoiseScale ?? 0.12;
    const rivers = new Set();
    const erosionMap = Array(height)
      .fill(null)
      .map(() => Array(width).fill(0));

    const distanceMap = computeDistanceToSea(heightMap, seaLevel, true);
    const total = width * height;
    const flow = new Float32Array(total);
    const effectiveElev = new Float32Array(total);
    let maxDist = 0;

    const buckets = [];

    const neighborSteps = [
      { dx: 1, dy: 0, dist: 1 },
      { dx: -1, dy: 0, dist: 1 },
      { dx: 0, dy: 1, dist: 1 },
      { dx: 0, dy: -1, dist: 1 },
      { dx: 1, dy: 1, dist: Math.SQRT2 },
      { dx: 1, dy: -1, dist: Math.SQRT2 },
      { dx: -1, dy: 1, dist: Math.SQRT2 },
      { dx: -1, dy: -1, dist: Math.SQRT2 },
    ];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dist = distanceMap[y][x];
        if (dist > maxDist) maxDist = dist;
      }
    }
    const bucketCount = 1001;
    for (let i = 0; i < bucketCount; i++) buckets.push([]);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const elev = heightMap[y][x].elevation;
        const dist = distanceMap[y][x];
        const elevNoise = noise2D ? noise2D(x * 0.08, y * 0.08) * 0.03 : 0;
        const effElev = Math.min(1, Math.max(0, elev + elevNoise));
        effectiveElev[idx] = effElev;
        const bucket = Math.max(
          0,
          Math.min(bucketCount - 1, Math.floor(effElev * (bucketCount - 1)))
        );
        buckets[bucket].push(idx);

        if (elev <= seaLevel) {
          flow[idx] = 0;
          continue;
        }

        const noiseVal = noise2D ? noise2D(x * 0.06, y * 0.06) : 0;
        const rain = 1 + noiseVal * rainNoise;
        const elevBonus = Math.max(0, elev - 0.4) * rainElevationBonus;
        flow[idx] = Math.max(0.1, rain + elevBonus);
      }
    }

    const slopeExponent = 1.3;
    for (let b = bucketCount - 1; b >= 0; b--) {
      const bucket = buckets[b];
      for (let i = 0; i < bucket.length; i++) {
        const idx = bucket[i];
        const x = idx % width;
        const y = Math.floor(idx / width);
        const elev = effectiveElev[idx];
        if (elev <= seaLevel) continue;
        const dist = distanceMap[y][x];

        let dirX = 0;
        let dirY = 0;
        if (noise2D) {
          const angle = (noise2D(x * dirNoiseScale, y * dirNoiseScale) + 1) * Math.PI;
          dirX = Math.cos(angle);
          dirY = Math.sin(angle);
        }

        let slopeDirX = 0;
        let slopeDirY = 0;
        if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
          const elevL = effectiveElev[idx - 1];
          const elevR = effectiveElev[idx + 1];
          const elevU = effectiveElev[idx - width];
          const elevD = effectiveElev[idx + width];
          const gradX = (elevR - elevL) * 0.5;
          const gradY = (elevD - elevU) * 0.5;
          const len = Math.hypot(gradX, gradY);
          if (len > 0) {
            slopeDirX = -gradX / len;
            slopeDirY = -gradY / len;
          }
        }

        const downslope = [];
        const fallback = [];
        for (const step of neighborSteps) {
          const nx = x + step.dx;
          const ny = y + step.dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nIdx = ny * width + nx;
          const nElev = effectiveElev[nIdx];
          const nDist = distanceMap[ny][nx];
          const elevDrop = elev - nElev;
          const distDrop = dist - nDist;
          if (elevDrop > 0) {
            const baseSlope = elevDrop / step.dist;
            const jitter = noise2D ? noise2D(nx * 0.08, ny * 0.08) * 0.05 : 0;
            const dirBias =
              step.dx * dirX + step.dy * dirY;
            const slopeBias =
              step.dx * slopeDirX + step.dy * slopeDirY;
            const score =
              baseSlope * elevWeight +
              distDrop * distWeight +
              jitter * meanderWeight +
              dirBias * dirFieldWeight +
              slopeBias * slopeWeight;
            downslope.push({ idx: nIdx, score, slope: baseSlope });
          } else if (distDrop > 0) {
            fallback.push({ idx: nIdx, score: distDrop });
          }
        }

        let pool = downslope;
        if (pool.length === 0 && fallback.length > 0) {
          fallback.sort((a, b) => b.score - a.score);
          pool = fallback.slice(0, 1);
        }
        if (pool.length === 0) continue;

        pool.sort((a, b) => b.score - a.score);
        const top = pool.slice(0, Math.min(candidateTop, pool.length));
        let totalWeight = 0;
        for (const entry of top) {
          const w = Math.pow(Math.max(0.0001, entry.slope || entry.score), slopeExponent);
          entry.weight = w;
          totalWeight += w;
        }
        if (!Number.isFinite(totalWeight) || totalWeight <= 0) continue;

        for (const entry of top) {
          flow[entry.idx] += flow[idx] * (entry.weight / totalWeight);
        }
      }
    }

    let maxFlow = 0;
    for (let i = 0; i < total; i++) {
      if (flow[i] > maxFlow) maxFlow = flow[i];
    }
    const maxStrength = maxFlow > 0 ? maxFlow : 1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const elev = heightMap[y][x].elevation;
        if (elev <= seaLevel) continue;
        const accum = flow[idx];
        if (accum < flowThreshold) continue;

        const strength = Math.min(1.6, (accum / maxStrength) * 2);
        const widthLevel =
          accum > flowThreshold * 6 ? 2 : accum > flowThreshold * 3 ? 1 : 0;

        for (let dy = -widthLevel; dy <= widthLevel; dy++) {
          for (let dx = -widthLevel; dx <= widthLevel; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const cellElev = heightMap[ny][nx].elevation;
            if (cellElev <= seaLevel) continue;
            const key = `${nx},${ny}`;
            rivers.add(key);
            erosionMap[ny][nx] += strength;
          }
        }
      }
    }

    return { rivers, erosionMap };
  } catch (error) {
    console.error("Error in generateRivers:", error);
    throw error;
  }
}

// Calculate temperature with natural variation
export const calculateTemperature = (
  x,
  y,
  elevation,
  width,
  height,
  noise2D
) => {
  try {
    const latitudeFactor = y / height;
    const baseTemp =
      25 * (1 - Math.pow(Math.abs(latitudeFactor - 0.5) * 1.25, 1.5));
    const largeScaleNoise = noise2D(x * 0.02, y * 0.02) * 8;
    const mediumScaleNoise = noise2D(x * 0.05, y * 0.05) * 4;
    const smallScaleNoise = noise2D(x * 0.1, y * 0.1) * 2;
    const elevationEffect = -elevation * 5;
    return baseTemp + largeScaleNoise + smallScaleNoise + elevationEffect;
  } catch (error) {
    console.error("Error in calculateTemperature:", error, { x, y, elevation });
    throw error;
  }
};

// Resource generation
export const generateResources = (biome, elevation, moisture, temperature) => {
  try {
    const nodeChanceByBiome = {
      GRASSLAND: 0.012,
      SAVANNA: 0.01,
      RIVER: 0.014,
      COASTAL: 0.012,
      FOREST: 0.01,
      WOODLAND: 0.01,
      TROPICAL_FOREST: 0.01,
      RAINFOREST: 0.01,
      TAIGA: 0.009,
      MOUNTAIN: 0.014,
      DESERT: 0.005,
      TUNDRA: 0.006,
    };
    const nodeChance = nodeChanceByBiome[biome] ?? 0;
    if (nodeChance <= 0) return [];
    if (Math.random() > nodeChance) return [];

    let weights = [];
    if (biome === "MOUNTAIN") {
      weights = [
        { type: "stone", w: 0.45 },
        { type: "iron", w: elevation > 0.65 ? 0.25 : 0.18 },
        { type: "gold", w: elevation > 0.8 ? 0.08 : 0.04 },
        { type: "food", w: 0.12 },
        { type: "wood", w: 0.1 },
      ];
    } else if (biome === "DESERT") {
      weights = [
        { type: "stone", w: 0.35 },
        { type: "iron", w: elevation > 0.65 ? 0.2 : 0.12 },
        { type: "gold", w: elevation > 0.8 ? 0.06 : 0.03 },
        { type: "food", w: 0.12 },
        { type: "wood", w: 0.08 },
      ];
    } else if (biome === "TUNDRA") {
      weights = [
        { type: "iron", w: 0.28 },
        { type: "stone", w: 0.22 },
        { type: "food", w: 0.18 },
        { type: "wood", w: 0.12 },
        { type: "gold", w: 0.05 },
      ];
    } else if (biome === "RIVER" || biome === "COASTAL") {
      weights = [
        { type: "food", w: 0.45 },
        { type: "wood", w: 0.22 },
        { type: "stone", w: 0.12 },
        { type: "iron", w: 0.08 },
        { type: "gold", w: 0.05 },
      ];
    } else if (
      biome === "FOREST" ||
      biome === "WOODLAND" ||
      biome === "TROPICAL_FOREST" ||
      biome === "RAINFOREST" ||
      biome === "TAIGA"
    ) {
      weights = [
        { type: "wood", w: 0.45 },
        { type: "food", w: 0.2 },
        { type: "stone", w: 0.12 },
        { type: "iron", w: 0.1 },
        { type: "gold", w: 0.05 },
      ];
    } else {
      weights = [
        { type: "food", w: 0.5 },
        { type: "wood", w: 0.2 },
        { type: "stone", w: 0.12 },
        { type: "iron", w: 0.1 },
        { type: "gold", w: 0.08 },
      ];
    }

    let total = 0;
    for (const entry of weights) total += entry.w;
    let roll = Math.random() * total;
    for (const entry of weights) {
      roll -= entry.w;
      if (roll <= 0) return [entry.type];
    }
    return [weights[weights.length - 1]?.type || "food"];
  } catch (error) {
    console.error("Error in generateResources:", error, {
      biome,
      elevation,
      moisture,
      temperature,
    });
    throw error;
  }
};

// Biome determination
export const determineBiome = (
  elevation,
  moisture,
  temperature,
  x,
  y,
  noise2D
) => {
  try {
    const thresholdNoise = noise2D(x * 0.05, y * 0.05) * 0.05;
    if (elevation < 0.35 + thresholdNoise) return "OCEAN";
    if (elevation < 0.4 + thresholdNoise) return "COASTAL";
    if (elevation > 0.85 + thresholdNoise) return "MOUNTAIN";

    const tempFactor = smoothStep(0, 35, temperature);
    const adjustedMoisture = moisture + noise2D(x * 0.03, y * 0.03) * 0.1;
    const moistureFactor = smoothStep(0, 1, adjustedMoisture);

    if (tempFactor > 0.7) {
      if (moistureFactor < 0.25) return "DESERT";
      if (moistureFactor < 0.45) return "SAVANNA";
      if (moistureFactor < 0.7) return "TROPICAL_FOREST";
      return "RAINFOREST";
    } else if (tempFactor < 0.3) {
      if (moistureFactor < 0.35) return "TUNDRA";
      return "TAIGA";
    } else {
      if (moistureFactor < 0.25) return "GRASSLAND";
      if (moistureFactor < 0.65) return "WOODLAND";
      return "FOREST";
    }
  } catch (error) {
    console.error("Error in determineBiome:", error, {
      elevation,
      moisture,
      temperature,
      x,
      y,
    });
    throw error;
  }
};

// Generates a set of initial large blobs.
function generateInitialBlobs(numBlobs, width, height) {
  const minDim = Math.min(width, height);
  const dist_factor = 0.9;
  const blobs = [];
  for (let i = 0; i < numBlobs; i++) {
    blobs.push({
      x: Math.random() * (width * dist_factor) + width * (1 - dist_factor),
      y: Math.random() * (height * dist_factor) + height * (1 - dist_factor),
      radius: Math.random() * (minDim / 6) + minDim / 4,
    });
  }
  return blobs;
}

function spawnSubBlobs(
  blobs,
  passes = 3,
  spawnChance = 0.5,
  scaleFactor = 0.7,
  maxSubBlobs = 4
) {
  let allBlobs = blobs.slice(); // start with initial blobs
  for (let pass = 0; pass < passes; pass++) {
    const newBlobs = [];
    // Consider all blobs from the previous pass.
    for (const blob of allBlobs) {
      // With a given chance, spawn either 1 or 2 sub–blobs from this blob.
      if (Math.random() < spawnChance) {
        // Randomly decide to spawn 1 or 2 sub-blobs.
        const maxCount = Math.max(1, maxSubBlobs);
        const numSubBlobs = Math.random() < 0.5 ? 1 : Math.min(4, maxCount);
        for (let i = 0; i < numSubBlobs; i++) {
          const angle = Math.random() * Math.PI * 2;
          // Place the new blob exactly on the edge of the parent blob.
          const subX = blob.x + Math.cos(angle) * blob.radius * 0.9;
          const subY = blob.y + Math.sin(angle) * blob.radius * 0.9;
          const subRadius = Math.random();
          if (DEBUG_MAP) {
            console.log("Added sub blob", blob.radius, subRadius);
          }
          newBlobs.push({ x: subX, y: subY, radius: subRadius });
        }
      }
    }
    // Add any new blobs from this pass to the overall collection.
    allBlobs = allBlobs.concat(newBlobs);
  }
  return allBlobs;
}

export function calculateBlobElevation(x, y, blobs, noise2D) {
  try {
    let blobElevation = 0;
    for (const blob of blobs) {
      const dx = x - blob.x;
      const dy = y - blob.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Influence is 1 at the center and falls to 0 at the blob's radius.
      const influence = 1 - smoothStep(0, blob.radius, dist);
      blobElevation = Math.max(blobElevation, influence);
    }
    // Add subtle low-frequency noise for additional natural variation.
    const noiseVal = noise2D(x * 0.05, y * 0.05) * 0.3 - 0.1;
    const noiseVal2 = noise2D(x * 0.15, y * 0.15) * 0.15;
    const noiseVal3 = noise2D(x * 0.5, y * 0.5) * 0.1;
    let elevation = blobElevation + noiseVal + noiseVal2 + noiseVal3;
    // Clamp elevation to the 0–1 range.
    elevation = Math.min(1, Math.max(0, elevation));
    return elevation;
  } catch (error) {
    console.error("Error in calculateBlobElevation:", error, { x, y, blobs });
    throw error;
  }
}

function generateMoistureMap(
  heightMap,
  width,
  height,
  noise2D,
  rivers,
  options = {}
) {
  const waterThreshold = 0.3;
  const baseMoistureWater = 1.0;
  const baseMoistureLand = 0.3;

  // 1. INITIAL BASE MOISTURE: water cells vs. land
  let moistureMap = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) =>
      heightMap[y][x].elevation < waterThreshold
        ? baseMoistureWater
        : baseMoistureLand
    )
  );
  if (DEBUG_MAP) console.log("Base moisture calculated.");

  // 2. WATER PROXIMITY BOOST: Compute distance-to-water via BFS
  let waterDistance = Array.from({ length: height }, () =>
    Array(width).fill(Infinity)
  );
  const queue = [];
  let queueIndex = 0;
  // Seed the BFS with water cells.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (
        heightMap[y][x].elevation < waterThreshold ||
        rivers.has(`${x},${y}`)
      ) {
        waterDistance[y][x] = 0;
        queue.push({ x, y });
      }
    }
  }
  const directions = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];
  while (queueIndex < queue.length) {
    const { x, y } = queue[queueIndex++];
    const d = waterDistance[y][x];
    for (const { dx, dy } of directions) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        if (waterDistance[ny][nx] > d + 1) {
          waterDistance[ny][nx] = d + 1;
          queue.push({ x: nx, y: ny });
        }
      }
    }
  }
  if (DEBUG_MAP) console.log("Water distance calculated.");

  // Boost moisture for cells near water.
  const maxWaterInfluenceDistance = 15; // in cells
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dist = waterDistance[y][x];
      if (dist < maxWaterInfluenceDistance) {
        // Closer cells get a larger boost (up to 0.3 extra).
        const boost =
          ((maxWaterInfluenceDistance - dist) / maxWaterInfluenceDistance) *
          0.7;
        moistureMap[y][x] += boost;
      }
    }
  }
  if (DEBUG_MAP) console.log("Water boost applied.");

  // 3. MOUNTAIN RAIN SHADOW: Reduce moisture if mountains block moisture from the west.
  // Assume prevailing wind comes from the west.
  const mountainThreshold = 0.6;
  const maxShadowDistance = 15; // how far to look to the west
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let shadow = 0;
      for (let d = 1; d <= maxShadowDistance; d++) {
        const nx = x - d;
        if (nx < 0) break;
        if (heightMap[y][nx].elevation > mountainThreshold) {
          // The higher the mountain above the threshold, the stronger the effect.
          const mountainExcess = heightMap[y][nx].elevation - mountainThreshold;
          shadow += mountainExcess * 0.4;
        }
      }
      moistureMap[y][x] = Math.max(0, moistureMap[y][x] - shadow);
    }
  }
  if (DEBUG_MAP) console.log("Mountain rain shadow applied.");

  // 4. FOREST BOOST: A simple heuristic that boosts moisture in areas likely to be forested.
  // Here we add a small boost if the cell is at a moderate elevation and has moist neighbors.
  const forestBoost = 0.1;
  // Create a copy so that neighbor reads are not affected by updates.
  let forestMoisture = moistureMap.map((row) => row.slice());
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0,
        count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            sum += moistureMap[ny][nx];
            count++;
          }
        }
      }
      const avgNeighborMoisture = sum / count;
      // If the cell is in a moderate elevation band and its neighborhood is moist,
      // add a forest boost.
      if (
        heightMap[y][x].elevation >= 0.3 &&
        heightMap[y][x].elevation <= 0.6 &&
        avgNeighborMoisture > 0.6
      ) {
        forestMoisture[y][x] += forestBoost;
      }
    }
  }
  moistureMap = forestMoisture;
  if (DEBUG_MAP) console.log("Forest boost applied.");

  // 5. Add natural noise and clamp the values between 0 and 1.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      moistureMap[y][x] += noise2D(x * 0.1, y * 0.1) * 0.1;
      moistureMap[y][x] = Math.max(0, Math.min(1, moistureMap[y][x]));
    }
  }

  // 6. Smooth the moisture map a few times to simulate diffusion.
  const smoothIterations = Math.max(1, options.smoothIterations ?? 6);
  for (let iter = 0; iter < smoothIterations; iter++) {
    const newMap = Array.from({ length: height }, () => Array(width).fill(0));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0,
          count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx,
              ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              sum += moistureMap[ny][nx];
              count++;
            }
          }
        }
        newMap[y][x] = sum / count;
      }
    }
    moistureMap = newMap;
  }
  if (DEBUG_MAP) console.log("Moisture diffused.");

  return moistureMap;
}

function smoothEligibleCells(mapData, radius = 2) {
  const height = mapData.length;
  const width = mapData[0].length;
  // Make a deep copy of the mapData to store the new elevation values.
  const newMapData = mapData.map((row) => row.map((cell) => ({ ...cell })));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = mapData[y][x];
      // Only smooth cells that are non-coastal and whose elevation is between 0.4 and 0.7.
      if (
        cell.biome !== "COASTAL" &&
        cell.elevation >= 0.35 &&
        cell.elevation <= 0.7
      ) {
        let sum = 0;
        let count = 0;
        // Loop over the 3x3 neighborhood.
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
              const neighbor = mapData[ny][nx];
              // Only include neighbors that are also non-coastal and within our elevation bounds.
              if (
                neighbor.biome !== "COASTAL" &&
                neighbor.elevation >= 0.4 &&
                neighbor.elevation <= 0.7
              ) {
                sum += neighbor.elevation;
                count++;
              }
            }
          }
        }
        if (count > 0) {
          // Update the elevation with the neighborhood average.
          newMapData[y][x].elevation = sum / count;
        }
      }
    }
  }
  return newMapData;
}

function ensureElevationConnectivity(heightMap, landThreshold, noise2D) {
  const height = heightMap.length;
  if (height === 0) return heightMap;
  const width = heightMap[0].length;
  const total = width * height;

  const visited = new Uint8Array(total);
  const componentId = new Int32Array(total);
  componentId.fill(-1);
  const componentSizes = [];

  const queue = new Int32Array(total);
  const neighbors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  let componentCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx]) continue;
      if (heightMap[y][x].elevation < landThreshold) continue;

      let head = 0;
      let tail = 0;
      queue[tail++] = idx;
      visited[idx] = 1;
      componentId[idx] = componentCount;
      let size = 0;

      while (head < tail) {
        const current = queue[head++];
        size++;
        const cy = Math.floor(current / width);
        const cx = current - cy * width;
        for (const [dx, dy] of neighbors) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (visited[nIdx]) continue;
          if (heightMap[ny][nx].elevation < landThreshold) continue;
          visited[nIdx] = 1;
          componentId[nIdx] = componentCount;
          queue[tail++] = nIdx;
        }
      }

      componentSizes.push(size);
      componentCount++;
    }
  }

  if (componentCount <= 1) return heightMap;

  let mainComponent = 0;
  for (let i = 1; i < componentSizes.length; i++) {
    if (componentSizes[i] > componentSizes[mainComponent]) {
      mainComponent = i;
    }
  }

  const dist = new Int32Array(total);
  const nearestMain = new Int32Array(total);
  dist.fill(-1);
  nearestMain.fill(-1);

  let head = 0;
  let tail = 0;
  for (let i = 0; i < total; i++) {
    if (componentId[i] === mainComponent) {
      dist[i] = 0;
      nearestMain[i] = i;
      queue[tail++] = i;
    }
  }

  while (head < tail) {
    const current = queue[head++];
    const cy = Math.floor(current / width);
    const cx = current - cy * width;
    for (const [dx, dy] of neighbors) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nIdx = ny * width + nx;
      if (dist[nIdx] !== -1) continue;
      dist[nIdx] = dist[current] + 1;
      nearestMain[nIdx] = nearestMain[current];
      queue[tail++] = nIdx;
    }
  }

  const bestDist = new Int32Array(componentCount).fill(-1);
  const bestIdx = new Int32Array(componentCount).fill(-1);
  const bestTarget = new Int32Array(componentCount).fill(-1);

  for (let i = 0; i < total; i++) {
    const comp = componentId[i];
    if (comp < 0 || comp === mainComponent) continue;
    const d = dist[i];
    if (d < 0) continue;
    if (bestDist[comp] === -1 || d < bestDist[comp]) {
      bestDist[comp] = d;
      bestIdx[comp] = i;
      bestTarget[comp] = nearestMain[i];
    }
  }

  const addBlob = (cx, cy, radius, strength) => {
    const r2 = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const falloff = 1 - d2 / r2;
        const lift = landThreshold + strength * falloff;
        heightMap[ny][nx].elevation = Math.max(
          heightMap[ny][nx].elevation,
          Math.min(0.9, lift)
        );
      }
    }
  };

  const jitter = (value, amount) => {
    const n =
      noise2D && typeof noise2D === "function"
        ? noise2D(value * 0.07, value * 0.11)
        : 0;
    return value + n * amount;
  };

  for (let comp = 0; comp < componentCount; comp++) {
    if (comp === mainComponent) continue;
    if (bestIdx[comp] === -1 || bestTarget[comp] === -1) continue;
    const from = bestIdx[comp];
    const to = bestTarget[comp];
    const fx = from % width;
    const fy = Math.floor(from / width);
    const tx = to % width;
    const ty = Math.floor(to / width);
    const distCells = Math.max(1, bestDist[comp]);
    const blobCount = Math.min(4, Math.max(2, Math.round(distCells / 18)));
    for (let i = 1; i <= blobCount; i++) {
      const t = i / (blobCount + 1);
      const cx = Math.round(jitter(lerp(t, fx, tx), 3));
      const cy = Math.round(jitter(lerp(t, fy, ty), 3));
      const radius = Math.min(8, Math.max(3, Math.round(distCells / 12)));
      const strength = 0.08 + (radius / 20);
      addBlob(cx, cy, radius, strength);
    }
  }

  return heightMap;
}

export function generateWorldMap(
  width,
  height,
  erosion_passes = 3,
  num_blobs = 4,
  seed = Math.random()
) {
  try {
    if (DEBUG_MAP)
      console.log("Starting world map generation using blob-based elevation...");
    const totalCells = width * height;
    const largeMap = totalCells >= 800000;
    const profile = {
      subBlobPasses: largeMap ? 2 : 3,
      subBlobSpawnChance: largeMap ? 0.35 : 0.5,
      maxSubBlobs: largeMap ? 2 : 4,
      maxBlobs: largeMap ? 160 : Infinity,
      moistureSmoothIterations: largeMap ? 3 : 6,
      smoothRadius: largeMap ? 1 : 2,
      rivers: {
        flowThreshold: Math.max(
          40,
          Math.round(Math.sqrt(totalCells) * (largeMap ? 0.18 : 0.14))
        ),
        rainNoise: largeMap ? 0.35 : 0.45,
        rainElevationBonus: largeMap ? 0.5 : 0.65,
        elevWeight: largeMap ? 1.1 : 1.3,
        distWeight: largeMap ? 0.2 : 0.3,
        meanderWeight: largeMap ? 0.5 : 0.45,
        dirFieldWeight: largeMap ? 0.55 : 0.5,
        slopeWeight: largeMap ? 0.85 : 0.75,
        candidateTop: largeMap ? 4 : 5,
        dirNoiseScale: largeMap ? 0.035 : 0.045,
        pickNoiseScale: largeMap ? 0.16 : 0.2,
      },
    };
    const noise2D = createNoise2D(seed);
    if (DEBUG_MAP) console.log("Noise function created successfully.");

    const initialBlobs = generateInitialBlobs(num_blobs, width, height);
    let allBlobs = spawnSubBlobs(
      initialBlobs,
      profile.subBlobPasses,
      profile.subBlobSpawnChance,
      0.7,
      profile.maxSubBlobs
    );
    if (Number.isFinite(profile.maxBlobs) && allBlobs.length > profile.maxBlobs) {
      allBlobs.sort((a, b) => b.radius - a.radius);
      allBlobs = allBlobs.slice(0, profile.maxBlobs);
    }
    if (DEBUG_MAP) {
      console.log(
        `Generated ${allBlobs.length} blobs (including sub-blobs) for base elevation.`
      );
    }

    // Build the height map using our blob-based elevation function.
    const heightMap = Array(height)
      .fill(0)
      .map((_, y) =>
        Array(width)
          .fill(0)
          .map((_, x) => {
            try {
              // Compute the base elevation for this cell.
              let elevation = calculateBlobElevation(x, y, allBlobs, noise2D);

              // -------------------------------------------------------
              // Border Fade-Out with Random Variation using Noise
              // -------------------------------------------------------
              const border = width * 0.2;
              const baseDistance = Math.min(
                x,
                width - 1 - x,
                y,
                height - 1 - y
              );
              const noiseScale = 0.3;
              const noiseAmplitude = border * 0.02;
              const noiseValue =
                (noise2D(x * noiseScale, y * noiseScale) + 1) / 2;
              const noiseOffset = noiseValue * noiseAmplitude;

              let d = baseDistance + noiseOffset;

              if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
                d = 0;
              }

              const borderFactor = smoothStep(0, border, d);

              elevation = elevation * borderFactor;

              if (elevation < 0.3) {
                elevation = elevation * 0.5;
              }
              return { x, y, elevation };
            } catch (error) {
              console.error("Error generating height map cell:", error, {
                x,
                y,
              });
              throw error;
            }
          })
      );
    if (DEBUG_MAP) console.log("Height map generated successfully.");

    // ----------------
    // River Generation
    // ----------------
    const { rivers, erosionMap } = generateRivers(heightMap, width, height, {
      noise2D,
      flowThreshold: profile.rivers.flowThreshold,
      rainNoise: profile.rivers.rainNoise,
      rainElevationBonus: profile.rivers.rainElevationBonus,
      elevWeight: profile.rivers.elevWeight,
      distWeight: profile.rivers.distWeight,
      meanderWeight: profile.rivers.meanderWeight,
      dirFieldWeight: profile.rivers.dirFieldWeight,
      slopeWeight: profile.rivers.slopeWeight,
      candidateTop: profile.rivers.candidateTop,
      dirNoiseScale: profile.rivers.dirNoiseScale,
      pickNoiseScale: profile.rivers.pickNoiseScale,
    });
    if (DEBUG_MAP) console.log("Rivers generated successfully.");
    const riverErosionFactor = 0.04; // Tweak this value to control how strongly rivers lower the elevation

    // Define a normalized 3x3 kernel that spreads the erosion effect.
    // The center gets the most erosion, while immediate neighbors receive a fraction.
    const kernel = [
      [0.05, 0.1, 0.05],
      [0.1, 0.4, 0.1],
      [0.05, 0.1, 0.05],
    ];

    // Create a new map to store the spread erosion values.
    const spreadErosionMap = Array(height)
      .fill(null)
      .map(() => Array(width).fill(0));

    // For each cell, sum contributions from the erosionMap in a 3x3 window weighted by the kernel.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let spreadErosion = 0;
        // Loop over the kernel offsets (here: -1 to 1 for both axes)
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const ny = y + ky;
            const nx = x + kx;
            // Only add contributions from valid neighbors.
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              // Get the corresponding kernel weight.
              const weight = kernel[ky + 1][kx + 1];
              spreadErosion += erosionMap[ny][nx] * weight;
            }
          }
        }
        spreadErosionMap[y][x] = spreadErosion;
      }
    }

    // Now, subtract the spread erosion influence from the elevation for each cell.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        heightMap[y][x].elevation = Math.max(
          0,
          Math.min(
            1,
            heightMap[y][x].elevation -
              spreadErosionMap[y][x] * riverErosionFactor
          )
        );
      }
    }
    if (DEBUG_MAP) console.log("River erosion (with spread) applied.");

    // Ensure landmasses are connected before downstream passes.
    ensureElevationConnectivity(heightMap, 0.35, noise2D);

    // -------------------
    // Moisture Generation
    // -------------------
    let moistureMap = generateMoistureMap(
      heightMap,
      width,
      height,
      noise2D,
      rivers,
      { smoothIterations: profile.moistureSmoothIterations }
    );

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        moistureMap[y][x] = Math.max(
          0,
          Math.min(1, moistureMap[y][x] + noise2D(x * 0.1, y * 0.1) * 0.1)
        );
      }
    }
    if (DEBUG_MAP) console.log("Moisture map noise added successfully.");

    const erodedHeightMap = simulateErosion(heightMap, erosion_passes);
    // ----------------
    // Assemble Final Map Data
    // ----------------
    const mapData = erodedHeightMap.map((row, y) =>
      row.map((cell, x) => {
        try {
          const { elevation } = cell;
          const moisture = moistureMap[y][x];
          const temperature = calculateTemperature(
            x,
            y,
            elevation,
            width,
            height,
            noise2D
          );
          const erosion = erosionMap[y][x];
          let biome = determineBiome(
            elevation,
            moisture,
            temperature,
            x,
            y,
            noise2D
          );
          const features = [];

          if (elevation > 0.8) {
            features.push("peaks", "cliffs");
          } else if (elevation > 0.6) {
            features.push("hills");
            if (moisture > 0.6) features.push("springs");
          } else if (elevation < 0.3) {
            features.push("lowlands");
            if (moisture > 0.6) {
              features.push("wetlands");
              if (Math.random() < 0.3) features.push("marshes");
            }
          }

          if (moisture > 0.7 && elevation > 0.3 && elevation < 0.6) {
            features.push("fertile valleys");
          }

          // River handling: if this cell is part of a river, mark it and adjust biome.
          if (rivers.has(`${x},${y}`)) {
            features.push("river");
            biome = "RIVER";
          }
          const resources = generateResources(
            biome,
            elevation,
            moisture,
            temperature
          );

          return {
            x,
            y,
            elevation,
            moisture,
            temperature,
            biome,
            isRiver: rivers.has(`${x},${y}`),
            erosion,
            features,
            resources,
          };
        } catch (error) {
          console.error("Error generating map data for cell:", error, { x, y });
          throw error;
        }
      })
    );
    if (DEBUG_MAP) console.log("Map data generated successfully.");

    const smoothedMapData = smoothEligibleCells(mapData, profile.smoothRadius);
    if (DEBUG_MAP) console.log("Smoothing pass completed.");

    if (DEBUG_MAP) console.log("World map generation completed.");
    return smoothedMapData;
  } catch (error) {
    console.error("Error in generateWorldMap:", error, { width, height });
    throw error;
  }
}
