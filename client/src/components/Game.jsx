import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import GameCanvas from "./GameCanvas";
import LeftPanel from "./LeftPanel";
import Modal from "./Modal";
import { ErrorMessage, LoadingSpinner } from "./ErrorHandling";

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
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [actionModal, setActionModal] = useState(null);

  // ----------------------------
  // API call helpers
  // ----------------------------
  const fetchMapMetadata = async () => {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/gamerooms/${id}/metadata`
      );
      if (!response.ok) throw new Error("Failed to fetch map metadata");
      const data = await response.json();
      setMapMetadata(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const CHUNK_SIZE = 10;
  const fetchMapChunk = async (startRow) => {
    try {
      const endRow = startRow + CHUNK_SIZE;
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/gamerooms/${id}/data?startRow=${startRow}&endRow=${endRow}`
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
      setLoading(true);
      try {
        const nextChunk = await fetchMapChunk(loadedRows);
        if (nextChunk && nextChunk.chunk && nextChunk.chunk.length > 0) {
          setMapChunks((prev) => [...prev, nextChunk.chunk]);
          setLoadedRows(nextChunk.endRow);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    loadNextChunk();
  }, [mapMetadata, loadedRows, error]);

  // ----------------------------
  // Poll game state (every 200ms)
  // ----------------------------
  useEffect(() => {
    if (!userId || !storedPassword) return;
    const fetchGameState = async () => {
      try {
        const response = await fetch(
          `${process.env.REACT_APP_API_URL}/api/gamerooms/${id}/state`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, password: storedPassword }),
          }
        );
        if (!response.ok) {
          navigate("/rooms");
        }
        const data = await response.json();
        setGameState(data);
      } catch (err) {
        console.error("Error fetching game state:", err);
      }
    };
    fetchGameState();
    const interval = setInterval(fetchGameState, 200);
    return () => clearInterval(interval);
  }, [id, userId, storedPassword]);

  // ----------------------------
  // Poll user state
  // ----------------------------
  useEffect(() => {
    if (!userId) return;
    const fetchUserState = async () => {
      try {
        const response = await fetch(
          `${process.env.REACT_APP_API_URL}/api/gamerooms/${id}/user/${userId}`
        );
        if (!response.ok) throw new Error("Failed to fetch user state");
        const data = await response.json();
        setUserState(data);
      } catch (err) {
        console.error("Error fetching user state:", err);
      }
    };
    fetchUserState();
  }, [id, userId]);

  // ----------------------------
  // Handle login form submission
  // ----------------------------
  const handleLoginSubmit = async (e) => {
    e?.preventDefault();
    setLoginError("");
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/gamerooms/${id}/join`,
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
        `${process.env.REACT_APP_API_URL}/api/gamerooms/${id}/foundNation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, password: storedPassword, x, y }),
        }
      );
      if (!response.ok) throw new Error("Failed to found nation");
      const data = await response.json();
      console.log("Nation founded:", data);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleBuildCity = async (x, y, cityName) => {
    const password = storedPassword || loginPassword;
    if (!userId || !password) return;
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/gamerooms/${id}/buildCity`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            password,
            x,
            y,
            cityType: "city",
            cityName,
          }),
        }
      );
      if (!response.ok) throw new Error("Failed to build city");
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAttack = async (x, y) => {
    if (!userId || !storedPassword) return;
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/gamerooms/${id}/attack`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, password: storedPassword, x, y }),
        }
      );
      if (!response.ok) throw new Error("Failed to perform attack");
      const data = await response.json();
      console.log("Attack result:", data);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSetExpandTarget = async (x, y) => {
    if (!userId || !storedPassword) return;
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/gamerooms/${id}/setExpandTarget`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, password: storedPassword, x, y }),
        }
      );
      if (!response.ok) throw new Error("Failed to set expand target");
      const data = await response.json();
      console.log("Expand target set:", data);
    } catch (err) {
      setError(err.message);
    }
  };

  const handlePauseGame = async () => {
    try {
      // Assuming you have implemented a pause endpoint on the backend
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/gamerooms/${id}/pause`,
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
      // Optionally, update local state to reflect the paused status
    } catch (err) {
      console.error("Error pausing game:", err);
    }
  };

  const handleUnPauseGame = async () => {
    try {
      // Assuming you have implemented a pause endpoint on the backend
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/gamerooms/${id}/unpause`,
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
      // Optionally, update local state to reflect the paused status
    } catch (err) {
      console.error("Error pausing game:", err);
    }
  };

  // New end game handler
  const handleEndGame = async () => {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/gamerooms/${id}/end`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The endpoint expects creator credentials so we send them here
          body: JSON.stringify({ userName: userId, password: storedPassword }),
        }
      );
      if (!response.ok) {
        throw new Error("Failed to end game");
      }
      const data = await response.json();
      console.log("Game ended:", data);
      // For example, you might navigate away or display a "game ended" message:
      // navigate("/game-over");
    } catch (err) {
      console.error("Error ending game:", err);
    }
  };

  // ----------------------------
  // Create a flat grid from the loaded map chunks.
  // ----------------------------
  const mapGrid = React.useMemo(() => {
    const grid = [];
    let currentY = 0;
    mapChunks.forEach((chunk) => {
      if (Array.isArray(chunk)) {
        chunk.forEach((row) => {
          row.forEach((cell, x) => {
            grid.push({ cell, x, y: currentY });
          });
          currentY++;
        });
      }
    });
    return grid;
  }, [mapChunks]);

  // ----------------------------
  // Helper for determining player (nation) colors.
  // ----------------------------
  const getNationColor = (nation) => {
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
    ];
    if (nation.owner === userId) return "#FFFF00";
    const index = gameState?.gameState?.nations?.findIndex(
      (n) => n.owner === nation.owner
    );
    return palette[index % palette.length];
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-4 text-sm">
        {gameState && (
          <>
            <p className="text-gray-700">Playing as: {userId}</p>
            <p className="text-gray-700">{gameState.roomName}</p>
            <p className="text-gray-700 w-40 text-right">
              Tick: {gameState.tickCount}
            </p>
          </>
        )}
      </div>
      <div className="flex justify-end items-center mb-4 text-sm">
        {gameState && gameState?.roomCreator === userId && (
          <div className="flex space-x-2">
            {paused ? (
              <button
                onClick={handleUnPauseGame}
                className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded"
              >
                Unpause
              </button>
            ) : (
              <button
                onClick={handlePauseGame}
                className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded"
              >
                Pause
              </button>
            )}
            <button
              onClick={handleEndGame}
              className="bg-red-600 hover:bg-red-800 text-white px-4 py-2 rounded"
            >
              End
            </button>
          </div>
        )}
      </div>

      {error && (
        <ErrorMessage
          message={error}
          onRetry={() => window.location.reload()}
        />
      )}

      {/* Main content area with three columns */}
      <div className="flex gap-6">
        {/* Left Panel */}
        <LeftPanel
          gameState={gameState}
          userId={userId}
          getNationColor={getNationColor}
          contextMenu={contextMenu}
          setContextMenu={setContextMenu}
          onFoundNation={handleFoundNation}
          setActionModal={setActionModal}
        />

        {/* Center: Game Canvas */}
        <div className="flex-1 relative">
          {!mapChunks.length && loading ? (
            <LoadingSpinner />
          ) : (
            <GameCanvas
              mapMetadata={mapMetadata}
              mapGrid={mapGrid}
              mappings={mappings}
              gameState={gameState}
              userId={userId}
              selectedRegion={selectedRegion}
              setSelectedRegion={setSelectedRegion}
              contextMenu={contextMenu}
              setContextMenu={setContextMenu}
            />
          )}
        </div>

        {/* Right Panel: Selected Region details */}
        <div className="w-64">
          {selectedRegion && (
            <div className="bg-white p-4 rounded-lg shadow-lg">
              <h2 className="text-lg font-semibold mb-2">Selected Region</h2>
              <div className="space-y-1 text-sm">
                <p>
                  Position: ({selectedRegion.x}, {selectedRegion.y})
                </p>
                <p>Biome: {selectedRegion.biome}</p>
                <p>Elevation: {selectedRegion.elevation.toFixed(2)}</p>
                <p>Temperature: {selectedRegion.temperature.toFixed(1)}°C</p>
                {selectedRegion.resources &&
                  selectedRegion.resources.length > 0 && (
                    <div>
                      <p className="font-medium">Resources:</p>
                      <ul className="list-disc pl-4">
                        {selectedRegion.resources.map((resource) => (
                          <li key={resource}>{resource}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                {selectedRegion.features &&
                  selectedRegion.features.length > 0 && (
                    <div>
                      <p className="font-medium">Features:</p>
                      <ul className="list-disc pl-4">
                        {selectedRegion.features.map((feature) => (
                          <li key={feature}>{feature}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                {selectedRegion.extraInfo && (
                  <div className="mt-2 p-2 border-t">
                    <h3 className="font-semibold">Player Info</h3>
                    <p>Name: {selectedRegion.extraInfo.owner}</p>
                    <p>
                      Territory: {selectedRegion.extraInfo.territoryCount} tiles
                    </p>
                    <p>
                      Cities: {selectedRegion.extraInfo.cities?.length || 0}
                    </p>
                    <p>Population: {selectedRegion.extraInfo.population}</p>
                  </div>
                )}
                {selectedRegion.cityInfo && (
                  <div className="mt-2 p-2 border-t">
                    <h3 className="font-semibold">
                      City: {selectedRegion.cityInfo.name}
                    </h3>
                    <p>Population: {selectedRegion.cityInfo.population}</p>
                    <p>Type: {selectedRegion.cityInfo.type}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal for login or action */}
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
        onBuildCity={handleBuildCity}
        onAttack={handleAttack}
        onSetExpandTarget={handleSetExpandTarget}
      />
    </div>
  );
};

export default Game;
