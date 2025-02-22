import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import GameCanvas from "./GameCanvas";
import { LoadingSpinner } from "./ErrorHandling";
import { ControlButtons } from "./ControlButtons";
import StatsBar from "./StatsBar";
import SettingsModal from "./SettingsModal";
import PlayerListModal from "./PlayerListModal";
import ActionBar from "./ActionBar";
import Modal from "./Modal";

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

  const isFetchingChunk = useRef(false);

  // ----------------------------
  // Credentials from localStorage (set in Lobby)
  // ----------------------------
  // Use a consistent room key (e.g. "gameRoom-<id>")
  const roomKey = `gameRoom-${id}`;
  const storedUserId =
    localStorage.getItem(`lobby-${id}-userName`) ||
    localStorage.getItem(`lobby-${id}-creator`) ||
    "";
  const storedPassword = localStorage.getItem(`lobby-${id}-password`) || "";

  const joinCode = localStorage.getItem(`lobby-${id}-joinCode`) || "";

  // ----------------------------
  // Modal and cell selection state
  // ----------------------------
  const [showSettings, setShowSettings] = useState(false);
  const [showPlayerList, setShowPlayerList] = useState(false);
  const [actionModal, setActionModal] = useState(null);
  const [foundingNation, setFoundingNation] = useState(false);
  const [buildingStructure, setBuildingStructure] = useState(null);
  const [isDefeated, setIsDefeated] = useState(false);
  const [hasFounded, setHasFounded] = useState(false);

  const startFoundNation = () => {
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

  const mergeTerritory = useCallback((existing, delta) => {
    if (!existing) {
      return { x: delta.add.x.slice(), y: delta.add.y.slice() };
    }
    let newX = existing.x.slice();
    let newY = existing.y.slice();
    for (let i = 0; i < delta.sub.x.length; i++) {
      const subX = delta.sub.x[i];
      const subY = delta.sub.y[i];
      const index = newX.findIndex(
        (val, idx) => val === subX && newY[idx] === subY
      );
      if (index !== -1) {
        newX.splice(index, 1);
        newY.splice(index, 1);
      }
    }
    newX = newX.concat(delta.add.x);
    newY = newY.concat(delta.add.y);
    return { x: newX, y: newY };
  }, []);

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
      if (isFetchingChunk.current) return;
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
  // Poll game state (every 200ms)
  // ----------------------------
  useEffect(() => {
    let pollCount = 0;
    const interval = setInterval(async () => {
      // Every 25 polls (~5000ms) use full polling.
      const full = pollCount % 25 === 0;
      if (full && actionModal) {
        pollCount++;
        return;
      }

      try {
        const requestBody = {
          userId: storedUserId,
          password: storedPassword,
        };
        if (full) {
          requestBody.full = "true";
        }
        const response = await fetch(
          `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/state`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
          }
        );
        if (!response.ok) {
          navigate("/rooms");
          return;
        }
        const data = await response.json();

        // Update game state with territory handling:
        setGameState((prevState) => {
          const previousNations = prevState?.gameState?.nations || [];
          const prevTerritories = previousNations.reduce((acc, nation) => {
            acc[nation.owner] = nation.territory || null;
            return acc;
          }, {});

          if (data.gameState.nations) {
            data.gameState.nations = data.gameState.nations.map((nation) => {
              if (full) {
                // On a full poll, overwrite the local territory completely.
                if (
                  nation.territory &&
                  nation.territory.x &&
                  nation.territory.y
                ) {
                  nation.territory = {
                    x: [...nation.territory.x],
                    y: [...nation.territory.y],
                  };
                } else if (nation.territoryDeltaForClient) {
                  nation.territory = {
                    x: [...nation.territoryDeltaForClient.add.x],
                    y: [...nation.territoryDeltaForClient.add.y],
                  };
                }
              } else if (nation.territoryDeltaForClient) {
                // For incremental updates, merge the delta.
                const previousTerritory = prevTerritories[nation.owner] || null;
                nation.territory = mergeTerritory(
                  previousTerritory,
                  nation.territoryDeltaForClient
                );
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

        // Update user state based on fetched game state.
        const winningNation = data.gameState.nations?.find(
          (n) => n.status === "winner"
        );
        if (winningNation) {
          setActionModal({
            type: "win",
            message: "Your you have won the game.",
            onClose: () => {
              setActionModal(null);
              setFoundingNation(true);
              setHasFounded(false);
              navigate("/");
            },
          });
        } else {
          const playerNation = data.gameState.nations?.find(
            (n) => n.owner === storedUserId && n.status !== "defeated"
          );
          if (playerNation) {
            // If the nation is active, ensure we exit founding mode.
            if (playerNation.status === "active") {
              setFoundingNation(false);
            }
            setUserState(playerNation);
            setIsDefeated(false);
            setHasFounded(true);
          } else {
            if (!isDefeated && hasFounded) {
              const defeatedNation = data.gameState.nations?.find(
                (n) => n.owner === storedUserId && n.status === "defeated"
              );
              if (defeatedNation) {
                setIsDefeated(true);
                setActionModal({
                  type: "defeat",
                  message:
                    "Your nation has been defeated! You can start over by founding a new nation.",
                  onClose: () => {
                    setActionModal(null);
                    setFoundingNation(true);
                    setHasFounded(false);
                  },
                });
              }
              setUserState(null);
            }
          }
        }
      } catch (err) {
        console.error("Error fetching game state:", err);
      }
      pollCount++;
    }, 200);

    return () => clearInterval(interval);
  }, [
    id,
    storedUserId,
    storedPassword,
    navigate,
    actionModal,
    isDefeated,
    hasFounded,
    // mergeTerritory is stable because it’s memoized via useCallback
  ]);

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
  // Handler for setting army attack target.
  // ----------------------------
  const handleSetArmyAttackTarget = async (armyId, x, y) => {
    if (!storedUserId || !storedPassword) return;
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/setAttackTarget`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: storedUserId,
            password: storedPassword,
            armyId,
            target: { x, y },
          }),
        }
      );
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to set attack target");
      }
    } catch (err) {
      setError(err.message);
    }
  };

  // ----------------------------
  // Handler for founding a nation.
  // ----------------------------
  const handleFoundNation = async (x, y) => {
    if (!storedUserId || !storedPassword) return;
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/foundNation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: storedUserId,
            password: storedPassword,
            x,
            y,
          }),
        }
      );
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to found nation");
      }
      setFoundingNation(false);
      setIsDefeated(false);
      setActionModal(null);
      setHasFounded(true);
    } catch (err) {
      setError(err.message);
      setFoundingNation(false);
    }
  };

  // ----------------------------
  // Handler for canceling a build.
  // ----------------------------
  const handleCancelBuild = () => {
    setBuildingStructure(null);
  };

  // ----------------------------
  // Handler for building a city.
  // ----------------------------
  const handleBuildCity = async (x, y, cityType, cityName) => {
    if (x === null && y === null) {
      setBuildingStructure(cityType);
      return;
    }
    if (!storedUserId || !storedPassword) return;
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/buildCity`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: storedUserId,
            password: storedPassword,
            x,
            y,
            cityType,
            cityName,
          }),
        }
      );
      if (!response.ok) throw new Error("Failed to build city");
      setBuildingStructure(null);
    } catch (err) {
      setError(err.message);
      setBuildingStructure(null);
    }
  };

  // ----------------------------
  // Handler for raising an army.
  // ----------------------------
  const handleRaiseArmy = async (type) => {
    if (!storedUserId || !storedPassword) return;
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/raiseArmy`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: storedUserId,
            password: storedPassword,
            type,
          }),
        }
      );
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to raise army");
      }
      const data = await response.json();
      console.log("Army raised:", data);
    } catch (err) {
      setError(err.message);
    }
  };

  // ----------------------------
  // Handler for pausing the game.
  // ----------------------------
  const handlePauseGame = async () => {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/pause`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: storedUserId,
            password: storedPassword,
          }),
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

  // ----------------------------
  // Handler for unpausing the game.
  // ----------------------------
  const handleUnPauseGame = async () => {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/unpause`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: storedUserId,
            password: storedPassword,
          }),
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

  // ----------------------------
  // Handler for ending the game.
  // ----------------------------
  const handleEndGame = async () => {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/end`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userName: storedUserId,
            password: storedPassword,
          }),
        }
      );
      if (!response.ok) {
        throw new Error("Failed to end game");
      }
      const data = await response.json();
      console.log("Game ended:", data);
      setShowSettings(false);
    } catch (err) {
      console.error("Error ending game:", err);
    }
  };

  // ----------------------------
  // Handler for quitting the game.
  // ----------------------------
  const handleQuitGame = async () => {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/quit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: storedUserId,
            password: storedPassword,
          }),
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
      console.error("Error quitting game:", err);
    }
  };

  // ----------------------------
  // Helper for determining player (nation) colors.
  // ----------------------------
  const getNationColor = (nation) => {
    const palette = [
      "#ff0008",
      "#ff0084",
      "#ff00f7",
      "#a200ff",
      "#d4ff00",
      "#ffc400",
      "#ff6200",
    ];
    if (nation.owner === storedUserId) return "#0000ff";
    const index = gameState?.gameState?.nations?.findIndex(
      (n) => n.owner === nation.owner
    );
    return palette[index % palette.length];
  };

  const isMapLoaded = mapMetadata && loadedRows >= mapMetadata.height;

  // If credentials are missing, show a fallback message.
  if (!storedUserId || !storedPassword) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-800 text-white p-4">
        <p>
          Missing credentials. Please return to the lobby and join the game
          properly.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-screen overflow-hidden top-0 left-0 right-0">
      {!isMapLoaded || !gameState ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-800 p4">
          <LoadingSpinner />
          {mapMetadata && mapMetadata.height ? (
            <div className="text-white mt-4">
              Loading map...{" "}
              {Math.min(
                ((loadedRows / mapMetadata.height) * 100).toFixed(0),
                100
              )}
              %
            </div>
          ) : (
            <div className="text-white mt-4">Initializing game...</div>
          )}
        </div>
      ) : (
        <>
          <div className="absolute top-0 left-0 right-0 z-50">
            {" "}
            {/* New wrapper for top controls */}
            <div className="flex items-start justify-between">
              {!isDefeated && (
                <StatsBar gameState={gameState} userId={storedUserId} />
              )}
              <ControlButtons
                onOpenSettings={() => setShowSettings(true)}
                onOpenPlayerList={() => setShowPlayerList(true)}
              />
            </div>
          </div>

          <div className="absolute inset-0">
            <GameCanvas
              mapMetadata={mapMetadata}
              mapGrid={mapGrid}
              mappings={mappings}
              gameState={gameState}
              userId={storedUserId}
              onArmyTargetSelect={handleSetArmyAttackTarget}
              foundingNation={foundingNation}
              onFoundNation={handleFoundNation}
              buildingStructure={buildingStructure}
              onBuildCity={handleBuildCity}
              onCancelBuild={handleCancelBuild}
            />
          </div>
          <ActionBar
            onBuildCity={handleBuildCity}
            onRaiseArmy={handleRaiseArmy}
            onFoundNation={startFoundNation}
            config={config}
            userState={userState}
            hasFounded={hasFounded}
          />
          <SettingsModal
            isOpen={showSettings}
            onClose={() => setShowSettings(false)}
            gameState={gameState}
            userId={storedUserId}
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
          {actionModal && (
            <Modal
              actionModal={actionModal}
              setActionModal={setActionModal}
              onClose={() => setActionModal(null)}
            />
          )}
        </>
      )}
    </div>
  );
};

export default Game;
