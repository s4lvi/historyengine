// GameCanvas.jsx
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Stage, Container, Graphics } from "@pixi/react";
import { settings } from "@pixi/settings";
import { SCALE_MODES } from "@pixi/constants";
import BorderedSprite from "./BorderedSprite";
import MapTiles from "./MapTiles";
import { useGameControls } from "./GameControls";
import { usePanZoom } from "./PanZoom";
import NationOverlay from "./NationOverlay";

settings.SCALE_MODE = SCALE_MODES.NEAREST;

const normalizePointerEvent = (e) => {
  // If it's a PIXI event
  if (e.data?.global) {
    return {
      position: { x: e.data.global.x, y: e.data.global.y },
      button: e.data.button ?? e.data.originalEvent?.button,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      originalEvent: e,
    };
  }

  // If it's a DOM event
  if (e.clientX !== undefined && e.clientY !== undefined && e.target) {
    const rect = e.target.getBoundingClientRect();
    return {
      position: {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      },
      button: e.button,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      originalEvent: e,
    };
  }

  return null;
};

// Helper to normalize wheel events
const normalizeWheelEvent = (e) => {
  let position;
  if (e.data?.global) {
    position = { x: e.data.global.x, y: e.data.global.y };
  } else if (e.clientX !== undefined && e.target) {
    const rect = e.target.getBoundingClientRect();
    position = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  return {
    position,
    deltaY: (e.data?.originalEvent || e).deltaY,
    originalEvent: e,
  };
};

/**
 * Main GameCanvas component
 */
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
  onCancelBuild,
}) => {
  const stageWidth = window.innerWidth;
  const stageHeight = window.innerHeight;
  const [hoveredCell, setHoveredCell] = useState(null);

  const {
    cellSize,
    scale,
    offset,
    setOffset,
    setScale,
    getCellCoordinates,
    computedMinScale,
    clampOffsetFinal,
  } = usePanZoom({
    mapMetadata,
    stageWidth,
    stageHeight,
  });

  const handlePointerEvent = useCallback((handler, e) => {
    const normalizedEvent = normalizePointerEvent(e);
    if (normalizedEvent) {
      handler(normalizedEvent);
    }
  }, []);

  const {
    gameMode,
    handleZoom,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  } = useGameControls({
    mapMetadata,
    scale,
    setScale,
    offset,
    setOffset,
    computedMinScale,
    clampOffsetFinal,
    getCellCoordinates,
    onFoundNation,
    onBuildCity,
    onArmyTargetSelect,
    userId,
    gameState,
  });

  useEffect(() => {
    if (foundingNation) {
      gameMode.enterFoundingMode();
    } else if (buildingStructure) {
      gameMode.enterBuildMode(buildingStructure);
    } else {
      // Exit any special mode (founding, building, etc.)
      gameMode.resetMode();
    }
  }, [foundingNation, buildingStructure]);

  const handleWheel = useCallback(
    (e) => {
      const delta = -(e.deltaY || e.data?.deltaY || 0);
      const point = e.data?.global || { x: e.clientX, y: e.clientY };
      if (point) {
        handleZoom(point, delta);
      }
    },
    [handleZoom]
  );

  const renderSelectionBox = useCallback(() => {
    if (!gameMode.selectionBox) return null;

    const adjustedStart = {
      x: (gameMode.selectionBox.start.x - offset.x) / scale,
      y: (gameMode.selectionBox.start.y - offset.y) / scale,
    };
    const adjustedEnd = {
      x: (gameMode.selectionBox.end.x - offset.x) / scale,
      y: (gameMode.selectionBox.end.y - offset.y) / scale,
    };

    return (
      <Graphics
        draw={(g) => {
          g.clear();
          g.lineStyle(1, 0x00ff00, 1);
          g.drawRect(
            Math.min(adjustedStart.x, adjustedEnd.x),
            Math.min(adjustedStart.y, adjustedEnd.y),
            Math.abs(adjustedEnd.x - adjustedStart.x),
            Math.abs(adjustedEnd.y - adjustedStart.y)
          );
        }}
        zIndex={10000}
      />
    );
  }, [gameMode.selectionBox, offset, scale]);

  // Update hover state from normalized pointer move events
  const handlePointerMoveWithHover = useCallback(
    (e) => {
      handlePointerEvent(handlePointerMove, e);

      const normalizedEvent = normalizePointerEvent(e);
      if (normalizedEvent?.position) {
        const cell = getCellCoordinates(
          normalizedEvent.position.x,
          normalizedEvent.position.y
        );
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
    },
    [handlePointerMove, getCellCoordinates, mapMetadata]
  );

  // Calculate visible portion of the map
  const visibleMapGrid = useMemo(() => {
    if (!mapMetadata) return [];

    const visibleLeft = -offset.x / scale;
    const visibleTop = -offset.y / scale;
    const visibleRight = visibleLeft + stageWidth / scale;
    const visibleBottom = visibleTop + stageHeight / scale;

    return mapGrid.filter(({ x, y }) => {
      const cellLeft = x * cellSize;
      const cellTop = y * cellSize;
      const cellRight = cellLeft + cellSize;
      const cellBottom = cellTop + cellSize;

      return (
        cellRight >= visibleLeft &&
        cellLeft <= visibleRight &&
        cellBottom >= visibleTop &&
        cellTop <= visibleBottom
      );
    });
  }, [mapGrid, offset, scale, stageWidth, stageHeight, cellSize, mapMetadata]);

  // Prepare textures for MapTiles
  const textures = useMemo(() => {
    const result = { default: "/grassland.png" };
    if (mappings?.biomes) {
      Object.values(mappings.biomes).forEach((biome) => {
        const key = biome.toLowerCase();
        result[key] = `/biomes/${key}.png`;
      });
    }
    return result;
  }, [mappings]);

  // Render resources
  const resources = useMemo(() => {
    return visibleMapGrid.flatMap(({ cell, x, y }) =>
      cell[5].map((resource, idx) => {
        const spacing = cellSize / 2;
        const centerX = x * cellSize + spacing + idx * spacing;
        const centerY = y * cellSize + spacing;

        return (
          <BorderedSprite
            key={`resource-${x}-${y}-${resource}`}
            texture={`/${resource}.png`}
            x={centerX}
            y={centerY}
            width={cellSize}
            height={cellSize}
            borderColor={0x000000}
            borderWidth={1 * Math.sqrt(scale)}
            interactive={true}
            baseZ={50}
          />
        );
      })
    );
  }, [visibleMapGrid, cellSize, scale]);

  // Build mode preview
  const buildPreview = useMemo(() => {
    if (!buildingStructure || !hoveredCell) return null;

    const gridCell = mapGrid.find(
      (c) => c.x === hoveredCell.x && c.y === hoveredCell.y
    );

    const resourceMapping = {
      farm: "food",
      "lumber mill": "wood",
      mine: ["stone", "bronze", "steel"],
      stable: "horses",
    };

    const required = resourceMapping[buildingStructure];
    const cellResources = gridCell?.cell[5] || [];

    let resourceValid = Array.isArray(required)
      ? required.some((r) => cellResources.includes(r))
      : cellResources.includes(required);

    const userNation = gameState?.gameState?.nations?.find(
      (n) => n.owner === userId
    );

    const territoryValid =
      userNation?.territory?.x?.includes(hoveredCell.x) &&
      userNation?.territory?.y?.includes(hoveredCell.y);

    resourceValid =
      resourceValid || ["town", "capital", "fort"].includes(buildingStructure);

    const valid = resourceValid && territoryValid;

    return (
      <BorderedSprite
        texture={`/${buildingStructure.toLowerCase().replace(" ", "_")}.png`}
        x={hoveredCell.x * cellSize + cellSize / 2}
        y={hoveredCell.y * cellSize + cellSize / 2}
        width={cellSize * 2}
        height={cellSize * 2}
        borderColor={valid ? 0x00ff00 : 0xff0000}
        isSelected={true}
        borderWidth={2}
        alpha={0.5}
        zIndex={300}
        interactive={true}
      />
    );
  }, [buildingStructure, hoveredCell, mapGrid, gameState, userId, cellSize]);

  return (
    <Stage
      width={stageWidth}
      height={stageHeight}
      options={{
        backgroundColor: 0xeeeeee,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      }}
      onWheel={handleWheel}
      onPointerDown={(e) => handlePointerEvent(handlePointerDown, e)}
      onPointerMove={handlePointerMoveWithHover}
      onPointerUp={(e) => handlePointerEvent(handlePointerUp, e)}
      onPointerLeave={(e) => handlePointerEvent(handlePointerUp, e)}
      style={{
        width: "100%",
        height: "100%",
        cursor: gameMode.mode !== "default" ? "crosshair" : "default",
        touchAction: "none",
      }}
    >
      <Container
        x={offset.x}
        y={offset.y}
        scale={scale}
        sortableChildren={true}
      >
        <MapTiles
          mapGrid={visibleMapGrid}
          cellSize={cellSize}
          mappings={mappings}
          textures={textures}
        />

        {resources}

        {gameState?.gameState?.nations?.map((nation, idx) => (
          <NationOverlay
            key={`nation-${nation.owner}`}
            nation={nation}
            nationIndex={idx}
            cellSize={cellSize}
            scale={scale}
            gameMode={gameMode}
            userId={userId}
            onArmySelect={(army) => gameMode.enterArmyMode([army])}
          />
        ))}

        {buildPreview}
        {renderSelectionBox()}
      </Container>
    </Stage>
  );
};

export default GameCanvas;
