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
import ArrowPanel from "./ArrowPanel";
import { unpackTerritoryDelta } from "../utils/packedDelta";
import MobileActionDock from "./MobileActionDock";
import ContextPanel from "./ContextPanel";
import { useAuth } from "../context/AuthContext";
import { apiFetch, getWsUrl } from "../utils/api";
import { isDiscordActivity, getDiscordToken } from "../utils/discord";

const Game = ({ discordRoomId }) => {
  // Get game room ID from URL params or Discord prop.
  const { id: paramId } = useParams();
  const id = discordRoomId || paramId;
  const isDiscord = isDiscordActivity();

  const routerNavigate = useNavigate();
  const navigate = isDiscord ? () => {} : routerNavigate;

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
  const requestFullStateRef = useRef(null);
  const wsReconnectTimerRef = useRef(null);
  const wsReconnectAttemptsRef = useRef(0);
  const lastNationOwnersRef = useRef("");
  const lastAppliedTickRef = useRef(-1);
  const pollRequestIdRef = useRef(0);
  const fullRequestIdRef = useRef(0);
  const pollInFlightRef = useRef(false);
  const fullInFlightRef = useRef(false);
  const pendingGapSyncRef = useRef(false);

  // ----------------------------
  // Login and credentials state
  // ----------------------------
  const {
    user,
    profile,
    loading: authLoading,
    loginWithGoogle,
  } = useAuth();
  const userId = user?.id || null;
  const roomKey = `gameRoom-${id}-userId`;
  const [joinCode, setJoinCode] = useState(
    localStorage.getItem(`${roomKey}-joinCode`) || ""
  );
  const [joinError, setJoinError] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [hasJoined, setHasJoined] = useState(false);

  // ----------------------------
  // Modal and cell selection state
  // ----------------------------
  const [showSettings, setShowSettings] = useState(false);
  const [showPlayerList, setShowPlayerList] = useState(false);
  const [actionModal, setActionModal] = useState(null);
  const [foundingNation, setFoundingNation] = useState(false);
  const [buildingStructure, setBuildingStructure] = useState(null);
  const [isDefeated, setIsDefeated] = useState(false);
  const [isSpectating, setIsSpectating] = useState(false);
  const [hasFounded, setHasFounded] = useState(false);
  const [attackPercent, setAttackPercent] = useState(0.25);
  const [troopTarget, setTroopTarget] = useState(0.2);
  const [uiMode, setUiMode] = useState("idle");
  const [selectedCellInfo, setSelectedCellInfo] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [combatFlashes, setCombatFlashes] = useState([]);
  const [regionData, setRegionData] = useState(null);
  const [isStartingRoom, setIsStartingRoom] = useState(false);
  const actionModalRef = useRef(actionModal);
  const isDefeatedRef = useRef(isDefeated);
  const hasFoundedRef = useRef(hasFounded);
  const allowRefound = config?.territorial?.allowRefound !== false;
  const roomStatus = gameState?.roomStatus || "open";
  const roomPlayers = gameState?.players || [];
  const isRoomStarted = roomStatus === "open" || roomStatus === "paused";
  const isRoomLobby = roomStatus === "lobby";
  const isRoomCreator = gameState?.roomCreator === userId;
  const readyPlayerCount = roomPlayers.filter((player) => player.ready).length;
  const discordTopOffset = isMobile && isDiscord ? 56 : 0;
  const discordBottomOffset = isMobile && isDiscord ? 56 : 0;
  const mobileDockReservedHeight = isMobile ? 132 : 0;
  const arrowPanelTopOffset = isMobile ? discordTopOffset + 64 : 0;
  const arrowPanelBottomOffset = isMobile
    ? discordBottomOffset + mobileDockReservedHeight
    : 0;

  // ----------------------------
  // Big Arrow system state
  // ----------------------------
  const [drawingArrowType, setDrawingArrowType] = useState(null); // "attack" or "defend"
  const [currentArrowPath, setCurrentArrowPath] = useState([]); // [{x, y}, ...]
  const [activeAttackArrows, setActiveAttackArrows] = useState([]); // [{path, remainingPower, status, ...}]
  const [activeDefendArrow, setActiveDefendArrow] = useState(null); // {path: [{x,y}...], remainingPower, ...}
  const prevArrowsRef = useRef({ attacks: [], defend: null });

  useEffect(() => {
    setHasJoined(false);
    setJoinError("");
  }, [id, userId]);

  useEffect(() => {
    setJoinCode(localStorage.getItem(`${roomKey}-joinCode`) || "");
  }, [roomKey]);

  useEffect(() => {
    if (joinError) {
      setJoinError("");
    }
  }, [joinCode]);

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
    setBuildingStructure(null);
    setUiMode("foundNation");
    setSelectedCellInfo(null);
  };

  const exitModes = () => {
    setFoundingNation(false);
    setBuildingStructure(null);
    setDrawingArrowType(null);
    setCurrentArrowPath([]);
    setUiMode("idle");
    setSelectedCellInfo(null);
  };

  const enterDrawMode = (type) => {
    setFoundingNation(false);
    setBuildingStructure(null);
    setDrawingArrowType(type);
    setUiMode(type === "attack" ? "drawAttack" : "drawDefend");
    setSelectedCellInfo(null);
  };

  const setMode = (nextMode) => {
    if (nextMode === "idle") {
      exitModes();
      return;
    }
    if (nextMode === "pan") {
      setFoundingNation(false);
      setBuildingStructure(null);
      setDrawingArrowType(null);
      setCurrentArrowPath([]);
      setSelectedCellInfo(null);
    }
    setUiMode(nextMode);
  };

  const handleBuildStructure = (type) => {
    if (!isRoomStarted) return;
    setBuildingStructure(type);
    setFoundingNation(false);
    setDrawingArrowType(null);
    setCurrentArrowPath([]);
    setUiMode("buildStructure");
    setSelectedCellInfo(null);
  };

  const handleInspectCell = (info) => {
    setSelectedCellInfo(info);
  };

  useEffect(() => {
    const updateMobile = () => {
      const coarse =
        window.matchMedia &&
        window.matchMedia("(pointer: coarse)").matches;
      setIsMobile(isDiscord || coarse || window.innerWidth < 768);
    };
    updateMobile();
    window.addEventListener("resize", updateMobile);
    return () => window.removeEventListener("resize", updateMobile);
  }, [isDiscord]);

  // ----------------------------
  // API call helpers
  // ----------------------------
  const fetchMapMetadata = async () => {
    try {
      const response = await apiFetch(`api/gamerooms/${id}/metadata`);
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
      const response = await apiFetch(
        `api/gamerooms/${id}/data?startRow=${startRow}&endRow=${endRow}`
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

  // Numeric key encoding: (y << 16) | x — avoids string allocation/split
  const mergeTerritory = (existing, delta) => {
    const next = new Set();
    if (existing && existing.x && existing.y) {
      for (let i = 0; i < existing.x.length; i++) {
        next.add((existing.y[i] << 16) | existing.x[i]);
      }
    }

    if (delta?.sub?.x?.length) {
      for (let i = 0; i < delta.sub.x.length; i++) {
        next.delete((delta.sub.y[i] << 16) | delta.sub.x[i]);
      }
    }

    if (delta?.add?.x?.length) {
      for (let i = 0; i < delta.add.x.length; i++) {
        next.add((delta.add.y[i] << 16) | delta.add.x[i]);
      }
    }

    const x = new Array(next.size);
    const y = new Array(next.size);
    let idx = 0;
    next.forEach((key) => {
      x[idx] = key & 0xFFFF;
      y[idx] = (key >> 16) & 0xFFFF;
      idx++;
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

  const applyDeltaGameState = (data, options = {}) => {
    const { isFullState = false } = options;
    if (!data?.gameState) return false;

    const incomingTick = Number(data.tickCount);
    const lastAppliedTick = Number(lastAppliedTickRef.current);
    if (Number.isFinite(incomingTick) && Number.isFinite(lastAppliedTick)) {
      if (!isFullState && incomingTick <= lastAppliedTick) {
        return false;
      }
      if (!isFullState && lastAppliedTick >= 0 && incomingTick > lastAppliedTick + 1) {
        if (!pendingGapSyncRef.current && requestFullStateRef.current) {
          pendingGapSyncRef.current = true;
          requestFullStateRef.current("tick-gap");
        }
        return false;
      }
    }

    // Unpack packed deltas if server is using that format
    if (data.usePackedDeltas && data.gameState?.nations) {
      data.gameState.nations = data.gameState.nations.map((nation) => {
        if (nation.packedDelta) {
          nation.territoryDeltaForClient = unpackTerritoryDelta(nation.packedDelta);
          delete nation.packedDelta;
        }
        return nation;
      });
    }

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
            // Keep territoryDeltaForClient — TerritoryRenderer uses it for incremental rendering
          }
          return nation;
        });
      }

      // Detect territory flips for combat flash effects
      if (!isFullState) {
        const now = performance.now();
        const newFlashes = [];
        data.gameState.nations.forEach((nation) => {
          if (nation.owner !== userId) return;
          const delta = nation.territoryDeltaForClient;
          if (!delta) return;
          if (delta.add?.x?.length) {
            for (let i = 0; i < delta.add.x.length; i++) {
              newFlashes.push({ x: delta.add.x[i], y: delta.add.y[i], type: "capture", createdAt: now });
            }
          }
          if (delta.sub?.x?.length) {
            for (let i = 0; i < delta.sub.x.length; i++) {
              newFlashes.push({ x: delta.sub.x[i], y: delta.sub.y[i], type: "loss", createdAt: now });
            }
          }
        });
        if (newFlashes.length > 0) {
          setCombatFlashes((prev) => {
            if (prev.length === 0) return newFlashes.slice(-100);
            const combined = prev.length + newFlashes.length <= 100
              ? prev.concat(newFlashes)
              : prev.concat(newFlashes).slice(-100);
            return combined;
          });
        }
      }

      return {
        tickCount: data.tickCount,
        roomName: data.roomName,
        roomCreator: data.roomCreator,
        roomStatus: data.roomStatus || prevState?.roomStatus || "open",
        players: data.players || prevState?.players || [],
        gameState: data.gameState,
      };
    });
    if (Number.isFinite(incomingTick)) {
      lastAppliedTickRef.current = incomingTick;
    }
    if (isFullState) {
      pendingGapSyncRef.current = false;
    }

    const winningNation = data.gameState.nations?.find(
      (n) => n.status === "winner"
    );
    const winningLabel = winningNation
      ? winningNation.nationName || winningNation.displayName || winningNation.owner
      : null;
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
            message: `${winningLabel} has won the game. Your nation has been defeated.`,
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
    return true;
  };

  useEffect(() => {
    lastAppliedTickRef.current = -1;
    pollRequestIdRef.current = 0;
    fullRequestIdRef.current = 0;
    pollInFlightRef.current = false;
    fullInFlightRef.current = false;
    pendingGapSyncRef.current = false;
    lastNationOwnersRef.current = "";
    exitModes();
    setSelectedCellInfo(null);
  }, [id]);

  useEffect(() => {
    applyDeltaGameStateRef.current = applyDeltaGameState;
  }, [applyDeltaGameState]);

  useEffect(() => {
    if (!id || !userId || hasJoined || authLoading) return;
    let isActive = true;
    const checkAccess = async () => {
      try {
        const response = await apiFetch(`api/gamerooms/${id}/state`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!isActive) return;
        if (response.ok) {
          const data = await response.json();
          applyDeltaGameStateRef.current?.(data, { isFullState: true });
          setHasJoined(true);
          return;
        }
        if (response.status === 404) {
          navigate("/rooms");
        }
      } catch (err) {
        console.warn("Failed to check join status:", err);
      }
    };
    checkAccess();
    return () => {
      isActive = false;
    };
  }, [id, userId, hasJoined, authLoading, navigate]);

  // ----------------------------
  // Fetch metadata on mount
  // ----------------------------
  useEffect(() => {
    if (id) {
      fetchMapMetadata();
    }
  }, [id]);

  // ----------------------------
  // Fetch region data after metadata loads
  // ----------------------------
  useEffect(() => {
    if (!id || !mapMetadata) return;
    const fetchRegions = async () => {
      try {
        const response = await apiFetch(`api/gamerooms/${id}/regions`);
        if (!response.ok) return; // Regions may not exist for older maps
        const data = await response.json();
        // Decode base64 assignmentBuffer into Uint16Array
        const binaryStr = atob(data.assignmentBuffer);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        const assignment = new Uint16Array(bytes.buffer);
        setRegionData({
          seeds: data.seeds,
          assignment,
          width: data.width,
          height: data.height,
          regionCount: data.regionCount,
        });
      } catch (err) {
        console.warn("Failed to load region data:", err);
      }
    };
    fetchRegions();
  }, [id, mapMetadata]);

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
    if (!id || !userId || !hasJoined) return;
    let isActive = true;

    const wsUrl = getWsUrl(isDiscord ? getDiscordToken() : undefined);

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
  }, [id, userId, hasJoined]);

  // ----------------------------
  // Poll game state (every 200ms)
  // ----------------------------
  // In your useEffect that polls game state:
  useEffect(() => {
    if (!userId || !hasJoined) return;

    const fetchGameState = async () => {
      if (
        wsConnected &&
        Date.now() - lastWsUpdateAtRef.current < 1000
      ) {
        return;
      }
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      const requestId = ++pollRequestIdRef.current;
      try {
        const response = await apiFetch(`api/gamerooms/${id}/state`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });

        if (!response.ok) {
          if (response.status === 403) {
            setHasJoined(false);
            return;
          }
          navigate("/rooms");
          return;
        }

        const data = await response.json();
        if (requestId !== pollRequestIdRef.current) {
          return;
        }

        applyDeltaGameState(data);
      } catch (err) {
        console.error("Error fetching game state:", err);
      } finally {
        pollInFlightRef.current = false;
      }
    };

    fetchGameState();
    const intervalMs = wsConnected ? 2000 : 250;
    const interval = setInterval(fetchGameState, intervalMs);
    return () => clearInterval(interval);
  }, [id, userId, hasJoined, navigate, wsConnected]);

  // Full state polling effect: every 5 seconds, fetch the full state to overwrite local territory.
  useEffect(() => {
    if (!userId || !hasJoined) return;

    const fetchFullState = async () => {
      if (fullInFlightRef.current) return;
      fullInFlightRef.current = true;
      const requestId = ++fullRequestIdRef.current;

      // If an action modal is active (win/defeat popup), skip full state update.
      if (actionModal) {
        fullInFlightRef.current = false;
        pendingGapSyncRef.current = false;
        return;
      }

      try {
        const response = await apiFetch(`api/gamerooms/${id}/state`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            full: "true",
          }),
        });
        if (!response.ok) {
          if (response.status === 403) {
            setHasJoined(false);
            return;
          }
          navigate("/rooms");
          return;
        }
        const data = await response.json();
        if (requestId !== fullRequestIdRef.current) {
          return;
        }
        applyDeltaGameState(data, { isFullState: true });
      } catch (err) {
        console.error("Error fetching full game state:", err);
      } finally {
        if (requestId === fullRequestIdRef.current) {
          pendingGapSyncRef.current = false;
        }
        fullInFlightRef.current = false;
      }
    };

    requestFullStateRef.current = fetchFullState;

    // Immediately fetch full state on mounting
    fetchFullState();
    // Then set interval for rectification every 5 seconds
    const fullIntervalMs = wsConnected ? 15000 : 1000;
    const interval = setInterval(fetchFullState, fullIntervalMs);
    return () => {
      clearInterval(interval);
      if (requestFullStateRef.current === fetchFullState) {
        requestFullStateRef.current = null;
      }
    };
  }, [id, userId, hasJoined, navigate, actionModal, wsConnected]);

  // ----------------------------
  // Handle join form submission
  // ----------------------------
  const handleJoinSubmit = async (e) => {
    e?.preventDefault();
    if (!user) {
      loginWithGoogle(`/rooms/${id}`);
      return;
    }
    setJoinError("");
    if (!joinCode) {
      setJoinError("Join code is required");
      return;
    }
    try {
      setIsJoining(true);
      const response = await apiFetch(`api/gamerooms/${id}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          joinCode: joinCode,
        }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to join game room");
      }
      await response.json();
      localStorage.setItem(`${roomKey}-joinCode`, joinCode);
      setHasJoined(true);

      // Immediately fetch the full state so the new player gets all territories.
      try {
        const fullResp = await apiFetch(`api/gamerooms/${id}/state`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ full: "true" }),
        });
        if (fullResp.ok) {
          const fullData = await fullResp.json();
          applyDeltaGameState(fullData, { isFullState: true });
        }
      } catch (err) {
        console.error("Error fetching full state on join:", err);
      }
    } catch (err) {
      console.error("Join error:", err);
      setJoinError(err.message);
    } finally {
      setIsJoining(false);
    }
  };

  // ----------------------------
  // API call wrappers for game actions
  // ----------------------------
  const handleFoundNation = async (x, y) => {
    if (!userId || !hasJoined) return;

    try {
      const response = await apiFetch(`api/gamerooms/${id}/foundNation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x, y }),
      });

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
      setUiMode("idle");
    } catch (err) {
      setError(err.message);
      setFoundingNation(false);
      setUiMode("idle");
    }
  };

  const handleCancelBuild = () => {
    setBuildingStructure(null);
    if (uiMode === "buildStructure") {
      setUiMode("idle");
    }
  };

  const handleBuildCity = async (x, y, cityType, cityName) => {
    // If x and y are null, it means we're just selecting what to build
    if (x === null && y === null) {
      if (!isRoomStarted) return;
      setBuildingStructure(cityType);
      setUiMode("buildStructure");
      return;
    }

    // Otherwise, we're actually building at the selected location
    if (!userId || !hasJoined) return;
    if (!isRoomStarted) return;

    try {
      const response = await apiFetch(`api/gamerooms/${id}/buildCity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          x,
          y,
          cityType,
          cityName,
        }),
      });
      if (!response.ok) throw new Error("Failed to build city");
      // Clear building mode after successful build
      setBuildingStructure(null);
      setUiMode("idle");
    } catch (err) {
      setError(err.message);
      // Also clear building mode on error
      setBuildingStructure(null);
      setUiMode("idle");
    }
  };


  const handlePauseGame = async () => {
    try {
      const response = await apiFetch(`api/gamerooms/${id}/pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
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
      const response = await apiFetch(`api/gamerooms/${id}/unpause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
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
      const response = await apiFetch(`api/gamerooms/${id}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
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
      const response = await apiFetch(`api/gamerooms/${id}/quit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error("Failed to quit game");
      }
      setHasJoined(false);
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

  // ----------------------------
  // Big Arrow handlers
  // ----------------------------
  const handleStartDrawArrow = (type) => {
    if (!isRoomStarted) return;
    // Clear any existing drawing state
    setCurrentArrowPath([]);
    enterDrawMode(type);
  };

  const handleCancelArrow = () => {
    setDrawingArrowType(null);
    setCurrentArrowPath([]);
    if (uiMode === "drawAttack" || uiMode === "drawDefend") {
      setUiMode("idle");
    }
  };

  const handleArrowPathUpdate = (path) => {
    setCurrentArrowPath(path);
  };

  const handleSendArrow = async (type, path) => {
    if (!userId || !hasJoined) return;
    if (!isRoomStarted) return;
    if (!path || path.length < 2) return;

    const playerNation = gameState?.gameState?.nations?.find(
      (n) => n.owner === userId
    );
    const population = playerNation?.population || 0;
    const initialPower = population * attackPercent;

    try {
      const response = await apiFetch(`api/gamerooms/${id}/arrow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          path,
          percent: attackPercent,
        }),
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to send arrow command");
      }

      const result = await response.json();

      if (type === "attack") {
        setActiveAttackArrows((prev) => [
          ...prev,
          {
            id: result.arrowId,
            path,
            percent: attackPercent,
            troopCommitment: attackPercent,
            remainingPower: 0,
            initialPower: 0,
            effectiveDensityAtFront: 0,
            currentIndex: 1,
            status: "advancing",
            frontWidth: 0,
            opposingForces: [],
            headX: path[0].x,
            headY: path[0].y,
          },
        ]);
      } else if (type === "defend") {
        setActiveDefendArrow({
          path,
          percent: attackPercent,
          troopCommitment: attackPercent,
          remainingPower: 0,
          effectiveDensityAtFront: 0,
          currentIndex: 0,
        });
      }

      setDrawingArrowType(null);
      setCurrentArrowPath([]);
      setUiMode("idle");
    } catch (err) {
      // Clear drawing state so the red line goes away
      setDrawingArrowType(null);
      setCurrentArrowPath([]);
      setUiMode("idle");
      console.warn("[ARROW] Error:", err.message);
    }
  };

  const handleClearActiveArrow = async (type, arrowId) => {
    if (!userId || !hasJoined) return;

    try {
      await apiFetch(`api/gamerooms/${id}/clearArrow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          arrowId,
        }),
      });

      if (type === "attack") {
        if (arrowId) {
          setActiveAttackArrows((prev) => prev.filter((a) => a.id !== arrowId));
        } else {
          setActiveAttackArrows([]);
        }
      } else if (type === "defend") {
        setActiveDefendArrow(null);
      }
    } catch (err) {
      console.error("Failed to clear arrow:", err);
    }
  };

  const handleReinforceArrow = async (arrowId, percent = 0.1) => {
    if (!userId || !hasJoined) return;
    try {
      await apiFetch(`api/gamerooms/${id}/reinforceArrow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          arrowId,
          percent,
        }),
      });
    } catch (err) {
      console.error("Failed to reinforce arrow:", err);
    }
  };

  const handleRetreatArrow = async (arrowId) => {
    if (!userId || !hasJoined) return;
    try {
      await apiFetch(`api/gamerooms/${id}/retreatArrow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          arrowId,
        }),
      });
    } catch (err) {
      console.error("Failed to retreat arrow:", err);
    }
  };

  const handleSetTroopTarget = async (newTarget) => {
    if (!isRoomStarted) return;
    setTroopTarget(newTarget);
    if (!userId || !hasJoined) return;
    try {
      await apiFetch(`api/gamerooms/${id}/troopTarget`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          troopTarget: newTarget,
        }),
      });
    } catch (err) {
      console.error("Failed to set troop target:", err);
    }
  };

  const handleStartRoom = async () => {
    if (!isRoomCreator || !isRoomLobby || isStartingRoom) return;
    try {
      setIsStartingRoom(true);
      const response = await apiFetch(`api/gamerooms/${id}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to start room");
      }
      setGameState((prev) =>
        prev
          ? {
              ...prev,
              roomStatus: "open",
            }
          : prev
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setIsStartingRoom(false);
    }
  };

  // Track arrow state from server and detect completions
  useEffect(() => {
    const playerNation = gameState?.gameState?.nations?.find(
      (n) => n.owner === userId && n.status !== "defeated"
    );
    const serverArrows = playerNation?.arrowOrders || {};
    const tickCount = Number(gameState?.tickCount);
    const tickRateMs = config?.territorial?.tickRateMs || 100;
    const minArrowDurationMs = config?.territorial?.minArrowDurationMs ?? 10000;
    const maxArrowDurationMs = config?.territorial?.maxArrowDurationMs ?? 120000;
    const arrowDurationPerPowerMs = config?.territorial?.arrowDurationPerPowerMs ?? 25;
    const arrowMaxStallTicks = config?.territorial?.arrowMaxStallTicks ?? 6;

    const isValidArrowPath = (path) =>
      Array.isArray(path) &&
      path.length >= 2 &&
      path.every(
        (point) =>
          point &&
          Number.isFinite(point.x) &&
          Number.isFinite(point.y)
      );

    const isStaleArrow = (arrow) => {
      if (!arrow) return true;
      if (!isValidArrowPath(arrow.path)) return true;

      // Density mode: arrows use troopCommitment instead of remainingPower
      const isDensityArrow = arrow.troopCommitment != null && arrow.troopCommitment > 0;

      if (!isDensityArrow) {
        // Legacy power-budget mode
        const remaining = Number(arrow.remainingPower ?? 0);
        if (!Number.isFinite(remaining) || remaining <= 0) return true;
        if (arrow.status === "retreating" && remaining <= 1) return true;
      }

      if (
        Number.isFinite(arrow.currentIndex) &&
        arrow.currentIndex >= arrow.path.length
      ) {
        return true;
      }
      if (Number.isFinite(arrow.stalledTicks) && Number.isFinite(arrowMaxStallTicks)) {
        if (isDensityArrow) {
          const densityStallLimit = Math.max(20, arrowMaxStallTicks * 4);
          if (arrow.stalledTicks >= densityStallLimit) return true;
        } else {
          if (arrow.stalledTicks >= arrowMaxStallTicks) return true;
        }
      }
      // Density arrows with no troops at front get removed quickly
      if (isDensityArrow && Number.isFinite(arrow.emptyFrontTicks) && arrow.emptyFrontTicks >= 10) {
        return true;
      }

      if (!isDensityArrow) {
        const remaining = Number(arrow.remainingPower ?? 0);
        let initialPower = Number(arrow.initialPower ?? remaining ?? 0);
        if (!Number.isFinite(initialPower)) initialPower = 0;
        const scaledDuration =
          minArrowDurationMs + initialPower * arrowDurationPerPowerMs;
        const maxDurationMs = Math.max(
          minArrowDurationMs,
          Math.min(maxArrowDurationMs, scaledDuration)
        );
        if (Number.isFinite(arrow.createdAtTick) && Number.isFinite(tickCount)) {
          const ageMs = (tickCount - arrow.createdAtTick) * tickRateMs;
          if (ageMs > maxDurationMs + tickRateMs * 2) return true;
        } else if (arrow.createdAt) {
          const rawAge =
            Date.now() - new Date(arrow.createdAt).getTime();
          if (Number.isFinite(rawAge) && rawAge > maxDurationMs + 2000) {
            return true;
          }
        }
      }
      return false;
    };

    // Handle legacy single attack -> attacks[] migration on client
    let serverAttacks = serverArrows.attacks || [];
    if (serverArrows.attack && !serverArrows.attacks) {
      serverAttacks = [serverArrows.attack];
    }

    // H1 diagnostic: log what client receives from server
    const prevAttacks = prevArrowsRef.current?.attacks || [];
    if (serverAttacks.length > 0 || prevAttacks.length > 0) {
      console.log(`[H1-CLIENT] server arrows: ${serverAttacks.length} (ids: ${serverAttacks.map(a => a.id?.slice(-6)).join(',')}) prev: ${prevAttacks.length}`);
    }

    // Always sync client arrows to match server state, with stale cleanup
    const filteredAttacks = Array.isArray(serverAttacks)
      ? serverAttacks.filter((arrow) => !isStaleArrow(arrow))
      : [];
    setActiveAttackArrows(filteredAttacks);

    if (serverArrows.defend && isValidArrowPath(serverArrows.defend.path)) {
      const defendArrow = serverArrows.defend;
      setActiveDefendArrow(isStaleArrow(defendArrow) ? null : defendArrow);
    } else if (!serverArrows.defend) {
      setActiveDefendArrow(null);
    }

    prevArrowsRef.current = {
      attacks: serverAttacks,
      defend: serverArrows.defend || null,
    };
  }, [gameState, userId, config]);

  const playerNation = gameState?.gameState?.nations?.find(
    (n) => n.owner === userId && n.status !== "defeated"
  );
  const playerResources = playerNation?.resources || {};
  const playerTroopCount = playerNation?.troopCount ?? 0;
  // Cache density map — server throttles to every 5 ticks, use last known between updates
  const lastDensityMapRef = React.useRef(null);
  if (playerNation?.troopDensityMap) {
    lastDensityMapRef.current = playerNation.troopDensityMap;
  }
  const playerTroopDensityMap = lastDensityMapRef.current;

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
  // Stable key that only changes when the nation owner/color list changes
  const nationColorKey = React.useMemo(() => {
    return (gameState?.gameState?.nations || [])
      .filter((n) => n?.owner)
      .sort((a, b) => (a.owner || "").localeCompare(b.owner || ""))
      .map((n) => n.owner + "|" + (n.color || ""))
      .join(",");
  }, [gameState]);

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
    const nations = (gameState?.gameState?.nations || [])
      .filter((n) => n?.owner)
      .sort((a, b) => (a.owner || "").localeCompare(b.owner || ""));
    const colorMap = {};
    let idx = 0;
    nations.forEach((nation) => {
      if (colorMap[nation.owner]) return;
      if (nation.color) {
        colorMap[nation.owner] = nation.color;
        return;
      }
      if (idx < palette.length) {
        colorMap[nation.owner] = palette[idx];
      } else {
        const hue = (idx * 137.508) % 360;
        colorMap[nation.owner] = `hsl(${hue.toFixed(0)}, 75%, 55%)`;
      }
      idx += 1;
    });
    return colorMap;
  }, [nationColorKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable key for nation labels — only recompute when owner/name list changes
  const nationLabelKey = React.useMemo(() => {
    return (gameState?.gameState?.nations || [])
      .filter((n) => n?.owner)
      .map((n) => n.owner + "|" + (n.nationName || n.displayName || ""))
      .join(",");
  }, [gameState]);

  const nationLabels = React.useMemo(() => {
    const labels = {};
    (gameState?.gameState?.nations || []).forEach((nation) => {
      if (nation.owner) {
        labels[nation.owner] =
          nation.nationName || nation.displayName || nation.owner;
      }
    });
    return labels;
  }, [nationLabelKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const getNationColor = (nation) => {
    if (!nation?.owner) return "#999999";
    return nation.color || nationColors[nation.owner] || "#999999";
  };

  const isMapLoaded = mapMetadata && loadedRows >= mapMetadata.height;

  return (
    <div className="relative h-screen overflow-hidden">
      <ControlButtons
        onOpenSettings={() => setShowSettings(true)}
        onOpenPlayerList={() => setShowPlayerList(true)}
        topOffset={discordTopOffset}
      />
      {!isDefeated && (
        <StatsBar
          gameState={gameState}
          userId={userId}
          topOffset={discordTopOffset}
          isMobile={isMobile}
        />
      )}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        gameState={gameState}
        userId={userId}
        profile={profile}
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
      {isRoomLobby && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2">
          <div className="pointer-events-auto rounded-lg border border-emerald-700/50 bg-gray-900/90 px-4 py-3 text-white shadow-lg">
            <div className="text-sm font-semibold">
              Lobby: {readyPlayerCount}/{roomPlayers.length || 0} ready
            </div>
            <div className="text-xs text-gray-300">
              Players pick a founding tile, then the host starts the match.
            </div>
            {isRoomCreator ? (
              <button
                onClick={handleStartRoom}
                disabled={isStartingRoom}
                className="mt-2 w-full rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-900"
              >
                {isStartingRoom ? "Starting..." : "Start Room"}
              </button>
            ) : (
              <div className="mt-2 text-xs text-gray-400">
                Waiting for host to start.
              </div>
            )}
          </div>
        </div>
      )}
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
            config={config}
            foundingNation={foundingNation}
            onFoundNation={handleFoundNation}
            buildingStructure={buildingStructure}
            onBuildCity={handleBuildCity}
            onCancelBuild={handleCancelBuild}
            drawingArrowType={drawingArrowType}
            onStartDrawArrow={handleStartDrawArrow}
            currentArrowPath={currentArrowPath}
            onArrowPathUpdate={handleArrowPathUpdate}
            onSendArrow={handleSendArrow}
            onCancelArrow={handleCancelArrow}
            activeAttackArrows={activeAttackArrows}
            activeDefendArrow={activeDefendArrow}
            uiMode={uiMode}
            isMobile={isMobile}
            onInspectCell={handleInspectCell}
            troopDensityMap={playerTroopDensityMap}
            combatFlashes={combatFlashes}
            setCombatFlashes={setCombatFlashes}
            regionData={regionData}
            isDiscord={isDiscord}
          />
        )}
      </div>
      {!isMobile && (
        <ActionBar
          onFoundNation={startFoundNation}
          userState={userState}
          hasFounded={hasFounded}
          isSpectating={isSpectating}
          allowRefound={allowRefound}
          attackPercent={attackPercent}
          setAttackPercent={setAttackPercent}
          troopTarget={troopTarget}
          onSetTroopTarget={handleSetTroopTarget}
          troopCount={playerTroopCount}
          drawingArrowType={drawingArrowType}
          onStartDrawArrow={handleStartDrawArrow}
          onCancelArrow={handleCancelArrow}
          activeAttackArrows={activeAttackArrows}
          activeDefendArrow={activeDefendArrow}
          maxAttackArrows={config?.territorial?.maxAttackArrows ?? 3}
          onBuildStructure={handleBuildStructure}
          playerResources={playerResources}
          buildCosts={config?.buildCosts?.structures}
          uiMode={uiMode}
          onSetMode={setMode}
          onExitMode={exitModes}
          arrowCosts={config?.arrowCosts}
          gameState={gameState}
          isRoomStarted={isRoomStarted}
          canStartRoom={isRoomCreator && isRoomLobby}
          onStartRoom={handleStartRoom}
          isStartingRoom={isStartingRoom}
          readyPlayerCount={readyPlayerCount}
          totalPlayers={roomPlayers.length}
        />
      )}
      {isMobile && (
        <MobileActionDock
          onFoundNation={startFoundNation}
          hasFounded={hasFounded}
          isSpectating={isSpectating}
          allowRefound={allowRefound}
          attackPercent={attackPercent}
          setAttackPercent={setAttackPercent}
          uiMode={uiMode}
          onSetMode={setMode}
          onBuildStructure={handleBuildStructure}
          playerResources={playerResources}
          buildCosts={config?.buildCosts?.structures}
          activeAttackArrows={activeAttackArrows}
          activeDefendArrow={activeDefendArrow}
          isRoomStarted={isRoomStarted}
          canStartRoom={isRoomCreator && isRoomLobby}
          onStartRoom={handleStartRoom}
          isStartingRoom={isStartingRoom}
          readyPlayerCount={readyPlayerCount}
          totalPlayers={roomPlayers.length}
          bottomOffset={discordBottomOffset}
        />
      )}
      <ContextPanel
        isMobile={isMobile}
        cellInfo={selectedCellInfo}
        onClose={() => setSelectedCellInfo(null)}
        nationColors={nationColors}
        nationLabels={nationLabels}
      />
      <ArrowPanel
        activeAttackArrows={activeAttackArrows}
        activeDefendArrow={activeDefendArrow}
        onReinforceArrow={handleReinforceArrow}
        onRetreatArrow={handleRetreatArrow}
        onClearArrow={handleClearActiveArrow}
        isMobile={isMobile}
        topOffset={arrowPanelTopOffset}
        bottomOffset={arrowPanelBottomOffset}
      />
      {/* The join/login modal now appears only if the map is loaded */}
      <Modal
        showLoginModal={isMapLoaded && !authLoading && (!userId || !hasJoined)}
        onJoinSubmit={handleJoinSubmit}
        onLogin={() => loginWithGoogle(`/rooms/${id}`)}
        isAuthenticated={!!userId}
        joinCode={joinCode}
        setJoinCode={setJoinCode}
        joinError={joinError}
        isJoining={isJoining}
        profile={profile}
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
