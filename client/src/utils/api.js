import { isDiscordActivity, getDiscordToken } from "./discord";

const API_BASE = process.env.REACT_APP_API_URL || "/";

export const buildApiUrl = (path = "") => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (API_BASE.endsWith("/") && normalizedPath.startsWith("/")) {
    return `${API_BASE}${normalizedPath.slice(1)}`;
  }
  if (!API_BASE.endsWith("/") && !normalizedPath.startsWith("/")) {
    return `${API_BASE}/${normalizedPath}`;
  }
  return `${API_BASE}${normalizedPath}`;
};

export const apiFetch = (path, options = {}) => {
  const headers = options.headers ? { ...options.headers } : {};
  let credentials = "include";

  // In Discord Activity mode, use Bearer token instead of cookies
  if (isDiscordActivity()) {
    const token = getDiscordToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    credentials = "omit";
  }

  return fetch(buildApiUrl(path), {
    credentials,
    ...options,
    headers,
  });
};

export const getWsUrl = (token) => {
  let base;
  if (API_BASE && API_BASE !== "/") {
    base = API_BASE.replace(/^http/, "ws");
    base = base.endsWith("/") ? `${base}ws` : `${base}/ws`;
  } else {
    base = window.location.origin.replace(/^http/, "ws");
    base = base.endsWith("/") ? `${base}ws` : `${base}/ws`;
  }

  // Append token as query param for Discord Activity WebSocket connections
  if (token) {
    const separator = base.includes("?") ? "&" : "?";
    return `${base}${separator}token=${encodeURIComponent(token)}`;
  }
  return base;
};
