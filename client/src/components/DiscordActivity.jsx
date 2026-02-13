import React, { useEffect, useState } from "react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getDiscordSdk } from "../utils/discord";
import { apiFetch } from "../utils/api";
import Game from "./Game";
import { LoadingSpinner } from "./ErrorHandling";

const MAP_SIZES = {
  Small: { width: 250, height: 250 },
  Normal: { width: 500, height: 500 },
};

const DiscordSetupScreen = ({ profile, onStart, loading }) => {
  const [nationName, setNationName] = useState(profile?.nationName || "");
  const [capitalName, setCapitalName] = useState(profile?.capitalName || "");
  const [color, setColor] = useState(profile?.color || "#3b82f6");
  const [mapSize, setMapSize] = useState("Small");
  const [botCount, setBotCount] = useState(0);

  const handleSubmit = (e) => {
    e.preventDefault();
    const { width, height } = MAP_SIZES[mapSize];
    onStart({ nationName, capitalName, color, mapWidth: width, mapHeight: height, botCount });
  };

  return (
    <div className="flex h-screen items-center justify-center bg-gray-900 text-white">
      <form onSubmit={handleSubmit} className="w-[90vw] max-w-sm space-y-5 p-6">
        <div className="text-center">
          <img src="annexilogo.png" alt="Annexi" className="mx-auto h-10 mb-3" />
          <h1 className="text-lg font-semibold">Set Up Your Nation</h1>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400">Nation Name</label>
            <input
              type="text"
              value={nationName}
              onChange={(e) => setNationName(e.target.value)}
              placeholder={profile?.displayName || "My Nation"}
              className="mt-1 w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400">Capital Name</label>
            <input
              type="text"
              value={capitalName}
              onChange={(e) => setCapitalName(e.target.value)}
              placeholder="Capital"
              className="mt-1 w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <label className="text-xs text-gray-400">Player Color</label>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-8 w-16 rounded border border-gray-700 bg-gray-800"
            />
          </div>
        </div>

        <div className="border-t border-gray-700 pt-4 space-y-3">
          <h2 className="text-sm font-medium text-gray-300">Game Settings</h2>
          <div>
            <label className="text-xs text-gray-400">Map Size</label>
            <select
              value={mapSize}
              onChange={(e) => setMapSize(e.target.value)}
              className="mt-1 w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-sm"
            >
              <option value="Small">Small (250 x 250)</option>
              <option value="Normal">Normal (500 x 500)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400">Bot Opponents</label>
            <input
              type="number"
              min={0}
              max={8}
              value={botCount}
              onChange={(e) => setBotCount(Math.max(0, Math.min(8, Number(e.target.value) || 0)))}
              className="mt-1 w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 px-4 py-2.5 font-medium text-white transition-colors"
        >
          {loading ? "Starting..." : "Start Game"}
        </button>
      </form>
    </div>
  );
};

const DiscordActivity = () => {
  const { user, profile, loading: authLoading, updateProfile } = useAuth();
  const [phase, setPhase] = useState("auth"); // auth → setup → creating → ready
  const [roomId, setRoomId] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState("Authenticating...");

  // Transition from auth → setup once authenticated
  useEffect(() => {
    if (!authLoading && user) {
      setPhase("setup");
    } else if (!authLoading && !user && !error) {
      setError("Discord authentication failed. Please try again.");
    }
  }, [authLoading, user, error]);

  const handleStart = async ({ nationName, capitalName, color, mapWidth, mapHeight, botCount }) => {
    setPhase("creating");
    let cancelled = false;

    try {
      // 1. Save profile
      setStatus("Saving profile...");
      await updateProfile({ nationName, capitalName, color });

      // 2. Create or join Discord room
      setStatus("Creating game room...");
      const sdk = getDiscordSdk();
      const instanceId = sdk?.instanceId;
      if (!instanceId) {
        throw new Error("Discord SDK instanceId not available");
      }

      const response = await apiFetch("api/gamerooms/discord-instance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId, mapWidth, mapHeight, botCount }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create Discord game room");
      }

      const data = await response.json();
      if (cancelled) return;

      // 3. Wait for map generation
      setStatus("Generating map...");
      const gameRoomId = data.gameRoomId;
      let ready = false;
      for (let i = 0; i < 120; i++) {
        if (cancelled) return;
        const statusResp = await apiFetch(`api/gamerooms/${gameRoomId}/status`);
        if (statusResp.ok) {
          const statusData = await statusResp.json();
          if (statusData.ready) {
            ready = true;
            break;
          }
          if (statusData.gameRoomStatus === "error" || statusData.mapStatus === "error") {
            throw new Error("Room generation failed");
          }
          const progress = statusData.progress || 0;
          setStatus(`Generating map... ${progress}%`);
        }
        await new Promise((r) => setTimeout(r, 1000));
      }

      if (!ready) {
        throw new Error("Room generation timed out");
      }

      if (cancelled) return;

      // 4. Auto-join the room
      const joinResp = await apiFetch(`api/gamerooms/${gameRoomId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinCode: data.joinCode }),
      });
      if (!joinResp.ok) {
        const joinErr = await joinResp.json().catch(() => ({}));
        if (joinResp.status !== 200 && !joinErr.message?.includes("Rejoined")) {
          console.warn("[DISCORD] Join response:", joinErr);
        }
      }

      setRoomId(gameRoomId);
      setPhase("ready");
    } catch (err) {
      if (!cancelled) {
        console.error("[DISCORD] Setup error:", err);
        setError(err.message);
      }
    }
  };

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-900 text-white">
        <div className="text-center">
          <h2 className="text-xl font-bold mb-2">Failed to start game</h2>
          <p className="text-gray-400">{error}</p>
        </div>
      </div>
    );
  }

  if (phase === "auth") {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-gray-900 text-white">
        <LoadingSpinner />
        <p className="mt-4 text-gray-300">Authenticating...</p>
      </div>
    );
  }

  if (phase === "setup") {
    return (
      <DiscordSetupScreen
        profile={profile}
        onStart={handleStart}
        loading={false}
      />
    );
  }

  if (phase === "creating") {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-gray-900 text-white">
        <LoadingSpinner />
        <p className="mt-4 text-gray-300">{status}</p>
      </div>
    );
  }

  // phase === "ready"
  return (
    <MemoryRouter initialEntries={[`/rooms/${roomId}`]}>
      <Routes>
        <Route path="/rooms/:id" element={<Game discordRoomId={roomId} />} />
      </Routes>
    </MemoryRouter>
  );
};

export default DiscordActivity;
