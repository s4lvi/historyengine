// mapUtils.js

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

export function computeDistanceToSea(heightMap, seaLevel = 0.3) {
  const height = heightMap.length;
  const width = heightMap[0].length;
  const distanceMap = Array.from({ length: height }, () =>
    Array(width).fill(Infinity)
  );
  const queue = [];
  const directions = [
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

  while (queue.length > 0) {
    const { x, y } = queue.shift();
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
export function generateRivers(heightMap, width, height) {
  try {
    const rivers = new Set();
    const erosionMap = Array(height)
      .fill(null)
      .map(() => Array(width).fill(0));

    const potentialRiverSources = [];

    // Identify potential river sources based on elevation thresholds.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const elev = heightMap[y][x].elevation;
        if (elev > 0.75 && Math.random() < 0.001) {
          potentialRiverSources.push({ x, y, elevation: elev });
        } else if (elev > 0.55 && Math.random() < 0.0005) {
          potentialRiverSources.push({ x, y, elevation: elev });
        }
      }
    }
    console.log(
      `Identified ${potentialRiverSources.length} potential river sources.`
    );

    // Sort sources from highest to lowest.
    potentialRiverSources.sort((a, b) => b.elevation - a.elevation);

    // Define the sea level (cells below this elevation are considered water).
    const seaLevel = 0.3;
    // Precompute the distance-to-sea map once.
    const distanceMap = computeDistanceToSea(heightMap, seaLevel);

    // Process each river source.
    potentialRiverSources.forEach((source, index) => {
      // Skip if the source is already part of an existing river.
      if (rivers.has(`${source.x},${source.y}`)) return;

      // Use A* to compute a path from the source to the sea.
      const path = aStarRiverPath(source, heightMap, distanceMap, seaLevel);
      if (!path) {
        console.log(
          `No valid path to sea found from source at (${source.x}, ${source.y}).`
        );
        return;
      }

      // Initialize river parameters.
      let riverWidth = 1;
      let stepsToWiden = Math.floor(Math.random() * 10) + 45;
      let flowStrength = 1.0;

      // Process each cell in the computed path.
      path.forEach((pt, i) => {
        const key = `${pt.x},${pt.y}`;

        // Stamp the river cells (using a square around the current cell based on riverWidth).
        for (
          let wx = -Math.floor(riverWidth / 2);
          wx < Math.ceil(riverWidth / 2);
          wx++
        ) {
          for (
            let wy = -Math.floor(riverWidth / 2);
            wy < Math.ceil(riverWidth / 2);
            wy++
          ) {
            const rx = pt.x + wx;
            const ry = pt.y + wy;
            if (rx >= 0 && rx < width && ry >= 0 && ry < height) {
              const cellKey = `${rx},${ry}`;
              rivers.add(cellKey);
              erosionMap[ry][rx] += flowStrength;
            }
          }
        }

        // Update flow strength based on elevation drop between current and next cell.
        if (i < path.length - 1) {
          const currentElev = heightMap[pt.y][pt.x].elevation;
          const nextPt = path[i + 1];
          const nextElev = heightMap[nextPt.y][nextPt.x].elevation;
          const elevDiff = currentElev - nextElev;
          flowStrength = Math.max(0.5, Math.min(1.5, flowStrength + elevDiff));
        }

        // Increase river width periodically.
        stepsToWiden--;
        if (stepsToWiden <= 0) {
          riverWidth = Math.min(riverWidth + 0.5, 2);
          stepsToWiden = Math.floor(Math.random() * 10) + 45;
          console.log(
            `Increased river width to ${riverWidth} at path step ${i}`
          );
        }
      });
    });

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
    const resources = [];

    // In grassland or savanna, assign food and a chance for horses
    if (biome === "GRASSLAND" || biome === "SAVANNA") {
      if (Math.random() < 0.004) resources.push("food");
      if (Math.random() < 0.0008) resources.push("horses");
    }

    // In woodlands or forests, assign wood
    if (
      biome === "WOODLAND" ||
      biome === "FOREST" ||
      biome === "TROPICAL_FOREST" ||
      biome === "RAINFOREST"
    ) {
      if (Math.random() < 0.008) resources.push("wood");
    }

    // In mountains, assign stone and, at higher elevations, bronze or steel
    if (biome === "MOUNTAIN") {
      if (Math.random() < 0.015) resources.push("stone");
      if (elevation > 0.7 && Math.random() < 0.005) resources.push("bronze");
      if (elevation > 0.85 && Math.random() < 0.0005) resources.push("steel");
    }

    return resources;
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
  const maxDistance = minDim / 6;
  const dist_factor = 0.9;
  const blobs = [];

  // Place first blob randomly
  blobs.push({
    x: Math.random() * (width * dist_factor) + width * (1 - dist_factor),
    y: Math.random() * (height * dist_factor) + height * (1 - dist_factor),
    radius: Math.random() * (minDim / 6) + minDim / 4,
  });

  // Add remaining blobs
  for (let i = 1; i < numBlobs; i++) {
    let newBlob;
    let isValidPosition = false;
    let attempts = 0;
    const maxAttempts = 100; // Prevent infinite loops

    while (!isValidPosition && attempts < maxAttempts) {
      // Generate candidate blob
      newBlob = {
        x: Math.random() * (width * dist_factor) + width * (1 - dist_factor),
        y: Math.random() * (height * dist_factor) + height * (1 - dist_factor),
        radius: Math.random() * (minDim / 6) + minDim / 4,
      };

      // Check if the new blob is within maxDistance of at least one existing blob
      isValidPosition = blobs.some((existingBlob) => {
        const distance = Math.sqrt(
          Math.pow(newBlob.x - existingBlob.x, 2) +
            Math.pow(newBlob.y - existingBlob.y, 2)
        );
        return distance <= maxDistance;
      });

      attempts++;
    }

    if (attempts === maxAttempts) {
      console.warn(
        `Could not find valid position for blob ${i} after ${maxAttempts} attempts`
      );
      // Use the last attempted position anyway
    }

    blobs.push(newBlob);
  }

  return blobs;
}

function spawnSubBlobs(
  blobs,
  passes = 3,
  spawnChance = 0.5,
  scaleFactor = 0.7
) {
  let allBlobs = blobs.slice(); // start with initial blobs
  for (let pass = 0; pass < passes; pass++) {
    const newBlobs = [];
    // Consider all blobs from the previous pass.
    for (const blob of allBlobs) {
      // With a given chance, spawn either 1 or 2 sub–blobs from this blob.
      if (Math.random() < spawnChance) {
        // Randomly decide to spawn 1 or 2 sub-blobs.
        const numSubBlobs = Math.random() < 0.5 ? 1 : 4;
        for (let i = 0; i < numSubBlobs; i++) {
          const angle = Math.random() * Math.PI * 2;
          // Place the new blob exactly on the edge of the parent blob.
          const subX = blob.x + Math.cos(angle) * blob.radius * 0.9;
          const subY = blob.y + Math.sin(angle) * blob.radius * 0.9;
          const subRadius = Math.random();
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

function generateMoistureMap(heightMap, width, height, noise2D, rivers) {
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
  console.log("Base moisture calculated.");

  // 2. WATER PROXIMITY BOOST: Compute distance-to-water via BFS
  let waterDistance = Array.from({ length: height }, () =>
    Array(width).fill(Infinity)
  );
  const queue = [];
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
  while (queue.length) {
    const { x, y } = queue.shift();
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
  console.log("Water distance calculated.");

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
  console.log("Water boost applied.");

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
  console.log("Mountain rain shadow applied.");

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
  console.log("Forest boost applied.");

  // 5. Add natural noise and clamp the values between 0 and 1.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      moistureMap[y][x] += noise2D(x * 0.1, y * 0.1) * 0.1;
      moistureMap[y][x] = Math.max(0, Math.min(1, moistureMap[y][x]));
    }
  }

  // 6. Smooth the moisture map a few times to simulate diffusion.
  const smoothIterations = 6;
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
  console.log("Moisture diffused.");

  return moistureMap;
}

function smoothEligibleCells(mapData) {
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
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
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

export function generateWorldMap(
  width,
  height,
  erosion_passes = 3,
  num_blobs = 4,
  seed = Math.random()
) {
  try {
    console.log("Starting world map generation using blob-based elevation...");
    const noise2D = createNoise2D(seed);
    console.log("Noise function created successfully.");

    const initialBlobs = generateInitialBlobs(num_blobs, width, height);
    const allBlobs = spawnSubBlobs(initialBlobs);
    console.log(
      `Generated ${allBlobs.length} blobs (including sub-blobs) for base elevation.`
    );

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
    console.log("Height map generated successfully.");

    // ----------------
    // River Generation
    // ----------------
    const { rivers, erosionMap } = generateRivers(
      heightMap,
      //moistureMap,
      width,
      height
    );
    console.log("Rivers generated successfully.");
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
    console.log("River erosion (with spread) applied.");

    // -------------------
    // Moisture Generation
    // -------------------
    let moistureMap = generateMoistureMap(
      heightMap,
      width,
      height,
      noise2D,
      rivers
    );

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        moistureMap[y][x] = Math.max(
          0,
          Math.min(1, moistureMap[y][x] + noise2D(x * 0.1, y * 0.1) * 0.1)
        );
      }
    }
    console.log("Moisture map noise added successfully.");

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
          const resources = generateResources(
            biome,
            elevation,
            moisture,
            temperature
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
    console.log("Map data generated successfully.");

    const smoothedMapData = smoothEligibleCells(mapData);
    console.log("Smoothing pass completed.");

    console.log("World map generation completed.");
    return smoothedMapData;
  } catch (error) {
    console.error("Error in generateWorldMap:", error, { width, height });
    throw error;
  }
}
