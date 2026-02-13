// mapUtils.js — Domain-warped FBM terrain generation
const DEBUG_MAP = process.env.DEBUG_MAP === "true";

// Default generation config — overridden by gameConfig.json mapGeneration section
const DEFAULTS = {
  seaLevel: 0.35,
  coastalLevel: 0.40,
  mountainLevel: 0.85,
  elevationOffset: 0.40,
  noiseWeight: 0.6,
  anchorWeight: 0.4,
  warp1Scale: 0.003,
  warp1Amplitude: 40,
  warp2Scale: 0.006,
  warp2Amplitude: 20,
  fbmOctaves: 6,
  fbmFrequency: 0.008,
  fbmPersistence: 0.5,
  borderWidth: 0.18,
  anchorMargin: 0.15,
  anchorMinStrength: 0.4,
  anchorStrengthRange: 0.35,
  anchorMinSigma: 0.15,
  anchorSigmaRange: 0.12,
  peakAmplifyStrength: 0.8,
  subSeaPush: 0.6,
  riverFlowMultiplier: 0.12,
  riverWidenMultiplier: 4,
  moistureInfluenceRadius: 15,
  rainShadowDecay: 0.92,
  moistureSmoothPasses: 3,
};

function resolveConfig(cfg) {
  if (!cfg) return { ...DEFAULTS };
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    out[key] = cfg[key] !== undefined ? cfg[key] : DEFAULTS[key];
  }
  return out;
}

// ─── Phase 1: Seeded PRNG + Noise ────────────────────────────────────────────

function mulberry32(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function smoothStep(edge0, edge1, x) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

export function createNoise2D(seed) {
  const rng = mulberry32(seed * 2654435761);
  const perm = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const tmp = base[i];
    base[i] = base[j];
    base[j] = tmp;
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];

  const gx = [1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0];
  const gy = [1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1];

  return (x, y) => {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);

    const A = perm[X] + Y;
    const B = perm[X + 1] + Y;

    const h00 = perm[A] % 12;
    const h10 = perm[B] % 12;
    const h01 = perm[A + 1] % 12;
    const h11 = perm[B + 1] % 12;

    const n00 = gx[h00] * xf + gy[h00] * yf;
    const n10 = gx[h10] * (xf - 1) + gy[h10] * yf;
    const n01 = gx[h01] * xf + gy[h01] * (yf - 1);
    const n11 = gx[h11] * (xf - 1) + gy[h11] * (yf - 1);

    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return nx0 + v * (nx1 - nx0);
  };
}

// ─── Phase 2: Elevation via Domain-Warped FBM ────────────────────────────────

function fbm(noise2D, x, y, octaves, freq, persistence) {
  let value = 0;
  let amp = 1;
  let f = freq;
  let maxAmp = 0;
  for (let i = 0; i < octaves; i++) {
    value += noise2D(x * f, y * f) * amp;
    maxAmp += amp;
    amp *= persistence;
    f *= 2;
  }
  return value / maxAmp;
}

function generateElevation(width, height, numBlobs, noise2D, rng, cfg) {
  const total = width * height;
  const elev = new Float32Array(total);

  const anchors = [];
  for (let i = 0; i < numBlobs; i++) {
    anchors.push({
      x: cfg.anchorMargin * width + rng() * width * (1 - 2 * cfg.anchorMargin),
      y: cfg.anchorMargin * height + rng() * height * (1 - 2 * cfg.anchorMargin),
      strength: cfg.anchorMinStrength + rng() * cfg.anchorStrengthRange,
      sigma: Math.min(width, height) * (cfg.anchorMinSigma + rng() * cfg.anchorSigmaRange),
    });
  }
  // Ensure at least one strong anchor for mountain generation
  anchors[0].strength = Math.max(anchors[0].strength, 0.55);

  const border = width * cfg.borderWidth;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      // Domain warp layer 1
      const w1x = noise2D(x * cfg.warp1Scale, y * cfg.warp1Scale) * cfg.warp1Amplitude;
      const w1y = noise2D(x * cfg.warp1Scale + 5.2, y * cfg.warp1Scale + 1.3) * cfg.warp1Amplitude;

      // Domain warp layer 2
      const w2x = noise2D((x + w1x) * cfg.warp2Scale, (y + w1y) * cfg.warp2Scale) * cfg.warp2Amplitude;
      const w2y = noise2D((x + w1x) * cfg.warp2Scale + 3.7, (y + w1y) * cfg.warp2Scale + 8.1) * cfg.warp2Amplitude;

      // FBM noise with warped coordinates
      const wx = x + w1x + w2x;
      const wy = y + w1y + w2y;
      const noiseVal = fbm(noise2D, wx, wy, cfg.fbmOctaves, cfg.fbmFrequency, cfg.fbmPersistence);

      // Continent anchor bias (Gaussian falloff)
      let blobBias = 0;
      for (let a = 0; a < anchors.length; a++) {
        const dx = x - anchors[a].x;
        const dy = y - anchors[a].y;
        const d2 = dx * dx + dy * dy;
        const sigma2 = anchors[a].sigma * anchors[a].sigma;
        blobBias = Math.max(blobBias, anchors[a].strength * Math.exp(-d2 / (2 * sigma2)));
      }

      // Combine
      let e = noiseVal * cfg.noiseWeight + blobBias * cfg.anchorWeight + cfg.elevationOffset;

      // Amplify peaks near continent centers
      if (blobBias > 0.2 && noiseVal > 0.15) {
        e += (blobBias - 0.2) * noiseVal * cfg.peakAmplifyStrength;
      }

      // Border fade-out
      const baseDistance = Math.min(x, width - 1 - x, y, height - 1 - y);
      const noiseOffset = (noise2D(x * 0.3, y * 0.3) + 1) * 0.5 * border * 0.02;
      let d = baseDistance + noiseOffset;
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) d = 0;
      const borderFactor = smoothStep(0, border, d);
      e *= borderFactor;

      // Push sub-sea-level cells lower
      if (e < cfg.seaLevel) e *= cfg.subSeaPush;

      elev[idx] = Math.max(0, Math.min(1, e));
    }
  }

  // Guarantee mountain peaks
  let maxElev = 0;
  let maxIdx = 0;
  for (let i = 0; i < total; i++) {
    if (elev[i] > maxElev) { maxElev = elev[i]; maxIdx = i; }
  }
  if (maxElev < cfg.mountainLevel + 0.03) {
    const cx = maxIdx % width;
    const cy = (maxIdx - cx) / width;
    const peakRadius = Math.max(4, Math.round(Math.min(width, height) * 0.015));
    const r2 = peakRadius * peakRadius;
    const boost = (cfg.mountainLevel + 0.07) - maxElev;
    for (let dy = -peakRadius; dy <= peakRadius; dy++) {
      for (let dx = -peakRadius; dx <= peakRadius; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const falloff = 1 - d2 / r2;
        const ni = ny * width + nx;
        elev[ni] = Math.min(1, elev[ni] + boost * falloff * falloff);
      }
    }
  }

  return elev;
}

// ─── Phase 3: Connectivity Bridge ────────────────────────────────────────────

function ensureConnectivity(elev, width, height, seaLevel, noise2D) {
  const total = width * height;
  const componentId = new Int32Array(total).fill(-1);
  const queue = new Int32Array(total);
  const componentSizes = [];
  const neighbors = [1, -1, width, -width];

  let componentCount = 0;
  for (let i = 0; i < total; i++) {
    if (componentId[i] !== -1 || elev[i] < seaLevel) continue;

    let head = 0, tail = 0;
    queue[tail++] = i;
    componentId[i] = componentCount;
    let size = 0;

    while (head < tail) {
      const cur = queue[head++];
      size++;
      const cx = cur % width;
      const cy = (cur - cx) / width;

      for (const offset of neighbors) {
        const ni = cur + offset;
        if (ni < 0 || ni >= total) continue;
        const nx = ni % width;
        if (Math.abs(nx - cx) > 1) continue;
        if (componentId[ni] !== -1 || elev[ni] < seaLevel) continue;
        componentId[ni] = componentCount;
        queue[tail++] = ni;
      }
    }
    componentSizes.push(size);
    componentCount++;
  }

  if (componentCount <= 1) return;

  let mainComp = 0;
  for (let i = 1; i < componentSizes.length; i++) {
    if (componentSizes[i] > componentSizes[mainComp]) mainComp = i;
  }

  const dist = new Int32Array(total).fill(-1);
  const nearestMain = new Int32Array(total).fill(-1);
  let head = 0, tail = 0;
  for (let i = 0; i < total; i++) {
    if (componentId[i] === mainComp) {
      dist[i] = 0;
      nearestMain[i] = i;
      queue[tail++] = i;
    }
  }

  while (head < tail) {
    const cur = queue[head++];
    const cx = cur % width;
    for (const offset of neighbors) {
      const ni = cur + offset;
      if (ni < 0 || ni >= total) continue;
      const nx = ni % width;
      if (Math.abs(nx - cx) > 1) continue;
      if (dist[ni] !== -1) continue;
      dist[ni] = dist[cur] + 1;
      nearestMain[ni] = nearestMain[cur];
      queue[tail++] = ni;
    }
  }

  const bestDist = new Int32Array(componentCount).fill(0x7fffffff);
  const bestIdx = new Int32Array(componentCount).fill(-1);
  const bestTarget = new Int32Array(componentCount).fill(-1);

  for (let i = 0; i < total; i++) {
    const comp = componentId[i];
    if (comp < 0 || comp === mainComp) continue;
    if (dist[i] < 0) continue;
    if (dist[i] < bestDist[comp]) {
      bestDist[comp] = dist[i];
      bestIdx[comp] = i;
      bestTarget[comp] = nearestMain[i];
    }
  }

  for (let comp = 0; comp < componentCount; comp++) {
    if (comp === mainComp || bestIdx[comp] === -1) continue;
    const from = bestIdx[comp];
    const to = bestTarget[comp];
    const fx = from % width, fy = (from - fx) / width;
    const tx = to % width, ty = (to - tx) / width;
    const distCells = Math.max(1, bestDist[comp]);
    const blobCount = Math.min(4, Math.max(2, Math.round(distCells / 18)));

    for (let b = 1; b <= blobCount; b++) {
      const t = b / (blobCount + 1);
      const jitterX = noise2D ? noise2D((fx + tx) * 0.07 * t, (fy + ty) * 0.11 * t) * 3 : 0;
      const jitterY = noise2D ? noise2D((fx + tx) * 0.11 * t, (fy + ty) * 0.07 * t) * 3 : 0;
      const cx = Math.round(fx + (tx - fx) * t + jitterX);
      const cy = Math.round(fy + (ty - fy) * t + jitterY);
      const radius = Math.min(8, Math.max(3, Math.round(distCells / 12)));
      const strength = 0.08 + radius / 20;
      const r2 = radius * radius;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;
          const falloff = 1 - d2 / r2;
          const lift = seaLevel + strength * falloff;
          const ni = ny * width + nx;
          elev[ni] = Math.max(elev[ni], Math.min(0.9, lift));
        }
      }
    }
  }
}

// ─── Phase 4: Rivers via Flow Accumulation ───────────────────────────────────

function generateRivers(elev, width, height, noise2D, cfg) {
  const total = width * height;
  const flow = new Float32Array(total);
  const riverMask = new Uint8Array(total);

  for (let i = 0; i < total; i++) {
    if (elev[i] >= cfg.seaLevel) {
      const x = i % width;
      const y = (i - x) / width;
      flow[i] = 1.0 + noise2D(x * 0.06, y * 0.06) * 0.4 +
        Math.max(0, elev[i] - 0.4) * 0.6;
    }
  }

  const order = new Uint32Array(total);
  for (let i = 0; i < total; i++) order[i] = i;
  order.sort((a, b) => elev[b] - elev[a]);

  const dx4 = [1, -1, 0, 0];
  const dy4 = [0, 0, 1, -1];

  for (let k = 0; k < total; k++) {
    const idx = order[k];
    if (elev[idx] < cfg.seaLevel) continue;
    const x = idx % width;
    const y = (idx - x) / width;

    let bestSlope = 0;
    let bestNeighbor = -1;

    for (let d = 0; d < 4; d++) {
      const nx = x + dx4[d];
      const ny = y + dy4[d];
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const ni = ny * width + nx;
      const slope = elev[idx] - elev[ni];
      if (slope > bestSlope) {
        bestSlope = slope;
        bestNeighbor = ni;
      }
    }

    if (bestNeighbor >= 0) {
      flow[bestNeighbor] += flow[idx];
    }
  }

  const flowThreshold = Math.max(25, Math.round(Math.sqrt(total) * cfg.riverFlowMultiplier));

  for (let i = 0; i < total; i++) {
    if (elev[i] < cfg.seaLevel) continue;
    if (flow[i] >= flowThreshold) {
      riverMask[i] = 1;

      if (flow[i] >= flowThreshold * cfg.riverWidenMultiplier) {
        const x = i % width;
        const y = (i - x) / width;
        for (let d = 0; d < 4; d++) {
          const nx = x + dx4[d];
          const ny = y + dy4[d];
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const ni = ny * width + nx;
            if (elev[ni] >= cfg.seaLevel) riverMask[ni] = 1;
          }
        }
      }
    }
  }

  return riverMask;
}

// ─── Phase 5: Moisture ──────────────────────────────────────────────────────

function generateMoisture(elev, riverMask, width, height, noise2D, cfg) {
  const total = width * height;
  const maxR = cfg.moistureInfluenceRadius;

  const waterDist = new Int16Array(total).fill(-1);
  const queue = new Int32Array(total);
  let head = 0, tail = 0;

  for (let i = 0; i < total; i++) {
    if (elev[i] < cfg.seaLevel || riverMask[i]) {
      waterDist[i] = 0;
      queue[tail++] = i;
    }
  }

  while (head < tail) {
    const cur = queue[head++];
    const cx = cur % width;
    const d = waterDist[cur];
    if (d >= maxR) continue;

    if (cx > 0 && waterDist[cur - 1] === -1) { waterDist[cur - 1] = d + 1; queue[tail++] = cur - 1; }
    if (cx < width - 1 && waterDist[cur + 1] === -1) { waterDist[cur + 1] = d + 1; queue[tail++] = cur + 1; }
    if (cur >= width && waterDist[cur - width] === -1) { waterDist[cur - width] = d + 1; queue[tail++] = cur - width; }
    if (cur + width < total && waterDist[cur + width] === -1) { waterDist[cur + width] = d + 1; queue[tail++] = cur + width; }
  }

  let bufA = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const wd = waterDist[i];
    let m = 0.3;
    if (wd >= 0 && wd < maxR) {
      m += ((maxR - wd) / maxR) * 0.7;
    }
    if (elev[i] < cfg.seaLevel) m = 1.0;
    bufA[i] = m;
  }

  const mountainThreshold = 0.6;
  for (let y = 0; y < height; y++) {
    let shadow = 0;
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (elev[idx] > mountainThreshold) {
        shadow += (elev[idx] - mountainThreshold) * 0.4;
      }
      shadow *= cfg.rainShadowDecay;
      bufA[idx] = Math.max(0, bufA[idx] - shadow);
    }
  }

  for (let i = 0; i < total; i++) {
    const x = i % width;
    const y = (i - x) / width;
    bufA[i] += noise2D(x * 0.1, y * 0.1) * 0.1;
    bufA[i] = Math.max(0, Math.min(1, bufA[i]));
  }

  let bufB = new Float32Array(total);
  const smoothPasses = cfg.moistureSmoothPasses;
  for (let iter = 0; iter < smoothPasses; iter++) {
    const src = (iter & 1) === 0 ? bufA : bufB;
    const dst = (iter & 1) === 0 ? bufB : bufA;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        let sum = 0, count = 0;
        const yMin = y > 0 ? y - 1 : 0;
        const yMax = y < height - 1 ? y + 1 : y;
        const xMin = x > 0 ? x - 1 : 0;
        const xMax = x < width - 1 ? x + 1 : x;
        for (let ny = yMin; ny <= yMax; ny++) {
          for (let nx = xMin; nx <= xMax; nx++) {
            sum += src[ny * width + nx];
            count++;
          }
        }
        dst[idx] = sum / count;
      }
    }
  }

  return (smoothPasses & 1) === 0 ? bufA : bufB;
}

// ─── Phase 6: Temperature ───────────────────────────────────────────────────

export const calculateTemperature = (x, y, elevation, width, height, noise2D) => {
  const latitudeFactor = y / height;
  const baseTemp = 25 * (1 - Math.pow(Math.abs(latitudeFactor - 0.5) * 1.25, 1.5));
  const largeScaleNoise = noise2D(x * 0.02, y * 0.02) * 8;
  const mediumScaleNoise = noise2D(x * 0.05, y * 0.05) * 4;
  const smallScaleNoise = noise2D(x * 0.1, y * 0.1) * 2;
  const elevationEffect = -elevation * 5;
  return baseTemp + largeScaleNoise + mediumScaleNoise + smallScaleNoise + elevationEffect;
};

// ─── Phase 7: Biome Assignment ──────────────────────────────────────────────

export function determineBiome(elevation, moisture, temperature, x, y, noise2D, cfg) {
  const c = cfg || DEFAULTS;
  const thresholdNoise = noise2D(x * 0.05, y * 0.05) * 0.05;
  if (elevation < c.seaLevel + thresholdNoise) return "OCEAN";
  if (elevation < c.coastalLevel + thresholdNoise) return "COASTAL";
  if (elevation > c.mountainLevel + thresholdNoise) return "MOUNTAIN";

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
}

// ─── Phase 8: Resources ─────────────────────────────────────────────────────

export const generateResources = (biome, elevation, moisture, temperature, rng) => {
  const nodeChanceByBiome = {
    GRASSLAND: 0.012, SAVANNA: 0.01, RIVER: 0.014, COASTAL: 0.012,
    FOREST: 0.01, WOODLAND: 0.01, TROPICAL_FOREST: 0.01, RAINFOREST: 0.01,
    TAIGA: 0.009, MOUNTAIN: 0.014, DESERT: 0.005, TUNDRA: 0.006,
  };
  const nodeChance = nodeChanceByBiome[biome] ?? 0;
  if (nodeChance <= 0 || rng() > nodeChance) return [];

  let weights;
  if (biome === "MOUNTAIN") {
    weights = [
      { type: "stone", w: 0.45 }, { type: "iron", w: elevation > 0.65 ? 0.25 : 0.18 },
      { type: "gold", w: elevation > 0.8 ? 0.08 : 0.04 },
      { type: "food", w: 0.12 }, { type: "wood", w: 0.1 },
    ];
  } else if (biome === "DESERT") {
    weights = [
      { type: "stone", w: 0.35 }, { type: "iron", w: elevation > 0.65 ? 0.2 : 0.12 },
      { type: "gold", w: elevation > 0.8 ? 0.06 : 0.03 },
      { type: "food", w: 0.12 }, { type: "wood", w: 0.08 },
    ];
  } else if (biome === "TUNDRA") {
    weights = [
      { type: "iron", w: 0.28 }, { type: "stone", w: 0.22 },
      { type: "food", w: 0.18 }, { type: "wood", w: 0.12 }, { type: "gold", w: 0.05 },
    ];
  } else if (biome === "RIVER" || biome === "COASTAL") {
    weights = [
      { type: "food", w: 0.45 }, { type: "wood", w: 0.22 },
      { type: "stone", w: 0.12 }, { type: "iron", w: 0.08 }, { type: "gold", w: 0.05 },
    ];
  } else if (biome === "FOREST" || biome === "WOODLAND" || biome === "TROPICAL_FOREST" || biome === "RAINFOREST" || biome === "TAIGA") {
    weights = [
      { type: "wood", w: 0.45 }, { type: "food", w: 0.2 },
      { type: "stone", w: 0.12 }, { type: "iron", w: 0.1 }, { type: "gold", w: 0.05 },
    ];
  } else {
    weights = [
      { type: "food", w: 0.5 }, { type: "wood", w: 0.2 },
      { type: "stone", w: 0.12 }, { type: "iron", w: 0.1 }, { type: "gold", w: 0.08 },
    ];
  }

  let total = 0;
  for (const entry of weights) total += entry.w;
  let roll = rng() * total;
  for (const entry of weights) {
    roll -= entry.w;
    if (roll <= 0) return [entry.type];
  }
  return [weights[weights.length - 1]?.type || "food"];
};

// ─── Phase 9: Assembly + Smoothing ──────────────────────────────────────────

function assembleMapData(elev, moisture, riverMask, width, height, noise2D, rng, cfg) {
  const mapData = new Array(height);

  for (let y = 0; y < height; y++) {
    const row = new Array(width);
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const elevation = elev[idx];
      const moist = moisture[idx];
      const temperature = calculateTemperature(x, y, elevation, width, height, noise2D);
      const isRiver = riverMask[idx] === 1;

      let biome = determineBiome(elevation, moist, temperature, x, y, noise2D, cfg);

      const features = [];
      if (elevation > 0.8) {
        features.push("peaks", "cliffs");
      } else if (elevation > 0.6) {
        features.push("hills");
        if (moist > 0.6) features.push("springs");
      } else if (elevation < 0.3) {
        features.push("lowlands");
        if (moist > 0.6) {
          features.push("wetlands");
          if (noise2D(x * 0.2, y * 0.2) > 0.3) features.push("marshes");
        }
      }

      if (moist > 0.7 && elevation > 0.3 && elevation < 0.6) {
        features.push("fertile valleys");
      }

      if (isRiver) {
        features.push("river");
        biome = "RIVER";
      }

      const resources = generateResources(biome, elevation, moist, temperature, rng);

      row[x] = {
        x, y, elevation, moisture: moist, temperature, biome,
        isRiver, erosion: 0, features, resources,
      };
    }
    mapData[y] = row;
  }

  return mapData;
}

function smoothEligibleCells(mapData, radius) {
  const height = mapData.length;
  const width = mapData[0].length;
  const elevSnap = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      elevSnap[y * width + x] = mapData[y][x].elevation;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = mapData[y][x];
      if (cell.biome !== "COASTAL" && cell.elevation >= 0.35 && cell.elevation <= 0.7) {
        let sum = 0, count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const ny = y + dy, nx = x + dx;
            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
              const neighbor = mapData[ny][nx];
              if (neighbor.biome !== "COASTAL" && neighbor.elevation >= 0.4 && neighbor.elevation <= 0.7) {
                sum += elevSnap[ny * width + nx];
                count++;
              }
            }
          }
        }
        if (count > 0) cell.elevation = sum / count;
      }
    }
  }
  return mapData;
}

// ─── Preview-only: compact biome buffer ─────────────────────────────────────

const BIOME_INDEX = {
  OCEAN: 0, COASTAL: 1, MOUNTAIN: 2, DESERT: 3, SAVANNA: 4,
  TROPICAL_FOREST: 5, RAINFOREST: 6, TUNDRA: 7, TAIGA: 8,
  GRASSLAND: 9, WOODLAND: 10, FOREST: 11, RIVER: 12,
};

export function generatePreview(width, height, erosion_passes, num_blobs, seed, mapConfig) {
  const cfg = resolveConfig(mapConfig);
  const t0 = Date.now();

  const rng = mulberry32(seed * 2147483647 + 1);
  const noise2D = createNoise2D(seed);

  const elev = generateElevation(width, height, num_blobs, noise2D, rng, cfg);
  ensureConnectivity(elev, width, height, cfg.seaLevel, noise2D);
  const riverMask = generateRivers(elev, width, height, noise2D, cfg);
  const moisture = generateMoisture(elev, riverMask, width, height, noise2D, cfg);

  // Build compact biome buffer + stats
  const total = width * height;
  const biomes = new Uint8Array(total);
  const biomeCounts = new Array(13).fill(0);
  let riverCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const e = elev[idx];
      const m = moisture[idx];
      const t = calculateTemperature(x, y, e, width, height, noise2D);
      const isRiver = riverMask[idx] === 1;

      let biome = determineBiome(e, m, t, x, y, noise2D, cfg);
      if (isRiver) biome = "RIVER";

      const bi = BIOME_INDEX[biome] ?? 0;
      biomes[idx] = bi;
      biomeCounts[bi]++;
      if (isRiver) riverCount++;
    }
  }

  const landCount = total - biomeCounts[0]; // 0 = OCEAN
  const genTime = Date.now() - t0;

  return {
    width, height,
    biomes: Buffer.from(biomes.buffer).toString("base64"),
    stats: {
      landPercent: +(landCount / total * 100).toFixed(1),
      riverCells: riverCount,
      biomeCounts: Object.fromEntries(
        Object.entries(BIOME_INDEX).map(([name, idx]) => [name, biomeCounts[idx]])
      ),
      genTimeMs: genTime,
    },
  };
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

export function generateWorldMap(
  width,
  height,
  erosion_passes = 3,
  num_blobs = 4,
  seed = 42,
  mapConfig
) {
  const cfg = resolveConfig(mapConfig);
  if (DEBUG_MAP) console.log("Starting world map generation (domain-warped FBM)...");
  const t0 = Date.now();

  const rng = mulberry32(seed * 2147483647 + 1);
  const noise2D = createNoise2D(seed);
  if (DEBUG_MAP) console.log(`[mapgen] PRNG + noise setup: ${Date.now() - t0}ms`);

  const t1 = Date.now();
  const elev = generateElevation(width, height, num_blobs, noise2D, rng, cfg);
  if (DEBUG_MAP) console.log(`[mapgen] Elevation: ${Date.now() - t1}ms`);

  const t2 = Date.now();
  ensureConnectivity(elev, width, height, cfg.seaLevel, noise2D);
  if (DEBUG_MAP) console.log(`[mapgen] Connectivity: ${Date.now() - t2}ms`);

  const t3 = Date.now();
  const riverMask = generateRivers(elev, width, height, noise2D, cfg);
  if (DEBUG_MAP) console.log(`[mapgen] Rivers: ${Date.now() - t3}ms`);

  const t4 = Date.now();
  const moisture = generateMoisture(elev, riverMask, width, height, noise2D, cfg);
  if (DEBUG_MAP) console.log(`[mapgen] Moisture: ${Date.now() - t4}ms`);

  const t5 = Date.now();
  const mapData = assembleMapData(elev, moisture, riverMask, width, height, noise2D, rng, cfg);
  if (DEBUG_MAP) console.log(`[mapgen] Assembly: ${Date.now() - t5}ms`);

  const t6 = Date.now();
  smoothEligibleCells(mapData, Math.min(2, erosion_passes));
  if (DEBUG_MAP) console.log(`[mapgen] Smoothing: ${Date.now() - t6}ms`);

  if (DEBUG_MAP) console.log(`[mapgen] Total: ${Date.now() - t0}ms`);
  return mapData;
}
