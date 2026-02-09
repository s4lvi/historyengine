// nameGenerator.js - Fantasy name generator for cities and towers

const CITY_PREFIXES = [
  "North", "South", "East", "West", "Fort", "Castle", "Glen", "New", "Old",
  "High", "Low", "Grand", "Royal", "Iron", "Golden", "Silver", "White",
  "Black", "Red", "Green", "Blue", "Grey", "Stone", "Oak", "Pine"
];

const CITY_ROOTS = [
  "wood", "stone", "river", "hill", "vale", "mount", "lake", "field",
  "marsh", "cliff", "brook", "dale", "glen", "haven", "ford", "shire",
  "meadow", "hollow", "ridge", "crest", "peak", "bay", "port", "gate"
];

const CITY_SUFFIXES = [
  "haven", "hold", "wick", "ton", "ford", "bridge", "gate", "watch",
  "guard", "keep", "stead", "worth", "dale", "bury", "ville", "ham",
  "minster", "borough", "fell", "moor", "thorpe", "combe", "ley", "mere"
];

const TOWER_PREFIXES = [
  "Watch", "Guard", "Sentinel", "Eagle", "Hawk", "Falcon", "Wolf", "Bear",
  "Lion", "Dragon", "Storm", "Thunder", "Fire", "Ice", "Shadow", "Dawn",
  "Dusk", "Moon", "Sun", "Star", "Iron", "Stone", "Oak", "Ancient"
];

const TOWER_SUFFIXES = [
  "Tower", "Spire", "Watch", "Guard", "Keep", "Bastion", "Citadel",
  "Outpost", "Fortress", "Stronghold", "Watchtower", "Lookout", "Point",
  "Peak", "Height", "Crown", "Pinnacle", "Beacon"
];

function sample(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function titleCase(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Generates a random fantasy city name
 * @returns {string} A generated city name
 */
export function generateCityName() {
  const style = Math.random();

  if (style < 0.35) {
    // Style 1: Prefix + Root (e.g., "Northwood", "Highvale")
    return sample(CITY_PREFIXES) + sample(CITY_ROOTS);
  } else if (style < 0.65) {
    // Style 2: Root + Suffix (e.g., "Riverhaven", "Stonehold")
    return titleCase(sample(CITY_ROOTS)) + sample(CITY_SUFFIXES);
  } else if (style < 0.85) {
    // Style 3: Prefix + Suffix (e.g., "Westgate", "Ironkeep")
    return sample(CITY_PREFIXES) + sample(CITY_SUFFIXES);
  } else {
    // Style 4: Three-part name (e.g., "New Riverhaven")
    return sample(CITY_PREFIXES) + " " + titleCase(sample(CITY_ROOTS)) + sample(CITY_SUFFIXES);
  }
}

/**
 * Generates a random fantasy tower name
 * @returns {string} A generated tower name
 */
export function generateTowerName() {
  const style = Math.random();

  if (style < 0.5) {
    // Style 1: Prefix + Suffix (e.g., "Eagle Tower", "Storm Spire")
    return sample(TOWER_PREFIXES) + " " + sample(TOWER_SUFFIXES);
  } else if (style < 0.8) {
    // Style 2: "The" + Prefix + Suffix (e.g., "The Iron Watch")
    return "The " + sample(TOWER_PREFIXES) + " " + sample(TOWER_SUFFIXES);
  } else {
    // Style 3: Prefix + "'s" + Suffix (e.g., "Dragon's Keep")
    return sample(TOWER_PREFIXES) + "'s " + sample(TOWER_SUFFIXES);
  }
}

/**
 * Generates a unique name not in the existing set
 * @param {Function} generator - The name generator function to use
 * @param {Set} existingNames - Set of existing names to avoid duplicates
 * @param {number} maxAttempts - Maximum attempts before adding a number suffix
 * @returns {string} A unique generated name
 */
export function generateUniqueName(generator, existingNames = new Set(), maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    const name = generator();
    if (!existingNames.has(name)) {
      return name;
    }
  }
  // Fallback: add a number suffix
  const baseName = generator();
  let counter = 2;
  while (existingNames.has(`${baseName} ${counter}`)) {
    counter++;
  }
  return `${baseName} ${counter}`;
}

export default {
  generateCityName,
  generateTowerName,
  generateUniqueName
};
