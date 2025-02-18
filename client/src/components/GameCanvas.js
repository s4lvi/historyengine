// GameCanvas.jsx
import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { Stage, Container, Graphics } from "@pixi/react";
import { string2hex } from "@pixi/utils";
import BorderedSprite from "./BorderedSprite";
import { settings } from "@pixi/settings";
import { SCALE_MODES } from "@pixi/constants";
import MapTiles from "./MapTiles";

settings.SCALE_MODE = SCALE_MODES.NEAREST;

/* -------------------------------------------------------------------------- */
/*                     Helper Rendering Functions                           */
/* -------------------------------------------------------------------------- */

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
          width={iconSize}
          height={iconSize}
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

/* -------------------------------------------------------------------------- */
/*                           Custom Hooks                                    */
/* -------------------------------------------------------------------------- */

/**
 * usePanZoom
 *
 * Encapsulates the logic for computing cellSize, scale, offset,
 * and handling wheel zoom events.
 */
function usePanZoom({ mapMetadata, stageWidth, stageHeight }) {
  const cellSize = useMemo(
    () => (mapMetadata ? stageWidth / mapMetadata.width : 1),
    [mapMetadata, stageWidth]
  );

  const computedMinScale = useMemo(() => {
    if (!mapMetadata) return 1;
    const minScaleWidth = mapMetadata.width / 64;
    const minScaleHeight =
      (stageHeight * mapMetadata.width) / (stageWidth * 64);
    return Math.max(minScaleWidth, minScaleHeight);
  }, [mapMetadata, stageWidth, stageHeight]);

  const initialScale = computedMinScale > 2 ? computedMinScale : 2;

  const initialOffset = useMemo(() => {
    if (!mapMetadata) return { x: 0, y: 0 };
    return {
      x: (stageWidth * (1 - initialScale)) / 2,
      y:
        (stageHeight -
          (stageWidth * mapMetadata.height * initialScale) /
            mapMetadata.width) /
        2,
    };
  }, [mapMetadata, stageWidth, stageHeight, initialScale]);

  const [scale, setScale] = useState(initialScale);
  const [offset, setOffset] = useState(initialOffset);

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
        mousePos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      } else {
        return;
      }
      const delta = -(
        (e.originalEvent && e.originalEvent.deltaY) ||
        e.deltaY ||
        0
      );
      const zoomFactor = delta > 0 ? 1.1 : 0.9;
      setScale((prevScale) => {
        const newScale = Math.min(
          Math.max(prevScale * zoomFactor, computedMinScale),
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
    [offset, computedMinScale, clampOffsetFinal]
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

  return {
    cellSize,
    scale,
    offset,
    setOffset,
    setScale,
    handleWheel,
    getCellCoordinates,
    computedMinScale,
  };
}

/**
 * useSelection
 *
 * Encapsulates selection box state management.
 */
function useSelection() {
  const [selectionBox, setSelectionBox] = useState(null);

  const startSelection = useCallback((startPos) => {
    setSelectionBox({ start: startPos, end: startPos });
  }, []);

  const updateSelection = useCallback((newPos) => {
    setSelectionBox((prev) => (prev ? { ...prev, end: newPos } : prev));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectionBox(null);
  }, []);

  return { selectionBox, startSelection, updateSelection, clearSelection };
}

/* -------------------------------------------------------------------------- */
/*                              Main Component                              */
/* -------------------------------------------------------------------------- */

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

  // Use our custom pan/zoom hook
  const {
    cellSize,
    scale,
    offset,
    setOffset,
    handleWheel,
    getCellCoordinates,
  } = usePanZoom({ mapMetadata, stageWidth, stageHeight });

  // Use our selection hook
  const { selectionBox, startSelection, updateSelection, clearSelection } =
    useSelection();

  // Local state for unit selections and hovered cell
  const [selectedArmies, setSelectedArmies] = useState([]);
  const [selectedArmy, setSelectedArmy] = useState(null);
  const [hoveredCell, setHoveredCell] = useState(null);

  /* ----- Middle Mouse Panning State ----- */
  const [isPanning, setIsPanning] = useState(false);
  const panStartPosRef = useRef(null);
  const panStartOffsetRef = useRef(null);

  /* ----- Smoother WASD Panning via Animation Frame ----- */
  const keysRef = useRef({ w: false, a: false, s: false, d: false });
  useEffect(() => {
    const handleKeyDown = (e) => {
      const key = e.key.toLowerCase();
      if (["w", "a", "s", "d"].includes(key)) {
        keysRef.current[key] = true;
      }
    };
    const handleKeyUp = (e) => {
      const key = e.key.toLowerCase();
      if (["w", "a", "s", "d"].includes(key)) {
        keysRef.current[key] = false;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    let animationFrameId;
    let lastFrameTime = performance.now();
    const panSpeed = 0.5; // Adjust speed (pixels per ms)

    const update = () => {
      const now = performance.now();
      const deltaTime = now - lastFrameTime;
      lastFrameTime = now;
      let dx = 0,
        dy = 0;
      if (keysRef.current.w) dy += panSpeed * deltaTime;
      if (keysRef.current.s) dy -= panSpeed * deltaTime;
      if (keysRef.current.a) dx += panSpeed * deltaTime;
      if (keysRef.current.d) dx -= panSpeed * deltaTime;
      if (dx !== 0 || dy !== 0) {
        setOffset((prev) => ({
          x: prev.x + dx,
          y: prev.y + dy,
        }));
      }
      animationFrameId = requestAnimationFrame(update);
    };
    animationFrameId = requestAnimationFrame(update);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      cancelAnimationFrame(animationFrameId);
    };
  }, [setOffset]);

  /* ----- Pointer Handlers ----- */
  const handlePointerDown = useCallback(
    (e) => {
      let x, y;
      if (e.data && e.data.global) {
        ({ x, y } = e.data.global);
      } else {
        const rect = e.target.getBoundingClientRect();
        x = e.nativeEvent.clientX - rect.left;
        y = e.nativeEvent.clientY - rect.top;
      }
      // Check which button is pressed (0: left, 1: middle)
      const button = e.data?.originalEvent?.button ?? e.nativeEvent?.button;
      if (button === 1) {
        // Middle mouse pressed: start panning
        setIsPanning(true);
        panStartPosRef.current = { x, y };
        panStartOffsetRef.current = { ...offset };
        return;
      }
      // If not panning and no special mode active, start selection.
      if (
        !foundingNation &&
        !buildingStructure &&
        !selectedArmy &&
        selectedArmies.length === 0
      ) {
        startSelection({ x, y });
      }
    },
    [
      foundingNation,
      buildingStructure,
      selectedArmy,
      selectedArmies,
      offset,
      startSelection,
    ]
  );

  const handlePointerMove = useCallback(
    (e) => {
      let x, y;
      if (e.data && e.data.global) {
        ({ x, y } = e.data.global);
      } else {
        const rect = e.target.getBoundingClientRect();
        x = e.nativeEvent.clientX - rect.left;
        y = e.nativeEvent.clientY - rect.top;
      }
      // If middle mouse panning is active, update offset based on pointer movement.
      if (isPanning) {
        const deltaX = x - panStartPosRef.current.x;
        const deltaY = y - panStartPosRef.current.y;
        const newOffset = {
          x: panStartOffsetRef.current.x + deltaX,
          y: panStartOffsetRef.current.y + deltaY,
        };
        setOffset(newOffset);
        return;
      }
      // If a selection is active, update the selection box.
      if (selectionBox) {
        updateSelection({ x, y });
      } else {
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
    },
    [
      isPanning,
      selectionBox,
      updateSelection,
      getCellCoordinates,
      mapMetadata,
      setOffset,
    ]
  );

  const handlePointerUp = useCallback(
    (e) => {
      // If we were panning with the middle mouse button, end panning.
      if (isPanning) {
        setIsPanning(false);
        return;
      }
      let x, y;
      if (e.data?.global) {
        x = e.data.global.x;
        y = e.data.global.y;
      } else {
        const rect = e.target.getBoundingClientRect();
        x = e.nativeEvent.clientX - rect.left;
        y = e.nativeEvent.clientY - rect.top;
      }
      const cell = getCellCoordinates(x, y);
      if (
        cell.x < 0 ||
        cell.x >= mapMetadata.width ||
        cell.y < 0 ||
        cell.y >= mapMetadata.height
      ) {
        clearSelection();
        return;
      }
      if (foundingNation) {
        onFoundNation?.(cell.x, cell.y);
        return;
      }
      if (buildingStructure) {
        const gridCell = mapGrid.find((c) => c.x === cell.x && c.y === cell.y);
        const resourceStructureMapping = {
          farm: "food",
          "lumber mill": "wood",
          mine: ["stone", "bronze", "steel"],
          stable: "horses",
        };
        const required = resourceStructureMapping[buildingStructure];
        const cellResources = gridCell ? gridCell.cell[5] : [];
        let resourceValid = Array.isArray(required)
          ? required.some((r) => cellResources.includes(r))
          : cellResources.includes(required);
        const userNation = gameState?.gameState?.nations?.find(
          (n) => n.owner === userId
        );
        const territoryValid =
          userNation &&
          userNation.territory &&
          userNation.territory.x &&
          userNation.territory.y &&
          userNation.territory.x.includes(cell.x) &&
          userNation.territory.y.includes(cell.y);
        resourceValid =
          resourceValid ||
          ["town", "capital", "fort"].includes(buildingStructure);
        if (resourceValid && territoryValid) {
          onBuildCity?.(cell.x, cell.y, buildingStructure);
        }
        onCancelBuild();
        return;
      }
      if (selectionBox) {
        const adjustedStart = {
          x: (selectionBox.start.x - offset.x) / scale,
          y: (selectionBox.start.y - offset.y) / scale,
        };
        const adjustedEnd = {
          x: (selectionBox.end.x - offset.x) / scale,
          y: (selectionBox.end.y - offset.y) / scale,
        };
        const boxMinX = Math.min(adjustedStart.x, adjustedEnd.x);
        const boxMaxX = Math.max(adjustedStart.x, adjustedEnd.x);
        const boxMinY = Math.min(adjustedStart.y, adjustedEnd.y);
        const boxMaxY = Math.max(adjustedStart.y, adjustedEnd.y);
        const newlySelected = [];
        if (gameState?.gameState?.nations) {
          gameState.gameState.nations.forEach((nation) => {
            nation.armies?.forEach((army) => {
              const armyCenterX =
                Math.floor(army.position.x) * cellSize + cellSize / 2;
              const armyCenterY =
                Math.floor(army.position.y) * cellSize + cellSize / 2;
              if (
                armyCenterX >= boxMinX &&
                armyCenterX <= boxMaxX &&
                armyCenterY >= boxMinY &&
                armyCenterY <= boxMaxY
              ) {
                newlySelected.push(army);
              }
            });
          });
        }
        setSelectedArmies(newlySelected);
        clearSelection();
      } else {
        if (selectedArmies.length > 0) {
          selectedArmies.forEach((army) =>
            onArmyTargetSelect?.(army.id, cell.x, cell.y)
          );
          setSelectedArmies([]);
          return;
        }
        let foundArmy = null;
        if (gameState?.gameState?.nations) {
          for (const nation of gameState.gameState.nations) {
            const army = nation.armies?.find((army) => {
              const armyX = Math.round(army.position.x);
              const armyY = Math.round(army.position.y);
              return armyX === cell.x && armyY === cell.y && !army.attackTarget;
            });
            if (army) {
              foundArmy = { army, nation };
              break;
            }
          }
        }
        if (foundArmy && foundArmy.nation.owner === userId) {
          setSelectedArmy(foundArmy.army);
        } else {
          setSelectedArmy(null);
        }
      }
    },
    [
      getCellCoordinates,
      mapMetadata,
      foundingNation,
      onFoundNation,
      buildingStructure,
      onBuildCity,
      selectionBox,
      offset,
      scale,
      mapGrid,
      gameState,
      userId,
      clearSelection,
      onCancelBuild,
      selectedArmies,
      onArmyTargetSelect,
      cellSize,
    ]
  );

  // Memoize resources rendering
  const memoizedResources = useMemo(
    () => renderResources(mapGrid, cellSize, scale),
    [mapGrid, cellSize, scale]
  );

  // Prepare textures mapping for MapTiles
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

  /* ----- Render Selection Box ----- */
  const renderSelectionBox = () => {
    if (!selectionBox) return null;
    const { start, end } = selectionBox;
    const adjustedStart = {
      x: (start.x - offset.x) / scale,
      y: (start.y - offset.y) / scale,
    };
    const adjustedEnd = {
      x: (end.x - offset.x) / scale,
      y: (end.y - offset.y) / scale,
    };
    const x = Math.min(adjustedStart.x, adjustedEnd.x);
    const y = Math.min(adjustedStart.y, adjustedEnd.y);
    const width = Math.abs(adjustedEnd.x - adjustedStart.x);
    const height = Math.abs(adjustedEnd.y - adjustedStart.y);
    return (
      <Graphics
        draw={(g) => {
          g.clear();
          g.lineStyle(1, 0x00ff00, 1);
          g.drawRect(x, y, width, height);
        }}
        zIndex={10000}
      />
    );
  };

  /* ----- Inline Territory & Overlay Helpers (unchanged) ----- */
  const forEachTerritoryCell = (territory, callback) => {
    if (!territory || !territory.x || !territory.y) return;
    for (let i = 0; i < territory.x.length; i++) {
      callback(territory.x[i], territory.y[i], i);
    }
  };

  const hasCellInTerritory = (territory, x, y) => {
    if (!territory || !territory.x || !territory.y) return false;
    for (let i = 0; i < territory.x.length; i++) {
      if (territory.x[i] === x && territory.y[i] === y) return true;
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
    const adjacent = [
      { x: x - 1, y: y - 1 },
      { x, y: y - 1 },
      { x: x + 1, y: y - 1 },
      { x: x - 1, y },
      { x: x + 1, y },
      { x: x - 1, y: y + 1 },
      { x, y: y + 1 },
      { x: x + 1, y: y + 1 },
    ];
    return adjacent.some((pos) => !hasCellInTerritory(territory, pos.x, pos.y));
  };

  // Helper: Given an array of points, compute a smoothed polygon using Catmull–Rom interpolation.
  function computeSmoothPolygon(borderPoints, numOfSegments = 8) {
    // First, compute the centroid to sort points in order.
    let cx = 0,
      cy = 0;
    borderPoints.forEach((pt) => {
      cx += pt.x;
      cy += pt.y;
    });
    cx /= borderPoints.length;
    cy /= borderPoints.length;

    // Sort points by angle relative to the centroid.
    borderPoints.sort((a, b) => {
      return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx);
    });

    // Catmull–Rom interpolation function.
    const catmullRom = (p0, p1, p2, p3, t) => {
      const t2 = t * t;
      const t3 = t2 * t;
      return (
        0.5 *
        (2 * p1 +
          (-p0 + p2) * t +
          (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
          (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
      );
    };

    // Generate smoothed points.
    const smoothPoints = [];
    const pts = borderPoints;
    const n = pts.length;
    // Loop over each point in the ordered list.
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n];
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      const p3 = pts[(i + 2) % n];
      // Interpolate between p1 and p2.
      for (let j = 0; j < numOfSegments; j++) {
        const t = j / numOfSegments;
        const x = catmullRom(p0.x, p1.x, p2.x, p3.x, t);
        const y = catmullRom(p0.y, p1.y, p2.y, p3.y, t);
        smoothPoints.push(x, y);
      }
    }
    return smoothPoints;
  }

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
            width={iconSize}
            height={iconSize}
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
            width={iconSize}
            height={iconSize}
            borderColor={baseColor}
            borderWidth={2 * Math.sqrt(scale)}
            interactive={true}
            isSelected={selectedArmies.some((sel) => sel.id === army.id)}
            pointerdown={(e) => {
              e.stopPropagation();
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

  // Compute the visible portion of the map for performance.
  const visibleMapGrid = useMemo(() => {
    if (!mapMetadata) return [];
    const visibleCells = [];
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
        cellTop <= visibleTop + stageHeight / scale
      ) {
        visibleCells.push({ cell, x, y });
      }
    });
    return visibleCells;
  }, [mapGrid, offset, scale, stageWidth, stageHeight, cellSize]);

  // Build mode preview for structures
  let buildPreview = null;
  if (buildingStructure && hoveredCell) {
    const gridCell = mapGrid.find(
      (c) => c.x === hoveredCell.x && c.y === hoveredCell.y
    );
    const resourceStructureMapping = {
      farm: "food",
      "lumber mill": "wood",
      mine: ["stone", "bronze", "steel"],
      stable: "horses",
    };
    const required = resourceStructureMapping[buildingStructure];
    const cellResources = gridCell ? gridCell.cell[5] : [];
    let resourceValid = Array.isArray(required)
      ? required.some((r) => cellResources.includes(r))
      : cellResources.includes(required);
    const userNation = gameState?.gameState?.nations?.find(
      (n) => n.owner === userId
    );
    const territoryValid =
      userNation &&
      userNation.territory &&
      hasCellInTerritory(userNation.territory, hoveredCell.x, hoveredCell.y);
    resourceValid =
      resourceValid || ["town", "capital", "fort"].includes(buildingStructure);
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
        isSelected={true}
        borderWidth={2}
        alpha={0.5}
        zIndex={300}
      />
    );
  }

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
        <MapTiles
          mapGrid={visibleMapGrid}
          cellSize={cellSize}
          mappings={mappings}
          textures={textures}
        />
        {memoizedResources}
        {renderNationOverlays()}
        {buildPreview}
        {renderSelectionBox()}
      </Container>
    </Stage>
  );
};

export default GameCanvas;
