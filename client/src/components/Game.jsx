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

  const isFetchingChunk = useRef(false);

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

  const mergeTerritory = (existing, delta) => {
    // If there’s no existing territory, then the new territory is just the additions.
    if (!existing) {
      return { x: delta.add.x.slice(), y: delta.add.y.slice() };
    }
    // Clone the existing arrays
    let newX = existing.x.slice();
    let newY = existing.y.slice();

    // Process subtractions: remove each coordinate found in delta.sub
    for (let i = 0; i < delta.sub.x.length; i++) {
      const subX = delta.sub.x[i];
      const subY = delta.sub.y[i];
      // Look for a matching coordinate in newX/newY
      const index = newX.findIndex(
        (val, idx) => val === subX && newY[idx] === subY
      );
      if (index !== -1) {
        newX.splice(index, 1);
        newY.splice(index, 1);
      }
    }

    // Process additions: append them to the territory arrays
    newX = newX.concat(delta.add.x);
    newY = newY.concat(delta.add.y);

    return { x: newX, y: newY };
  };

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
  // Poll game state (every 200ms)
  // ----------------------------
  // In your useEffect that polls game state:
  useEffect(() => {
    if (!userId || !storedPassword) return;

    const fetchGameState = async () => {
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

        // Update territories using your merge function, etc.
        setGameState((prevState) => {
          const previousNations = prevState?.gameState?.nations || [];
          const prevTerritories = previousNations.reduce((acc, nation) => {
            acc[nation.owner] = nation.territory || null;
            return acc;
          }, {});

          if (data.gameState.nations) {
            data.gameState.nations = data.gameState.nations.map((nation) => {
              const previousTerritory = prevTerritories[nation.owner] || null;
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

        // Check for win condition
        const winningNation = data.gameState.nations?.find(
          (n) => n.status === "winner"
        );
        if (winningNation) {
          if (winningNation.owner === userId) {
            // Your nation is the winner!
            if (!actionModal || actionModal.type !== "win") {
              setActionModal({
                type: "win",
                message: "Congratulations! Your nation has won the game!",
                onClose: () => {
                  handleEndGame();
                },
              });
            }
            setUserState(winningNation);
          } else {
            // Another nation won—treat it similar to defeat.
            if (!actionModal || actionModal.type !== "defeat") {
              console.log("Setting defeat modal because someone won");
              setActionModal({
                type: "defeat",
                message: `${winningNation.owner} has won the game. Your nation has been defeated.`,
                onClose: () => {
                  navigate("/");
                },
              });
            } else {
              setUserState(null);
              setFoundingNation(true);
              setHasFounded(false);
            }
          }
        } else {
          // No win condition—proceed with existing logic.
          const playerNation = data.gameState.nations?.find(
            (n) => n.owner === userId && n.status !== "defeated"
          );
          if (playerNation) {
            setUserState(playerNation);
            setIsDefeated(false);
            setHasFounded(true);
          } else {
            console.log(
              "No player nation found, checking for defeat...",
              isDefeated,
              hasFounded
            );
            if (!isDefeated && hasFounded) {
              const defeatedNation = data.gameState.nations?.find(
                (n) => n.owner === userId && n.status === "defeated"
              );
              console.log(userId);
              console.log("Defeated nation:", defeatedNation);
              if (defeatedNation) {
                console.log("Nation is defeated");
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
    };

    fetchGameState();
    const interval = setInterval(fetchGameState, 100);
    return () => clearInterval(interval);
  }, [id, userId, storedPassword, navigate, isDefeated, hasFounded]);

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
          data.gameState.nations = data.gameState.nations.map((nation) => {
            // Remove any delta properties if present.
            if (nation.territoryDeltaForClient) {
              delete nation.territoryDeltaForClient;
            }
            return nation;
          });
        }

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
            console.log(
              "Player nation found:",
              playerNation,
              hasFounded,
              isDefeated
            );
            setUserState(playerNation);
            setIsDefeated(false);
            setHasFounded(true);
          } else {
            console.log(
              "No player nation found, checking for defeat...",
              isDefeated,
              hasFounded
            );
            if (!isDefeated && hasFounded) {
              const defeatedNation = data.gameState.nations?.find(
                (n) => n.owner === userId && n.status === "defeated"
              );
              console.log("Defeated nation:", defeatedNation);
              if (defeatedNation) {
                console.log("Nation is defeated");
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
        console.error("Error fetching full game state:", err);
      }
    };

    // Immediately fetch full state on mounting
    fetchFullState();
    // Then set interval for rectification every 5 seconds
    const interval = setInterval(fetchFullState, 5000);
    return () => clearInterval(interval);
  }, [
    id,
    userId,
    storedPassword,
    navigate,
    actionModal,
    isDefeated,
    hasFounded,
  ]);

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
        throw new Error(errData.error || "Failed to found nation");
      }

      setFoundingNation(false);
      setIsDefeated(false);
      setActionModal(null);
      setHasFounded(true);
      console.log("Nation founded successfully");
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

  const handleRaiseArmy = async (type) => {
    if (!userId || !storedPassword) return;
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/raiseArmy`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, password: storedPassword, type }),
        }
      );
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to raise army");
      }
      const data = await response.json();
      console.log("Army raised:", data);
      // Rely on polling to update gameState
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSetArmyAttackTarget = async (armyId, x, y) => {
    if (!userId || !storedPassword) return;
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/setAttackTarget`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
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
    if (nation.owner === userId) return "#0000ff";
    const index = gameState?.gameState?.nations?.findIndex(
      (n) => n.owner === nation.owner
    );
    return palette[index % palette.length];
  };

  const isMapLoaded = mapMetadata && loadedRows >= mapMetadata.height;

  return (
    <div className="relative h-screen overflow-hidden">
      {!isMapLoaded || !gameState ? (
        // Loading screen that covers game content but not modals
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-800">
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

          {/* Modals - These stay outside the loading condition */}
          <Modal
            showLoginModal={!userId}
            onLoginSubmit={handleLoginSubmit}
            loginName={loginName}
            setLoginName={setLoginName}
            loginPassword={loginPassword}
            setLoginPassword={setLoginPassword}
            joinCode={joinCode}
            setJoinCode={setJoinCode}
            loginError={loginError}
          />
        </div>
      ) : (
        // Main game content
        <>
          <ControlButtons
            onOpenSettings={() => setShowSettings(true)}
            onOpenPlayerList={() => setShowPlayerList(true)}
          />
          {!isDefeated && <StatsBar gameState={gameState} userId={userId} />}

          {/* Main Content Area */}
          <div className="absolute inset-0">
            <GameCanvas
              mapMetadata={mapMetadata}
              mapGrid={mapGrid}
              mappings={mappings}
              gameState={gameState}
              userId={userId}
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
          <Modal
            showLoginModal={!userId}
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
            config={config}
            userState={userState}
          />
        </>
      )}
    </div>
  );
};

export default Game;
