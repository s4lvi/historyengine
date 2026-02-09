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
  return fetch(buildApiUrl(path), {
    credentials: "include",
    ...options,
    headers,
  });
};

export const getWsUrl = () => {
  if (API_BASE && API_BASE !== "/") {
    const base = API_BASE.replace(/^http/, "ws");
    return base.endsWith("/") ? `${base}ws` : `${base}/ws`;
  }
  const base = window.location.origin.replace(/^http/, "ws");
  return base.endsWith("/") ? `${base}ws` : `${base}/ws`;
};
