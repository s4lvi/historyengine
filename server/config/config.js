// config/config.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Convert import.meta.url to __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Adjust the relative path as needed (if your JSON file is in the same directory)
const configPath = path.join(__dirname, "./gameConfig.json");

let config = {};

try {
  const fileContents = fs.readFileSync(configPath, "utf8");
  config = JSON.parse(fileContents);
  console.log("Game configuration loaded successfully.", config);
} catch (e) {
  console.error("Failed to load game configuration:", e);
}

export default config;
