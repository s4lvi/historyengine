import { DiscordSDK } from "@discord/embedded-app-sdk";
import { apiFetch } from "./api";

const DISCORD_CLIENT_ID = process.env.REACT_APP_DISCORD_CLIENT_ID;

let discordSdk = null;
let discordToken = null;
let discordAuth = null;
let discordError = null;

/**
 * Detect whether the app is running inside a Discord Activity iframe.
 * Discord injects query params like frame_id and instance_id.
 */
export function isDiscordActivity() {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has("frame_id")) return true;
    if (window.location.hostname.endsWith(".discordsays.com")) return true;
  } catch {}
  return false;
}

/**
 * Initialize the Discord SDK, authorize, exchange token, and authenticate.
 * Returns { user, profile, token } on success.
 */
export async function initDiscord() {
  if (!DISCORD_CLIENT_ID) {
    throw new Error("REACT_APP_DISCORD_CLIENT_ID is not set");
  }

  console.log("[DISCORD] Starting init, clientId:", DISCORD_CLIENT_ID);

  // Create and ready the SDK
  discordSdk = new DiscordSDK(DISCORD_CLIENT_ID);
  console.log("[DISCORD] SDK created, calling ready()...");
  await discordSdk.ready();
  console.log("[DISCORD] SDK ready, calling authorize()...");

  // Request authorization from the user
  const { code } = await discordSdk.commands.authorize({
    client_id: DISCORD_CLIENT_ID,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify"],
  });
  console.log("[DISCORD] Authorized, got code, exchanging token...");

  // Exchange the code with our server for a JWT
  const response = await apiFetch("api/auth/discord/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Discord token exchange failed");
  }

  const data = await response.json();
  discordToken = data.token;
  discordAuth = data;
  console.log("[DISCORD] Token exchanged, calling authenticate()...");

  // Authenticate with Discord SDK using the access token
  await discordSdk.commands.authenticate({ access_token: data.access_token });
  console.log("[DISCORD] Fully authenticated!");

  return {
    user: data.user,
    profile: data.profile,
    token: data.token,
  };
}

/** Returns the stored JWT for Bearer auth. */
export function getDiscordToken() {
  return discordToken;
}

/** Returns the Discord SDK instance (after initDiscord()). */
export function getDiscordSdk() {
  return discordSdk;
}

/** Returns the full auth result from initDiscord(). */
export function getDiscordAuth() {
  return discordAuth;
}

/** Returns the last error from initDiscord(). */
export function getDiscordError() {
  return discordError;
}

/** Set error (called from AuthContext). */
export function setDiscordError(err) {
  discordError = err;
}
