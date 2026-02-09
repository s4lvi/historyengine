// utils/auth.js
import jwt from "jsonwebtoken";
import crypto from "crypto";
import User from "../models/User.js";

const SESSION_COOKIE = "annexi_session";
const OAUTH_STATE_COOKIE = "annexi_oauth_state";
const JWT_SECRET = process.env.AUTH_JWT_SECRET || "dev_secret_change_me";
const SESSION_TTL = "7d";

function parseCookies(header = "") {
  const out = {};
  if (!header) return out;
  header.split(";").forEach((part) => {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey) return;
    const value = rest.join("=");
    out[decodeURIComponent(rawKey)] = decodeURIComponent(value || "");
  });
  return out;
}

function cookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  const secureOverride = process.env.AUTH_COOKIE_SECURE;
  const secure =
    secureOverride === "true"
      ? true
      : secureOverride === "false"
        ? false
        : isProd;
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
  };
}

export function getSessionTokenFromRequest(req) {
  const cookies = parseCookies(req.headers?.cookie || "");
  return cookies[SESSION_COOKIE] || null;
}

export function getOAuthStateTokenFromRequest(req) {
  const cookies = parseCookies(req.headers?.cookie || "");
  return cookies[OAUTH_STATE_COOKIE] || null;
}

export function signSessionToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: SESSION_TTL });
}

export function verifySessionToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function setSessionCookie(res, token) {
  const opts = { ...cookieOptions(), maxAge: 1000 * 60 * 60 * 24 * 7 };
  res.cookie(SESSION_COOKIE, token, opts);
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

export function setOAuthStateCookie(res, token) {
  const opts = { ...cookieOptions(), maxAge: 1000 * 60 * 10 };
  res.cookie(OAUTH_STATE_COOKIE, token, opts);
}

export function clearOAuthStateCookie(res) {
  res.clearCookie(OAUTH_STATE_COOKIE, cookieOptions());
}

export function signOAuthState(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "10m" });
}

export function verifyOAuthState(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function generateRandomToken(size = 16) {
  return crypto.randomBytes(size).toString("hex");
}

export function deriveColorFromSeed(seed) {
  const hash = Array.from(seed || "").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const hue = hash % 360;
  return hslToHex(hue, 70, 55);
}

function hslToHex(h, s, l) {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hh = h / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;

  if (hh >= 0 && hh < 1) {
    r = c;
    g = x;
  } else if (hh >= 1 && hh < 2) {
    r = x;
    g = c;
  } else if (hh >= 2 && hh < 3) {
    g = c;
    b = x;
  } else if (hh >= 3 && hh < 4) {
    g = x;
    b = c;
  } else if (hh >= 4 && hh < 5) {
    r = x;
    b = c;
  } else if (hh >= 5 && hh < 6) {
    r = c;
    b = x;
  }

  const m = light - c / 2;
  const toHex = (val) => {
    const v = Math.round((val + m) * 255);
    return v.toString(16).padStart(2, "0");
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export async function getSessionUser(req) {
  const token = getSessionTokenFromRequest(req);
  if (!token) return null;
  const payload = verifySessionToken(token);
  if (!payload?.sub) return null;
  const user = await User.findById(payload.sub).lean();
  if (!user) return null;
  return {
    id: user._id.toString(),
    profile: user.profile || {},
    providers: user.providers || {},
  };
}

export function getSessionUserIdFromRequest(req) {
  const token = getSessionTokenFromRequest(req);
  if (!token) return null;
  const payload = verifySessionToken(token);
  if (!payload?.sub) return null;
  return payload.sub;
}
