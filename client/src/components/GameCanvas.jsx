import React, { useRef, useState, useCallback, useEffect } from "react";
import { GiVillage } from "react-icons/gi";
import { renderToStaticMarkup } from "react-dom/server";

// Cache so we don’t recreate the same image repeatedly.
const cityIconCache = {};
const createColoredCityIconImage = (color) => {
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

const GameCanvas = ({
  mapMetadata,
  mapGrid,
  mappings,
  gameState,
  userId,
  selectedRegion,
  setSelectedRegion,
  contextMenu,
  setContextMenu,
}) => {
  const canvasRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const offsetStart = useRef({ x: 0, y: 0 });

  const getMinScale = useCallback(() => {
    if (!canvasRef.current || !mapMetadata) return 1;
    const canvas = canvasRef.current;
    const naturalWidth = canvas.width;
    const naturalHeight =
      canvas.width * (mapMetadata.height / mapMetadata.width);
    const scaleForHeight = canvas.height / naturalHeight;
    return Math.min(1, scaleForHeight);
  }, [mapMetadata]);

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

  const handleMouseDown = useCallback(
    (e) => {
      isDragging.current = true;
      dragStart.current = { x: e.clientX, y: e.clientY };
      offsetStart.current = { ...offset };
      // Clear previous context actions.
      setContextMenu(null);
    },
    [offset, setContextMenu]
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
      // If mouse didn’t move, treat as a click.
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
            const cellOwnerNation = gameState?.gameState?.nations?.find((n) =>
              n.territory?.some((c) => c.x === cellX && c.y === cellY)
            );
            const city = gameState?.gameState?.nations
              ?.flatMap((nation) => nation.cities || [])
              .find((c) => c.x === cellX && c.y === cellY);
            const cityInfo = city ? { cityName: city.cityName, ...city } : null;
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
      setSelectedRegion,
      setContextMenu,
    ]
  );

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
            return "#FFFF00";
          } else {
            const index = gameState.gameState.nations.findIndex(
              (n) => n.owner === nation.owner
            );
            return palette[index % palette.length];
          }
        })();

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
          const cellCenterWorldX = city.x * cellSize + cellSize / 2;
          const cellCenterWorldY = city.y * cellSize + cellSize / 2;
          const screenX = cellCenterWorldX * scale + offset.x;
          const screenY = cellCenterWorldY * scale + offset.y;
          const fixedIconBaseSize = 30;
          const iconSize = fixedIconBaseSize * Math.sqrt(scale);
          const coloredCityIcon = getCityIconForColor(nationColor);
          ctx.save();
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

    mapGrid.forEach(({ cell, x, y }) => {
      if (
        x >= visibleLeft &&
        x <= visibleRight &&
        y >= visibleTop &&
        y <= visibleBottom
      ) {
        const baseColor = mappings
          ? (() => {
              const biome = mappings.biomes[cell[3]];
              const defaultColors = {
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
              };
              return defaultColors[biome] || "#ccc";
            })()
          : "#ccc";
        const pixelX = x * cellSize;
        const pixelY = y * cellSize;
        ctx.fillStyle = baseColor;
        ctx.fillRect(pixelX, pixelY, cellSize + 1, cellSize + 1);
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
      ctx.beginPath();
      ctx.moveTo(selectedRegion.x * cellSize + cellSize / 2, 0);
      ctx.lineTo(
        selectedRegion.x * cellSize + cellSize / 2,
        mapMetadata.height * cellSize
      );
      ctx.stroke();
      ctx.beginPath();
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
    mappings,
    drawGameOverlay,
  ]);

  return (
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
  );
};

export default GameCanvas;
