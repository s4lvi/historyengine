// routes/authRoutes.js
import express from "express";
import fetch from "node-fetch";
import { OAuth2Client } from "google-auth-library";
import User from "../models/User.js";
import {
  clearOAuthStateCookie,
  clearSessionCookie,
  deriveColorFromSeed,
  generateRandomToken,
  getOAuthStateTokenFromRequest,
  getSessionUser,
  setOAuthStateCookie,
  setSessionCookie,
  signOAuthState,
  signSessionToken,
  verifyOAuthState,
} from "../utils/auth.js";

const router = express.Router();

let oauthClient = null;
let oauthClientId = null;

function getGoogleConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
  };
}

function getOauthClient(clientId) {
  if (!oauthClient || oauthClientId !== clientId) {
    oauthClientId = clientId;
    oauthClient = new OAuth2Client(clientId);
  }
  return oauthClient;
}

function getBaseUrl(req) {
  const { publicBaseUrl } = getGoogleConfig();
  if (publicBaseUrl) return publicBaseUrl.replace(/\/$/, "");
  return `${req.protocol}://${req.get("host")}`;
}

function resolveRedirectTarget(redirectPath) {
  if (!redirectPath) return null;
  if (/^https?:\/\//i.test(redirectPath)) return redirectPath;
  const frontendBase = process.env.CLIENT_ORIGIN;
  if (frontendBase && redirectPath.startsWith("/")) {
    return `${frontendBase.replace(/\/$/, "")}${redirectPath}`;
  }
  return redirectPath;
}

function normalizeProfile(profile, fallbackName) {
  const displayName = profile.displayName || fallbackName || "Player";
  const nationName = profile.nationName || displayName;
  const capitalName = profile.capitalName || "Capital";
  const color = profile.color || deriveColorFromSeed(displayName);
  return { displayName, nationName, capitalName, color };
}

router.get("/google/start", (req, res) => {
  const { clientId, clientSecret } = getGoogleConfig();
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: "Google OAuth not configured" });
  }
  const redirect = req.query.redirect || "/rooms";
  const state = generateRandomToken(16);
  const nonce = generateRandomToken(16);
  const stateToken = signOAuthState({ state, nonce, redirect });
  setOAuthStateCookie(res, stateToken);

  const redirectUri = `${getBaseUrl(req)}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    prompt: "select_account",
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get("/google/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    const { clientId, clientSecret } = getGoogleConfig();
    if (!code || !state) {
      return res.status(400).json({ error: "Missing OAuth code or state" });
    }
    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: "Google OAuth not configured" });
    }
    const stateToken = getOAuthStateTokenFromRequest(req);
    if (!stateToken) {
      return res.status(400).json({ error: "Missing OAuth state cookie" });
    }
    const stored = verifyOAuthState(stateToken);
    if (!stored || stored.state !== state) {
      return res.status(400).json({ error: "Invalid OAuth state" });
    }

    const redirectUri = `${getBaseUrl(req)}/api/auth/google/callback`;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: String(code),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      return res.status(401).json({ error: "Failed to exchange Google token", details: errorBody });
    }

    const tokenData = await tokenResponse.json();
    const idToken = tokenData.id_token;
    if (!idToken) {
      return res.status(401).json({ error: "Missing id_token from Google" });
    }

    const ticket = await getOauthClient(clientId).verifyIdToken({
      idToken,
      audience: clientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub) {
      return res.status(401).json({ error: "Invalid Google token payload" });
    }

    let user = await User.findOne({ "providers.google.sub": payload.sub });
    if (!user) {
      const baseProfile = normalizeProfile({}, payload.name || payload.email);
      user = new User({
        providers: {
          google: {
            sub: payload.sub,
            email: payload.email,
            name: payload.name,
            picture: payload.picture,
          },
        },
        profile: baseProfile,
      });
    } else {
      user.providers = user.providers || {};
      user.providers.google = {
        sub: payload.sub,
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
      };
      user.profile = normalizeProfile(user.profile || {}, payload.name || payload.email);
    }
    await user.save();

    const sessionToken = signSessionToken(user._id.toString());
    setSessionCookie(res, sessionToken);
    clearOAuthStateCookie(res);

    const redirectPath = stored.redirect || "/rooms";
    const target = resolveRedirectTarget(redirectPath) || "/rooms";
    res.redirect(target);
  } catch (err) {
    res.status(500).json({ error: "OAuth callback failed", details: err.message });
  }
});

router.get("/me", async (req, res) => {
  const session = await getSessionUser(req);
  if (!session) {
    return res.status(200).json({ user: null, profile: null });
  }
  res.json({ user: { id: session.id }, profile: session.profile || {} });
});

router.post("/profile", async (req, res) => {
  const session = await getSessionUser(req);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const { displayName, nationName, capitalName, color } = req.body || {};
  const updates = {
    displayName,
    nationName,
    capitalName,
    color,
  };
  const user = await User.findById(session.id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  user.profile = {
    ...(user.profile || {}),
    ...Object.fromEntries(Object.entries(updates).filter(([, v]) => v != null)),
  };
  user.profile = normalizeProfile(user.profile, user.profile.displayName);
  await user.save();
  res.json({ profile: user.profile });
});

// -------------------------------------------------------------------
// POST /api/auth/discord/token — Exchange Discord OAuth code for JWT
// Used by the Discord Activity (embedded iframe) auth flow
// -------------------------------------------------------------------
router.post("/discord/token", async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) {
      return res.status(400).json({ error: "Missing authorization code" });
    }

    const discordClientId = process.env.DISCORD_CLIENT_ID;
    const discordClientSecret = process.env.DISCORD_CLIENT_SECRET;
    if (!discordClientId || !discordClientSecret) {
      return res.status(500).json({ error: "Discord OAuth not configured" });
    }

    // Exchange the authorization code for an access token
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: discordClientId,
        client_secret: discordClientSecret,
        grant_type: "authorization_code",
        code,
      }),
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      return res.status(401).json({ error: "Failed to exchange Discord token", details: errorBody });
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return res.status(401).json({ error: "Missing access_token from Discord" });
    }

    // Fetch Discord user profile
    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userResponse.ok) {
      return res.status(401).json({ error: "Failed to fetch Discord user profile" });
    }
    const discordUser = await userResponse.json();
    if (!discordUser.id) {
      return res.status(401).json({ error: "Invalid Discord user profile" });
    }

    // Find or create User document via providers.discord.sub
    let user = await User.findOne({ "providers.discord.sub": discordUser.id });
    const discordName = discordUser.global_name || discordUser.username || "Player";
    const discordAvatar = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
      : null;

    if (!user) {
      const baseProfile = normalizeProfile({}, discordName);
      user = new User({
        providers: {
          discord: {
            sub: discordUser.id,
            email: discordUser.email || null,
            name: discordName,
            picture: discordAvatar,
          },
        },
        profile: baseProfile,
      });
    } else {
      user.providers = user.providers || {};
      user.providers.discord = {
        sub: discordUser.id,
        email: discordUser.email || null,
        name: discordName,
        picture: discordAvatar,
      };
      user.profile = normalizeProfile(user.profile || {}, discordName);
    }
    await user.save();

    const sessionToken = signSessionToken(user._id.toString());
    res.json({
      token: sessionToken,
      user: { id: user._id.toString() },
      profile: user.profile || {},
      access_token: accessToken,
    });
  } catch (err) {
    console.error("[DISCORD] Token exchange error:", err);
    res.status(500).json({ error: "Discord token exchange failed", details: err.message });
  }
});

router.post("/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

export default router;
