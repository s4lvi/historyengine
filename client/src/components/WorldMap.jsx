import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ErrorMessage, LoadingSpinner } from './ErrorHandling';

const CHUNK_SIZE = 10;

const WorldMap = () => {
  const [mapMetadata, setMapMetadata] = useState(null);
  const [mapChunks, setMapChunks] = useState([]);
  const [mappings, setMappings] = useState(null);
  const [loadedRows, setLoadedRows] = useState(0);
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { id } = useParams();
  const navigate = useNavigate();

  // Pan/zoom state
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const canvasRef = useRef(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const offsetStart = useRef({ x: 0, y: 0 });
  const isFetchingChunk = useRef(false);

  // *** NEW: Render mode state ***
  // 'biome' for biome rendering, 'heightmap' for grayscale heightmap rendering.
  const [renderMode, setRenderMode] = useState('biome');

  // Fetch metadata
  const fetchMapMetadata = async () => {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/maps/${id}/metadata`
      );
      if (!response.ok) throw new Error('Failed to fetch map metadata');
      const data = await response.json();
      setMapMetadata(data);
    } catch (err) {
      setError(err.message);
    }
  };

  // Fetch one chunk from the API.
  const fetchMapChunk = async (startRow) => {
    try {
      const endRow = startRow + CHUNK_SIZE;
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/maps/${id}/data?startRow=${startRow}&endRow=${endRow}`
      );
      if (!response.ok) throw new Error('Failed to fetch map chunk');
      const data = await response.json();
      // Set mappings only once.
      if (data.mappings && !mappings) {
        setMappings(data.mappings);
      }
      return data;
    } catch (err) {
      throw err;
    }
  };

  // Load metadata when the id changes.
  useEffect(() => {
    if (id) {
      fetchMapMetadata();
    }
  }, [id]);

  // Load chunks sequentially.
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
        console.log(nextChunk);
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

  // Define colors for biomes.
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

  const handleCellHover = useCallback(
    (cell, x, y) => {
      if (!mappings) return;
      setSelectedRegion({
        x,
        y,
        elevation: cell[0],
        moisture: cell[1],
        temperature: cell[2],
        biome: mappings.biomes[cell[3]] || "Unknown",
        isRiver: cell[4] === 1,
        features: (cell[5] || []).map(
          (id) => mappings.features[id] || `Feature ${id}`
        ),
        resources: (cell[6] || []).map(
          (id) => mappings.resources[id] || `Resource ${id}`
        ),
      });
    },
    [mappings]
  );

  // Build a flat grid of cells.
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

  const updateMousePosition = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    setMousePosition({ y });
  }, []);

  // ── NEW: Calculate the minimum allowed scale ──────────────────────────────
  // The “natural” drawing size makes the map fill the canvas horizontally.
  // If the map is taller than it is wide, we allow zooming out further until
  // its full height exactly fits the canvas.
  const getMinScale = useCallback(() => {
    if (!canvasRef.current || !mapMetadata) return 1;
    const canvas = canvasRef.current;
    // Natural width always equals the canvas width.
    const naturalWidth = canvas.width;
    const naturalHeight = canvas.width * (mapMetadata.height / mapMetadata.width);
    // When the map is tall the height may be larger than the canvas height.
    // Compute the scale needed so that the full height just fits.
    const scaleForHeight = canvas.height / naturalHeight;
    // If the map is wider (or square), prevent zooming out below a scale of 1.
    return Math.min(1, scaleForHeight);
  }, [mapMetadata]);

  // ── NEW: Clamp the offset so panning cannot move the map beyond its edges ─
  const clampOffset = useCallback(
    (offset, currentScale) => {
      if (!canvasRef.current || !mapMetadata) return offset;
      const canvas = canvasRef.current;
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;
      // Because our natural cellSize makes the map’s drawn width equal to canvas.width,
      // the effective map dimensions are:
      const effectiveWidth = canvasWidth * currentScale;
      const effectiveHeight =
        canvasWidth * (mapMetadata.height / mapMetadata.width) * currentScale;
      let clampedX, clampedY;
      // If the effective width is smaller than the canvas, center it.
      if (effectiveWidth <= canvasWidth) {
        clampedX = (canvasWidth - effectiveWidth) / 2;
      } else {
        // Otherwise, clamp between the left and right edges.
        const minX = canvasWidth - effectiveWidth;
        const maxX = 0;
        clampedX = Math.min(maxX, Math.max(offset.x, minX));
      }
      // Do the same vertically.
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

  // Whenever the scale (or map dimensions) change, update the offset.
  useEffect(() => {
    setOffset((current) => clampOffset(current, scale));
  }, [scale, mapMetadata, clampOffset]);


  const adjustColorByElevation = (hexColor, elevation) => {
    let hex = hexColor.replace("#", "");
    if (hex.length === 3) {
      hex = hex.split("").map((c) => c + c).join("");
    }
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);
  
    // Define a brightness factor based on elevation.
    // For instance, if elevation is 0, brightness is 0.9 (a bit darker),
    // and if elevation is 1, brightness is 1.1 (a bit lighter).
    const brightnessFactor = 0.6 + 0.3 * (elevation*2.5);
  
    // Adjust the color channels.
    r = Math.min(255, Math.floor(r * brightnessFactor));
    g = Math.min(255, Math.floor(g * brightnessFactor));
    b = Math.min(255, Math.floor(b * brightnessFactor));
  
    return `rgb(${r}, ${g}, ${b})`;
  };
  
  // ── DRAWING THE MAP ─────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mapMetadata) return;
    const ctx = canvas.getContext("2d");

    // Enable crisp pixel rendering.
    ctx.imageSmoothingEnabled = true;

    const canvasWidth = canvas.width;
    const cols = mapMetadata.width;
    const cellSize = canvasWidth / cols;

    // Clear the entire canvas.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply transform for pan/zoom.
    ctx.setTransform(scale, 0, 0, scale, offset.x, offset.y);

    // Calculate visible area.
    const visibleLeft = Math.max(0, Math.floor((-offset.x / scale) / cellSize));
    const visibleTop = Math.max(0, Math.floor((-offset.y / scale) / cellSize));
    const visibleRight = Math.min(
      cols,
      Math.ceil((canvas.width / scale - offset.x / scale) / cellSize)
    );
    const visibleBottom = Math.min(
      mapMetadata.height,
      Math.ceil((canvas.height / scale - offset.y / scale) / cellSize)
    );
    // Only render cells that are in view.
    mapGrid.forEach(({ cell, x, y }) => {
      if (
        x >= visibleLeft &&
        x <= visibleRight &&
        y >= visibleTop &&
        y <= visibleBottom
      ) {
        let color;
        if (renderMode === "biome") {
          // Get the base biome color.
          const baseColor = getBiomeColor(cell[3]);
          // Adjust the base color based on the cell's elevation.
          color = adjustColorByElevation(baseColor, cell[0]);
        } else if (renderMode === "heightmap") {
          const h = cell[0];
          const clampedH = Math.min(Math.max(h, 0), 1);
          const intensity = Math.floor(clampedH * 255);
          color = `rgb(${intensity}, ${intensity}, ${intensity})`;
        } else if (renderMode === "temperature") {
          const temp = cell[2];
          
          // Normalize temperature from -20 to 100 range to 0-1 range
          const normalizedTemp = (temp - (-20)) / (100 - (-20));
          const clampedTemp = Math.min(Math.max(normalizedTemp, 0), 1);
          
          // Create a smooth transition through the RGB spectrum
          let red, green, blue;
          
          if (clampedTemp < 0.5) {
            // Cold (blue) to neutral (purple)
            red = Math.floor((clampedTemp * 2) * 255);
            blue = 255;
          } else {
            // Neutral (purple) to hot (red)
            red = 255;
            blue = Math.floor((1 - (clampedTemp - 0.5) * 2) * 255);
          }
          // Keep green at 0 for more vibrant colors
          green = 0;
          
          color = `rgb(${red}, ${green}, ${blue})`;
        }

        // Draw cell with pixel-perfect alignment.
        const pixelX = x * cellSize;
        const pixelY = y * cellSize;
        const pixelSize = cellSize + 1;

        ctx.fillStyle = color;
        ctx.fillRect(pixelX, pixelY, pixelSize, pixelSize);
      }
    });

    // Optionally, draw a red outline on the selected cell.
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
    renderMode,
  ]);

  // ── UTILS: Get the mouse coordinates in canvas space ──────────────────────
  const getCanvasMousePos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    // Scale factor between the canvas's internal size and its displayed size.
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  // ── HANDLERS ───────────────────────────────────────────────────────────────
  // Handle zooming while clamping both scale and offset.
  const handleWheel = useCallback(
    (e) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;

      const mousePos = getCanvasMousePos(e);
      const delta = -e.deltaY;
      const zoomFactor = delta > 0 ? 1.1 : 0.9;
      const minScale = getMinScale();

      setScale((prevScale) => {
        // Calculate the new scale and constrain it between minScale and 5.
        const newScale = Math.min(
          Math.max(prevScale * zoomFactor, minScale),
          5
        );

        // Compute the world coordinates (before zoom) of the mouse position.
        const worldX = (mousePos.x - offset.x) / prevScale;
        const worldY = (mousePos.y - offset.y) / prevScale;

        // Compute a new offset so that the world point stays under the mouse.
        let newOffset = {
          x: mousePos.x - worldX * newScale,
          y: mousePos.y - worldY * newScale,
        };

        newOffset = clampOffset(newOffset, newScale);
        setOffset(newOffset);

        return newScale;
      });
    },
    [offset, getCanvasMousePos, getMinScale, clampOffset]
  );

  const handleMouseDown = (e) => {
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    offsetStart.current = { ...offset };
  };


  const handleMouseMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas || !mapMetadata) return;
    updateMousePosition(e);
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
  };

  const handleMouseUp = (e) => {
    isDragging.current = false;
    const canvas = canvasRef.current;
    if (!canvas || !mapMetadata) return;
    if( dragStart.current.x == e.clientX && dragStart.current.y == e.clientY) {
      // For hover: convert mouse coordinates into canvas cell coordinates.
      const { x: mouseX, y: mouseY } = getCanvasMousePos(e);
      const adjustedX = (mouseX - offset.x) / scale;
      const adjustedY = (mouseY - offset.y) / scale;
      const cellSize = canvas.width / mapMetadata.width;
      const cellX = Math.floor(adjustedX / cellSize);
      const cellY = Math.floor(adjustedY / cellSize);

      if (
        cellX < 0 ||
        cellX >= mapMetadata.width ||
        cellY < 0 ||
        cellY >= mapMetadata.height
      ) {
        setSelectedRegion(null);
      } else {
        const cellData = mapGrid.find(
          (item) => item.x === cellX && item.y === cellY
        );
        if (cellData) {
          handleCellHover(cellData.cell, cellX, cellY);
        } else {
          setSelectedRegion(null);
        }
      }
    } 
  }

  const handleMouseLeave = () => {
    isDragging.current = false;
  };

  const loadingProgress = mapMetadata
    ? (loadedRows / mapMetadata.height) * 100
    : 0;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header with Back button and Render Mode toggle */}
      <div className="flex justify-between items-center mb-4">
      <div className="flex gap-2">
  <button
    onClick={() => navigate('/')}
    className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg"
  >
    ← Back to Maps
  </button>
  <button
    onClick={() =>
      setRenderMode((prev) => {
        switch(prev) {
          case "biome":
            return "heightmap";
          case "heightmap":
            return "temperature";
          default:
            return "biome";
        }
      })
    }
    className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg"
  >
    {renderMode === "biome"
      ? "Switch to Heightmap"
      : renderMode === "heightmap"
      ? "Switch to Temperature"
      : "Switch to Biome"}
  </button>
  {/* New Button to Switch to the 3D View */}
  <button
    onClick={() => navigate(`/map/${id}/3d`)}
    className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg"
  >
    Switch to 3D View
  </button>
</div>
        {loading && (
          <div className="flex items-center gap-2">
            <div className="h-2 w-24 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${loadingProgress}%` }}
              />
            </div>
            <span className="text-sm text-gray-600">
              {loadingProgress.toFixed(0)}%
            </span>
          </div>
        )}
      </div>

      {error && (
        <ErrorMessage
          message={error}
          onRetry={() => window.location.reload()}
        />
      )}

      {(!mapChunks.length && loading) ? (
        <LoadingSpinner />
      ) : (
        // Container for the canvas and region details.
        <div
          style={{
            position: "relative",
            width: "100%",
            maxWidth: "600px",
            margin: "0 auto",
          }}
        >
          <canvas
            ref={canvasRef}
            width={1000}
            height={1000}
            style={{
              width: "100%",
              height: "auto",
              display: "block",
              border: "1px solid #ccc",
              cursor: isDragging.current ? "grabbing" : "grab",
            }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
          />
          {selectedRegion && (
            <div
              style={{
                position: "absolute",
                ...(mousePosition.y > 0.6 
                  ? { top: "10px" } 
                  : { bottom: "10px" }),
                right: "10px",
                width: "180px",
                padding: "10px",
                background: "rgba(255,255,255,0.9)",
                border: "1px solid #ccc",
                borderRadius: "8px",
                fontSize: "0.7rem",
                lineHeight: "1.1rem",
              }}
            >
              <h3
                style={{
                  margin: "0 0 4px 0",
                  fontSize: "1rem",
                  fontWeight: "bold",
                }}
              >
                Region Details
              </h3>
              <p style={{ margin: "2px 0" }}>
                <strong>Location:</strong> ({selectedRegion.x},{" "}
                {selectedRegion.y})
              </p>
              <p style={{ margin: "2px 0" }}>
                <strong>Biome:</strong> {selectedRegion.biome}
              </p>
              <p style={{ margin: "2px 0" }}>
                <strong>Elevation:</strong>{" "}
                {selectedRegion.elevation.toFixed(2)}
              </p>
              <p style={{ margin: "2px 0" }}>
                <strong>Moisture:</strong>{" "}
                {selectedRegion.moisture.toFixed(2)}
              </p>
              <p style={{ margin: "2px 0" }}>
                <strong>Temp:</strong>{" "}
                {selectedRegion.temperature.toFixed(1)}°C
              </p>
              <p style={{ margin: "2px 0" }}>
                <strong>Features:</strong>{" "}
                {selectedRegion.features.length > 0
                  ? selectedRegion.features.join(", ")
                  : "None"}
              </p>
              <p style={{ margin: "2px 0" }}>
                <strong>Resources:</strong>{" "}
                {selectedRegion.resources.length > 0
                  ? selectedRegion.resources.join(", ")
                  : "None"}
              </p>
              {selectedRegion.isRiver && (
                <p style={{ margin: "2px 0", color: "blue" }}>
                  Contains River
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WorldMap;
