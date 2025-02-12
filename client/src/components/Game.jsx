import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ErrorMessage, LoadingSpinner } from './ErrorHandling';
import NationStatsPanel from './NationStatsPanel';
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
  const [loginError, setLoginError] = useState('');

  const { id } = useParams();
  const roomKey = `gameRoom-${id}-userId`;
  const [joinCode, setJoinCode] = useState(localStorage.getItem(`${roomKey}-joinCode`));
  const [userId, setUserId] = useState(localStorage.getItem(`${roomKey}-userId`));
  const [storedPassword, setStoredPassword] = useState(localStorage.getItem(`${roomKey}-password`));
  const navigate = useNavigate();

  const canvasRef = useRef(null);
  const isFetchingChunk = useRef(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const offsetStart = useRef({ x: 0, y: 0 })
  const [contextMenu, setContextMenu] = useState(null);;

  const getMinScale = useCallback(() => {
    if (!canvasRef.current || !mapMetadata) return 1;
    const canvas = canvasRef.current;
    const naturalWidth = canvas.width;
    const naturalHeight = canvas.width * (mapMetadata.height / mapMetadata.width);
    const scaleForHeight = canvas.height / naturalHeight;
    return Math.min(1, scaleForHeight);
  }, [mapMetadata]);

  useEffect(() => {if (!contextMenu) setSelectedRegion(null)}, [contextMenu]);

  const clampOffset = useCallback(
    (offset, currentScale) => {
      if (!canvasRef.current || !mapMetadata) return offset;
      const canvas = canvasRef.current;
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;
      const effectiveWidth = canvasWidth * currentScale;
      const effectiveHeight =
        canvasWidth * (mapMetadata.height / mapMetadata.width) * currentScale;
      
      let clampedX, clampedY;
      if (effectiveWidth <= canvasWidth) {
        clampedX = (canvasWidth - effectiveWidth) / 2;
      } else {
        const minX = canvasWidth - effectiveWidth;
        const maxX = 0;
        clampedX = Math.min(maxX, Math.max(offset.x, minX));
      }
      
      if (effectiveHeight <= canvasHeight) {
        clampedY = (canvasHeight - effectiveHeight) / 2;
      } else {
        const minY = canvasHeight - effectiveHeight;
        const maxY = 0;
        clampedY = Math.min(maxY, Math.max(offset.y, minY));
      }
      
      return { x: clampedX, y: clampedY };
    },
    [mapMetadata]
  );


  useEffect(() => {
    setOffset((current) => clampOffset(current, scale));
  }, [scale, mapMetadata, clampOffset]);

  const handleWheel = useCallback(
    (e) => {
      //e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;

      const mousePos = getCanvasMousePos(e);
      const delta = -e.deltaY;
      const zoomFactor = delta > 0 ? 1.1 : 0.9;
      const minScale = getMinScale();

      setScale((prevScale) => {
        const newScale = Math.min(Math.max(prevScale * zoomFactor, minScale), 5);
        const worldX = (mousePos.x - offset.x) / prevScale;
        const worldY = (mousePos.y - offset.y) / prevScale;
        let newOffset = {
          x: mousePos.x - worldX * newScale,
          y: mousePos.y - worldY * newScale,
        };
        newOffset = clampOffset(newOffset, newScale);
        setOffset(newOffset);
        return newScale;
      });
    },
    [offset, getMinScale, clampOffset]
  );


  // ---------------------------------------------------------------------------
  // Login: When there is no userId, show a login form that calls the join API.
  // ---------------------------------------------------------------------------
  const handleLoginSubmit = async (e) => {
    e?.preventDefault();
    setLoginError('');
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/gamerooms/${id}/join`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userName: userId ? userId : loginName,
            password: storedPassword ? storedPassword : loginPassword,
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
      if (loginName) {

        localStorage.setItem(`${roomKey}-userId`, loginName);
        localStorage.setItem(`${roomKey}-password`, loginPassword);
        localStorage.setItem(`${roomKey}-joinCode`, joinCode);
        setUserId(loginName);
        setStoredPassword(loginPassword);
        setJoinCode(joinCode);
        // Debug log the stored values
        console.log('Stored credentials:', {
          userId: loginName,
          password: loginPassword
        });
      }
      
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
  
    //console.log('Territory color mapping:', mapping); // Debug log
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
  
      const territory = nation.territory || [];
      const territorySet = new Set(territory.map(cell => `${cell.x},${cell.y}`));
  
      // Function to check if a cell is on the edge of territory
      const isEdgeCell = (x, y) => {
        // Check all 8 adjacent cells
        const adjacentCells = [
          [x-1, y], [x+1, y],   // Left, Right
          [x, y-1], [x, y+1],   // Top, Bottom
          [x-1, y-1], [x+1, y-1], // Top-Left, Top-Right
          [x-1, y+1], [x+1, y+1]  // Bottom-Left, Bottom-Right
        ];
  
        // If any adjacent cell is not in territory, this is an edge
        return adjacentCells.some(([adjX, adjY]) => 
          !territorySet.has(`${adjX},${adjY}`)
        );
      };
  
      // Draw territory fills
      const baseColor = color.slice(0, 7); // Get the hex color without alpha
      ctx.fillStyle = `${baseColor}40`; // 40 is hex for 25% opacity
      
      territory.forEach(cell => {
        // Fill all territory cells
        ctx.fillRect(
          cell.x * cellSize,
          cell.y * cellSize,
          cellSize,
          cellSize
        );
      });
  
      // Draw borders only for edge cells
      ctx.strokeStyle = baseColor;
      ctx.lineWidth = 2 / scale;
      
      territory.forEach(cell => {
        if (isEdgeCell(cell.x, cell.y)) {
          // Draw border only for edge cells
          ctx.fillRect(
            cell.x * cellSize,
            cell.y * cellSize,
            cellSize,
            cellSize
          );
        }
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

    ctx.imageSmoothingEnabled = true;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, offset.x, offset.y);

    const canvasWidth = canvas.width;
    const cellSize = canvasWidth / mapMetadata.width;

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

    // Draw map cells
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

    // Draw game overlay (nations, cities, etc.)
    drawGameOverlay(ctx, cellSize);

    // Draw selected region
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


  const handleMouseDown = useCallback((e) => {
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    offsetStart.current = { ...offset };
    setContextMenu(null); // Close context menu when starting to drag
  }, [offset]);

  const handleMouseMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas || !mapMetadata) return;
    
    if (isDragging.current) {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      let newOffset = {
        x: offsetStart.current.x + dx,
        y: offsetStart.current.y + dy,
      };
      newOffset = clampOffset(newOffset, scale);
      setOffset(newOffset);
    }
  }, [mapMetadata, scale, clampOffset]);


  const handleMouseUp = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas || !mapMetadata) return;

    if (dragStart.current.x === e.clientX && dragStart.current.y === e.clientY) {
      const { x: mouseX, y: mouseY } = getCanvasMousePos(e);
      const adjustedX = (mouseX - offset.x) / scale;
      const adjustedY = (mouseY - offset.y) / scale;
      const cellSize = canvas.width / mapMetadata.width;
      const cellX = Math.floor(adjustedX / cellSize);
      const cellY = Math.floor(adjustedY / cellSize);

      if (
        cellX >= 0 &&
        cellX < mapMetadata.width &&
        cellY >= 0 &&
        cellY < mapMetadata.height
      ) {
        const cellData = mapGrid.find(
          (item) => item.x === cellX && item.y === cellY
        );
        if (cellData) {
          // Update selected region with cell info
          setSelectedRegion({
            x: cellX,
            y: cellY,
            elevation: cellData.cell[0],
            moisture: cellData.cell[1],
            temperature: cellData.cell[2],
            biome: mappings?.biomes[cellData.cell[3]] || "Unknown",
            isRiver: cellData.cell[4] === 1,
            features: (cellData.cell[5] || []).map(
              (id) => mappings?.features[id] || `Feature ${id}`
            ),
            resources: (cellData.cell[6] || []).map(
              (id) => mappings?.resources[id] || `Resource ${id}`
            ),
          });

          // Show context menu with available actions
          const rect = canvas.getBoundingClientRect();
          setContextMenu({
            x: cellX,
            y: cellY,
            screenX: e.clientX - rect.left,
            screenY: e.clientY - rect.top,
          });
        }
      }
    }
    isDragging.current = false;
  }, [mapMetadata, offset, scale, mapGrid, mappings]);

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
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => {
                  isDragging.current = false;
                }}
              />
              
              {/* Context Menu */}
              {contextMenu && (
                <div className="absolute bottom-0 left-0 right-0 bg-white p-4 border-t border-gray-200 shadow-lg">
                  <div className="flex flex-col space-y-2 max-w-md mx-auto">
                    {!gameState?.nations?.find(n => n.owner === userId) && (
                      <button
                        onClick={() => handleFoundNation(contextMenu.x, contextMenu.y)}
                        className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded"
                      >
                        Found Nation Here
                      </button>
                    )}
                    
                    {gameState?.nations?.find(n => n.owner === userId) && (
                      <button
                        onClick={() => {
                          const cityName = prompt('Enter city name:');
                          if (cityName) {
                            handleBuildCity(contextMenu.x, contextMenu.y, cityName);
                          }
                        }}
                        className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded"
                      >
                        Build City Here
                      </button>
                    )}
                    
                    <button
                      onClick={() => setContextMenu(null)}
                      className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
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

          <NationStatsPanel gameState={gameState} userId={userId} />
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
