import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { Stage, Container, Graphics, Sprite, Text } from "@pixi/react";
import * as PIXI from "pixi.js";
import { string2hex } from "@pixi/utils";
import BorderedSprite from "./BorderedSprite";
import { settings } from "@pixi/settings";
import { SCALE_MODES } from "@pixi/constants";
import MapTiles from "./MapTiles";
import MapChunks from "./MapChunks";

settings.SCALE_MODE = SCALE_MODES.NEAREST;

function capitalize(s) {
  return String(s[0]).toUpperCase() + String(s).slice(1);
}

const renderResources = (mapGrid, cellSize, scale) => {
  const resources = [];
  mapGrid.forEach(({ cell, x, y }) => {
    cell[5].forEach((resource, idx) => {
      const iconSize = cellSize;
      const spacing = iconSize / 2;
      const centerX = x * cellSize + spacing + idx * spacing;
      const centerY = y * cellSize + spacing;
      resources.push(
        <BorderedSprite
          key={`resource-${x}-${y}-${resource}`}
          texture={`/${resource}.png`}
          x={centerX}
          y={centerY}
          width={iconSize * 2}
          height={iconSize * 2}
          borderColor={0x000000}
          borderWidth={1 * Math.sqrt(scale)}
          interactive={true}
          pointerdown={(e) => {
            e.stopPropagation();
            console.log(`Resource clicked: ${resource} at ${x},${y}`);
          }}
          baseZ={50}
        />
      );
    });
  });
  return resources;
};

const GameCanvas = ({
  mapMetadata,
  mapGrid,
  mappings,
  gameState,
  userId,
  onArmyTargetSelect,
  foundingNation,
  onFoundNation,
  buildingStructure, // e.g. "farm", "mine", etc.
  onBuildCity,
  onCancelBuild,
}) => {
  const stageWidth = window.innerWidth;
  const stageHeight = window.innerHeight;
  const cellSize = mapMetadata ? stageWidth / mapMetadata.width : 1;

  const [scale, setScale] = useState(2);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const offsetStart = useRef({
    x: Math.floor(mapMetadata.width / 2),
    y: Math.floor(mapMetadata.height / 2),
  });
  const lastRenderTime = useRef(0);
  const [selectedArmy, setSelectedArmy] = useState(null);
  const [hoveredCell, setHoveredCell] = useState(null);
  const disableDrag = useRef(false);

  // Helper functions for territory checking (unchanged)
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
    let territory = { x: [], y: [] };
    if (nation.territory && nation.territory.x && nation.territory.y) {
      territory = {
        x: [...nation.territory.x],
        y: [...nation.territory.y],
      };
    } else if (
      nation.territoryDeltaForClient &&
      nation.territoryDeltaForClient.add
    ) {
      territory = {
        x: [...(nation.territoryDeltaForClient.add.x || [])],
        y: [...(nation.territoryDeltaForClient.add.y || [])],
      };
    }
    if (nation.territoryDeltaForClient && nation.territoryDeltaForClient.sub) {
      const subSet = new Set(
        nation.territoryDeltaForClient.sub.x.map(
          (x, i) => `${x},${nation.territoryDeltaForClient.sub.y[i]}`
        )
      );
      const merged = { x: [], y: [] };
      for (let i = 0; i < territory.x.length; i++) {
        const key = `${territory.x[i]},${territory.y[i]}`;
        if (!subSet.has(key)) {
          merged.x.push(territory.x[i]);
          merged.y.push(territory.y[i]);
        }
      }
      territory = merged;
    }
    return territory;
  };

  const isBorderCell = (x, y, territory) => {
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
    return adjacentPositions.some(
      (pos) => !hasCellInTerritory(territory, pos.x, pos.y)
    );
  };

  // Clamping functions (unchanged)
  const clampOffsetDuringDrag = useCallback(
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
        x: Math.min(maxX, Math.max(minX, offset.x)),
        y: Math.min(maxY, Math.max(minY, offset.y)),
      };
    },
    [stageWidth, stageHeight, mapMetadata]
  );

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

  const isWithinBounds = useCallback(
    (x, y) => {
      return (
        x >= 0 && x < mapMetadata.width && y >= 0 && y < mapMetadata.height
      );
    },
    [mapMetadata]
  );

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
          const armyX = Math.round(army.position.x);
          const armyY = Math.round(army.position.y);
          return armyX === x && armyY === y;
        });
        if (army) {
          if (army.attackTarget) return null;
          return { army, nation };
        }
      }
      return null;
    },
    [gameState]
  );

  // --- Build Mode Preview & Pointer Handlers ---

  const resourceStructureMapping = {
    farm: "food",
    "lumber mill": "wood",
    mine: ["stone", "bronze", "steel"],
    stable: "horses",
  };

  const textures = useMemo(() => {
    const result = {};
    if (mappings && mappings.biomes) {
      Object.values(mappings.biomes).forEach((biome) => {
        const key = biome.toLowerCase();
        result[key] = `/biomes/${key}.png`;
      });
    }
    result["default"] = `/grassland.png`;
    return result;
  }, [mappings]);

  let buildPreview = null;
  if (buildingStructure && hoveredCell) {
    const gridCell = mapGrid.find(
      (c) => c.x === hoveredCell.x && c.y === hoveredCell.y
    );
    const required = resourceStructureMapping[buildingStructure];
    const cellResources = gridCell ? gridCell.cell[5] : [];
    let resourceValid = false;

    if (Array.isArray(required)) {
      resourceValid = required.some((r) => cellResources.includes(r));
    } else {
      resourceValid = cellResources.includes(required);
    }
    const userNation = gameState?.gameState?.nations?.find(
      (n) => n.owner === userId
    );
    const territoryValid =
      userNation &&
      hasCellInTerritory(userNation.territory, hoveredCell.x, hoveredCell.y);
    resourceValid =
      resourceValid ||
      buildingStructure === "town" ||
      buildingStructure === "capital" ||
      buildingStructure === "fort";
    const valid = resourceValid && territoryValid;
    const borderColor = valid ? 0x00ff00 : 0xff0000;
    buildPreview = (
      <BorderedSprite
        texture={`/${buildingStructure.toLowerCase().replace(" ", "_")}.png`}
        x={hoveredCell.x * cellSize + cellSize / 2}
        y={hoveredCell.y * cellSize + cellSize / 2}
        width={cellSize * 2}
        height={cellSize * 2}
        borderColor={borderColor}
        borderWidth={2}
        alpha={0.5}
        zIndex={300}
      />
    );
  }

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
        const worldX = (mousePos.x - offset.x) / prevScale;
        const worldY = (mousePos.y - offset.y) / prevScale;
        const newOffset = {
          x: mousePos.x - worldX * newScale,
          y: mousePos.y - worldY * newScale,
        };
        setOffset(clampOffsetFinal(newOffset, newScale));
        return newScale;
      });
    },
    [offset, clampOffsetFinal]
  );

  const handlePointerDown = useCallback(
    (e) => {
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
      if (e.buttons === 0) {
        isDragging.current = false;
      }
      const currentTime = performance.now();
      if (currentTime - lastRenderTime.current < 16) {
        return;
      }
      lastRenderTime.current = currentTime;
      if (!isDragging.current) {
        let x, y;
        if (e.data && e.data.global) {
          ({ x, y } = e.data.global);
        } else {
          const rect = e.target.getBoundingClientRect();
          x = e.nativeEvent.clientX - rect.left;
          y = e.nativeEvent.clientY - rect.top;
        }
        const cell = getCellCoordinates(x, y);
        if (
          cell.x >= 0 &&
          cell.x < mapMetadata.width &&
          cell.y >= 0 &&
          cell.y < mapMetadata.height
        ) {
          setHoveredCell(cell);
        } else {
          setHoveredCell(null);
        }
      }
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
    [scale, offset, mapMetadata, getCellCoordinates, clampOffsetDuringDrag]
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
            const gridCell = mapGrid.find(
              (c) => c.x === cell.x && c.y === cell.y
            );
            const required = resourceStructureMapping[buildingStructure];
            const cellResources = gridCell ? gridCell.cell[5] : [];
            let resourceValid = false;
            if (Array.isArray(required)) {
              resourceValid = required.some((r) => cellResources.includes(r));
            } else {
              resourceValid = cellResources.includes(required);
            }
            const userNation = gameState?.gameState?.nations?.find(
              (n) => n.owner === userId
            );
            const territoryValid =
              userNation &&
              hasCellInTerritory(userNation.territory, cell.x, cell.y);
            resourceValid =
              resourceValid ||
              buildingStructure === "town" ||
              buildingStructure === "capital" ||
              buildingStructure === "fort";
            if (resourceValid && territoryValid) {
              onBuildCity?.(hoveredCell.x, hoveredCell.y, buildingStructure);
            }
            onCancelBuild();
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
      buildingStructure,
      onBuildCity,
      selectedArmy,
      onArmyTargetSelect,
      findArmyAtPosition,
      userId,
      mapGrid,
      gameState,
    ]
  );

  // ******************************************************************
  // Compute the "visible" grid based on the current offset and scale.
  // This filters out cells that are outside of the viewport.
  // ******************************************************************
  const visibleMapGrid = useMemo(() => {
    if (!mapMetadata) return [];
    const visibleCells = [];
    // Calculate viewport boundaries in world coordinates.
    const visibleLeft = -offset.x / scale;
    const visibleTop = -offset.y / scale;
    const visibleRight = visibleLeft + stageWidth / scale;
    const visibleBottom = visibleTop + stageHeight / scale;

    mapGrid.forEach(({ cell, x, y }) => {
      const cellLeft = x * cellSize;
      const cellTop = y * cellSize;
      const cellRight = cellLeft + cellSize;
      const cellBottom = cellTop + cellSize;
      if (
        cellRight >= visibleLeft &&
        cellLeft <= visibleRight &&
        cellBottom >= visibleTop &&
        cellTop <= visibleBottom
      ) {
        visibleCells.push({ cell, x, y });
      }
    });
    return visibleCells;
  }, [mapGrid, offset, scale, stageWidth, stageHeight, cellSize]);

  const memoizedResources = useMemo(
    () => renderResources(mapGrid, cellSize, scale),
    [mapGrid, cellSize, scale]
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
          zIndex={100}
          draw={(g) => {
            g.clear();
            g.beginFill(baseColor, 0.375);
            forEachTerritoryCell(territory, (x, y) => {
              if (!isBorderCell(x, y, territory)) {
                g.drawRect(x * cellSize, y * cellSize, cellSize, cellSize);
              }
            });
            g.endFill();
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
      (nation.cities || []).forEach((city, idx) => {
        const iconSize = cellSize;
        const centerX = city.x * cellSize + cellSize / 2;
        const centerY = city.y * cellSize + cellSize / 2;
        overlays.push(
          <BorderedSprite
            key={`city-${nation.owner}-${idx}`}
            texture={`/${city.type.toLowerCase().replace(" ", "_")}.png`}
            x={centerX}
            y={centerY}
            width={iconSize * 2}
            height={iconSize * 2}
            borderColor={baseColor}
            borderWidth={2 * Math.sqrt(scale)}
            interactive={true}
            pointerdown={(e) => {
              e.stopPropagation();
              console.log("City clicked:", city);
            }}
            baseZ={150 + centerY}
          />
        );
      });
      (nation.armies || []).forEach((army, idx) => {
        const iconSize = cellSize;
        const centerX = Math.floor(army.position.x) * cellSize + cellSize / 2;
        const centerY = Math.floor(army.position.y) * cellSize + cellSize / 2;
        overlays.push(
          <BorderedSprite
            key={`army-${nation.owner}-${idx}`}
            texture={`/${army.type.toLowerCase().replace(" ", "_")}.png`}
            x={centerX}
            y={centerY}
            width={iconSize * 2}
            height={iconSize * 2}
            borderColor={baseColor}
            borderWidth={2 * Math.sqrt(scale)}
            interactive={true}
            isSelected={selectedArmy && selectedArmy.id === army.id}
            pointerdown={(e) => {
              e.stopPropagation();
              disableDrag.current = true;
              console.log("Army clicked:", army);
              setSelectedArmy(army);
            }}
            baseZ={500 + centerY}
            text={`${army.currentPower}`}
          />
        );
      });
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
          buildingStructure || foundingNation || selectedArmy
            ? "crosshair"
            : "default",
      }}
    >
      <Container
        x={offset.x}
        y={offset.y}
        scale={scale}
        sortableChildren={true}
      >
        {/* Pass the filtered grid (only visible cells) to MapTiles */}
        <MapTiles
          mapGrid={visibleMapGrid}
          cellSize={cellSize}
          mappings={mappings}
          textures={textures}
        />
        {memoizedResources}
        {renderNationOverlays()}
        {buildPreview}
      </Container>
    </Stage>
  );
};

export default GameCanvas;
