import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import GameCanvas from "./GameCanvas";
import Modal from "./Modal";
import { LoadingSpinner } from "./ErrorHandling";
import { ControlButtons } from "./ControlButtons";
import StatsBar from "./StatsBar";
import SettingsModal from "./SettingsModal";
import PlayerListModal from "./PlayerListModal";
import ActionBar from "./ActionBar";

const Game = () => {
  // Get game room ID from URL params.
  const { id } = useParams();
  const navigate = useNavigate();

  // ----------------------------
  // API–fetched data and map info
  // ----------------------------
  const [mapMetadata, setMapMetadata] = useState(null);
  const [mapChunks, setMapChunks] = useState([]);
  const [mappings, setMappings] = useState(null);
  const [loadedRows, setLoadedRows] = useState(0);
  const [gameState, setGameState] = useState(null);
  const [userState, setUserState] = useState(null);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const lastWsUpdateAtRef = useRef(0);

  const isFetchingChunk = useRef(false);
  const wsRef = useRef(null);
  const applyDeltaGameStateRef = useRef(null);
  const wsReconnectTimerRef = useRef(null);
  const wsReconnectAttemptsRef = useRef(0);
  const lastNationOwnersRef = useRef("");

  // ----------------------------
  // Login and credentials state
  // ----------------------------
  const [loginName, setLoginName] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const roomKey = `gameRoom-${id}-userId`;
  const [joinCode, setJoinCode] = useState(
    localStorage.getItem(`${roomKey}-joinCode`)
  );
  const [userId, setUserId] = useState(
    localStorage.getItem(`${roomKey}-userId`)
  );
  const [storedPassword, setStoredPassword] = useState(
    localStorage.getItem(`${roomKey}-password`)
  );

  // ----------------------------
  // Modal and cell selection state
  // ----------------------------
  const [showSettings, setShowSettings] = useState(false);
  const [showPlayerList, setShowPlayerList] = useState(false);
  const [actionModal, setActionModal] = useState(null);
  const [foundingNation, setFoundingNation] = useState(false);
  const [buildingStructure, setBuildingStructure] = useState(null);
  const [placingTower, setPlacingTower] = useState(false);
  const [pressureMarkers, setPressureMarkers] = useState([]);
  const [isDefeated, setIsDefeated] = useState(false);
  const [isSpectating, setIsSpectating] = useState(false);
  const [hasFounded, setHasFounded] = useState(false);
  const [attackPercent, setAttackPercent] = useState(0.25);
  const actionModalRef = useRef(actionModal);
  const isDefeatedRef = useRef(isDefeated);
  const hasFoundedRef = useRef(hasFounded);
  const allowRefound = config?.territorial?.allowRefound !== false;

  useEffect(() => {
    actionModalRef.current = actionModal;
  }, [actionModal]);

  useEffect(() => {
    isDefeatedRef.current = isDefeated;
  }, [isDefeated]);

  useEffect(() => {
    hasFoundedRef.current = hasFounded;
  }, [hasFounded]);

  const startFoundNation = () => {
    setIsSpectating(false);
    setFoundingNation(true);
  };

  // ----------------------------
  // API call helpers
  // ----------------------------
  const fetchMapMetadata = async () => {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/metadata`
      );
      if (!response.ok) throw new Error("Failed to fetch map metadata");
      const data = await response.json();
      setMapMetadata(data.map);
      setConfig(data.config);
    } catch (err) {
      setError(err.message);
    }
  };

  const CHUNK_SIZE = 20;
  const fetchMapChunk = async (startRow) => {
    try {
      const endRow = startRow + CHUNK_SIZE;
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/data?startRow=${startRow}&endRow=${endRow}`
      );
      if (!response.ok) throw new Error("Failed to fetch map chunk");
      const data = await response.json();
      if (data.mappings && !mappings) {
        setMappings(data.mappings);
      }
      return data;
    } catch (err) {
      throw err;
    }
  };

  const mergeTerritory = (existing, delta) => {
    const next = new Set();
    if (existing && existing.x && existing.y) {
      for (let i = 0; i < existing.x.length; i++) {
        next.add(`${existing.x[i]},${existing.y[i]}`);
      }
    }

    if (delta?.sub?.x?.length) {
      for (let i = 0; i < delta.sub.x.length; i++) {
        next.delete(`${delta.sub.x[i]},${delta.sub.y[i]}`);
      }
    }

    if (delta?.add?.x?.length) {
      for (let i = 0; i < delta.add.x.length; i++) {
        next.add(`${delta.add.x[i]},${delta.add.y[i]}`);
      }
    }

    const x = [];
    const y = [];
    next.forEach((key) => {
      const [sx, sy] = key.split(",");
      x.push(Number(sx));
      y.push(Number(sy));
    });
    return { x, y };
  };

  const logNationOwners = (nextState) => {
    const owners = (nextState?.nations || [])
      .map((nation) => nation.owner)
      .sort()
      .join("|");
    if (owners && owners !== lastNationOwnersRef.current) {
      lastNationOwnersRef.current = owners;
      console.log("[STATE] nations:", owners);
    }
  };

  const applyDeltaGameState = (data) => {
    logNationOwners(data.gameState);
    const allowRefound = config?.territorial?.allowRefound !== false;
    const beginSpectate = () => {
      setActionModal(null);
      setFoundingNation(false);
      setHasFounded(false);
      setIsSpectating(true);
    };
    const beginRefound = () => {
      setActionModal(null);
      setFoundingNation(true);
      setHasFounded(false);
      setIsSpectating(false);
    };
    setGameState((prevState) => {
      const previousNations = prevState?.gameState?.nations || [];
      const prevTerritories = previousNations.reduce((acc, nation) => {
        acc[nation.owner] = nation.territory || null;
        return acc;
      }, {});

      if (data.gameState.nations) {
        const byOwner = new Map();
        data.gameState.nations.forEach((nation) => {
          const existing = byOwner.get(nation.owner);
          if (!existing) {
            byOwner.set(nation.owner, nation);
            return;
          }
          if (existing.status === "defeated" && nation.status !== "defeated") {
            byOwner.set(nation.owner, nation);
            return;
          }
          if (nation.status !== "defeated" && existing.status !== "defeated") {
            byOwner.set(nation.owner, nation);
          }
        });
        data.gameState.nations = Array.from(byOwner.values()).map((nation) => {
          const previousTerritory = prevTerritories[nation.owner] || null;
          if (nation.status === "defeated") {
            nation.territory = { x: [], y: [] };
            if (nation.territoryDeltaForClient) {
              delete nation.territoryDeltaForClient;
            }
            return nation;
          }
          if (nation.territoryDeltaForClient) {
            nation.territory = mergeTerritory(
              previousTerritory,
              nation.territoryDeltaForClient
            );
            delete nation.territoryDeltaForClient;
          }
          return nation;
        });
      }

      return {
        tickCount: data.tickCount,
        roomName: data.roomName,
        roomCreator: data.roomCreator,
        gameState: data.gameState,
      };
    });

    const winningNation = data.gameState.nations?.find(
      (n) => n.status === "winner"
    );
    if (winningNation) {
      if (winningNation.owner === userId) {
        if (!actionModalRef.current || actionModalRef.current.type !== "win") {
          setActionModal({
            type: "win",
            message: "Congratulations! Your nation has won the game!",
            onClose: () => {
              handleEndGame();
            },
          });
        }
        setUserState(winningNation);
        setIsSpectating(false);
      } else {
        if (
          !actionModalRef.current ||
          actionModalRef.current.type !== "defeat"
        ) {
          setActionModal({
            type: "defeat",
            message: `${winningNation.owner} has won the game. Your nation has been defeated.`,
            onSpectate: beginSpectate,
          });
        }
        setUserState(null);
        setFoundingNation(false);
        setHasFounded(false);
        setIsDefeated(true);
        setIsSpectating(true);
      }
    } else {
      const playerNation = data.gameState.nations?.find(
        (n) => n.owner === userId && n.status !== "defeated"
      );
      const defeatedNation = data.gameState.nations?.find(
        (n) => n.owner === userId && n.status === "defeated"
      );
      const anyNationForUser = !!playerNation || !!defeatedNation;
      if (playerNation) {
        setUserState(playerNation);
        setIsDefeated(false);
        setHasFounded(true);
        setIsSpectating(false);
      } else {
        if (defeatedNation) {
          setIsDefeated(true);
          if (!allowRefound) {
            setIsSpectating(true);
          }
          if (!isDefeatedRef.current && hasFoundedRef.current) {
            setActionModal({
              type: "defeat",
              message: allowRefound
                ? "Your nation has been defeated! You can start over by founding a new nation or spectate."
                : "Your nation has been defeated. Refounding is disabled; you can spectate the match.",
              onSpectate: beginSpectate,
              onRefound: allowRefound ? beginRefound : null,
            });
          }
        } else {
          setIsDefeated(false);
          setIsSpectating(false);
        }
        const canInitialFound = !anyNationForUser;
        const canRefound = allowRefound && !!defeatedNation;
        const shouldSpectate =
          (!allowRefound && !!defeatedNation) || isSpectating;
        setUserState(null);
        setFoundingNation((canInitialFound || canRefound) && !shouldSpectate);
        setHasFounded(false);
      }
    }
  };

  useEffect(() => {
    applyDeltaGameStateRef.current = applyDeltaGameState;
  }, [applyDeltaGameState]);

  // ----------------------------
  // Fetch metadata on mount
  // ----------------------------
  useEffect(() => {
    if (id) {
      fetchMapMetadata();
    }
  }, [id]);

  // ----------------------------
  // Fetch map chunks sequentially
  // ----------------------------
  useEffect(() => {
    const loadNextChunk = async () => {
      if (!mapMetadata || error || loadedRows >= mapMetadata.height) return;
      if (isFetchingChunk.current) return; // Already fetching a chunk, so skip.

      isFetchingChunk.current = true;
      setLoading(true);
      try {
        const nextChunk = await fetchMapChunk(loadedRows);
        if (nextChunk && nextChunk.chunk && nextChunk.chunk.length > 0) {
          setMapChunks((prev) => [
            ...prev,
            { startRow: nextChunk.startRow, chunk: nextChunk.chunk },
          ]);
          setLoadedRows(nextChunk.endRow);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
        isFetchingChunk.current = false;
      }
    };
    loadNextChunk();
  }, [mapMetadata, loadedRows, error]);

  // ----------------------------
  // WebSocket: subscribe to game state updates
  // ----------------------------
  useEffect(() => {
    if (!id || !userId || !storedPassword) return;
    let isActive = true;

    const apiBase = process.env.REACT_APP_API_URL;
    const wsBase = apiBase
      ? apiBase.replace(/^http/, "ws")
      : window.location.origin.replace(/^http/, "ws");
    const wsUrl = wsBase.endsWith("/") ? `${wsBase}ws` : `${wsBase}/ws`;

    const scheduleReconnect = () => {
      if (!isActive) return;
      const attempts = wsReconnectAttemptsRef.current;
      const delay = Math.min(10000, 500 * Math.pow(2, attempts));
      wsReconnectAttemptsRef.current = attempts + 1;
      if (wsReconnectTimerRef.current) {
        clearTimeout(wsReconnectTimerRef.current);
      }
      wsReconnectTimerRef.current = setTimeout(() => {
        if (isActive) connect();
      }, delay);
    };

    const connect = () => {
      if (!isActive) return;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[WS] open");
        wsReconnectAttemptsRef.current = 0;
        ws.send(
          JSON.stringify({
            type: "subscribe",
            roomId: id,
            userId,
            password: storedPassword,
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "subscribed") {
            setWsConnected(true);
            return;
          }
          if (msg.type === "state") {
            lastWsUpdateAtRef.current = Date.now();
            applyDeltaGameStateRef.current?.(msg);
            return;
          }
          if (msg.type === "error") {
            setError(msg.message || "WebSocket error");
            ws.close();
          }
        } catch (err) {
          console.error("Error parsing WebSocket message:", err);
        }
      };

      ws.onclose = () => {
        console.warn("[WS] closed");
        setWsConnected(false);
        scheduleReconnect();
      };
      ws.onerror = (err) => {
        console.warn("[WS] error", err);
        setWsConnected(false);
        ws.close();
      };
    };

    connect();

    return () => {
      isActive = false;
      if (wsReconnectTimerRef.current) {
        clearTimeout(wsReconnectTimerRef.current);
      }
      wsRef.current?.close();
    };
  }, [id, userId, storedPassword]);

  // ----------------------------
  // Poll game state (every 200ms)
  // ----------------------------
  // In your useEffect that polls game state:
  useEffect(() => {
    if (!userId || !storedPassword) return;

    const fetchGameState = async () => {
      if (
        wsConnected &&
        Date.now() - lastWsUpdateAtRef.current < 1000
      ) {
        return;
      }
      try {
        const response = await fetch(
          `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/state`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, password: storedPassword }),
          }
        );

        if (!response.ok) {
          navigate("/rooms");
          return;
        }

        const data = await response.json();

        applyDeltaGameState(data);
      } catch (err) {
        console.error("Error fetching game state:", err);
      }
    };

    fetchGameState();
    const intervalMs = wsConnected ? 250 : 250;
    const interval = setInterval(fetchGameState, intervalMs);
    return () => clearInterval(interval);
  }, [id, userId, storedPassword, navigate, wsConnected]);

  // Full state polling effect: every 5 seconds, fetch the full state to overwrite local territory.
  useEffect(() => {
    if (!userId || !storedPassword) return;

    const fetchFullState = async () => {
      // If an action modal is active (win/defeat popup), skip full state update.
      if (actionModal) return;

      try {
        const response = await fetch(
          `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/state`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId,
              password: storedPassword,
              full: "true",
            }),
          }
        );
        if (!response.ok) {
          navigate("/rooms");
          return;
        }
        const data = await response.json();

        // Overwrite local state with the full state from the backend.
        if (data.gameState.nations) {
          const byOwner = new Map();
          data.gameState.nations.forEach((nation) => {
            const existing = byOwner.get(nation.owner);
            if (!existing) {
              byOwner.set(nation.owner, nation);
              return;
            }
            if (existing.status === "defeated" && nation.status !== "defeated") {
              byOwner.set(nation.owner, nation);
              return;
            }
            if (nation.status !== "defeated" && existing.status !== "defeated") {
              byOwner.set(nation.owner, nation);
            }
          });
          data.gameState.nations = Array.from(byOwner.values()).map((nation) => {
            // Remove any delta properties if present.
            if (nation.territoryDeltaForClient) {
              delete nation.territoryDeltaForClient;
            }
            if (nation.status === "defeated") {
              nation.territory = { x: [], y: [] };
            }
            return nation;
          });
        }

        logNationOwners(data.gameState);
        setGameState({
          tickCount: data.tickCount,
          roomName: data.roomName,
          roomCreator: data.roomCreator,
          gameState: data.gameState,
        });

        // Also update userState if needed.
        if (data.gameState.nations) {
          const playerNation = data.gameState.nations.find(
            (n) => n.owner === userId && n.status !== "defeated"
          );
          if (playerNation) {
            setUserState(playerNation);
            setIsDefeated(false);
            setHasFounded(true);
          } else {
            if (!isDefeated && hasFounded) {
              const defeatedNation = data.gameState.nations.find(
                (n) => n.owner === userId && n.status === "defeated"
              );
              if (defeatedNation) {
                setIsDefeated(true);
                setHasFounded(false);
              }
              setUserState(null);
              setFoundingNation(true);
              setHasFounded(false);
            }
          }
        }
      } catch (err) {
        console.error("Error fetching full game state:", err);
      }
    };

    // Immediately fetch full state on mounting
    fetchFullState();
    // Then set interval for rectification every 5 seconds
    const fullIntervalMs = wsConnected ? 15000 : 1000;
    const interval = setInterval(fetchFullState, fullIntervalMs);
    return () => clearInterval(interval);
  }, [id, userId, storedPassword, navigate, actionModal, wsConnected]);

  // ----------------------------
  // Handle login form submission
  // ----------------------------
  const handleLoginSubmit = async (e) => {
    e?.preventDefault();
    setLoginError("");
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/join`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userName: userId ? userId : loginName,
            password: storedPassword ? storedPassword : loginPassword,
            joinCode: joinCode,
          }),
        }
      );
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to join game room");
      }
      const data = await response.json();
      console.log("Join response:", data);
      // Store credentials if needed.
      if (loginName) {
        localStorage.setItem(`${roomKey}-userId`, loginName);
        localStorage.setItem(`${roomKey}-password`, loginPassword);
        localStorage.setItem(`${roomKey}-joinCode`, joinCode);
        setUserId(loginName);
        setStoredPassword(loginPassword);

        // Immediately fetch the full state so the new player gets all territories.
        try {
          const fullResp = await fetch(
            `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/state`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                userId: loginName,
                password: loginPassword,
                full: "true",
              }),
            }
          );
          if (fullResp.ok) {
            const fullData = await fullResp.json();
            if (fullData.gameState.nations) {
              fullData.gameState.nations = fullData.gameState.nations.map(
                (nation) => {
                  if (nation.territoryDeltaForClient) {
                    delete nation.territoryDeltaForClient;
                  }
                  return nation;
                }
              );
            }
            setGameState({
              tickCount: fullData.tickCount,
              roomName: fullData.roomName,
              roomCreator: fullData.roomCreator,
              gameState: fullData.gameState,
            });
            if (fullData.gameState.nations) {
              setUserState(
                fullData.gameState.nations.find((n) => n.owner === loginName)
              );
            }
          }
        } catch (err) {
          console.error("Error fetching full state on join:", err);
        }
      }
    } catch (err) {
      console.error("Join error:", err);
      setLoginError(err.message);
    }
  };

  // ----------------------------
  // API call wrappers for game actions
  // ----------------------------
  const handleFoundNation = async (x, y) => {
    if (!userId || !storedPassword) return;

    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/foundNation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, password: storedPassword, x, y }),
        }
      );

      if (!response.ok) {
        const errData = await response.json();
        if (errData?.code === "REFOUND_DISABLED") {
          setIsSpectating(true);
          setFoundingNation(false);
        }
        throw new Error(errData.error || "Failed to found nation");
      }

      setFoundingNation(false);
      setIsDefeated(false);
      setIsSpectating(false);
      setActionModal(null);
      setHasFounded(true);
    } catch (err) {
      setError(err.message);
      setFoundingNation(false);
    }
  };

  const handleCancelBuild = () => {
    setBuildingStructure(null);
  };

  const handleBuildCity = async (x, y, cityType, cityName) => {
    // If x and y are null, it means we're just selecting what to build
    if (x === null && y === null) {
      setBuildingStructure(cityType);
      return;
    }

    // Otherwise, we're actually building at the selected location
    const password = storedPassword || loginPassword;
    if (!userId || !password) return;

    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/buildCity`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            password,
            x,
            y,
            cityType,
            cityName,
          }),
        }
      );
      if (!response.ok) throw new Error("Failed to build city");
      // Clear building mode after successful build
      setBuildingStructure(null);
    } catch (err) {
      setError(err.message);
      // Also clear building mode on error
      setBuildingStructure(null);
    }
  };


  const handlePauseGame = async () => {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/pause`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, password: storedPassword }),
        }
      );
      if (!response.ok) {
        throw new Error("Failed to pause game");
      }
      const data = await response.json();
      console.log("Game paused:", data);
      setPaused(true);
    } catch (err) {
      console.error("Error pausing game:", err);
    }
  };

  const handleUnPauseGame = async () => {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/unpause`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, password: storedPassword }),
        }
      );
      if (!response.ok) {
        throw new Error("Failed to unpause game");
      }
      const data = await response.json();
      console.log("Game unpaused:", data);
      setPaused(false);
    } catch (err) {
      console.error("Error unpausing game:", err);
    }
  };

  const handleEndGame = async () => {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/end`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userName: userId, password: storedPassword }),
        }
      );
      if (!response.ok) {
        throw new Error("Failed to end game");
      }
      const data = await response.json();
      console.log("Game ended:", data);
      // For example, navigate to a game-over screen
      // navigate("/game-over");
    } catch (err) {
      console.error("Error ending game:", err);
    }
  };

  const handleQuitGame = async () => {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/quit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: userId, password: storedPassword }),
        }
      );
      if (!response.ok) {
        throw new Error("Failed to quit game");
      }
      setFoundingNation(true);
      setHasFounded(false);
      setActionModal(null);
      setUserState(null);
      setGameState(null);
      navigate("/rooms");
    } catch (err) {
      console.error("Error ending game:", err);
    }
  };

  const handleSendPressure = async (x, y) => {
    if (!userId || !storedPassword) return;
    if (!config?.territorial?.enabled) return;
    const userNation = gameState?.gameState?.nations?.find(
      (n) => n.owner === userId
    );
    if (!userNation) return;
    const anchor =
      userNation.cities?.find((c) => c.type === "capital") ||
      userNation.startingCell ||
      (userNation.territory?.x?.length
        ? { x: userNation.territory.x[0], y: userNation.territory.y[0] }
        : null);
    if (!anchor) return;
    const direction = { x: x - anchor.x, y: y - anchor.y };
    if (direction.x === 0 && direction.y === 0) return;

    try {
      const markerId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setPressureMarkers((prev) => [
        ...prev,
        {
          id: markerId,
          x,
          y,
          expiresAt: Date.now() + 1400,
        },
      ]);
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/pressure`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            password: storedPassword,
            direction,
            target: { x, y },
            percent: attackPercent,
          }),
        }
      );
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to send pressure");
      }
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    if (!pressureMarkers.length) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setPressureMarkers((prev) =>
        prev.filter((marker) => marker.expiresAt > now)
      );
    }, 300);
    return () => clearInterval(interval);
  }, [pressureMarkers.length]);

  const handlePlaceTower = async (x, y) => {
    if (!userId || !storedPassword) return;
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/upgradeNode`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, password: storedPassword, x, y }),
        }
      );
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to upgrade node");
      }
      setPlacingTower(false);
    } catch (err) {
      setError(err.message);
      setPlacingTower(false);
    }
  };

  // ----------------------------
  // Create a flat grid from the loaded map chunks.
  // ----------------------------
  const mapGrid = React.useMemo(() => {
    const grid = [];
    mapChunks.forEach(({ startRow, chunk }) => {
      chunk.forEach((row, rowIndex) => {
        const y = startRow + rowIndex;
        row.forEach((cell, x) => {
          grid.push({ cell, x, y });
        });
      });
    });
    return grid;
  }, [mapChunks]);

  // ----------------------------
  // Helper for determining player (nation) colors.
  // ----------------------------
  const nationColors = React.useMemo(() => {
    const palette = [
      "#FF5733",
      "#33FF57",
      "#3357FF",
      "#FF33A8",
      "#A833FF",
      "#33FFF0",
      "#FFC133",
      "#FF3333",
      "#33FF33",
      "#3333FF",
      "#FF8C42",
      "#4ADEDE",
      "#F72585",
      "#3A86FF",
      "#2A9D8F",
    ];
    const owners = (gameState?.gameState?.nations || [])
      .map((n) => n.owner)
      .filter(Boolean)
      .sort();
    const uniqueOwners = Array.from(new Set(owners));
    const colorMap = {};
    uniqueOwners.forEach((owner, idx) => {
      if (idx < palette.length) {
        colorMap[owner] = palette[idx];
      } else {
        const hue = (idx * 137.508) % 360;
        colorMap[owner] = `hsl(${hue.toFixed(0)}, 75%, 55%)`;
      }
    });
    return colorMap;
  }, [gameState]);

  const getNationColor = (nation) => {
    if (!nation?.owner) return "#999999";
    return nationColors[nation.owner] || "#999999";
  };

  const isMapLoaded = mapMetadata && loadedRows >= mapMetadata.height;

  return (
    <div className="relative h-screen overflow-hidden">
      <ControlButtons
        onOpenSettings={() => setShowSettings(true)}
        onOpenPlayerList={() => setShowPlayerList(true)}
      />
      {!isDefeated && <StatsBar gameState={gameState} userId={userId} />}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        gameState={gameState}
        userId={userId}
        paused={paused}
        onPause={handlePauseGame}
        onUnpause={handleUnPauseGame}
        onEndGame={handleEndGame}
        onLeaveGame={handleQuitGame}
        onBackToGameRooms={() => navigate("/rooms")}
      />
      <PlayerListModal
        isOpen={showPlayerList}
        onClose={() => setShowPlayerList(false)}
        gameState={gameState}
        getNationColor={getNationColor}
      />
      {/* Main Content Area */}
      <div className="absolute inset-0">
        {!isMapLoaded ? (
          <div className="flex flex-col items-center justify-center h-full bg-gray-800">
            <LoadingSpinner />
            {mapMetadata && (
              <div className="text-white mt-4">
                Loading map...{" "}
                {Math.min(
                  ((loadedRows / mapMetadata.height) * 100).toFixed(0),
                  100
                )}
                %
              </div>
            )}
          </div>
        ) : (
          <GameCanvas
            mapMetadata={mapMetadata}
            mapGrid={mapGrid}
            mappings={mappings}
            gameState={gameState}
            userId={userId}
            nationColors={nationColors}
            pressureMarkers={pressureMarkers}
            config={config}
            foundingNation={foundingNation}
            onFoundNation={handleFoundNation}
            buildingStructure={buildingStructure}
            onBuildCity={handleBuildCity}
            onCancelBuild={handleCancelBuild}
            onSendPressure={handleSendPressure}
            placingTower={placingTower}
            onPlaceTower={handlePlaceTower}
          />
        )}
      </div>
      <ActionBar
        onFoundNation={startFoundNation}
        userState={userState}
        hasFounded={hasFounded}
        isSpectating={isSpectating}
        allowRefound={allowRefound}
        attackPercent={attackPercent}
        setAttackPercent={setAttackPercent}
        onStartPlaceTower={() => setPlacingTower(true)}
      />
      {/* The join/login modal now appears only if the map is loaded */}
      <Modal
        showLoginModal={!userId && isMapLoaded}
        onLoginSubmit={handleLoginSubmit}
        loginName={loginName}
        setLoginName={setLoginName}
        loginPassword={loginPassword}
        setLoginPassword={setLoginPassword}
        joinCode={joinCode}
        setJoinCode={setJoinCode}
        loginError={loginError}
        actionModal={actionModal}
        setActionModal={setActionModal}
        onBuildCity={handleBuildCity}
        config={config}
        userState={userState}
      />
    </div>
  );
};

export default Game;
