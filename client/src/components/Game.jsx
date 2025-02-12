import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ErrorMessage, LoadingSpinner } from './ErrorHandling';

const CHUNK_SIZE = 10;
const UPDATE_INTERVAL = 1000; // 1 second

const Game = () => {
  // Map and game state
  const [mapMetadata, setMapMetadata] = useState(null);
  const [mapChunks, setMapChunks] = useState([]);
  const [mappings, setMappings] = useState(null);
  const [loadedRows, setLoadedRows] = useState(0);
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [userState, setUserState] = useState(null);

  // Player credentials (for joining the game)
  const [loginName, setLoginName] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [loginError, setLoginError] = useState('');

  const { id } = useParams();
  const roomKey = `gameRoom-${id}-userId`;
  const [userId, setUserId] = useState(localStorage.getItem(`${roomKey}-userId`));
  const [storedPassword, setStoredPassword] = useState(localStorage.getItem(`${roomKey}-password`));
  const navigate = useNavigate();

  // Pan/zoom state
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const canvasRef = useRef(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const offsetStart = useRef({ x: 0, y: 0 });
  const isFetchingChunk = useRef(false);

  // ---------------------------------------------------------------------------
  // Login: When there is no userId, show a login form that calls the join API.
  // ---------------------------------------------------------------------------
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/gamerooms/${id}/join`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userName: loginName,
            password: loginPassword,
            joinCode: joinCode,
          }),
        }
      );
      
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to join game room');
      }
      
      const data = await response.json();
      console.log('Join response:', data); // Debug log
      
      // Store credentials using the userName as userId
      localStorage.setItem(`${roomKey}-userId`, loginName);
      localStorage.setItem(`${roomKey}-password`, loginPassword);
      setUserId(loginName);
      setStoredPassword(loginPassword);
      
      // Debug log the stored values
      console.log('Stored credentials:', {
        userId: loginName,
        password: loginPassword
      });
    } catch (err) {
      console.error('Join error:', err);
      setLoginError(err.message);
    }
  };

  // ---------------------------------------------------------------------------
  // Map metadata and chunk fetching (same as before)
  // ---------------------------------------------------------------------------
  const fetchMapMetadata = async () => {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/gamerooms/${id}/metadata`
      );
      if (!response.ok) throw new Error('Failed to fetch map metadata');
      const data = await response.json();
      setMapMetadata(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const fetchMapChunk = async (startRow) => {
    try {
      const endRow = startRow + CHUNK_SIZE;
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/gamerooms/${id}/data?startRow=${startRow}&endRow=${endRow}`
      );
      if (!response.ok) throw new Error('Failed to fetch map chunk');
      const data = await response.json();
      console.log('Fetched chunk:', data);
      if (data.mappings && !mappings) {
        setMappings(data.mappings);
      }
      return data;
    } catch (err) {
      throw err;
    }
  };

  useEffect(() => {
    if (id) {
      fetchMapMetadata();
    }
  }, [id]);

  useEffect(() => {
    const loadNextChunk = async () => {
      if (
        !mapMetadata ||
        error ||
        loadedRows >= mapMetadata.height ||
        isFetchingChunk.current
      )
        return;

      isFetchingChunk.current = true;
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
        isFetchingChunk.current = false;
      }
    };

    loadNextChunk();
  }, [mapMetadata, loadedRows, error]);

  // ---------------------------------------------------------------------------
  // Define biome colors and helper functions
  // ---------------------------------------------------------------------------
  const biomeColors = useMemo(
    () => ({
      OCEAN: "#1E90FF",
      COASTAL: "#ccc79d",
      MOUNTAIN: "#979e88",
      DESERT: "#e3bf9a",
      SAVANNA: "#a5ba84",
      TROPICAL_FOREST: "#30801f",
      RAINFOREST: "#1b570d",
      TUNDRA: "#616e2d",
      TAIGA: "#406b5f",
      GRASSLAND: "#6a9c5f",
      WOODLAND: "#557a4d",
      FOREST: "#395c31",
      RIVER: "#1E90FF",
    }),
    []
  );

  const getBiomeColor = useCallback(
    (biomeId) => {
      if (!mappings) return "#ccc";
      const biomeName = mappings.biomes[biomeId];
      return biomeColors[biomeName] || "#ccc";
    },
    [mappings, biomeColors]
  );

  // ---------------------------------------------------------------------------
  // Poll game state (now passing in credentials)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!userId || !storedPassword) return;

    const fetchGameState = async () => {
      try {
        const response = await fetch(
          `${process.env.REACT_APP_API_URL}/api/gamerooms/${id}/state`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId,
              password: storedPassword,
            }),
          }
        );
        if (!response.ok) throw new Error('Failed to fetch game state');
        const data = await response.json();
        console.log('Game state update:', data); // Debug log
        setGameState(data);
      } catch (err) {
        console.error('Error fetching game state:', err);
      }
    };

    fetchGameState();
    const interval = setInterval(fetchGameState, UPDATE_INTERVAL);
    return () => clearInterval(interval);
  }, [id, userId, storedPassword]);

  // ---------------------------------------------------------------------------
  // Poll user state (only after a user has joined)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const fetchUserState = async () => {
      if (!userId) return;
      try {
        const response = await fetch(
          `${process.env.REACT_APP_API_URL}/api/gamerooms/${id}/user/${userId}`
        );
        if (!response.ok) throw new Error('Failed to fetch user state');
        const data = await response.json();
        setUserState(data);
      } catch (err) {
        console.error('Error fetching user state:', err);
      }
    };

    fetchUserState();
  }, [id, userId]);

  // ---------------------------------------------------------------------------
  // Build a flat grid of cells from the loaded chunks.
  // ---------------------------------------------------------------------------
  const mapGrid = useMemo(() => {
    const grid = [];
    let currentY = 0;
    for (const chunk of mapChunks) {
      if (Array.isArray(chunk)) {
        for (const row of chunk) {
          for (let x = 0; x < row.length; x++) {
            grid.push({
              cell: row[x],
              x,
              y: currentY,
            });
          }
          currentY++;
        }
      }
    }
    return grid;
  }, [mapChunks]);

  // ---------------------------------------------------------------------------
  // Handlers for game actions (found nation, build city)
  // ---------------------------------------------------------------------------
  const handleFoundNation = async (x, y) => {
    if (!userId || !storedPassword) return;
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/gamerooms/${id}/foundNation`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, password: storedPassword, x, y }),
        }
      );
      if (!response.ok) throw new Error('Failed to found nation');
      const data = await response.json();
      console.log('Nation founded:', data); // Debug log
    } catch (err) {
      setError(err.message);
    }
  };

  const handleBuildCity = async (x, y, cityName) => {
    if (!userId || !loginPassword) return;
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/gamerooms/${id}/buildCity`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, password: loginPassword, x, y, cityName }),
        }
      );
      if (!response.ok) throw new Error('Failed to build city');
      // Game state will update on the next poll.
    } catch (err) {
      setError(err.message);
    }
  };
  

  const handleCellClick = (x, y) => {
    if (!gameState) return;
    
    const userNation = gameState.nations?.find(n => n.owner === userId);
    
    if (!userNation) {
      // If the player has not yet founded a nation, offer to do so.
      if (window.confirm('Found your nation here?')) {
        handleFoundNation(x, y);
      }
    } else {
      // Otherwise, offer to build a city.
      const canBuildCity = true; // (Replace with your actual conditions.)
      if (canBuildCity && window.confirm('Build a city here?')) {
        const cityName = prompt('Enter city name:');
        if (cityName) {
          handleBuildCity(x, y, cityName);
        }
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Define a unique color mapping for each player's territory
  // ---------------------------------------------------------------------------
  const territoryColors = useMemo(() => {
    // Early return if no gameState or nations
    if (!gameState?.gameState?.nations) return {};
  
    // Define a palette of distinct colors for nations
    const palette = [
      '#FF5733', // Orange-red
      '#33FF57', // Bright green
      '#3357FF', // Blue
      '#FF33A8', // Pink
      '#A833FF', // Purple
      '#33FFF0', // Cyan
      '#FFC133', // Gold
      '#FF3333', // Red
      '#33FF33', // Lime
      '#3333FF'  // Deep blue
    ];
  
    const mapping = {};
    let colorIndex = 0;
  
    // Iterate through nations in gameState.gameState
    gameState.gameState.nations.forEach(nation => {
      // Check if this nation already has a color assigned
      if (!mapping[nation.owner]) {
        if (nation.owner === userId) {
          // Current player's nation is always yellow
          mapping[nation.owner] = '#FFFF00';
        } else {
          // Assign next color from palette for other players
          mapping[nation.owner] = palette[colorIndex % palette.length];
          colorIndex++;
        }
      }
    });
  
    console.log('Territory color mapping:', mapping); // Debug log
    return mapping;
  }, [gameState, userId]);

  // ---------------------------------------------------------------------------
  // Canvas drawing and mouse handling
  // ---------------------------------------------------------------------------
  const drawGameOverlay = useCallback((ctx, cellSize) => {
    if (!gameState?.gameState?.nations) return;
  
    gameState.gameState.nations.forEach(nation => {
      const color = territoryColors[nation.owner];
      if (!color) {
        console.warn('No color found for nation:', nation.owner);
        return;
      }
  
      // Draw territory with semi-transparency
      const baseColor = color.slice(0, 7); // Get the hex color without alpha
      ctx.fillStyle = `${baseColor}40`; // 40 is hex for 25% opacity
      
      nation.territory?.forEach(cell => {
        // Fill territory
        ctx.fillRect(
          cell.x * cellSize,
          cell.y * cellSize,
          cellSize,
          cellSize
        );
        
        // Draw border
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = 2 / scale;
        ctx.strokeRect(
          cell.x * cellSize,
          cell.y * cellSize,
          cellSize,
          cellSize
        );
      });
  
      // Draw cities
      nation.cities?.forEach(city => {
        ctx.fillStyle = nation.owner === userId ? '#FFD700' : '#C0C0C0';
        ctx.beginPath();
        ctx.arc(
          city.x * cellSize + cellSize / 2,
          city.y * cellSize + cellSize / 2,
          cellSize / 2,
          0,
          2 * Math.PI
        );
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1 / scale;
        ctx.stroke();
      });
    });
  }, [gameState, userId, scale, territoryColors]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mapMetadata) return;
    const ctx = canvas.getContext("2d");

    // Calculate cell size based on canvas width and map width.
    const canvasWidth = canvas.width;
    const cellSize = canvasWidth / mapMetadata.width;

    ctx.imageSmoothingEnabled = true;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, offset.x, offset.y);

    const visibleLeft = Math.max(0, Math.floor((-offset.x / scale) / cellSize));
    const visibleTop = Math.max(0, Math.floor((-offset.y / scale) / cellSize));
    const visibleRight = Math.min(
      mapMetadata.width,
      Math.ceil((canvas.width / scale - offset.x / scale) / cellSize)
    );
    const visibleBottom = Math.min(
      mapMetadata.height,
      Math.ceil((canvas.height / scale - offset.y / scale) / cellSize)
    );

    mapGrid.forEach(({ cell, x, y }) => {
      if (
        x >= visibleLeft &&
        x <= visibleRight &&
        y >= visibleTop &&
        y <= visibleBottom
      ) {
        const baseColor = getBiomeColor(cell[3]);
        const pixelX = x * cellSize;
        const pixelY = y * cellSize;
        const pixelSize = cellSize + 1;
        ctx.fillStyle = baseColor;
        ctx.fillRect(pixelX, pixelY, pixelSize, pixelSize);
      }
    });

    drawGameOverlay(ctx, cellSize);

    if (selectedRegion) {
      ctx.strokeStyle = "red";
      ctx.lineWidth = 2 / scale;
      ctx.strokeRect(
        selectedRegion.x * cellSize,
        selectedRegion.y * cellSize,
        cellSize,
        cellSize
      );
    }
  }, [mapGrid, mapMetadata, scale, offset, selectedRegion, getBiomeColor, drawGameOverlay]);

  const getCanvasMousePos = useCallback((e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const handleMouseDown = useCallback((e) => {
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    offsetStart.current = { ...offset };
  }, [offset]);

  const handleMouseMove = useCallback((e) => {
    if (isDragging.current) {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setOffset({
        x: offsetStart.current.x + dx,
        y: offsetStart.current.y + dy,
      });
    }
  }, []);

  const handleMouseUp = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas || !mapMetadata) return;

    if (dragStart.current.x === e.clientX && dragStart.current.y === e.clientY) {
      const { x: mouseX, y: mouseY } = getCanvasMousePos(e);
      const cellSize = canvas.width / mapMetadata.width;
      const x = Math.floor((mouseX - offset.x) / scale / cellSize);
      const y = Math.floor((mouseY - offset.y) / scale / cellSize);
      
      if (x >= 0 && x < mapMetadata.width && y >= 0 && y < mapMetadata.height) {
        handleCellClick(x, y);
      }
    }
    isDragging.current = false;
  }, [mapMetadata, offset, scale, getCanvasMousePos]);

  const handleMouseLeave = useCallback(() => {
    isDragging.current = false;
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center mb-4">
        <button
          onClick={() => navigate('/rooms')}
          className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg"
        >
          ← Back to Game Rooms
        </button>
        {gameState && (
          <div className="text-sm space-y-1">
            <p className="text-gray-700">Tick: {gameState.tickCount}</p>
            {userState && (
              <p className="text-gray-700">Playing as: {userState.userId}</p>
            )}
            {gameState.nations?.find(n => n.owner === userId) && (
              <p className="text-green-600">Nation Founded</p>
            )}
          </div>
        )}
      </div>

      {error && (
        <ErrorMessage message={error} onRetry={() => window.location.reload()} />
      )}

      <div className="flex gap-6">
        <div className="flex-1">
          {(!mapChunks.length && loading) ? (
            <LoadingSpinner />
          ) : (
            <div className="relative w-full">
              <canvas
                ref={canvasRef}
                width={1000}
                height={1000}
                className="w-full h-auto block border border-gray-300 rounded-lg shadow-lg"
                style={{ cursor: isDragging.current ? "grabbing" : "grab" }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
              />
            </div>
          )}
        </div>

        <div className="w-64 space-y-4">
          <div className="bg-white p-4 rounded-lg shadow-lg">
            <h2 className="text-lg font-semibold mb-2">Game Info</h2>
            {gameState?.gameState?.nations?.map(nation => {
              const isCurrentPlayer = nation.owner === userId;
              return (
                <div 
                  key={nation.owner}
                  className={`p-2 rounded ${isCurrentPlayer ? 'bg-blue-50' : 'bg-gray-50'} mb-2`}
                >
                  <p className="font-medium">
                  {nation.owner}
                  </p>
                  <p className="text-sm">Cities: {nation.cities?.length || 0}</p>
                  <p className="text-sm">Territory: {nation.territory?.length || 0} tiles</p>
                </div>
              );
            })}
          </div>

          {selectedRegion && (
            <div className="bg-white p-4 rounded-lg shadow-lg">
              <h2 className="text-lg font-semibold mb-2">Selected Region</h2>
              <div className="space-y-1 text-sm">
                <p>Position: ({selectedRegion.x}, {selectedRegion.y})</p>
                <p>Biome: {selectedRegion.biome}</p>
                <p>Elevation: {selectedRegion.elevation.toFixed(2)}</p>
                <p>Temperature: {selectedRegion.temperature.toFixed(1)}°C</p>
                {selectedRegion.resources.length > 0 && (
                  <div>
                    <p className="font-medium">Resources:</p>
                    <ul className="list-disc pl-4">
                      {selectedRegion.resources.map(resource => (
                        <li key={resource}>{resource}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {selectedRegion.features.length > 0 && (
                  <div>
                    <p className="font-medium">Features:</p>
                    <ul className="list-disc pl-4">
                      {selectedRegion.features.map(feature => (
                        <li key={feature}>{feature}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="bg-white p-4 rounded-lg shadow-lg">
            <h2 className="text-lg font-semibold mb-2">Controls</h2>
            <ul className="text-sm space-y-1">
              <li>Click: Select region</li>
              <li>Drag: Pan map</li>
              <li>Click empty tile: Found nation (if none)</li>
              <li>Click owned tile: Build city</li>
            </ul>
          </div>
        </div>
      </div>

      {/* -----------------------------------------------------------------------
          Login Modal: Only visible if no userId is present.
      ------------------------------------------------------------------------- */}
      {!userId && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg max-w-sm w-full">
            <h2 className="text-xl font-semibold mb-4 text-center">Join Game</h2>
            <form onSubmit={handleLoginSubmit}>
              <div className="mb-3">
                <label className="block text-sm font-medium mb-1">User Name</label>
                <input
                  type="text"
                  value={loginName}
                  onChange={(e) => setLoginName(e.target.value)}
                  required
                  className="w-full border rounded p-2"
                />
              </div>
              <div className="mb-3">
                <label className="block text-sm font-medium mb-1">Password</label>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                  className="w-full border rounded p-2"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1">Join Code</label>
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  required
                  className="w-full border rounded p-2"
                />
              </div>
              {loginError && (
                <p className="text-red-500 text-sm mb-3">{loginError}</p>
              )}
              <button
                type="submit"
                className="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 rounded"
              >
                Join Game
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Game;
