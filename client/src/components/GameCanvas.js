// GameCanvas.jsx
import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { Stage, Container, Graphics, Text, Sprite } from "@pixi/react";
import { string2hex } from "@pixi/utils";
import BorderedSprite from "./BorderedSprite";
import { settings } from "@pixi/settings";
import { SCALE_MODES } from "@pixi/constants";
import MapTiles from "./MapTiles";
import { SCALE_MODES as PIXI_SCALE_MODES } from "pixi.js";

settings.SCALE_MODE = SCALE_MODES.NEAREST;

/* -------------------------------------------------------------------------- */
/*                     Helper Rendering Functions                           */
/* -------------------------------------------------------------------------- */

const resourceIconMap = {
  iron: "steel",
  gold: "bronze",
};

const renderResources = (mapGrid, cellSize, scale) => {
  const resources = [];
  const zoomBoost = Math.min(
    3,
    Math.max(1, Math.pow(1 / Math.max(scale || 1, 0.15), 1.25))
  );
  mapGrid.forEach(({ cell, x, y }) => {
    if (!cell || !Array.isArray(cell[5]) || cell[5].length === 0) return;
    const iconSize = cellSize * 0.8 * zoomBoost;
    const spacing = iconSize * 0.7;
    const centerX = x * cellSize + cellSize / 2;
    const centerY = y * cellSize + cellSize / 2;
    const startOffset = -((cell[5].length - 1) * spacing) / 2;
    cell[5].forEach((resource, idx) => {
      const iconName = resourceIconMap[resource] || resource;
      resources.push(
        <BorderedSprite
          key={`resource-${x}-${y}-${resource}`}
          texture={`/${iconName}.png`}
          x={centerX + startOffset + idx * spacing}
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

const renderResourceCaptureOverlays = (
  mapGrid,
  cellSize,
  scale,
  ownershipMap,
  resourceNodeClaims,
  captureTicks
) => {
  const overlays = [];
  mapGrid.forEach(({ cell, x, y }) => {
    if (!cell || !Array.isArray(cell[5]) || cell[5].length === 0) return;
    const key = `${x},${y}`;
    const owner = ownershipMap.get(key);
    if (!owner) return;
    const claim = resourceNodeClaims?.[key];
    if (!claim) return;
    const isCaptured = claim.owner === owner;
    const progressOwner = claim.progressOwner;
    if (!isCaptured && progressOwner !== owner) return;
    const progress = Math.min(
      1,
      (claim.progress || 0) / Math.max(1, captureTicks)
    );
    const size = cellSize * 1.05;
    const cx = x * cellSize + cellSize / 2;
    const cy = y * cellSize + cellSize / 2;

    // Use resource-specific icon instead of generic fort
    const resourceType = cell[5][0];
    const iconName = resourceIconMap[resourceType] || resourceType;

    overlays.push(
      <BorderedSprite
        key={`capture-building-${key}`}
        texture={`/${iconName}.png`}
        x={cx}
        y={cy + size * 0.05}
        width={size * 0.9}
        height={size * 0.9}
        borderColor={0x6e6e6e}
        borderWidth={1}
        alpha={isCaptured ? 0.9 : 0.6}
        baseZ={112}
      />
    );
    if (isCaptured) return;
    overlays.push(
      <Graphics
        key={`capture-${key}`}
        zIndex={115}
        draw={(g) => {
          g.clear();
          // pie timer - increased radius for better visibility
          const radius = size * 0.75;
          const pieY = cy;
          // Draw outline first
          g.lineStyle(2, 0xffffff, 0.8);
          g.drawCircle(cx, pieY, radius);
          // Then draw pie fill on top
          g.beginFill(0x1c2331, 0.6);
          g.moveTo(cx, pieY);
          const start = -Math.PI / 2;
          const end = start + progress * Math.PI * 2;
          g.arc(cx, pieY, radius, start, end);
          g.lineTo(cx, pieY);
          g.endFill();
        }}
      />
    );
  });
  return overlays;
};

// Simplify arrow path by keeping every Nth point plus start/end
const simplifyArrowPath = (path, n = 3) => {
  if (!path || path.length < 2) return path;
  const result = [path[0]];
  for (let i = n; i < path.length - 1; i += n) {
    result.push(path[i]);
  }
  if (path.length > 1) {
    result.push(path[path.length - 1]);
  }
  return result;
};

// Render an arrow path with arrowhead and troop count
const renderArrowPath = (path, cellSize, type, isActive, key, troopCount = null) => {
  if (!path || path.length < 2) return null;

  const color = type === "attack" ? 0xff4444 : 0x4444ff;
  const alpha = isActive ? 0.8 : 0.6;

  // Calculate midpoint for troop display
  const midIndex = Math.floor(path.length / 2);
  const midPoint = path[midIndex];
  const midX = midPoint.x * cellSize + cellSize / 2;
  const midY = midPoint.y * cellSize + cellSize / 2;

  return (
    <React.Fragment key={key}>
      <Graphics
        zIndex={200}
        draw={(g) => {
          g.clear();
          g.lineStyle(4, color, alpha);

          // Draw the path
          const startX = path[0].x * cellSize + cellSize / 2;
          const startY = path[0].y * cellSize + cellSize / 2;
          g.moveTo(startX, startY);

          for (let i = 1; i < path.length; i++) {
            const px = path[i].x * cellSize + cellSize / 2;
            const py = path[i].y * cellSize + cellSize / 2;
            g.lineTo(px, py);
          }

          // Draw arrowhead at the end
          if (path.length >= 2) {
            const last = path[path.length - 1];
            const prev = path[path.length - 2];
            const endX = last.x * cellSize + cellSize / 2;
            const endY = last.y * cellSize + cellSize / 2;
            const prevX = prev.x * cellSize + cellSize / 2;
            const prevY = prev.y * cellSize + cellSize / 2;

            const angle = Math.atan2(endY - prevY, endX - prevX);
            const arrowSize = cellSize * 0.8;

            g.beginFill(color, alpha);
            g.moveTo(endX, endY);
            g.lineTo(
              endX - arrowSize * Math.cos(angle - Math.PI / 6),
              endY - arrowSize * Math.sin(angle - Math.PI / 6)
            );
            g.lineTo(
              endX - arrowSize * 0.5 * Math.cos(angle),
              endY - arrowSize * 0.5 * Math.sin(angle)
            );
            g.lineTo(
              endX - arrowSize * Math.cos(angle + Math.PI / 6),
              endY - arrowSize * Math.sin(angle + Math.PI / 6)
            );
            g.lineTo(endX, endY);
            g.endFill();
          }
        }}
      />
      {troopCount !== null && (
        <>
          {/* Background circle for troop count */}
          <Graphics
            zIndex={201}
            draw={(g) => {
              g.clear();
              g.beginFill(0x000000, 0.7);
              g.drawCircle(midX, midY - cellSize * 0.8, cellSize * 0.6);
              g.endFill();
              g.lineStyle(2, color, 1);
              g.drawCircle(midX, midY - cellSize * 0.8, cellSize * 0.6);
            }}
          />
          <Text
            text={Math.round(troopCount).toString()}
            x={midX}
            y={midY - cellSize * 0.8}
            anchor={0.5}
            zIndex={202}
            style={{
              fontFamily: "system-ui",
              fill: "#ffffff",
              fontSize: Math.max(10, cellSize * 0.5),
              fontWeight: "bold",
            }}
          />
        </>
      )}
    </React.Fragment>
  );
};

// Render completed arrow with fade out animation
const renderCompletedArrow = (arrow, cellSize, elapsedMs) => {
  if (!arrow.path || arrow.path.length < 2) return null;

  const progress = Math.min(1, elapsedMs / 2000); // 2 second animation
  const alpha = 1 - progress;
  const floatOffset = progress * cellSize * 2; // Float upward

  const color = arrow.success ? 0x44ff44 : 0xff4444;
  const displayTroops = arrow.success ? arrow.troops : 0;

  // Calculate midpoint for display
  const midIndex = Math.floor(arrow.path.length / 2);
  const midPoint = arrow.path[midIndex];
  const midX = midPoint.x * cellSize + cellSize / 2;
  const midY = midPoint.y * cellSize + cellSize / 2 - floatOffset;

  return (
    <React.Fragment key={arrow.id}>
      {/* Fading troop count */}
      <Graphics
        zIndex={300}
        draw={(g) => {
          g.clear();
          g.beginFill(0x000000, 0.7 * alpha);
          g.drawCircle(midX, midY, cellSize * 0.8);
          g.endFill();
          g.lineStyle(3, color, alpha);
          g.drawCircle(midX, midY, cellSize * 0.8);
        }}
      />
      <Text
        text={displayTroops.toString()}
        x={midX}
        y={midY}
        anchor={0.5}
        zIndex={301}
        alpha={alpha}
        style={{
          fontFamily: "system-ui",
          fill: arrow.success ? "#44ff44" : "#ff4444",
          fontSize: Math.max(14, cellSize * 0.7),
          fontWeight: "bold",
          stroke: "#000000",
          strokeThickness: 2,
        }}
      />
    </React.Fragment>
  );
};

// Note: renderTowers for resource upgrades has been removed
// Towers are now handled as structures within nations.cities

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
    const naturalMapHeight = (stageWidth * mapMetadata.height) / mapMetadata.width;
    const fitScale =
      naturalMapHeight > stageHeight
        ? stageHeight / naturalMapHeight
        : 1;
    return Math.min(1, fitScale);
  }, [mapMetadata, stageWidth, stageHeight]);

  const initialScale = computedMinScale;

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
  const scaleRef = useRef(scale);
  const offsetRef = useRef(offset);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

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

  const zoomAtPoint = useCallback(
    (screenX, screenY, targetScale) => {
      const prevScale = scaleRef.current;
      const prevOffset = offsetRef.current;
      const nextScale = Math.min(Math.max(targetScale, computedMinScale), 14);
      const worldX = (screenX - prevOffset.x) / prevScale;
      const worldY = (screenY - prevOffset.y) / prevScale;
      const newOffset = {
        x: screenX - worldX * nextScale,
        y: screenY - worldY * nextScale,
      };
      setScale(nextScale);
      setOffset(clampOffsetFinal(newOffset, nextScale));
    },
    [computedMinScale, clampOffsetFinal]
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
      zoomAtPoint(
        mousePos.x,
        mousePos.y,
        scaleRef.current * zoomFactor
      );
    },
    [zoomAtPoint]
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
    zoomAtPoint,
    getCellCoordinates,
    computedMinScale,
  };
}

/* -------------------------------------------------------------------------- */
/*                         Helper: Territory Merging                        */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/*                    New Component: NationOverlay                          */
/* -------------------------------------------------------------------------- */

/**
 * NationOverlay
 *
 * This component renders a nation’s territory and cities.
 * It memoizes the territory lookup set and border cells so that border
 * detection only happens when the territory actually changes.
 */
const NationOverlay = ({
  nation,
  nationIndex,
  cellSize,
  scale,
  userId,
  nationColors,
  ownershipMap,
  visibleBounds,
}) => {
  const palette = [
    "#FF3B30",
    "#34C759",
    "#0A84FF",
    "#FF9F0A",
    "#BF5AF2",
    "#FF375F",
    "#64D2FF",
    "#FFD60A",
    "#32D74B",
    "#5E5CE6",
  ];
  const nationColor =
    nationColors?.[nation.owner] ||
    palette[nationIndex % palette.length];
  const baseColor = string2hex(nationColor);

  // Compute the merged territory for this nation.
  const territory = useMemo(() => getMergedTerritory(nation), [nation]);
  const territorySet = useMemo(() => {
    const set = new Set();
    for (let i = 0; i < territory.x.length; i++) {
      set.add(`${territory.x[i]},${territory.y[i]}`);
    }
    return set;
  }, [territory]);

  const territoryCentroid = useMemo(() => {
    if (!territory.x.length) return null;
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < territory.x.length; i++) {
      sumX += territory.x[i];
      sumY += territory.y[i];
    }
    return {
      x: sumX / territory.x.length,
      y: sumY / territory.y.length,
    };
  }, [territory]);
  const showBorders = scale > 0.35;
  const showCities = scale > 0.4;
  const showLabels = scale > 0.55;

  const rowRuns = useMemo(() => {
    const rows = new Map();
    const minX = visibleBounds?.minX ?? -Infinity;
    const maxX = visibleBounds?.maxX ?? Infinity;
    const minY = visibleBounds?.minY ?? -Infinity;
    const maxY = visibleBounds?.maxY ?? Infinity;
    const useCulling = scale < 0.7 && visibleBounds;
    for (let i = 0; i < territory.x.length; i++) {
      const x = territory.x[i];
      const y = territory.y[i];
      if (useCulling) {
        if (x < minX || x > maxX || y < minY || y > maxY) continue;
      }
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push(x);
    }
    const runs = [];
    rows.forEach((xs, y) => {
      xs.sort((a, b) => a - b);
      let start = xs[0];
      let prev = xs[0];
      for (let i = 1; i < xs.length; i++) {
        const cur = xs[i];
        if (cur === prev + 1) {
          prev = cur;
          continue;
        }
        runs.push({ y, start, end: prev });
        start = cur;
        prev = cur;
      }
      if (start !== undefined) {
        runs.push({ y, start, end: prev });
      }
    });
    return runs;
  }, [territory, visibleBounds, scale]);

  const borderSegments = useMemo(() => {
    const segments = [];
    const directions = [
      { dx: 0, dy: -1, x1: 0, y1: 0, x2: 1, y2: 0, side: "top" }, // top
      { dx: 1, dy: 0, x1: 1, y1: 0, x2: 1, y2: 1, side: "right" }, // right
      { dx: 0, dy: 1, x1: 1, y1: 1, x2: 0, y2: 1, side: "bottom" }, // bottom
      { dx: -1, dy: 0, x1: 0, y1: 1, x2: 0, y2: 0, side: "left" }, // left
    ];
    if (scale < 0.5) return segments;
    for (let i = 0; i < territory.x.length; i++) {
      const x = territory.x[i];
      const y = territory.y[i];
      for (const dir of directions) {
        const nx = x + dir.dx;
        const ny = y + dir.dy;
        if (!territorySet.has(`${nx},${ny}`)) {
          segments.push({
            x1: (x + dir.x1),
            y1: (y + dir.y1),
            x2: (x + dir.x2),
            y2: (y + dir.y2),
            side: dir.side,
          });
        }
      }
    }
    return segments;
  }, [territory, territorySet, ownershipMap, nation.owner]);

  return (
    <>
      <Graphics
        key={`territory-${nation.owner}`}
        zIndex={100}
        draw={(g) => {
          g.clear();
          // Draw merged horizontal runs to avoid per-tile fills.
          g.beginFill(baseColor, 0.6);
          for (let i = 0; i < rowRuns.length; i++) {
            const run = rowRuns[i];
            const width = (run.end - run.start + 1) * cellSize;
            g.drawRect(run.start * cellSize, run.y * cellSize, width, cellSize);
          }
          g.endFill();
        }}
      />
      {showBorders && (
        <Graphics
          key={`border-${nation.owner}`}
          zIndex={120}
          draw={(g) => {
            g.clear();
            const lineWidth = 2;
            const inset = Math.min(0.24, 3 / cellSize);
            g.lineStyle(lineWidth, baseColor, 1);
            for (let i = 0; i < borderSegments.length; i++) {
              const seg = borderSegments[i];
              let x1 = seg.x1;
              let y1 = seg.y1;
              let x2 = seg.x2;
              let y2 = seg.y2;
              if (seg.side === "top") {
                y1 += inset;
                y2 += inset;
              } else if (seg.side === "bottom") {
                y1 -= inset;
                y2 -= inset;
              } else if (seg.side === "left") {
                x1 += inset;
                x2 += inset;
              } else if (seg.side === "right") {
                x1 -= inset;
                x2 -= inset;
              }
              g.moveTo(x1 * cellSize, y1 * cellSize);
              g.lineTo(x2 * cellSize, y2 * cellSize);
            }
          }}
        />
      )}
      {showLabels && territoryCentroid && (
        <Text
          text={nation.owner}
          x={territoryCentroid.x * cellSize}
          y={territoryCentroid.y * cellSize}
          anchor={0.5}
          zIndex={130}
          style={{
            fontFamily: "system-ui",
            fill: "#ffffff",
            fontSize: Math.max(10, 12 / Math.max(scale, 0.5)),
            stroke: "#000000",
            strokeThickness: 3,
          }}
          alpha={scale > 3.5 ? 0.2 : 0.9}
        />
      )}
      {showCities &&
        (nation.cities || []).map((city, idx) => {
          const iconSize = cellSize;
          const centerX = city.x * cellSize + cellSize / 2;
          const centerY = city.y * cellSize + cellSize / 2;
          const showName = scale > 1.5 && city.name;
          return (
            <React.Fragment key={`city-${nation.owner}-${idx}`}>
              <BorderedSprite
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
              {showName && (
                <Text
                  text={city.name}
                  x={centerX}
                  y={centerY + iconSize * 0.6}
                  anchor={0.5}
                  zIndex={151 + centerY}
                  style={{
                    fontFamily: "system-ui",
                    fill: "#ffffff",
                    fontSize: Math.max(8, 10 / Math.max(scale, 0.8)),
                    stroke: "#000000",
                    strokeThickness: 2,
                  }}
                  alpha={0.9}
                />
              )}
            </React.Fragment>
          );
        })}
    </>
  );
};

/* -------------------------------------------------------------------------- */
/*                              Main Component                              */
/* -------------------------------------------------------------------------- */

const GameCanvas = ({
  mapMetadata,
  mapGrid,
  mappings,
  gameState,
  userId,
  nationColors,
  config,
  foundingNation,
  onFoundNation,
  buildingStructure,
  onBuildCity,
  onCancelBuild,
  placingTower,
  onPlaceTower,
  drawingArrowType,
  currentArrowPath,
  onArrowPathUpdate,
  onSendArrow,
  onCancelArrow,
  activeAttackArrow,
  activeDefendArrow,
  completedArrows,
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
    zoomAtPoint,
    getCellCoordinates,
    computedMinScale,
  } = usePanZoom({ mapMetadata, stageWidth, stageHeight });

  // Local state for unit selections and hovered cell
  const [hoveredCell, setHoveredCell] = useState(null);
  const hoverFrameRef = useRef(null);
  const pendingHoverRef = useRef(null);
  const nations = gameState?.gameState?.nations || [];
  const resourceNodeClaims = gameState?.gameState?.resourceNodeClaims || {};
  const captureTicks =
    config?.territorial?.resourceCaptureTicks || 20;
  const ownershipMap = useMemo(() => {
    const map = new Map();
    nations.forEach((nation) => {
      const tx = nation?.territory?.x || [];
      const ty = nation?.territory?.y || [];
      for (let i = 0; i < tx.length; i++) {
        map.set(`${tx[i]},${ty[i]}`, nation.owner);
      }
    });
    return map;
  }, [nations]);

  const mapGridByRow = useMemo(() => {
    if (!mapMetadata) return [];
    const rows = Array.from({ length: mapMetadata.height }, () =>
      Array.from({ length: mapMetadata.width }, () => null)
    );
    for (let i = 0; i < mapGrid.length; i++) {
      const entry = mapGrid[i];
      if (!entry) continue;
      const { cell, x, y } = entry;
      if (y >= 0 && y < rows.length && x >= 0 && x < rows[y].length) {
        rows[y][x] = cell;
      }
    }
    return rows;
  }, [mapGrid, mapMetadata]);

  const biomeColors = useMemo(
    () => ({
      OCEAN: 0x1b4f72,
      COASTAL: 0x2e86c1,
      RIVER: 0x3498db,
      MOUNTAIN: 0x7f8c8d,
      DESERT: 0xd4ac0d,
      SAVANNA: 0xa9c46a,
      TROPICAL_FOREST: 0x1e8449,
      RAINFOREST: 0x145a32,
      TUNDRA: 0xd6eaf8,
      TAIGA: 0x4d9078,
      GRASSLAND: 0x6aa84f,
      WOODLAND: 0x3d7b3f,
      FOREST: 0x1b5e20,
      default: 0x6aa84f,
    }),
    []
  );

  const fullMapImageUrl = useMemo(() => {
    if (!mapMetadata || mapGridByRow.length === 0) return null;
    const width = mapMetadata.width;
    const height = mapMetadata.height;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;
    const biomeLookup = mappings?.biomes || {};
    for (let y = 0; y < height; y++) {
      const row = mapGridByRow[y];
      if (!row) continue;
      for (let x = 0; x < width; x++) {
        const cell = row[x];
        if (!cell) continue;
        const biomeName = biomeLookup[cell[3]] || "default";
        const color = biomeColors[biomeName] ?? biomeColors.default;
        const idx = (y * width + x) * 4;
        data[idx] = (color >> 16) & 0xff;
        data[idx + 1] = (color >> 8) & 0xff;
        data[idx + 2] = color & 0xff;
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL();
  }, [mapMetadata, mapGridByRow, mappings, biomeColors]);

  useEffect(() => {
    return () => {
      if (hoverFrameRef.current) {
        cancelAnimationFrame(hoverFrameRef.current);
      }
    };
  }, []);

  /* ----- Middle Mouse Panning State ----- */
  const [isPanning, setIsPanning] = useState(false);
  const panStartPosRef = useRef(null);
  const panStartOffsetRef = useRef(null);
  const dragStartRef = useRef(null);
  const suppressClickRef = useRef(false);
  const lastPointerRef = useRef(null);
  const pointersRef = useRef(new Map());
  const pinchRef = useRef(null);

  /* ----- Arrow Drawing State ----- */
  const isDrawingArrowRef = useRef(false);
  const arrowPathRef = useRef([]);
  const lastArrowPointRef = useRef(null);

  /* ----- Arrow Animation State ----- */
  const [animationTick, setAnimationTick] = useState(0);

  // Force re-renders for completed arrow animations
  useEffect(() => {
    if (!completedArrows || completedArrows.length === 0) return;
    const interval = setInterval(() => {
      setAnimationTick((t) => t + 1);
    }, 50); // 20fps animation
    return () => clearInterval(interval);
  }, [completedArrows?.length]);

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
      const pointerId =
        e.data?.pointerId ?? e.data?.identifier ?? e.nativeEvent?.pointerId;
      const pointerType =
        e.data?.pointerType ?? e.nativeEvent?.pointerType ?? "mouse";
      if (pointerId !== undefined) {
        pointersRef.current.set(pointerId, { x, y, pointerType });
        if (pointersRef.current.size === 2) {
          const points = Array.from(pointersRef.current.values());
          const dx = points[0].x - points[1].x;
          const dy = points[0].y - points[1].y;
          pinchRef.current = {
            distance: Math.hypot(dx, dy),
            scale,
          };
          suppressClickRef.current = true;
          setIsPanning(true);
          return;
        }
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
      // Arrow drawing mode
      if (button === 0 && drawingArrowType) {
        const cell = getCellCoordinates(x, y);
        if (
          cell.x >= 0 &&
          cell.x < mapMetadata.width &&
          cell.y >= 0 &&
          cell.y < mapMetadata.height
        ) {
          isDrawingArrowRef.current = true;
          arrowPathRef.current = [{ x: cell.x, y: cell.y }];
          lastArrowPointRef.current = { x: cell.x, y: cell.y };
          onArrowPathUpdate?.([{ x: cell.x, y: cell.y }]);
        }
        return;
      }
      // Left-drag to pan when not in action modes.
      if (button === 0 && !foundingNation && !buildingStructure && !placingTower) {
        dragStartRef.current = { x, y };
        panStartPosRef.current = { x, y };
        panStartOffsetRef.current = { ...offset };
        suppressClickRef.current = false;
      }
    },
    [foundingNation, buildingStructure, placingTower, drawingArrowType, offset, scale, getCellCoordinates, mapMetadata, onArrowPathUpdate]
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
      lastPointerRef.current = { x, y };
      const pointerId =
        e.data?.pointerId ?? e.data?.identifier ?? e.nativeEvent?.pointerId;
      if (pointerId !== undefined) {
        const existing = pointersRef.current.get(pointerId);
        pointersRef.current.set(pointerId, {
          x,
          y,
          pointerType: existing?.pointerType || e.data?.pointerType,
        });
      }
      if (pointersRef.current.size === 2 && pinchRef.current) {
        const points = Array.from(pointersRef.current.values());
        const dx = points[0].x - points[1].x;
        const dy = points[0].y - points[1].y;
        const distance = Math.hypot(dx, dy);
        const ratio = distance / pinchRef.current.distance;
        const midX = (points[0].x + points[1].x) / 2;
        const midY = (points[0].y + points[1].y) / 2;
        zoomAtPoint(midX, midY, pinchRef.current.scale * ratio);
        return;
      }
      // Arrow drawing - add points to path
      if (isDrawingArrowRef.current && drawingArrowType) {
        const cell = getCellCoordinates(x, y);
        if (
          cell.x >= 0 &&
          cell.x < mapMetadata.width &&
          cell.y >= 0 &&
          cell.y < mapMetadata.height
        ) {
          const last = lastArrowPointRef.current;
          // Only add if moved to a different cell (and throttle to every few cells)
          if (!last || cell.x !== last.x || cell.y !== last.y) {
            arrowPathRef.current.push({ x: cell.x, y: cell.y });
            lastArrowPointRef.current = { x: cell.x, y: cell.y };
            onArrowPathUpdate?.([...arrowPathRef.current]);
          }
        }
        return;
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
      if (dragStartRef.current) {
        const dx = x - dragStartRef.current.x;
        const dy = y - dragStartRef.current.y;
        if (Math.hypot(dx, dy) > 4) {
          suppressClickRef.current = true;
          setIsPanning(true);
          const newOffset = {
            x: panStartOffsetRef.current.x + dx,
            y: panStartOffsetRef.current.y + dy,
          };
          setOffset(newOffset);
          return;
        }
      }
      const cell = getCellCoordinates(x, y);
      if (
        cell.x >= 0 &&
        cell.x < mapMetadata.width &&
        cell.y >= 0 &&
        cell.y < mapMetadata.height
      ) {
        pendingHoverRef.current = cell;
      } else {
        pendingHoverRef.current = null;
      }
      if (!hoverFrameRef.current) {
        hoverFrameRef.current = requestAnimationFrame(() => {
          hoverFrameRef.current = null;
          setHoveredCell(pendingHoverRef.current);
        });
      }
    },
    [
      isPanning,
      getCellCoordinates,
      mapMetadata,
      setOffset,
      drawingArrowType,
      onArrowPathUpdate,
    ]
  );

  const handlePointerUp = useCallback(
    (e) => {
      const pointerId =
        e.data?.pointerId ?? e.data?.identifier ?? e.nativeEvent?.pointerId;
      if (pointerId !== undefined) {
        pointersRef.current.delete(pointerId);
      }
      if (pointersRef.current.size < 2) {
        pinchRef.current = null;
      }
      // Arrow drawing completed
      if (isDrawingArrowRef.current && drawingArrowType) {
        isDrawingArrowRef.current = false;
        const path = [...arrowPathRef.current];
        arrowPathRef.current = [];
        lastArrowPointRef.current = null;

        // Simplify path - keep only every Nth point plus endpoints
        const simplifiedPath = simplifyArrowPath(path, 3);

        if (simplifiedPath.length >= 2) {
          onSendArrow?.(drawingArrowType, simplifiedPath);
        } else {
          onCancelArrow?.();
        }
        return;
      }
      // End panning/dragging.
      if (isPanning) {
        setIsPanning(false);
        dragStartRef.current = null;
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
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
        dragStartRef.current = null;
        return;
      }
      dragStartRef.current = null;
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
      if (placingTower) {
        const gridCell = mapGrid.find((c) => c.x === cell.x && c.y === cell.y);
        const cellResources = gridCell ? gridCell.cell[5] : [];
        const hasResource = Array.isArray(cellResources) && cellResources.length > 0;
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
        if (hasResource && territoryValid) {
          onPlaceTower?.(cell.x, cell.y);
        }
        return;
      }
    },
    [
      getCellCoordinates,
      mapMetadata,
      foundingNation,
      onFoundNation,
      buildingStructure,
      onBuildCity,
      mapGrid,
      gameState,
      userId,
      onCancelBuild,
      placingTower,
      onPlaceTower,
      drawingArrowType,
      onSendArrow,
      onCancelArrow,
    ]
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

  /* ----- Render Nation Overlays using NationOverlay ----- */
  const visibleBounds = useMemo(() => {
    if (!mapMetadata) return null;
    const visibleLeft = -offset.x / scale;
    const visibleTop = -offset.y / scale;
    const visibleRight = visibleLeft + stageWidth / scale;
    const visibleBottom = visibleTop + stageHeight / scale;
    const minX = Math.max(0, Math.floor(visibleLeft / cellSize) - 2);
    const maxX = Math.min(
      mapMetadata.width - 1,
      Math.ceil(visibleRight / cellSize) + 2
    );
    const minY = Math.max(0, Math.floor(visibleTop / cellSize) - 2);
    const maxY = Math.min(
      mapMetadata.height - 1,
      Math.ceil(visibleBottom / cellSize) + 2
    );
    return { minX, maxX, minY, maxY };
  }, [mapMetadata, offset, scale, stageWidth, stageHeight, cellSize]);

  const renderNationOverlays = useMemo(() => {
    const overlays = [];
    nations.forEach((nation, nationIndex) => {
      overlays.push(
        <NationOverlay
          key={`nation-${nation.owner}`}
          nation={nation}
          nationIndex={nationIndex}
          cellSize={cellSize}
          scale={scale}
          userId={userId}
          nationColors={nationColors}
          ownershipMap={ownershipMap}
          visibleBounds={visibleBounds}
        />
      );
    });
    return overlays;
  }, [
    nations,
    cellSize,
    scale,
    userId,
    nationColors,
    ownershipMap,
    visibleBounds,
  ]);

  // Compute the visible portion of the map for performance.
  const visibleMapGrid = useMemo(() => {
    if (!mapMetadata || mapGridByRow.length === 0 || !visibleBounds) return [];
    const visibleCells = [];
    for (let y = visibleBounds.minY; y <= visibleBounds.maxY; y++) {
      const row = mapGridByRow[y];
      if (!row) continue;
      for (let x = visibleBounds.minX; x <= visibleBounds.maxX; x++) {
        const cell = row[x];
        if (!cell) continue;
        visibleCells.push({ cell, x, y });
      }
    }
    return visibleCells;
  }, [mapGridByRow, mapMetadata, visibleBounds]);

  // Memoize resources rendering (only visible cells)
  const memoizedResources = useMemo(() => {
    if (scale < 0.4) return null;
    if (
      process.env.REACT_APP_DEBUG_RESOURCES === "true" &&
      visibleMapGrid.length &&
      mappings?.resources
    ) {
      const counts = {};
      visibleMapGrid.slice(0, 200).forEach(({ cell }) => {
        const resources = Array.isArray(cell[5]) ? cell[5] : [];
        resources.forEach((r) => {
          const name = mappings.resources[r] ?? r;
          counts[name] = (counts[name] || 0) + 1;
        });
      });
      console.log("[CLIENT RESOURCES] sample counts", counts);
    }
    return renderResources(visibleMapGrid, cellSize, scale);
  }, [visibleMapGrid, cellSize, scale]);
  const memoizedCaptureOverlays = useMemo(() => {
    if (scale < 0.45) return null;
    return renderResourceCaptureOverlays(
      visibleMapGrid,
      cellSize,
      scale,
      ownershipMap,
      resourceNodeClaims,
      captureTicks
    );
  }, [visibleMapGrid, cellSize, scale, ownershipMap, resourceNodeClaims, captureTicks]);
  // Note: memoizedTowers removed - towers are now rendered as structures in NationOverlay

  const visibleTileCount = useMemo(() => {
    if (!visibleBounds || !mapMetadata) return 0;
    return (
      (visibleBounds.maxX - visibleBounds.minX + 1) *
      (visibleBounds.maxY - visibleBounds.minY + 1)
    );
  }, [visibleBounds, mapMetadata]);

  const useFullMapTexture =
    !!fullMapImageUrl && (scale <= 0.65 || visibleTileCount > 60000);

  // Build mode preview for structures
  let buildPreview = null;
  let towerPreview = null;
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
    // (Using the old hasCellInTerritory logic here – if needed, this can be optimized similarly.)
    const territoryValid =
      userNation &&
      userNation.territory &&
      userNation.territory.x &&
      userNation.territory.y &&
      userNation.territory.x.includes(hoveredCell.x) &&
      userNation.territory.y.includes(hoveredCell.y);
    resourceValid =
      resourceValid || ["town", "capital", "fort", "tower"].includes(buildingStructure);
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
  if (placingTower && hoveredCell) {
    const gridCell = mapGrid.find(
      (c) => c.x === hoveredCell.x && c.y === hoveredCell.y
    );
    const cellResources = gridCell ? gridCell.cell[5] : [];
    const hasResource = Array.isArray(cellResources) && cellResources.length > 0;
    const userNation = gameState?.gameState?.nations?.find(
      (n) => n.owner === userId
    );
    const territoryValid =
      userNation &&
      userNation.territory &&
      userNation.territory.x &&
      userNation.territory.y &&
      userNation.territory.x.includes(hoveredCell.x) &&
      userNation.territory.y.includes(hoveredCell.y);
    const valid = hasResource && territoryValid;
    const borderColor = valid ? 0x00ff00 : 0xff0000;
    const iconSize =
      cellSize *
      1.1 *
      Math.min(3, Math.max(1, Math.pow(1 / Math.max(scale || 1, 0.15), 1.2)));
    towerPreview = (
      <BorderedSprite
        texture="/fort.png"
        x={hoveredCell.x * cellSize + cellSize / 2}
        y={hoveredCell.y * cellSize + cellSize / 2}
        width={iconSize}
        height={iconSize}
        borderColor={borderColor}
        isSelected={true}
        borderWidth={2}
        alpha={0.6}
        zIndex={320}
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
        antialias: scale > 0.6,
        resolution: scale < 0.45 ? 1 : window.devicePixelRatio || 1,
        autoDensity: true,
      }}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        width: "100%",
        height: "100%",
        cursor: buildingStructure || foundingNation || placingTower || drawingArrowType
          ? "crosshair"
          : isPanning
          ? "grabbing"
          : "grab",
      }}
    >
      <Container
        x={offset.x}
        y={offset.y}
        scale={scale}
        sortableChildren={true}
      >
        {useFullMapTexture ? (
          <Sprite
            image={fullMapImageUrl}
            x={0}
            y={0}
            width={mapMetadata.width * cellSize}
            height={mapMetadata.height * cellSize}
          />
        ) : (
          <>
            <MapTiles
              mapGrid={visibleMapGrid}
              cellSize={cellSize}
              mappings={mappings}
              textures={textures}
            />
        {!useFullMapTexture && memoizedResources}
        {!useFullMapTexture && memoizedCaptureOverlays}
          </>
        )}
        {renderNationOverlays}
        {/* Render active arrows with troop counts */}
        {activeAttackArrow && activeAttackArrow.path && renderArrowPath(
          activeAttackArrow.path,
          cellSize,
          "attack",
          true,
          "active-attack-arrow",
          activeAttackArrow.remainingPower
        )}
        {activeDefendArrow && activeDefendArrow.path && renderArrowPath(
          activeDefendArrow.path,
          cellSize,
          "defend",
          true,
          "active-defend-arrow",
          activeDefendArrow.remainingPower
        )}
        {/* Render current drawing arrow */}
        {drawingArrowType && currentArrowPath && currentArrowPath.length > 0 &&
          renderArrowPath(currentArrowPath, cellSize, drawingArrowType, false, "drawing-arrow", null)}
        {/* Render completed arrow animations */}
        {completedArrows && completedArrows.map((arrow) => {
          const elapsed = Date.now() - arrow.createdAt;
          return renderCompletedArrow(arrow, cellSize, elapsed);
        })}
        {buildPreview}
        {towerPreview}
      </Container>
    </Stage>
  );
};

export default GameCanvas;
