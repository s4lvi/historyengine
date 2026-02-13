#!/usr/bin/env node
// Test script for map generation — generates a map and outputs an ASCII/ANSI preview
// Usage: node scripts/testMap.js [width] [height] [seed] [num_blobs]
// Example: node scripts/testMap.js 200 200 42 4

import { generateWorldMap } from "../server/utils/mapUtils.js";

const width = Number(process.argv[2]) || 200;
const height = Number(process.argv[3]) || 200;
const seed = Number(process.argv[4]) || Math.floor(Math.random() * 100000);
const numBlobs = Number(process.argv[5]) || 4;

console.log(`Generating ${width}x${height} map with seed=${seed}, blobs=${numBlobs}...`);
console.time("generation");
const mapData = generateWorldMap(width, height, 3, numBlobs, seed);
console.timeEnd("generation");

// ─── Stats ───────────────────────────────────────────────────────────────────

const biomes = {};
const featureSet = new Set();
const resourceSet = new Set();
let riverCount = 0;
let minElev = 1, maxElev = 0;
let hasNaN = false;

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const c = mapData[y][x];
    biomes[c.biome] = (biomes[c.biome] || 0) + 1;
    c.features.forEach((f) => featureSet.add(f));
    c.resources.forEach((r) => resourceSet.add(r));
    if (c.isRiver) riverCount++;
    if (c.elevation < minElev) minElev = c.elevation;
    if (c.elevation > maxElev) maxElev = c.elevation;
    if (
      !Number.isFinite(c.elevation) ||
      !Number.isFinite(c.moisture) ||
      !Number.isFinite(c.temperature)
    )
      hasNaN = true;
  }
}

const total = width * height;
const landCount = total - (biomes.OCEAN || 0);

console.log("\n─── Map Stats ───");
console.log(`  Dimensions: ${width}x${height} (${total} cells)`);
console.log(`  Seed: ${seed}`);
console.log(`  Land: ${landCount} (${((landCount / total) * 100).toFixed(1)}%)`);
console.log(`  Rivers: ${riverCount} cells`);
console.log(`  Elevation: ${minElev.toFixed(3)} – ${maxElev.toFixed(3)}`);
console.log(`  NaN/Infinity: ${hasNaN ? "YES (BUG!)" : "none"}`);

console.log("\n─── Biomes ───");
const biomeOrder = [
  "OCEAN", "COASTAL", "RIVER", "MOUNTAIN", "DESERT", "SAVANNA",
  "TROPICAL_FOREST", "RAINFOREST", "TUNDRA", "TAIGA", "GRASSLAND",
  "WOODLAND", "FOREST",
];
for (const b of biomeOrder) {
  const count = biomes[b] || 0;
  const pct = ((count / total) * 100).toFixed(1);
  const bar = "█".repeat(Math.round(count / total * 60));
  console.log(`  ${b.padEnd(18)} ${String(count).padStart(7)} (${pct.padStart(5)}%) ${bar}`);
}
const missing = biomeOrder.filter((b) => !biomes[b]);
if (missing.length) console.log(`  MISSING: ${missing.join(", ")}`);

console.log(`\n─── Features (${featureSet.size}/9) ───`);
console.log(`  ${[...featureSet].sort().join(", ")}`);

console.log(`\n─── Resources (${resourceSet.size}) ───`);
console.log(`  ${[...resourceSet].sort().join(", ")}`);

// ─── Determinism Check ──────────────────────────────────────────────────────

const map2 = generateWorldMap(width, height, 3, numBlobs, seed);
let identical = true;
for (let y = 0; y < height && identical; y++) {
  for (let x = 0; x < width && identical; x++) {
    if (
      mapData[y][x].elevation !== map2[y][x].elevation ||
      mapData[y][x].biome !== map2[y][x].biome
    )
      identical = false;
  }
}
console.log(`\n─── Determinism: ${identical ? "PASS" : "FAIL"} ───`);

// ─── Field Check ────────────────────────────────────────────────────────────

const required = [
  "x", "y", "elevation", "moisture", "temperature",
  "biome", "isRiver", "erosion", "features", "resources",
];
const sample = mapData[Math.floor(height / 2)][Math.floor(width / 2)];
const missingFields = required.filter((f) => !(f in sample));
console.log(
  `─── Fields: ${missingFields.length ? "MISSING " + missingFields.join(", ") : "ALL PRESENT"} ───`
);

// ─── ANSI Map Preview ───────────────────────────────────────────────────────

const BIOME_COLORS = {
  OCEAN: "\x1b[44m\x1b[34m",        // blue bg
  COASTAL: "\x1b[46m\x1b[36m",      // cyan bg
  RIVER: "\x1b[44m\x1b[96m",        // bright cyan on blue
  MOUNTAIN: "\x1b[47m\x1b[37m",     // white bg
  DESERT: "\x1b[43m\x1b[33m",       // yellow bg
  SAVANNA: "\x1b[43m\x1b[93m",      // bright yellow
  TROPICAL_FOREST: "\x1b[42m\x1b[92m", // bright green on green
  RAINFOREST: "\x1b[42m\x1b[32m",   // dark green on green
  TUNDRA: "\x1b[47m\x1b[90m",       // gray on white
  TAIGA: "\x1b[42m\x1b[36m",        // cyan on green
  GRASSLAND: "\x1b[102m\x1b[92m",   // bright green bg
  WOODLAND: "\x1b[42m\x1b[33m",     // yellow on green
  FOREST: "\x1b[42m\x1b[32m",       // green
};
const RESET = "\x1b[0m";

const BIOME_CHAR = {
  OCEAN: "~", COASTAL: ".", RIVER: "≈", MOUNTAIN: "^",
  DESERT: ":", SAVANNA: ",", TROPICAL_FOREST: "♣", RAINFOREST: "♠",
  TUNDRA: "*", TAIGA: "↑", GRASSLAND: "'", WOODLAND: "†", FOREST: "♦",
};

// Downsample to fit terminal (~120 cols x 40 rows)
const maxCols = Math.min(120, process.stdout.columns || 120);
const maxRows = 40;
const stepX = Math.max(1, Math.ceil(width / maxCols));
const stepY = Math.max(1, Math.ceil(height / maxRows));

console.log(`\n─── Map Preview (${Math.ceil(width/stepX)}x${Math.ceil(height/stepY)}, 1:${stepX}) ───`);
for (let y = 0; y < height; y += stepY) {
  let line = "";
  for (let x = 0; x < width; x += stepX) {
    const c = mapData[y][x];
    const color = BIOME_COLORS[c.biome] || "";
    const ch = BIOME_CHAR[c.biome] || "?";
    line += color + ch + RESET;
  }
  console.log(line);
}

console.log("\nLegend: ~ ocean  . coast  ≈ river  ^ mountain  : desert  , savanna");
console.log("        ♣ tropical  ♠ rain  * tundra  ↑ taiga  ' grass  † wood  ♦ forest");
