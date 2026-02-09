import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch, buildApiUrl } from "../utils/api";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

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
    refresh();
  }, [refresh]);

  const loginWithGoogle = useCallback((redirectPath) => {
    const redirect = redirectPath || window.location.pathname;
    const url = buildApiUrl(`api/auth/google/start?redirect=${encodeURIComponent(redirect)}`);
    window.location.assign(url);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch("api/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
      setProfile(null);
    }
  }, []);

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
      refresh,
      loginWithGoogle,
      logout,
      updateProfile,
    }),
    [user, profile, loading, refresh, loginWithGoogle, logout, updateProfile]
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

