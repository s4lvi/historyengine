import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ErrorMessage, LoadingSpinner } from "./ErrorHandling";
import NationStatsPanel from "./NationStatsPanel";
import { GiVillage } from "react-icons/gi";
import { FaUser } from "react-icons/fa6";
import { IconContext } from "react-icons/lib";
import { renderToStaticMarkup } from "react-dom/server";

// Cache object so we don’t recreate the same image for the same color repeatedly.
const cityIconCache = {};

const createColoredCityIconImage = (color) => {
  // Render the icon with the fill color set to the given color.
  const svgString = renderToStaticMarkup(<GiVillage fill={color} />);
  const svgDataUrl =
    "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgString);
  const img = new Image();
  img.src = svgDataUrl;
  return img;
};

const getCityIconForColor = (color) => {
  if (!cityIconCache[color]) {
    cityIconCache[color] = createColoredCityIconImage(color);
  }
  return cityIconCache[color];
};

const Modal = ({ children, onClose }) => (
  <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
    <div className="bg-white p-6 rounded-lg shadow-lg relative">
      <button
        onClick={onClose}
        className="absolute top-0 right-0 m-2 text-xl font-bold"
      >
        &times;
      </button>
      {children}
    </div>
  </div>
);

const CHUNK_SIZE = 10;
const UPDATE_INTERVAL = 200; // 200ms

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
  const [loginName, setLoginName] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  const { id } = useParams();
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
  const navigate = useNavigate();

  const canvasRef = useRef(null);
  const isFetchingChunk = useRef(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const offsetStart = useRef({ x: 0, y: 0 });
  // Instead of an overlay, we store the last context menu info to show in the left panel.
  const [contextMenu, setContextMenu] = useState(null);
  const [cityName, setCityName] = useState("");
  const [actionModal, setActionModal] = useState(null);

  const getMinScale = useCallback(() => {
    if (!canvasRef.current || !mapMetadata) return 1;
    const canvas = canvasRef.current;
    const naturalWidth = canvas.width;
    const naturalHeight =
      canvas.width * (mapMetadata.height / mapMetadata.width);
    const scaleForHeight = canvas.height / naturalHeight;
    return Math.min(1, scaleForHeight);
  }, [mapMetadata]);

  // When the contextMenu state changes, clear the selected region if needed.
  useEffect(() => {
    if (!contextMenu) setSelectedRegion(null);
  }, [contextMenu]);

  useEffect(() => {
    if (!actionModal) setSelectedRegion(null);
  }, [actionModal]);

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

  const handleAttack = async (x, y) => {};
  const handleSetExpandTarget = async (x, y) => {};

  const handleWheel = useCallback(
    (e) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const mousePos = getCanvasMousePos(e);
      const delta = -e.deltaY;
      const zoomFactor = delta > 0 ? 1.1 : 0.9;
      const minScale = getMinScale();
      setScale((prevScale) => {
        const newScale = Math.min(
          Math.max(prevScale * zoomFactor, minScale),
          14
        );
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
    [offset, getMinScale, clampOffset, getCanvasMousePos]
  );

  // ---------------------------------------------------------------------------
  // Login: When there is no userId, show a login form that calls the join API.
  // ---------------------------------------------------------------------------
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

      // Store credentials using the userName as userId
      if (loginName) {
        localStorage.setItem(`${roomKey}-userId`, loginName);
        localStorage.setItem(`${roomKey}-password`, loginPassword);
        localStorage.setItem(`${roomKey}-joinCode`, joinCode);
        setUserId(loginName);
        setStoredPassword(loginPassword);
        setJoinCode(joinCode);
        console.log("Stored credentials:", {
          userId: loginName,
          password: loginPassword,
        });
      }
    } catch (err) {
      console.error("Join error:", err);
      setLoginError(err.message);
    }
  };

  // ---------------------------------------------------------------------------
  // Map metadata and chunk fetching
  // ---------------------------------------------------------------------------
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

  const fetchMapChunk = async (startRow) => {
    try {
      const endRow = startRow + CHUNK_SIZE;
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/gamerooms/${id}/data?startRow=${startRow}&endRow=${endRow}`
      );
      if (!response.ok) throw new Error("Failed to fetch map chunk");
      const data = await response.json();
      console.log("Fetched chunk:", data);
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
  // Poll game state (using credentials)
  // ---------------------------------------------------------------------------
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
        if (!response.ok) throw new Error("Failed to fetch game state");
        const data = await response.json();
        setGameState(data);
      } catch (err) {
        console.error("Error fetching game state:", err);
      }
    };
    fetchGameState();
    const interval = setInterval(fetchGameState, UPDATE_INTERVAL);
    return () => clearInterval(interval);
  }, [id, userId, storedPassword]);

  // ---------------------------------------------------------------------------
  // Poll user state (after joining)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const fetchUserState = async () => {
      if (!userId) return;
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

  // ---------------------------------------------------------------------------
  // Build a flat grid of cells from loaded chunks.
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
  // Handlers for game actions
  // ---------------------------------------------------------------------------
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
            cityName, // removed duplicate property
          }),
        }
      );
      if (!response.ok) throw new Error("Failed to build city");
      // Game state will update on the next poll.
    } catch (err) {
      setError(err.message);
    }
  };

  // ---------------------------------------------------------------------------
  // Mouse handling for canvas – update selected cell and context menu state.
  // ---------------------------------------------------------------------------
  const handleMouseDown = useCallback(
    (e) => {
      isDragging.current = true;
      dragStart.current = { x: e.clientX, y: e.clientY };
      offsetStart.current = { ...offset };
      // Clear any previous context actions
      setContextMenu(null);
      setActionModal(null);
    },
    [offset]
  );

  const handleMouseMove = useCallback(
    (e) => {
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
    },
    [mapMetadata, scale, clampOffset]
  );

  const handleMouseUp = useCallback(
    (e) => {
      const canvas = canvasRef.current;
      if (!canvas || !mapMetadata) return;
      // If mouse hasn't moved, treat as a click.
      if (
        dragStart.current.x === e.clientX &&
        dragStart.current.y === e.clientY
      ) {
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
            // Determine if any nation owns this cell.
            const cellOwnerNation = gameState?.gameState?.nations?.find((n) =>
              n.territory?.some((c) => c.x === cellX && c.y === cellY)
            );
            const city = gameState?.gameState?.nations
              ?.flatMap((nation) => nation.cities || [])
              .find((c) => c.x === cellX && c.y === cellY);

            const cityInfo = city ? { cityName: city.cityName, ...city } : null;
            console.log("City info:", city);
            const extraInfo =
              cellOwnerNation && cellOwnerNation.owner !== userId
                ? {
                    owner: cellOwnerNation.owner,
                    territoryCount: cellOwnerNation.territory?.length,
                    cities: cellOwnerNation.cities,
                    population: cellOwnerNation.population,
                  }
                : null;
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
              extraInfo,
              cityInfo,
            });
            // Save the context info so that the left panel's "Context Actions" panel can display appropriate options.
            setContextMenu({ x: cellX, y: cellY });
          }
        }
      }
      isDragging.current = false;
    },
    [
      mapMetadata,
      offset,
      scale,
      mapGrid,
      mappings,
      gameState,
      userId,
      getCanvasMousePos,
    ]
  );

  // ---------------------------------------------------------------------------
  // Canvas drawing
  // ---------------------------------------------------------------------------
  const drawGameOverlay = useCallback(
    (ctx, cellSize) => {
      if (!gameState?.gameState?.nations) return;
      gameState.gameState.nations.forEach((nation) => {
        // Determine the nation's color.
        const nationColor = (() => {
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
          if (nation.owner === userId) {
            return "#FFFF00"; // Current player's nation is yellow.
          } else {
            const index = gameState.gameState.nations.findIndex(
              (n) => n.owner === nation.owner
            );
            return palette[index % palette.length];
          }
        })();

        // Use the nation's color for territory fill/stroke.
        const baseColor = nationColor.slice(0, 7);
        const territory = nation.territory || [];
        const territorySet = new Set(
          territory.map((cell) => `${cell.x},${cell.y}`)
        );

        const isEdgeCell = (x, y) => {
          const adjacent = [
            [x - 1, y],
            [x + 1, y],
            [x, y - 1],
            [x, y + 1],
            [x - 1, y - 1],
            [x + 1, y - 1],
            [x - 1, y + 1],
            [x + 1, y + 1],
          ];
          return adjacent.some(
            ([adjX, adjY]) => !territorySet.has(`${adjX},${adjY}`)
          );
        };

        ctx.fillStyle = `${baseColor}60`;
        territory.forEach((cell) => {
          ctx.fillRect(
            cell.x * cellSize,
            cell.y * cellSize,
            cellSize,
            cellSize
          );
        });
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = 2 / scale;
        territory.forEach((cell) => {
          if (isEdgeCell(cell.x, cell.y)) {
            ctx.fillRect(
              cell.x * cellSize,
              cell.y * cellSize,
              cellSize,
              cellSize
            );
          }
        });

        // Draw city icons.
        nation.cities?.forEach((city) => {
          // Compute the center of the cell in world coordinates.
          const cellCenterWorldX = city.x * cellSize + cellSize / 2;
          const cellCenterWorldY = city.y * cellSize + cellSize / 2;
          // Convert world coordinates to screen coordinates.
          const screenX = cellCenterWorldX * scale + offset.x;
          const screenY = cellCenterWorldY * scale + offset.y;
          // Define a base icon size (e.g., 30 pixels when scale = 1) and make it grow gently.
          const fixedIconBaseSize = 30;
          const iconSize = fixedIconBaseSize * Math.sqrt(scale);

          // Get the colored icon image.
          const coloredCityIcon = getCityIconForColor(nationColor);

          ctx.save();
          // Reset the transform so we can draw using fixed screen coordinates.
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
          ctx.shadowColor = "black";
          ctx.shadowBlur = 15;

          ctx.drawImage(
            coloredCityIcon,
            screenX - iconSize / 2,
            screenY - iconSize / 2,
            iconSize,
            iconSize
          );
          ctx.restore();
        });
      });
    },
    [gameState, userId, scale, offset]
  );

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
    const visibleLeft = Math.max(0, Math.floor(-offset.x / scale / cellSize));
    const visibleTop = Math.max(0, Math.floor(-offset.y / scale / cellSize));
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

    // Draw overlay (nations, cities)
    drawGameOverlay(ctx, cellSize);

    // Draw selected region border
    if (selectedRegion) {
      ctx.strokeStyle = "red";
      ctx.lineWidth = 2 / scale;
      ctx.beginPath();
      ctx.strokeRect(
        selectedRegion.x * cellSize,
        selectedRegion.y * cellSize,
        cellSize,
        cellSize
      );
      ctx.moveTo(selectedRegion.x * cellSize + cellSize / 2, 0);
      ctx.lineTo(
        selectedRegion.x * cellSize + cellSize / 2,
        mapMetadata.height * cellSize
      );
      ctx.stroke();
      ctx.moveTo(0, selectedRegion.y * cellSize + cellSize / 2);
      ctx.lineTo(
        mapMetadata.width * cellSize,
        selectedRegion.y * cellSize + cellSize / 2
      );
      ctx.stroke();
    }
  }, [
    mapGrid,
    mapMetadata,
    scale,
    offset,
    selectedRegion,
    getBiomeColor,
    drawGameOverlay,
  ]);

  // ---------------------------------------------------------------------------
  // Determine context actions based on the current cell (if any)
  // ---------------------------------------------------------------------------
  const renderContextActions = () => {
    // Only render actions if a cell was clicked (i.e. contextMenu state is set)
    if (!contextMenu) {
      return <p>No context actions</p>;
    }
    // Determine the current user's nation and the nation owning the clicked cell.
    const currentUserNation = gameState?.gameState?.nations?.find(
      (n) => n.owner === userId
    );
    const cellOwnerNation = gameState?.gameState?.nations?.find((n) =>
      n.territory?.some((c) => c.x === contextMenu.x && c.y === contextMenu.y)
    );
    return (
      <div className="flex flex-col space-y-2">
        {!currentUserNation && (
          <button
            onClick={() => {
              handleFoundNation(contextMenu.x, contextMenu.y);
              setContextMenu(null);
            }}
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded"
          >
            Found Nation Here
          </button>
        )}
        {currentUserNation && (
          <>
            {cellOwnerNation ? (
              cellOwnerNation.owner === userId ? (
                <button
                  onClick={() => {
                    // Instead of using prompt, set the action modal for building a city.
                    setActionModal({
                      type: "buildCity",
                      x: contextMenu.x,
                      y: contextMenu.y,
                    });
                    setContextMenu(null);
                  }}
                  className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded"
                >
                  Build City Here
                </button>
              ) : (
                <button
                  onClick={() => {
                    // Instead of using alert, set the action modal for attacking.
                    setActionModal({
                      type: "attack",
                      x: contextMenu.x,
                      y: contextMenu.y,
                    });
                    setContextMenu(null);
                  }}
                  className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded"
                >
                  Attack
                </button>
              )
            ) : (
              <button
                onClick={() => {
                  // Instead of using alert, set the action modal for setting expand target.
                  setActionModal({
                    type: "setExpandTarget",
                    x: contextMenu.x,
                    y: contextMenu.y,
                  });
                  setContextMenu(null);
                }}
                className="bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded"
              >
                Set Expand Target
              </button>
            )}
          </>
        )}
      </div>
    );
  };

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
    if (nation.owner === userId) {
      return "#FFFF00"; // Use yellow for the current player
    } else {
      const index = gameState?.gameState?.nations?.findIndex(
        (n) => n.owner === nation.owner
      );
      return palette[index % palette.length];
    }
  };

  // ---------------------------------------------------------------------------
  // Render JSX
  // ---------------------------------------------------------------------------
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
        {/* Only show these if the current user is the room creator */}
        {gameState && gameState?.roomCreator === userId && (
          <div className="flex space-x-2">
            <button className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded">
              Pause
            </button>
            <button className="bg-red-600 hover:bg-red-800 text-white px-4 py-2 rounded">
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
        <div className="w-64 flex flex-col gap-4">
          {/* Players List Panel (fixed height and scrollable) */}
          <div className="bg-white p-4 rounded-lg shadow-lg h-64 flex flex-col">
            <h2 className="text-lg font-semibold mb-2">Players</h2>
            <div className="flex-1 overflow-y-auto">
              {gameState?.gameState?.nations?.map((nation) => (
                <div
                  key={nation.owner}
                  className={`p-2 rounded ${
                    nation.owner === userId ? "bg-blue-50" : "bg-gray-50"
                  } mb-2 flex flex-row items-center justify-between`}
                >
                  <p className="text-sm pr-1">{nation.owner}</p>
                  <IconContext.Provider
                    value={{
                      color: getNationColor(nation),
                    }}
                  >
                    <div>
                      <FaUser />
                    </div>
                  </IconContext.Provider>
                </div>
              ))}
            </div>
          </div>

          {/* Nation Stats Panel */}
          <NationStatsPanel gameState={gameState} userId={userId} />
          {/* Always-visible Context Actions Panel */}
          <div className="bg-white p-4 rounded-lg shadow-lg">
            <h2 className="text-lg font-semibold mb-2">Context Actions</h2>
            {renderContextActions()}
          </div>
        </div>

        {/* Center: Canvas */}
        <div className="flex-1 relative">
          {!mapChunks.length && loading ? (
            <LoadingSpinner />
          ) : (
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
          )}
        </div>

        {/* Right Panel: Selected Region */}
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
                {selectedRegion.resources.length > 0 && (
                  <div>
                    <p className="font-medium">Resources:</p>
                    <ul className="list-disc pl-4">
                      {selectedRegion.resources.map((resource) => (
                        <li key={resource}>{resource}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {selectedRegion.features.length > 0 && (
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

      {/* Action Modal */}
      {actionModal && (
        <Modal onClose={() => setActionModal(null)}>
          {actionModal.type === "buildCity" && (
            <div>
              <h2 className="text-xl font-bold mb-4">Build City</h2>
              <input
                type="text"
                value={cityName}
                onChange={(e) => setCityName(e.target.value)}
                placeholder="Enter city name"
                className="border p-2 rounded mb-4 w-full"
              />
              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => {
                    setActionModal(null);
                    setCityName("");
                  }}
                  className="px-4 py-2 bg-gray-300 rounded"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    handleBuildCity(actionModal.x, actionModal.y, cityName);
                    setActionModal(null);
                    setCityName("");
                  }}
                  className="px-4 py-2 bg-green-500 text-white rounded"
                >
                  Submit
                </button>
              </div>
            </div>
          )}
          {actionModal.type === "attack" && (
            <div>
              <h2 className="text-xl font-bold mb-4">Attack</h2>
              <p className="mb-4">Do you want to attack this territory?</p>
              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => setActionModal(null)}
                  className="px-4 py-2 bg-gray-300 rounded"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    handleAttack(actionModal.x, actionModal.y);
                    setActionModal(null);
                  }}
                  className="px-4 py-2 bg-red-500 text-white rounded"
                >
                  Confirm
                </button>
              </div>
            </div>
          )}
          {actionModal.type === "setExpandTarget" && (
            <div>
              <h2 className="text-xl font-bold mb-4">Set Expand Target</h2>
              <p className="mb-4">
                Do you want to set this cell as your expansion target?
              </p>
              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => setActionModal(null)}
                  className="px-4 py-2 bg-gray-300 rounded"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    handleSetExpandTarget(actionModal.x, actionModal.y);
                    setActionModal(null);
                  }}
                  className="px-4 py-2 bg-yellow-500 text-white rounded"
                >
                  Confirm
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Login Modal (only if no userId) */}
      {!userId && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg max-w-sm w-full">
            <h2 className="text-xl font-semibold mb-4 text-center">
              Join Game
            </h2>
            <form onSubmit={handleLoginSubmit}>
              <div className="mb-3">
                <label className="block text-sm font-medium mb-1">
                  User Name
                </label>
                <input
                  type="text"
                  value={loginName}
                  onChange={(e) => setLoginName(e.target.value)}
                  required
                  className="w-full border rounded p-2"
                />
              </div>
              <div className="mb-3">
                <label className="block text-sm font-medium mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                  className="w-full border rounded p-2"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1">
                  Join Code
                </label>
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
