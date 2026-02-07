// GameCanvas.jsx
import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import {
  Stage,
  Graphics,
  Text,
  Sprite,
  Container,
} from "@pixi/react";
import { string2hex } from "@pixi/utils";
import BorderedSprite from "./BorderedSprite";
import { settings } from "@pixi/settings";
import { SCALE_MODES } from "@pixi/constants";
import MapTiles from "./MapTiles";
import { SCALE_MODES as PIXI_SCALE_MODES } from "pixi.js";
import { TerritoryLayer } from "./TerritoryRenderer";

// Feature flag for optimized territory rendering (set via environment or default false)
const USE_OPTIMIZED_TERRITORY = process.env.REACT_APP_OPTIMIZED_TERRITORY === "true";

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

// Status color map for arrow rendering
const ARROW_STATUS_COLORS = {
  advancing: 0x44cc44,
  consolidating: 0xcccc44,
  stalled: 0xcc8844,
  retreating: 0xcc4444,
};
const ARROW_STATUS_HEX = {
  advancing: "#44cc44",
  consolidating: "#cccc44",
  stalled: "#cc8844",
  retreating: "#cc4444",
};

// Simple thin-line arrow for drawing-in-progress and defend arrows
const renderArrowPath = (path, cellSize, type, isActive, key, troopCount = null) => {
  if (!path || path.length < 2) return null;

  const color = type === "attack" ? 0xff4444 : 0x4444ff;
  const alpha = isActive ? 0.8 : 0.6;

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
          const startX = path[0].x * cellSize + cellSize / 2;
          const startY = path[0].y * cellSize + cellSize / 2;
          g.moveTo(startX, startY);
          for (let i = 1; i < path.length; i++) {
            g.lineTo(path[i].x * cellSize + cellSize / 2, path[i].y * cellSize + cellSize / 2);
          }
          if (path.length >= 2) {
            const last = path[path.length - 1];
            const prev = path[path.length - 2];
            const endX = last.x * cellSize + cellSize / 2;
            const endY = last.y * cellSize + cellSize / 2;
            const angle = Math.atan2(endY - (prev.y * cellSize + cellSize / 2), endX - (prev.x * cellSize + cellSize / 2));
            const arrowSize = cellSize * 0.8;
            g.beginFill(color, alpha);
            g.moveTo(endX, endY);
            g.lineTo(endX - arrowSize * Math.cos(angle - Math.PI / 6), endY - arrowSize * Math.sin(angle - Math.PI / 6));
            g.lineTo(endX - arrowSize * 0.5 * Math.cos(angle), endY - arrowSize * 0.5 * Math.sin(angle));
            g.lineTo(endX - arrowSize * Math.cos(angle + Math.PI / 6), endY - arrowSize * Math.sin(angle + Math.PI / 6));
            g.lineTo(endX, endY);
            g.endFill();
          }
        }}
      />
      {troopCount !== null && (
        <>
          <Graphics zIndex={201} draw={(g) => {
            g.clear();
            g.beginFill(0x000000, 0.7);
            g.drawCircle(midX, midY - cellSize * 0.8, cellSize * 0.6);
            g.endFill();
            g.lineStyle(2, color, 1);
            g.drawCircle(midX, midY - cellSize * 0.8, cellSize * 0.6);
          }} />
          <Text text={Math.round(troopCount).toString()} x={midX} y={midY - cellSize * 0.8} anchor={0.5} zIndex={202}
            style={{ fontFamily: "system-ui", fill: "#ffffff", fontSize: Math.max(10, cellSize * 0.5), fontWeight: "bold" }} />
        </>
      )}
    </React.Fragment>
  );
};

// Broad wedge arrow for active attack arrows (documentary war style)
const renderArrowV2 = (arrow, cellSize, key, scale) => {
  if (!arrow?.path || arrow.path.length < 2) return null;

  const path = arrow.path;
  const status = arrow.status || "advancing";
  const color = ARROW_STATUS_COLORS[status] || 0x44cc44;
  const hexColor = ARROW_STATUS_HEX[status] || "#44cc44";
  const frontWidth = Math.max(2, arrow.frontWidth || 3);
  const halfW = (frontWidth / 2) * cellSize;
  const troopCount = arrow.remainingPower || 0;
  const headX = (arrow.headX ?? path[path.length - 1].x) * cellSize + cellSize / 2;
  const headY = (arrow.headY ?? path[path.length - 1].y) * cellSize + cellSize / 2;
  const opposingForces = arrow.opposingForces || [];

  return (
    <React.Fragment key={key}>
      <Graphics
        zIndex={200}
        draw={(g) => {
          g.clear();

          const startX = path[0].x * cellSize + cellSize / 2;
          const startY = path[0].y * cellSize + cellSize / 2;

          // Build left and right outlines by offsetting path perpendicular
          const leftPts = [];
          const rightPts = [];
          let lastDx = 0, lastDy = 0;
          for (let i = 0; i < path.length; i++) {
            const px = path[i].x * cellSize + cellSize / 2;
            const py = path[i].y * cellSize + cellSize / 2;
            const t = path.length > 1 ? i / (path.length - 1) : 0;
            // Spearhead: wide at origin, narrowing to a point at the front
            const w = halfW * Math.max(0.08, 1.0 - 0.88 * t);

            let dx, dy;
            if (i < path.length - 1) {
              dx = path[i + 1].x - path[i].x;
              dy = path[i + 1].y - path[i].y;
            } else {
              dx = path[i].x - path[i - 1].x;
              dy = path[i].y - path[i - 1].y;
            }
            lastDx = dx; lastDy = dy;
            const len = Math.hypot(dx, dy) || 1;
            const perpX = -dy / len;
            const perpY = dx / len;

            leftPts.push({ x: px + perpX * w, y: py + perpY * w });
            rightPts.push({ x: px - perpX * w, y: py - perpY * w });
          }

          // Draw filled wedge polygon
          g.beginFill(color, 0.25);
          g.lineStyle(2, color, 0.6);
          g.moveTo(leftPts[0].x, leftPts[0].y);
          for (let i = 1; i < leftPts.length; i++) g.lineTo(leftPts[i].x, leftPts[i].y);
          for (let i = rightPts.length - 1; i >= 0; i--) g.lineTo(rightPts[i].x, rightPts[i].y);
          g.lineTo(leftPts[0].x, leftPts[0].y);
          g.endFill();

          // Arrowhead at the tip — wings as wide as the arrow base
          const tipX = path[path.length - 1].x * cellSize + cellSize / 2;
          const tipY = path[path.length - 1].y * cellSize + cellSize / 2;
          const tipLen = Math.hypot(lastDx, lastDy) || 1;
          const fwdX = lastDx / tipLen;
          const fwdY = lastDy / tipLen;
          const perpTipX = -fwdY;
          const perpTipY = fwdX;
          const arrowLen = Math.max(cellSize * 1.5, halfW * 0.6);
          const arrowWing = halfW; // match the full base width of the wedge
          g.beginFill(color, 0.7);
          g.lineStyle(0);
          g.moveTo(tipX + fwdX * arrowLen, tipY + fwdY * arrowLen);
          g.lineTo(tipX + perpTipX * arrowWing, tipY + perpTipY * arrowWing);
          g.lineTo(tipX - perpTipX * arrowWing, tipY - perpTipY * arrowWing);
          g.lineTo(tipX + fwdX * arrowLen, tipY + fwdY * arrowLen);
          g.endFill();

          // Center line
          g.lineStyle(2, color, 0.5);
          g.moveTo(startX, startY);
          for (let i = 1; i < path.length; i++) {
            g.lineTo(path[i].x * cellSize + cellSize / 2, path[i].y * cellSize + cellSize / 2);
          }

          // Phase markers
          for (let i = 1; i < path.length; i++) {
            const wx = path[i].x * cellSize + cellSize / 2;
            const wy = path[i].y * cellSize + cellSize / 2;
            const reached = i < (arrow.currentIndex || 1);
            g.lineStyle(1, reached ? 0xffffff : 0x888888, 0.6);
            g.beginFill(reached ? 0xffffff : 0x444444, 0.4);
            g.drawCircle(wx, wy, cellSize * 0.2);
            g.endFill();
          }
        }}
      />
      {/* Troop count label at head — fixed screen size via inverse scale */}
      {(() => {
        // Render at large internal font size, scale by 1/zoomScale so it stays
        // at a fixed screen size regardless of zoom (same approach as NationLabel).
        const baseFontSize = 14;
        const invScale = 1 / Math.max(0.35, scale || 1);
        // Fade when zoomed in so it doesn't block the view
        const labelAlpha = scale > 2 ? Math.max(0.3, 1.0 - (scale - 2) * 0.15) : 0.85;
        return (
          <Text
            text={Math.round(troopCount).toLocaleString()}
            x={headX}
            y={headY - cellSize * 0.8}
            anchor={0.5}
            zIndex={211}
            alpha={labelAlpha}
            scale={{ x: invScale, y: invScale }}
            style={{
              fontFamily: "system-ui, -apple-system, sans-serif",
              fill: hexColor,
              fontSize: baseFontSize,
              fontWeight: "300",
              stroke: "#000000",
              strokeThickness: 3,
            }}
          />
        );
      })()}
      {/* Opposition indicators */}
      {opposingForces.length > 0 && (() => {
        const baseFontSize = 11;
        const invScale = 1 / Math.max(0.35, scale || 1);
        const labelAlpha = scale > 2 ? Math.max(0.2, 0.8 - (scale - 2) * 0.15) : 0.7;
        return (
          <Text
            text={opposingForces.map((o) => `vs ${o.nationName}`).join(" ")}
            x={headX}
            y={headY + cellSize * 0.3}
            anchor={0.5}
            zIndex={211}
            alpha={labelAlpha}
            scale={{ x: invScale, y: invScale }}
            style={{
              fontFamily: "system-ui, -apple-system, sans-serif",
              fill: "#ff6666",
              fontSize: baseFontSize,
              fontWeight: "300",
              stroke: "#000000",
              strokeThickness: 3,
            }}
          />
        );
      })()}
    </React.Fragment>
  );
};

// Completed arrow rendering removed — troops return to population silently

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
      naturalMapHeight > stageHeight ? stageHeight / naturalMapHeight : 1;
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
      zoomAtPoint(mousePos.x, mousePos.y, scaleRef.current * zoomFactor);
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
const NationLabel = ({ text, x, y, fontSize, alpha, scale }) => {
  const labelRef = useRef(null);
  useEffect(() => {
    if (labelRef.current?.texture?.baseTexture) {
      labelRef.current.texture.baseTexture.scaleMode = PIXI_SCALE_MODES.LINEAR;
    }
  }, [text]);

  const inverseScale = 1 / Math.max(0.35, scale || 1);

  return (
    <Text
      ref={labelRef}
      text={text}
      x={x}
      y={y}
      anchor={0.5}
      zIndex={130}
      scale={inverseScale}
      resolution={window.devicePixelRatio || 1}
      style={{
        fontFamily: "Barlow Semi Condensed, system-ui",
        fill: "#ffffff",
        fontSize,
        fontWeight: "600",
        stroke: "#000000",
        strokeThickness: Math.max(2, Math.round(fontSize * 0.18)),
      }}
      alpha={alpha}
    />
  );
};

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
  const showLabels = scale > 0.5;

  const labelFontSize = useMemo(() => {
    const population = Math.max(0, Number(nation.population) || 0);
    const popScale = Math.log10(population + 10);
    const base = 10;
    const size = base + popScale * 6;
    return Math.min(34, Math.max(12, size));
  }, [nation.population]);

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

  // Compute which tiles are border tiles (have at least one non-owned neighbor)
  const borderTileSet = useMemo(() => {
    const bSet = new Set();
    if (scale < 0.35) return bSet;
    for (let i = 0; i < territory.x.length; i++) {
      const x = territory.x[i];
      const y = territory.y[i];
      const hasNonOwned =
        !territorySet.has(`${x},${y - 1}`) ||
        !territorySet.has(`${x + 1},${y}`) ||
        !territorySet.has(`${x},${y + 1}`) ||
        !territorySet.has(`${x - 1},${y}`);
      if (hasNonOwned) bSet.add(`${x},${y}`);
    }
    return bSet;
  }, [territory, territorySet, scale]);

  return (
    <>
      <Graphics
        key={`territory-${nation.owner}`}
        zIndex={100}
        draw={(g) => {
          g.clear();
          // Interior tiles at 0.6 alpha, edge tiles at full opacity
          for (let i = 0; i < rowRuns.length; i++) {
            const run = rowRuns[i];
            if (!showBorders) {
              // Not zoomed in enough for borders — draw whole run at 0.6
              const width = (run.end - run.start + 1) * cellSize;
              g.beginFill(baseColor, 0.6);
              g.drawRect(run.start * cellSize, run.y * cellSize, width, cellSize);
              g.endFill();
            } else {
              // Split run into edge vs interior segments
              let segStart = run.start;
              let segIsEdge = borderTileSet.has(`${run.start},${run.y}`);
              for (let x = run.start + 1; x <= run.end; x++) {
                const isEdge = borderTileSet.has(`${x},${run.y}`);
                if (isEdge !== segIsEdge) {
                  const width = (x - segStart) * cellSize;
                  g.beginFill(baseColor, segIsEdge ? 1.0 : 0.5);
                  g.drawRect(segStart * cellSize, run.y * cellSize, width, cellSize);
                  g.endFill();
                  segStart = x;
                  segIsEdge = isEdge;
                }
              }
              // Final segment
              const width = (run.end - segStart + 1) * cellSize;
              g.beginFill(baseColor, segIsEdge ? 1.0 : 0.5);
              g.drawRect(segStart * cellSize, run.y * cellSize, width, cellSize);
              g.endFill();
            }
          }
        }}
      />
      {showLabels && territoryCentroid && (
        <NationLabel
          text={nation.owner}
          x={territoryCentroid.x * cellSize}
          y={territoryCentroid.y * cellSize}
          fontSize={labelFontSize}
          alpha={scale > 3.5 ? 0.2 : 0.9}
          scale={scale}
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
                <NationLabel
                  text={city.name}
                  x={centerX}
                  y={centerY + iconSize * 0.6}
                  fontSize={Math.max(10, labelFontSize * 0.6)}
                  alpha={0.9}
                  scale={scale}
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
  onStartDrawArrow,
  currentArrowPath,
  onArrowPathUpdate,
  onSendArrow,
  onCancelArrow,
  activeAttackArrows,
  activeDefendArrow,
}) => {
  const stageWidth = window.innerWidth;
  const stageHeight = window.innerHeight;

  const {
    cellSize,
    scale,
    offset,
    setOffset,
    handleWheel,
    getCellCoordinates,
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

  /* ----- Viewport State ----- */
  const [isPanning, setIsPanning] = useState(false);
  const drawTypeRef = useRef(null);

  /* ----- Arrow Drawing State ----- */
  const isDrawingArrowRef = useRef(false);
  const arrowPathRef = useRef([]);
  const lastArrowPointRef = useRef(null);
  const configRef = useRef(config);
  configRef.current = config;
  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;

  /* ----- Arrow Animation State ----- */

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
      // Check which button is pressed (0: left, 1: middle, 2: right)
      const button = e.data?.originalEvent?.button ?? e.nativeEvent?.button;
      if (button === 1) return;
      if (button === 2) {
        e.data?.originalEvent?.preventDefault?.();
        e.preventDefault?.();
      }
      // Arrow drawing mode: left=attack, right=defend
      const arrowType = button === 0 ? "attack" : button === 2 ? "defend" : null;
      if (
        arrowType &&
        !foundingNation &&
        !buildingStructure &&
        !placingTower
      ) {
        const cell = getCellCoordinates(x, y);
        if (
          cell.x >= 0 &&
          cell.x < mapMetadata.width &&
          cell.y >= 0 &&
          cell.y < mapMetadata.height
        ) {
          drawTypeRef.current = arrowType;
          if (drawingArrowType !== arrowType) {
            onStartDrawArrow?.(arrowType);
          }
          isDrawingArrowRef.current = true;
          arrowPathRef.current = [{ x: cell.x, y: cell.y }];
          lastArrowPointRef.current = { x: cell.x, y: cell.y };
          onArrowPathUpdate?.([{ x: cell.x, y: cell.y }]);
        }
        return;
      }
    },
    [
      foundingNation,
      buildingStructure,
      placingTower,
      drawingArrowType,
      getCellCoordinates,
      mapMetadata,
      onArrowPathUpdate,
      onStartDrawArrow,
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
      // Arrow drawing - add points to path, clamped to max range
      if (isDrawingArrowRef.current && (drawTypeRef.current || drawingArrowType)) {
        const cell = getCellCoordinates(x, y);
        if (
          cell.x >= 0 &&
          cell.x < mapMetadata.width &&
          cell.y >= 0 &&
          cell.y < mapMetadata.height
        ) {
          const last = lastArrowPointRef.current;
          if (!last || cell.x !== last.x || cell.y !== last.y) {
            // Compute max arrow range from config + player population
            const cfg = configRef.current;
            const baseRange = cfg?.territorial?.arrowBaseRange ?? 15;
            const rangePerSqrtPop = cfg?.territorial?.arrowRangePerSqrtPop ?? 0.15;
            const maxRangeCfg = cfg?.territorial?.arrowMaxRange ?? 60;
            const gs = gameStateRef.current;
            const playerNation = gs?.gameState?.nations?.find(
              (n) => n.owner === userId
            );
            const pop = playerNation?.population || 0;
            const maxRange = Math.min(maxRangeCfg, baseRange + Math.sqrt(pop) * rangePerSqrtPop);

            // Compute current path length
            const path = arrowPathRef.current;
            let pathLen = 0;
            for (let i = 1; i < path.length; i++) {
              pathLen += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
            }
            const segLen = Math.hypot(cell.x - last.x, cell.y - last.y);

            // Only add point if within max range
            if (pathLen + segLen <= maxRange) {
              arrowPathRef.current.push({ x: cell.x, y: cell.y });
              lastArrowPointRef.current = { x: cell.x, y: cell.y };
              onArrowPathUpdate?.([...arrowPathRef.current]);
            }
            // else: silently stop extending — arrow is at max range
          }
        }
        return;
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
      getCellCoordinates,
      mapMetadata,
      drawingArrowType,
      onArrowPathUpdate,
    ]
  );

  // Clean up arrow drawing state — shared by pointerup and pointerleave
  const finishArrowDrawing = useCallback(
    (submit) => {
      if (!isDrawingArrowRef.current) return;
      isDrawingArrowRef.current = false;
      const drawType = drawTypeRef.current || drawingArrowType;
      const path = [...arrowPathRef.current];
      arrowPathRef.current = [];
      lastArrowPointRef.current = null;
      drawTypeRef.current = null;

      if (submit) {
        const simplifiedPath = simplifyArrowPath(path, 3);
        if (simplifiedPath.length >= 2) {
          onSendArrow?.(drawType, simplifiedPath);
        } else {
          onCancelArrow?.();
        }
      } else {
        onCancelArrow?.();
      }
    },
    [drawingArrowType, onSendArrow, onCancelArrow]
  );

  const handlePointerLeave = useCallback(() => {
    // If the pointer leaves the canvas while drawing, cancel the arrow
    finishArrowDrawing(false);
  }, [finishArrowDrawing]);

  const handlePointerUp = useCallback(
    (e) => {
      // Arrow drawing completed
      if (isDrawingArrowRef.current && (drawTypeRef.current || drawingArrowType)) {
        finishArrowDrawing(true);
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
      finishArrowDrawing,
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

  const sceneChildren = useMemo(() => {
    const children = [];
    if (useFullMapTexture && fullMapImageUrl && mapMetadata) {
      children.push(
        <Sprite
          key="full-map"
          image={fullMapImageUrl}
          x={0}
          y={0}
          width={mapMetadata.width * cellSize}
          height={mapMetadata.height * cellSize}
        />
      );
    } else {
      children.push(
        <MapTiles
          key="map-tiles"
          mapGrid={visibleMapGrid}
          cellSize={cellSize}
          mappings={mappings}
          textures={textures}
        />
      );
      if (memoizedResources) {
        if (Array.isArray(memoizedResources)) {
          children.push(...memoizedResources);
        } else {
          children.push(memoizedResources);
        }
      }
      if (memoizedCaptureOverlays) {
        if (Array.isArray(memoizedCaptureOverlays)) {
          children.push(...memoizedCaptureOverlays);
        } else {
          children.push(memoizedCaptureOverlays);
        }
      }
    }

    if (USE_OPTIMIZED_TERRITORY && mapMetadata) {
      children.push(
        <TerritoryLayer
          key="territory-layer"
          mapWidth={mapMetadata.width}
          mapHeight={mapMetadata.height}
          cellSize={cellSize}
          nations={nations}
          nationColors={nationColors}
          zIndex={100}
        />
      );
    } else if (renderNationOverlays?.length) {
      children.push(...renderNationOverlays);
    }

    // Render active attack arrows (broad wedge style)
    if (activeAttackArrows && activeAttackArrows.length > 0) {
      for (let i = 0; i < activeAttackArrows.length; i++) {
        const arrow = activeAttackArrows[i];
        if (arrow?.path) {
          const node = renderArrowV2(arrow, cellSize, `active-attack-${arrow.id || i}`, scale);
          if (node) children.push(node);
        }
      }
    }

    if (activeDefendArrow?.path) {
      const node = renderArrowPath(
        activeDefendArrow.path,
        cellSize,
        "defend",
        true,
        "active-defend-arrow",
        activeDefendArrow.remainingPower
      );
      if (node) children.push(node);
    }

    if (drawingArrowType && currentArrowPath && currentArrowPath.length > 0) {
      const node = renderArrowPath(
        currentArrowPath,
        cellSize,
        drawingArrowType,
        false,
        "drawing-arrow",
        null
      );
      if (node) children.push(node);
    }

    if (buildPreview) children.push(buildPreview);
    if (towerPreview) children.push(towerPreview);

    return children;
  }, [
    useFullMapTexture,
    fullMapImageUrl,
    mapMetadata,
    cellSize,
    visibleMapGrid,
    mappings,
    textures,
    memoizedResources,
    memoizedCaptureOverlays,
    renderNationOverlays,
    activeAttackArrows,
    activeDefendArrow,
    drawingArrowType,
    currentArrowPath,
    buildPreview,
    towerPreview,
    nations,
    nationColors,
  ]);

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
      onContextMenu={(e) => e.preventDefault()}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      style={{
        width: "100%",
        height: "100%",
        cursor:
          buildingStructure || foundingNation || placingTower || drawingArrowType
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
        {sceneChildren}
      </Container>
    </Stage>
  );
};

export default GameCanvas;
