import config from "../config/config.js";
import { getTerrainSimilarity } from "./terrainSimilarity.js";

export function getNodeMultiplier(level) {
  const mults = config?.territorial?.resourceNodeLevelMultipliers || {};
  const key = String(level ?? 0);
  return Number(mults[key]) || 1;
}

export function computeBonusesByOwner(
  nations,
  mapData,
  resourceUpgrades = null,
  resourceNodeClaims = null
) {
  const bonusesByOwner = {};
  const effects = config?.territorial?.resourceEffects || {};
  const upgrades = resourceUpgrades || {};
  const claims = resourceNodeClaims || {};
  if (!Array.isArray(nations)) return bonusesByOwner;

  const totalsByOwner = {};
  Object.entries(claims).forEach(([key, claim]) => {
    if (!claim?.owner || !claim?.type) return;
    const [xStr, yStr] = key.split(",");
    const x = Number(xStr);
    const y = Number(yStr);
    const cell = mapData?.[y]?.[x];
    if (!cell?.resourceNode?.type) return;

    const upgradeLevel = upgrades?.[key]?.level;
    const level =
      upgradeLevel !== undefined
        ? upgradeLevel
        : cell.resourceNode.level ?? 0;
    const mult = getNodeMultiplier(level);
    const effect = effects[cell.resourceNode.type] || {};

    if (!totalsByOwner[claim.owner]) {
      totalsByOwner[claim.owner] = {
        expansionPower: 0,
        attackPower: 0,
        defensePower: 0,
        production: 0,
        goldIncome: 0,
      };
    }
    const totals = totalsByOwner[claim.owner];
    totals.expansionPower += (effect.expansionPower || 0) * mult;
    totals.attackPower += (effect.attackPower || 0) * mult;
    totals.defensePower += (effect.defensePower || 0) * mult;
    totals.production += (effect.production || 0) * mult;
    totals.goldIncome += (effect.goldIncome || 0) * mult;
  });

  nations.forEach((nation) => {
    const totals = totalsByOwner[nation.owner] || {
      expansionPower: 0,
      attackPower: 0,
      defensePower: 0,
      production: 0,
      goldIncome: 0,
    };
    bonusesByOwner[nation.owner] = {
      expansionPower: 1 + totals.expansionPower,
      attackPower: 1 + totals.attackPower,
      defensePower: 1 + totals.defensePower,
      production: 1 + totals.production,
      goldIncome: totals.goldIncome,
    };
  });

  return bonusesByOwner;
}

export function getTerrainCostModifiers(sourceBiome, targetBiome) {
  const rawSimilarity = getTerrainSimilarity(sourceBiome, targetBiome);
  const minSimilarity = config?.territorial?.minTerrainSimilarity ?? 0.2;
  const similarity = Math.max(rawSimilarity, minSimilarity);
  const speedMult = 0.5 + 0.5 * similarity;
  const lossMult = 1.0 + 0.6 * (1 - similarity);
  return { similarity, speedMult, lossMult };
}
