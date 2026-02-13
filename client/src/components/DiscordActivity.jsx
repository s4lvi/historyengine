import React, { useEffect, useState } from "react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getDiscordSdk } from "../utils/discord";
import { apiFetch } from "../utils/api";
import Game from "./Game";
import { LoadingSpinner } from "./ErrorHandling";

const DiscordActivity = () => {
  const { user, loading: authLoading } = useAuth();
  const [roomId, setRoomId] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState("Authenticating...");

  // Handle auth failure — if loading finished but no user, auth failed
  useEffect(() => {
    if (!authLoading && !user && !error) {
      setError("Discord authentication failed. Please try again.");
    }
  }, [authLoading, user, error]);

  useEffect(() => {
    if (authLoading || !user) return;

    let cancelled = false;
    const setup = async () => {
      try {
        setStatus("Creating game room...");
        const sdk = getDiscordSdk();
        const instanceId = sdk?.instanceId;
        if (!instanceId) {
          throw new Error("Discord SDK instanceId not available");
        }

        // Get or create a room for this Discord Activity instance
        const response = await apiFetch("api/gamerooms/discord-instance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instanceId }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error || "Failed to create Discord game room");
        }

        const data = await response.json();
        if (cancelled) return;

        // Wait for the room to be ready (may be generating the map)
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

        // Auto-join the room
        const joinResp = await apiFetch(`api/gamerooms/${gameRoomId}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ joinCode: data.joinCode }),
        });
        if (!joinResp.ok) {
          const joinErr = await joinResp.json().catch(() => ({}));
          // 403 with "Rejoined" is OK — player was already in the room
          if (joinResp.status !== 200 && !joinErr.message?.includes("Rejoined")) {
            console.warn("[DISCORD] Join response:", joinErr);
          }
        }

        setRoomId(gameRoomId);
      } catch (err) {
        if (!cancelled) {
          console.error("[DISCORD] Setup error:", err);
          setError(err.message);
        }
      }
    };

    setup();
    return () => { cancelled = true; };
  }, [user, authLoading]);

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

  if (!roomId) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-gray-900 text-white">
        <LoadingSpinner />
        <p className="mt-4 text-gray-300">{status}</p>
      </div>
    );
  }

  // Wrap Game in a MemoryRouter so useParams/useNavigate hooks don't throw
  return (
    <MemoryRouter initialEntries={[`/rooms/${roomId}`]}>
      <Routes>
        <Route path="/rooms/:id" element={<Game discordRoomId={roomId} />} />
      </Routes>
    </MemoryRouter>
  );
};

export default DiscordActivity;
