// debug.js — Centralized debug logging gated by DEBUG env var
// Usage: import { debug, debugWarn } from "../utils/debug.js";
//        debug("message", data);

const DEBUG = process.env.DEBUG === "true";

export function debug(...args) {
  if (DEBUG) console.log(...args);
}

export function debugWarn(...args) {
  if (DEBUG) console.warn(...args);
}

export { DEBUG };
