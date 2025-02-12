// terrainGeneration.js
// =====================================================
// A Complete World Generation System
// Implements:
// - Core Math Utilities (lerp, smoothStep)
// - Seeded 2D Noise (improved Perlin-like noise)
// - Atmospheric/Climate Simulation (global winds, air masses)
// - Tectonic/Geological Systems (plate generation, crustal deformation)
// - Hydrological Systems (precipitation, water flow)
// - Advanced Erosion (fluvial, etc.)
// - Climate & Biome Determination, Resource Generation
// - Final World Map Assembly
// =====================================================

/* =====================================================
   1. Core Mathematical Utilities
===================================================== */

/**
 * Linear interpolation between two values.
 * @param {number} t - Interpolation factor (0–1).
 * @param {number} a - Start value.
 * @param {number} b - End value.
 * @returns {number} Interpolated value.
 */
export function lerp(t, a, b) {
  return a + t * (b - a);
}

/**
 * Smooth step function using cubic Hermite interpolation.
 * @param {number} edge0 - Lower edge.
 * @param {number} edge1 - Upper edge.
 * @param {number} x - Input value.
 * @returns {number} Smoothed value between 0 and 1.
 */
export function smoothStep(edge0, edge1, x) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * Creates a seeded random number generator using a linear congruential method.
 * @param {number} seed - A number between 0 and 1.
 * @returns {Function} Random number generator function.
 */
function createSeededRandom(seed) {
  let m = 0x80000000; // 2^31
  let a = 1103515245;
  let c = 12345;
  let state = Math.floor(seed * m) || Math.floor(Math.random() * m);
  return function () {
    state = (a * state + c) % m;
    return state / m;
  };
}

/**
 * Creates a 2D noise function using improved Perlin noise.
 * @param {number} seed - Random seed.
 * @returns {Function} 2D noise function: (x, y) => number.
 */
export function createNoise2D(seed = Math.random()) {
  const random = createSeededRandom(seed);
  // Build a permutation table (0–255 shuffled)
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  const p = perm.concat(perm); // Duplicate for wrap-around

  // Gradient function returns a dot product based on a hash.
  function grad(hash, x, y) {
    const h = hash & 7; // 0-7
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return (h & 1 ? -u : u) + (h & 2 ? -v : v);
  }

  return (x, y) => {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = x * x * x * (x * (x * 6 - 15) + 10); // Quintic
    const v = y * y * y * (y * (y * 6 - 15) + 10);
    const aa = p[p[X] + Y];
    const ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y];
    const bb = p[p[X + 1] + Y + 1];
    const lerp1 = lerp(u, grad(aa, x, y), grad(ba, x - 1, y));
    const lerp2 = lerp(u, grad(ab, x, y - 1), grad(bb, x - 1, y - 1));
    return lerp(v, lerp1, lerp2);
  };
}

/* =====================================================
     2. Atmospheric and Climate Systems
  ===================================================== */

/**
 * Simulates global wind patterns (trade winds, westerlies, polar easterlies).
 * @param {number} width - Map width.
 * @param {number} height - Map height.
 * @param {Function} noise2D - Noise function.
 * @returns {Object} { windVectors: 2D array of {direction, strength}, pressureSystems: Array }.
 */
export function simulateGlobalWinds(width, height, noise2D) {
  const windVectors = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    const latitude = y / height;
    // Base wind direction: tropical cells have easterly winds, higher latitudes vary.
    for (let x = 0; x < width; x++) {
      let baseDirection;
      if (latitude < 0.33) {
        baseDirection = Math.PI; // Westward in tropics
      } else if (latitude > 0.66) {
        baseDirection = 0; // Eastward in polar regions
      } else {
        baseDirection = Math.PI / 2; // Southerly or variable in mid-latitudes
      }
      // Add local variation from noise.
      const noiseAngle = noise2D(x * 0.05, y * 0.05) * (Math.PI / 2);
      const direction = baseDirection + noiseAngle;
      // Wind strength varies with latitude and local noise.
      const strength = 5 + noise2D(x * 0.03, y * 0.03) * 2;
      row.push({ direction, strength });
    }
    windVectors.push(row);
  }

  // Create a few idealized pressure systems.
  const pressureSystems = [
    {
      center: { x: width / 2, y: height * 0.15 },
      type: "Hadley",
      strength: 100,
    },
    { center: { x: width / 2, y: height * 0.5 }, type: "Ferrel", strength: 80 },
    { center: { x: width / 2, y: height * 0.85 }, type: "Polar", strength: 60 },
  ];

  return { windVectors, pressureSystems };
}

/**
 * Calculates air masses and frontal systems.
 * @param {Array<Array<number>>} heightMap - 2D array of elevation values.
 * @param {Object} windData - Data returned from simulateGlobalWinds.
 * @param {Function} noise2D - Noise function.
 * @returns {Object} { airMasses: Array, fronts: Array }.
 */
export function calculateAirMasses(heightMap, windData, noise2D) {
  const height = heightMap.length;
  const airMasses = [];
  const fronts = [];

  // Divide the map into four broad air masses based on latitude.
  airMasses.push({
    type: "cT",
    position: { yStart: 0, yEnd: Math.floor(height * 0.3) },
    properties: { moisture: 0.8 },
  });
  airMasses.push({
    type: "mT",
    position: {
      yStart: Math.floor(height * 0.3),
      yEnd: Math.floor(height * 0.5),
    },
    properties: { moisture: 0.6 },
  });
  airMasses.push({
    type: "mP",
    position: {
      yStart: Math.floor(height * 0.5),
      yEnd: Math.floor(height * 0.7),
    },
    properties: { moisture: 0.4 },
  });
  airMasses.push({
    type: "cP",
    position: { yStart: Math.floor(height * 0.7), yEnd: height - 1 },
    properties: { moisture: 0.2 },
  });

  // Generate frontal boundaries at the interfaces.
  for (let i = 0; i < airMasses.length - 1; i++) {
    const yFront = Math.floor(
      (airMasses[i].position.yEnd + airMasses[i + 1].position.yStart) / 2
    );
    fronts.push({
      type: `${airMasses[i].type}-${airMasses[i + 1].type}`,
      position: { y: yFront },
      strength: 50 + noise2D(0, yFront * 0.1) * 10,
    });
  }
  return { airMasses, fronts };
}

/* =====================================================
     3. Tectonic and Geological Systems
  ===================================================== */

/**
 * Generates plate tectonics simulation.
 * @param {number} width - Map width.
 * @param {number} height - Map height.
 * @param {number} numPlates - Number of tectonic plates.
 * @returns {Object} { plates: Array, boundaries: Array, faultLines: Array }.
 */
export function generatePlates(width, height, numPlates) {
  const plates = [];
  for (let i = 0; i < numPlates; i++) {
    plates.push({
      center: { x: Math.random() * width, y: Math.random() * height },
      movement: {
        dx: (Math.random() - 0.5) * 2,
        dy: (Math.random() - 0.5) * 2,
      },
      density: Math.random() < 0.5 ? "oceanic" : "continental",
      age: Math.random() * 1000,
    });
  }
  // Boundaries and fault lines could be computed via Voronoi diagrams.
  const boundaries = []; // (Not implemented in detail)
  const faultLines = []; // (Not implemented in detail)
  return { plates, boundaries, faultLines };
}

/**
 * Simulates crustal deformation from plate interactions.
 * Uses a simplified Voronoi-inspired approach: for each cell, the difference between its
 * distance to the nearest and second-nearest plate centers is used to set a base elevation.
 * @param {Array<Object>} plates - Array of plate objects.
 * @param {number} width - Map width.
 * @param {number} height - Map height.
 * @param {Function} noise2D - Noise function.
 * @returns {Array<Array<number>>} 2D initial elevation map.
 */
export function simulateCrustalDeformation(plates, width, height, noise2D) {
  const elevationMap = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      // Compute distances to each plate center.
      const distances = plates.map((plate) => {
        const dx = x - plate.center.x;
        const dy = y - plate.center.y;
        return Math.sqrt(dx * dx + dy * dy);
      });
      const sorted = distances.slice().sort((a, b) => a - b);
      // The difference between the nearest and second nearest indicates a plate boundary.
      const diff = sorted[1] - sorted[0];
      // Base elevation is higher near boundaries.
      let baseElevation = diff > 10 ? 0.8 : 0.2;
      // Add a bit of noise for natural variation.
      baseElevation += noise2D(x * 0.01, y * 0.01) * 0.1;
      row.push(Math.min(1, Math.max(0, baseElevation)));
    }
    elevationMap.push(row);
  }
  return elevationMap;
}

/* =====================================================
     4. Hydrological Systems
  ===================================================== */

/**
 * Calculates precipitation patterns based on wind, orographic effects, and air mass moisture.
 * @param {Object} windData - Wind pattern data from simulateGlobalWinds.
 * @param {Array<Array<number>>} heightMap - Terrain elevation map.
 * @param {Array} airMasses - Air mass data.
 * @returns {Array<Array<number>>} Precipitation map (e.g., in mm).
 */
export function calculatePrecipitation(windData, heightMap, airMasses) {
  const height = heightMap.length;
  const width = heightMap[0].length;
  const precipMap = [];

  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      // Base precipitation (a constant for simplicity).
      const basePrecip = 100;
      // Orographic effect: if the upwind cell is higher, add extra precipitation.
      const wind = windData.windVectors[y][x];

      // Calculate the upwind cell indices.
      // Note: Math.cos and Math.sin can be negative so we use clamping to ensure indices remain within bounds.
      const rawUpwindX = x - Math.round(Math.cos(wind.direction));
      const rawUpwindY = y - Math.round(Math.sin(wind.direction));
      const upwindX = Math.min(width - 1, Math.max(0, rawUpwindX));
      const upwindY = Math.min(height - 1, Math.max(0, rawUpwindY));

      const elevationDiff = heightMap[upwindY][upwindX] - heightMap[y][x];
      const orographic = elevationDiff > 0 ? elevationDiff * 20 : 0;
      row.push(basePrecip + orographic);
    }
    precipMap.push(row);
  }
  return precipMap;
}

/**
 * Simulates water flow and erosion via a basic steepest-descent algorithm.
 * @param {Array<Array<number>>} heightMap - Terrain elevation.
 * @param {Array<Array<number>>} precipMap - Precipitation map.
 * @returns {Object} { rivers: Array of {x,y}, flowAccumulation: 2D array }.
 */
export function simulateHydrology(heightMap, precipMap) {
  const height = heightMap.length;
  const width = heightMap[0].length;
  const flowAccumulation = Array.from({ length: height }, () =>
    Array(width).fill(0)
  );

  // For each cell, send water to the steepest descent neighbor.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const currentElevation = heightMap[y][x];
      let lowest = currentElevation;
      let lowestCoord = { x, y };
      const neighbors = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
      ];
      for (let { dx, dy } of neighbors) {
        const nx = x + dx,
          ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          if (heightMap[ny][nx] < lowest) {
            lowest = heightMap[ny][nx];
            lowestCoord = { x: nx, y: ny };
          }
        }
      }
      // Flow is the local precipitation.
      flowAccumulation[y][x] = precipMap[y][x];
      // Propagate water downward (with some loss).
      if (lowestCoord.x !== x || lowestCoord.y !== y) {
        flowAccumulation[lowestCoord.y][lowestCoord.x] +=
          flowAccumulation[y][x] * 0.5;
      }
    }
  }

  // Identify river cells (threshold flow accumulation).
  const rivers = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (flowAccumulation[y][x] > 150) {
        rivers.push({ x, y });
      }
    }
  }
  return { rivers, flowAccumulation };
}

/* =====================================================
     5. Advanced Erosion Systems
  ===================================================== */

/**
 * Simulates various erosion types (fluvial, glacial, aeolian, thermal).
 * For simplicity, we subtract a fraction of water flow from elevation.
 * @param {Array<Array<number>>} heightMap - Terrain elevation.
 * @param {Object} climate - Climate data (not detailed in this example).
 * @param {Object} hydrology - Hydrology data from simulateHydrology.
 * @returns {Array<Array<number>>} Eroded terrain map.
 */
export function simulateErosion(heightMap, climate, hydrology) {
  const height = heightMap.length;
  const width = heightMap[0].length;
  const erodedMap = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      // Erosion factor proportional to local flow accumulation.
      const erosionFactor = hydrology.flowAccumulation[y][x] / 10000;
      const newElevation = heightMap[y][x] - erosionFactor;
      row.push(Math.max(0, newElevation));
    }
    erodedMap.push(row);
  }
  return erodedMap;
}

/* =====================================================
     6. Climate and Biome Systems
  ===================================================== */

/**
 * Calculates temperature based on latitude, elevation, and a lapse rate.
 * @param {number} x - X coordinate.
 * @param {number} y - Y coordinate.
 * @param {number} elevation - Elevation (0–1 normalized).
 * @param {Object} climate - Climate parameters (expects mapHeight).
 * @returns {number} Temperature (°C).
 */
export function calculateTemperature(x, y, elevation, climate) {
  const mapHeight = climate.mapHeight || 100;
  const lat = y / mapHeight;
  // Base temperature peaks at the equator.
  const baseTemp = 30 * (1 - Math.abs(lat - 0.5) * 2);
  // Apply a lapse rate: assume elevation * 1000 (meters) and 6.5°C per 1000 m.
  const altitudeEffect = elevation * 1000 * (6.5 / 1000);
  return baseTemp - altitudeEffect;
}

/**
 * Determines the biome for a cell based on elevation, moisture, and temperature.
 * Biomes returned are in ALL CAPS.
 *
 * @param {number} elevation - Normalized elevation (0–1)
 * @param {number} moisture - Normalized moisture (0–1)
 * @param {number} temperature - Temperature (°C)
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {Function} noise2D - A 2D noise function
 * @returns {string} Biome classification in ALL CAPS
 */
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
      if (moistureFactor < 0.35) return "GRASSLAND";
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

/* =====================================================
     7. Resource Generation
  ===================================================== */

/**
 * Generates natural resources based on the given biome and environmental factors.
 * Resource names are returned in ALL CAPS.
 *
 * @param {string} biome - Biome classification in ALL CAPS (e.g., "FOREST", "DESERT")
 * @param {number} elevation - Normalized elevation (0–1)
 * @param {number} moisture - Normalized moisture (0–1)
 * @param {number} temperature - Temperature (°C)
 * @returns {Array<string>} Array of resource names (ALL CAPS)
 */
export const generateResources = (biome, elevation, moisture, temperature) => {
  try {
    const resources = new Set();
    const random = Math.random();
    if (elevation > 0.8) {
      if (random < 0.3) resources.add("IRON ORE");
      if (random < 0.2) resources.add("PRECIOUS METALS");
      if (random < 0.15) resources.add("GEMS");
    } else if (elevation > 0.6) {
      if (random < 0.2) resources.add("STONE");
      if (random < 0.15) resources.add("COPPER ORE");
    }
    if (moisture > 0.6) {
      resources.add("FRESH WATER");
      if (random < 0.3) resources.add("FISH");
    }
    switch (biome) {
      case "FOREST":
      case "TROPICAL_FOREST":
      case "RAINFOREST":
        resources.add("TIMBER");
        if (random < 0.4) resources.add("MEDICINAL PLANTS");
        if (random < 0.3) resources.add("WILD FRUITS");
        if (random < 0.5) resources.add("GAME ANIMALS");
        break;
      case "GRASSLAND":
      case "SAVANNA":
        resources.add("ARABLE LAND");
        resources.add("PASTURES");
        if (random < 0.4) resources.add("GRAZING ANIMALS");
        break;
      case "WOODLAND":
        resources.add("TIMBER");
        resources.add("ARABLE LAND");
        if (random < 0.3) resources.add("WILD FRUITS");
        if (random < 0.4) resources.add("GAME ANIMALS");
        break;
      case "DESERT":
        if (random < 0.1) resources.add("SALT");
        if (moisture > 0.2) resources.add("DATE PALMS");
        break;
      case "TUNDRA":
        if (random < 0.3) resources.add("FUR ANIMALS");
        break;
      case "TAIGA":
        resources.add("TIMBER");
        if (random < 0.4) resources.add("FUR ANIMALS");
        break;
    }
    if (temperature > 15 && temperature < 30 && moisture > 0.4) {
      resources.add("FERTILE SOIL");
      if (random < 0.3) resources.add("HERBS");
    }
    return Array.from(resources);
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

/* =====================================================
     8. Main World Generation
  ===================================================== */

/**
 * Generates a complete world map incorporating tectonics, climate, hydrology, erosion, biomes, and resources.
 * @param {number} width - Map width (number of cells).
 * @param {number} height - Map height (number of cells).
 * @param {Object} options - World generation options (seed, numPlates, erosionPasses, etc.).
 * @returns {Array<Array<Object>>} 2D array of cell objects with properties:
 *   x, y, elevation, moisture, temperature, biome, isRiver, erosion, features, resources.
 */
export function generateWorldMap(width, height, options = {}) {
  const seed = options.seed || Math.random();
  const noise2D = createNoise2D(seed);

  // 1. Tectonic and Geological Systems.
  const plateData = generatePlates(width, height, options.numPlates || 5);
  const baseElevationMap = simulateCrustalDeformation(
    plateData.plates,
    width,
    height,
    noise2D
  );

  // 2. Atmospheric and Climate Systems.
  const windData = simulateGlobalWinds(width, height, noise2D);
  const airMassData = calculateAirMasses(baseElevationMap, windData, noise2D);

  // 3. Hydrological Systems.
  const precipMap = calculatePrecipitation(
    windData,
    baseElevationMap,
    airMassData.airMasses
  );
  const hydrologyData = simulateHydrology(baseElevationMap, precipMap);

  // 4. Advanced Erosion.
  const erodedElevationMap = simulateErosion(
    baseElevationMap,
    {},
    hydrologyData
  );

  // 5. Assemble final world map.
  const worldMap = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      const elevation = erodedElevationMap[y][x];
      // Normalize moisture from precipitation.
      const moisture = Math.min(1, precipMap[y][x] / 200);
      const temperature = calculateTemperature(x, y, elevation, {
        mapHeight: height,
      });
      const biome = determineBiome(
        elevation,
        moisture,
        temperature,
        x,
        y,
        noise2D
      );
      biome, elevation, moisture, temperature;
      const resources = generateResources(
        biome,
        elevation,
        moisture,
        temperature
      );
      // Mark a cell as river if it appears in the hydrology river list.
      const isRiver = hydrologyData.rivers.some((r) => r.x === x && r.y === y);
      row.push({
        x,
        y,
        elevation,
        moisture,
        temperature,
        biome,
        isRiver,
        erosion: baseElevationMap[y][x] - erodedElevationMap[y][x],
        features: [], // Additional features (mountain peaks, valleys, etc.) can be added here.
        resources,
      });
    }
    worldMap.push(row);
  }
  return worldMap;
}
