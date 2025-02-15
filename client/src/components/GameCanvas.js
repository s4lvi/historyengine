import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { Stage, Container, Graphics, Sprite } from "@pixi/react";
import "@pixi/events";
import * as PIXI from "pixi.js";
import { string2hex } from "@pixi/utils";
import BorderedSprite from "./BorderedSprite";

// Load textures once at the component lev
const GameCanvas = ({
  mapMetadata,
  mapGrid,
  mappings,
  gameState,
  userId,
  onArmyTargetSelect,
  foundingNation,
  onFoundNation,
  buildingStructure,
  onBuildCity,
}) => {
  const stageWidth = window.innerWidth;
  const stageHeight = window.innerHeight - 60;
  const cellSize = mapMetadata ? stageWidth / mapMetadata.width : 1;

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const offsetStart = useRef({ x: 0, y: 0 });
  const lastRenderTime = useRef(0);

  const [selectedArmy, setSelectedArmy] = useState(null);
  const [hoveredCell, setHoveredCell] = useState(null);
  const disableDrag = useRef(false);
  const [textures, setTextures] = useState({
    city: null,
    army: null,
    expansion: null,
  });

  // Load textures
  useEffect(() => {
    setTextures({
      city: PIXI.Texture.from("/village.png"),
      army: PIXI.Texture.from("/army.png"),
      expansion: PIXI.Texture.from("/banner.png"),
    });
  }, []);

  const forEachTerritoryCell = (territory, callback) => {
    if (!territory || !territory.x || !territory.y) return;
    for (let i = 0; i < territory.x.length; i++) {
      callback(territory.x[i], territory.y[i], i);
    }
  };

  const hasCellInTerritory = (territory, x, y) => {
    if (!territory || !territory.x || !territory.y) return false;
    for (let i = 0; i < territory.x.length; i++) {
      if (territory.x[i] === x && territory.y[i] === y) {
        return true;
      }
    }
    return false;
  };

  const getMergedTerritory = (nation) => {
    // If the full territory is available, use it.
    if (nation.territory && nation.territory.x && nation.territory.y) {
      return nation.territory;
    }
    // Otherwise, if we have a territory delta for client, assume territory is what was added.
    if (nation.territoryDeltaForClient) {
      return {
        x: [...(nation.territoryDeltaForClient.add?.x || [])],
        y: [...(nation.territoryDeltaForClient.add?.y || [])],
      };
    }
    return { x: [], y: [] };
  };

  // Update the border-check function to use the new structure.
  const isBorderCell = (x, y, territory) => {
    // Define the 8 adjacent positions.
    const adjacentPositions = [
      { x: x - 1, y: y - 1 },
      { x: x, y: y - 1 },
      { x: x + 1, y: y - 1 },
      { x: x - 1, y: y },
      { x: x + 1, y: y },
      { x: x - 1, y: y + 1 },
      { x: x, y: y + 1 },
      { x: x + 1, y: y + 1 },
    ];

    // If any adjacent cell is not in territory, this is a border cell.
    return adjacentPositions.some(
      (pos) => !hasCellInTerritory(territory, pos.x, pos.y)
    );
  };

  // Clamp during dragging – allows slight overscroll for smooth feel.
  const clampOffsetDuringDrag = useCallback(
    (offset, currentScale) => {
      const cellSize = stageWidth / mapMetadata.width;
      const mapWidth = stageWidth * currentScale;
      const mapHeight = cellSize * mapMetadata.height * currentScale;

      let minX, maxX, minY, maxY;

      // Horizontal boundaries: if mapWidth <= stageWidth, center it.
      if (mapWidth <= stageWidth) {
        minX = maxX = (stageWidth - mapWidth) / 2;
      } else {
        minX = stageWidth - mapWidth;
        maxX = 0;
      }

      // Vertical boundaries: if mapHeight <= stageHeight, center it.
      if (mapHeight <= stageHeight) {
        minY = maxY = (stageHeight - mapHeight) / 2;
      } else {
        minY = stageHeight - mapHeight;
        maxY = 0;
      }

      // Instead of rubberClamp, we strictly clamp the offset.
      return {
        x: Math.min(maxX, Math.max(minX, offset.x)),
        y: Math.min(maxY, Math.max(minY, offset.y)),
      };
    },
    [stageWidth, stageHeight, mapMetadata]
  );

  // Strict clamping (no overscroll) used on pointer release.
  const clampOffsetFinal = useCallback(
    (offset, currentScale) => {
      const cellSize = stageWidth / mapMetadata.width;
      const mapWidth = stageWidth * currentScale;
      const mapHeight = cellSize * mapMetadata.height * currentScale;

      let minX, maxX, minY, maxY;

      if (mapWidth <= stageWidth) {
        minX = maxX = (stageWidth - mapWidth) / 2;
      } else {
        minX = stageWidth - mapWidth;
        maxX = 0;
      }

      if (mapHeight <= stageHeight) {
        minY = maxY = (stageHeight - mapHeight) / 2;
      } else {
        minY = stageHeight - mapHeight;
        maxY = 0;
      }

      return {
        x: Math.min(maxX, Math.max(offset.x, minX)),
        y: Math.min(maxY, Math.max(offset.y, minY)),
      };
    },
    [stageWidth, stageHeight, mapMetadata]
  );

  // Check if a point is within bounds
  const isWithinBounds = useCallback(
    (x, y) => {
      return (
        x >= 0 && x < mapMetadata.width && y >= 0 && y < mapMetadata.height
      );
    },
    [mapMetadata]
  );

  // Get cell coordinates from screen coordinates
  const getCellCoordinates = useCallback(
    (screenX, screenY) => {
      const adjustedX = (screenX - offset.x) / scale;
      const adjustedY = (screenY - offset.y) / scale;
      return {
        x: Math.floor(adjustedX / cellSize),
        y: Math.floor(adjustedY / cellSize),
      };
    },
    [offset, scale, cellSize]
  );

  const findArmyAtPosition = useCallback(
    (x, y) => {
      if (!gameState?.gameState?.nations) return null;

      for (const nation of gameState.gameState.nations) {
        const army = nation.armies?.find((army) => {
          // Round the position values to handle floating point positions
          const armyX = Math.round(army.position.x);
          const armyY = Math.round(army.position.y);
          return armyX === x && armyY === y;
        });
        if (army) {
          // Only check attackTarget, not target
          if (army.attackTarget) return null;
          return { army, nation };
        }
      }
      return null;
    },
    [gameState]
  );

  // --- Event Handlers for Pan/Zoom ---

  const handleWheel = useCallback(
    (e) => {
      let mousePos;
      if (e.data && e.data.global) {
        mousePos = e.data.global;
      } else if (
        e.clientX !== undefined &&
        e.clientY !== undefined &&
        e.target &&
        e.target.getBoundingClientRect
      ) {
        const rect = e.target.getBoundingClientRect();
        mousePos = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
      } else {
        return;
      }

      const delta = -(
        (e.originalEvent && e.originalEvent.deltaY) ||
        e.deltaY ||
        0
      );
      const zoomFactor = delta > 0 ? 1.1 : 0.9;
      const minScale = 1;
      setScale((prevScale) => {
        const newScale = Math.min(
          Math.max(prevScale * zoomFactor, minScale),
          14
        );
        // Calculate the world coordinates of the mouse position
        const worldX = (mousePos.x - offset.x) / prevScale;
        const worldY = (mousePos.y - offset.y) / prevScale;
        // Calculate the new offset so that the mouse position stays at the same world coordinate
        const newOffset = {
          x: mousePos.x - worldX * newScale,
          y: mousePos.y - worldY * newScale,
        };
        // Update the offset using the newOffset value, clamped to valid bounds.
        setOffset(clampOffsetFinal(newOffset, newScale));
        return newScale;
      });
    },
    [offset, clampOffsetFinal]
  );

  const handlePointerDown = useCallback(
    (e) => {
      // If this pointerdown event originated on an interactive sprite, do not start dragging.
      if (disableDrag.current) {
        return;
      }
      let x, y;
      if (e.data && e.data.global) {
        ({ x, y } = e.data.global);
      } else {
        const rect = e.target.getBoundingClientRect();
        x = e.nativeEvent.clientX - rect.left;
        y = e.nativeEvent.clientY - rect.top;
      }
      isDragging.current = true;
      dragStart.current = { x, y };
      offsetStart.current = { ...offset };
    },
    [offset]
  );

  const handlePointerMove = useCallback(
    (e) => {
      // If no mouse button is pressed, cancel dragging.
      if (e.buttons === 0) {
        isDragging.current = false;
        return;
      }

      const currentTime = performance.now();
      if (currentTime - lastRenderTime.current < 16) {
        // ~60fps
        return;
      }
      lastRenderTime.current = currentTime;

      // Only run hover logic if not dragging.
      if (!isDragging.current) {
        let x, y;
        if (e.data && e.data.global) {
          ({ x, y } = e.data.global);
        } else {
          const rect = e.target.getBoundingClientRect();
          x = e.nativeEvent.clientX - rect.left;
          y = e.nativeEvent.clientY - rect.top;
        }
        const adjustedX = (x - offset.x) / scale;
        const adjustedY = (y - offset.y) / scale;
        const cellX = Math.floor(adjustedX / cellSize);
        const cellY = Math.floor(adjustedY / cellSize);
        if (
          cellX >= 0 &&
          cellX < mapMetadata.width &&
          cellY >= 0 &&
          cellY < mapMetadata.height
        ) {
          setHoveredCell({ x: cellX, y: cellY });
        } else {
          setHoveredCell(null);
        }
      }

      // If dragging is active, update the offset
      if (isDragging.current) {
        let x, y;
        if (e.data && e.data.global) {
          ({ x, y } = e.data.global);
        } else {
          const rect = e.target.getBoundingClientRect();
          x = e.nativeEvent.clientX - rect.left;
          y = e.nativeEvent.clientY - rect.top;
        }
        const dx = x - dragStart.current.x;
        const dy = y - dragStart.current.y;
        const newOffset = {
          x: offsetStart.current.x + dx,
          y: offsetStart.current.y + dy,
        };
        setOffset(clampOffsetDuringDrag(newOffset, scale));
      }
    },
    [scale, offset, mapMetadata, cellSize, clampOffsetDuringDrag]
  );

  const handlePointerUp = useCallback(
    (e) => {
      disableDrag.current = false;

      let x, y;
      if (e.data?.global) {
        x = e.data.global.x;
        y = e.data.global.y;
      } else {
        const rect = e.target.getBoundingClientRect();
        x = e.nativeEvent.clientX - rect.left;
        y = e.nativeEvent.clientY - rect.top;
      }

      const dx = x - dragStart.current.x;
      const dy = y - dragStart.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const clickThreshold = 5;

      if (distance < clickThreshold) {
        const cell = getCellCoordinates(x, y);

        if (isWithinBounds(cell.x, cell.y)) {
          if (foundingNation) {
            onFoundNation?.(cell.x, cell.y);
            return;
          }

          if (buildingStructure) {
            onBuildCity?.(cell.x, cell.y, buildingStructure);
            return;
          }

          if (selectedArmy) {
            onArmyTargetSelect?.(selectedArmy.id, cell.x, cell.y);
            setSelectedArmy(null);
            return;
          }

          const armyAtPosition = findArmyAtPosition(
            Math.round(cell.x),
            Math.round(cell.y)
          );

          if (armyAtPosition && armyAtPosition.nation.owner === userId) {
            setSelectedArmy(armyAtPosition.army);
          } else {
            setSelectedArmy(null);
          }
        }
      }

      isDragging.current = false;
    },
    [
      getCellCoordinates,
      isWithinBounds,
      foundingNation,
      onFoundNation,
      buildingStructure, // Add this
      onBuildCity, // Add this
      selectedArmy,
      onArmyTargetSelect,
      findArmyAtPosition,
      userId,
    ]
  );

  const drawMap = useCallback(
    (g) => {
      if (!mapMetadata) return;
      g.clear();

      // Draw base map
      mapGrid.forEach(({ cell, x, y }) => {
        let fillColor = "#ccc";
        if (mappings) {
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
          fillColor = string2hex(defaultColors[biome] || "#ccc");
        }
        const pixelX = x * cellSize;
        const pixelY = y * cellSize;
        g.beginFill(fillColor);
        g.drawRect(pixelX, pixelY, cellSize, cellSize);
        g.endFill();
      });

      // Draw selection highlight for selected army
      if (selectedArmy) {
        const armyX = Math.round(selectedArmy.position.x);
        const armyY = Math.round(selectedArmy.position.y);

        // Draw outer glow
        g.lineStyle(6 / scale, 0x000000, 0.5);
        g.drawRect(armyX * cellSize, armyY * cellSize, cellSize, cellSize);

        // Draw main selection border
        g.lineStyle(3 / scale, 0xffff00, 1);
        g.drawRect(armyX * cellSize, armyY * cellSize, cellSize, cellSize);
      }

      // Draw hover effect when founding nation
      if (foundingNation && hoveredCell) {
        g.lineStyle(2 / scale, 0x00ff00);
        g.drawRect(
          hoveredCell.x * cellSize,
          hoveredCell.y * cellSize,
          cellSize,
          cellSize
        );
      }
    },
    [
      mapMetadata,
      mapGrid,
      mappings,
      cellSize,
      scale,
      selectedArmy,
      foundingNation,
      hoveredCell,
    ]
  );

  const renderNationOverlays = () => {
    const overlays = [];
    if (!gameState?.gameState?.nations) return overlays;

    gameState.gameState.nations.forEach((nation, nationIndex) => {
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
      const nationColor =
        nation.owner === userId
          ? "#FFFF00"
          : palette[nationIndex % palette.length];
      const baseColor = string2hex(nationColor);

      const territory = getMergedTerritory(nation);

      overlays.push(
        <Graphics
          key={`territory-${nation.owner}`}
          draw={(g) => {
            g.clear();
            // First, draw interior cells with lower opacity.
            g.beginFill(baseColor, 0.375);
            forEachTerritoryCell(territory, (x, y) => {
              if (!isBorderCell(x, y, territory)) {
                g.drawRect(x * cellSize, y * cellSize, cellSize, cellSize);
              }
            });
            g.endFill();

            // Then, draw border cells with higher opacity.
            g.beginFill(baseColor, 0.75);
            forEachTerritoryCell(territory, (x, y) => {
              if (isBorderCell(x, y, territory)) {
                g.drawRect(x * cellSize, y * cellSize, cellSize, cellSize);
              }
            });
            g.endFill();
          }}
        />
      );
      // Render cities with interactive sprites.
      (nation.cities || []).forEach((city, idx) => {
        const iconSize = 20 * Math.sqrt(scale);
        const centerX = city.x * cellSize + cellSize / 2;
        const centerY = city.y * cellSize + cellSize / 2;

        overlays.push(
          <BorderedSprite
            key={`city-${nation.owner}-${idx}`}
            texture="/village.png"
            x={centerX}
            y={centerY}
            width={iconSize}
            height={iconSize}
            borderColor={baseColor}
            borderWidth={2 * Math.sqrt(scale)}
            interactive={true}
            pointerdown={(e) => {
              // Stop propagation so that the cell click handler doesn't also fire.
              e.stopPropagation();
              // Call your city-specific handler.
              console.log("City clicked:", city);
              // For example, you might want to select the city or open a modal.
            }}
          />
        );
      });

      // Render armies with interactive sprites.
      (nation.armies || []).forEach((army, idx) => {
        const iconSize = 20 * Math.sqrt(scale);
        const centerX = army.position.x * cellSize + cellSize / 2;
        const centerY = army.position.y * cellSize + cellSize / 2;

        overlays.push(
          <BorderedSprite
            key={`army-${nation.owner}-${idx}`}
            texture={`/${army.type.toLowerCase().replace(" ", "_")}.png`}
            x={centerX}
            y={centerY}
            width={iconSize}
            height={iconSize}
            borderColor={baseColor}
            borderWidth={2 * Math.sqrt(scale)}
            interactive={true}
            isSelected={selectedArmy && selectedArmy.id === army.id}
            pointerdown={(e) => {
              e.stopPropagation();
              disableDrag.current = true; // prevent stage dragging for this pointer event
              console.log("Army clicked:", army);
              setSelectedArmy(army);
            }}
          />
        );
      });

      // Render expansion target (if needed, interactive too)
      if (nation.expansionTarget && nation.expansionTarget.ticksRemaining > 0) {
        const iconSize = 20 * Math.sqrt(scale);
        const centerX =
          nation.expansionTarget.current.x * cellSize + cellSize / 2;
        const centerY =
          nation.expansionTarget.current.y * cellSize + cellSize / 2;

        overlays.push(
          <BorderedSprite
            key={`expansion-${nation.owner}`}
            texture="/banner.png"
            x={centerX}
            y={centerY}
            width={iconSize}
            height={iconSize}
            borderColor={baseColor}
            borderWidth={2 * Math.sqrt(scale)}
            interactive={true}
            pointerdown={(e) => {
              e.stopPropagation();
              console.log("Expansion target clicked for", nation.owner);
              // Add logic for handling clicks on the expansion target if needed.
            }}
          />
        );
      }
    });

    return overlays;
  };

  return (
    <Stage
      interactive={true}
      width={stageWidth}
      height={stageHeight}
      options={{
        backgroundColor: 0xeeeeee,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      }}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        width: "100%",
        height: "100%",
        cursor:
          foundingNation || selectedArmy || buildingStructure
            ? "crosshair"
            : "default",
      }}
    >
      <Container x={offset.x} y={offset.y} scale={scale}>
        <Graphics draw={drawMap} />
        {renderNationOverlays()}
      </Container>
    </Stage>
  );
};

export default GameCanvas;
