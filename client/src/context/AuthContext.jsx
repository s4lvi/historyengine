import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch, buildApiUrl } from "../utils/api";
import { isDiscordActivity, initDiscord } from "../utils/discord";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isDiscord, setIsDiscord] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const response = await apiFetch("api/auth/me");
      if (!response.ok) {
        setUser(null);
        setProfile(null);
        return;
      }
      const data = await response.json();
      setUser(data.user || null);
      setProfile(data.profile || null);
    } catch {
      setUser(null);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isDiscordActivity()) {
      // Discord Activity mode: initialize SDK and exchange token
      setIsDiscord(true);
      (async () => {
        try {
          setLoading(true);
          const result = await initDiscord();
          setUser(result.user || null);
          setProfile(result.profile || null);
        } catch (err) {
          console.error("[DISCORD] Auth initialization failed:", err);
          setUser(null);
          setProfile(null);
        } finally {
          setLoading(false);
        }
      })();
    } else {
      // Standard web app mode: refresh from cookie-based session
      refresh();
    }
  }, [refresh]);

  const loginWithGoogle = useCallback((redirectPath) => {
    if (isDiscord) return; // No Google login in Discord mode
    const redirect = redirectPath || window.location.pathname;
    const url = buildApiUrl(`api/auth/google/start?redirect=${encodeURIComponent(redirect)}`);
    window.location.assign(url);
  }, [isDiscord]);

  const logout = useCallback(async () => {
    if (isDiscord) return; // No logout in Discord mode
    try {
      await apiFetch("api/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
      setProfile(null);
    }
  }, [isDiscord]);

  const updateProfile = useCallback(async (updates) => {
    const response = await apiFetch("api/auth/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "Failed to update profile");
    }
    const data = await response.json();
    setProfile(data.profile || null);
    return data.profile;
  }, []);

  const value = useMemo(
    () => ({
      user,
      profile,
      loading,
      isDiscord,
      refresh,
      loginWithGoogle,
      logout,
      updateProfile,
    }),
    [user, profile, loading, isDiscord, refresh, loginWithGoogle, logout, updateProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
};
