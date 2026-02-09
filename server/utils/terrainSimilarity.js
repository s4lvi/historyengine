import config from "../config/config.js";

const defaultConfig = {
  defaults: { same: 1, group: 0.8, near: 0.6, far: 0.3 },
  groups: {},
  nearGroups: {},
};

function getConfig() {
  return config?.territorial?.terrainSimilarity || defaultConfig;
}

function findGroup(terrain) {
  const { groups } = getConfig();
  for (const [groupName, terrains] of Object.entries(groups || {})) {
    if (terrains.includes(terrain)) return groupName;
  }
  return null;
}

function areGroupsNear(groupA, groupB) {
  if (!groupA || !groupB) return false;
  const { nearGroups } = getConfig();
  const neighbors = nearGroups?.[groupA] || [];
  return neighbors.includes(groupB);
}

export function getTerrainSimilarity(a, b) {
  const { defaults } = getConfig();
  if (!a || !b) return defaults.far;
  if (a === b) return defaults.same;
  const groupA = findGroup(a);
  const groupB = findGroup(b);
  if (groupA && groupB && groupA === groupB) return defaults.group;
  if (areGroupsNear(groupA, groupB) || areGroupsNear(groupB, groupA))
    return defaults.near;
  return defaults.far;
}
