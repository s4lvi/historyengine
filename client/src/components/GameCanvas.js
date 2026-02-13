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
import RegionOverlay from "./RegionOverlay";

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

const buildIconMap = {
  tower: "/fort.png",
  fort: "/fort.png",
  town: "/town.png",
  farm: "/farm.png",
  mine: "/mine.png",
  stable: "/stable.png",
  "lumber mill": "/lumber_mill.png",
  workshop: "/workshop.png",
};

const CAPTURE_EFFECT_DURATION_MS = 1600;
const CAPTURE_EFFECT_MAX = 36;
const TOUCH_LONG_PRESS_MS = 320;
const TOUCH_LONG_PRESS_MOVE_PX = 10;

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
  ownershipMap,
  resourceNodeClaims,
  captureTicks
) => {
  const overlays = [];
  mapGrid.forEach(({ cell, x, y }) => {
    if (!cell || !Array.isArray(cell[5]) || cell[5].length === 0) return;
    const owner = ownershipMap.get((y << 16) | x);
    if (!owner) return;
    const key = `${x},${y}`;
    const claim = resourceNodeClaims?.[key];
    if (!claim) return;
    const isCaptured = claim.owner === owner;
    const progressOwner = claim.progressOwner;
    if (!isCaptured && progressOwner !== owner) return;
    const progress = Math.min(
      1,
      (claim.progress || 0) / Math.max(1, captureTicks)
    );
    const size = cellSize * 0.9;
    const cx = x * cellSize + cellSize / 2;
    const cy = y * cellSize + cellSize / 2;

    // Use resource-specific icon instead of generic fort
    const resourceType = cell[5][0];
    const iconName = resourceIconMap[resourceType] || resourceType;

    if (isCaptured) {
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
          alpha={0.9}
          baseZ={112}
        />
      );
      return;
    }
    overlays.push(
      <Graphics
        key={`capture-${key}`}
        zIndex={115}
        draw={(g) => {
          g.clear();
          const radius = size * 0.48;
          const pieY = cy;
          g.beginFill(0x0f172a, 0.35);
          g.drawCircle(cx, pieY, radius);
          g.endFill();
          g.beginFill(0x34d399, 0.8);
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

const lerpNumber = (from, to, t) => from + (to - from) * t;

const toFiniteNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const cloneAttackArrow = (arrow) => ({
  ...arrow,
  path: Array.isArray(arrow?.path)
    ? arrow.path.map((p) => ({
        x: toFiniteNumber(p?.x, 0),
        y: toFiniteNumber(p?.y, 0),
      }))
    : [],
  opposingForces: Array.isArray(arrow?.opposingForces)
    ? arrow.opposingForces.map((f) => ({ ...f }))
    : [],
});

const getAttackArrowKey = (arrow, idx) => arrow?.id || `idx-${idx}`;

const canInterpolateAttackArrows = (fromArrow, toArrow) => {
  if (!fromArrow || !toArrow) return false;
  if (!Array.isArray(fromArrow.path) || !Array.isArray(toArrow.path)) return false;
  if (fromArrow.path.length !== toArrow.path.length) return false;
  for (let i = 0; i < toArrow.path.length; i++) {
    const fromPoint = fromArrow.path[i];
    const toPoint = toArrow.path[i];
    if (!fromPoint || !toPoint) return false;
    if (fromPoint.x !== toPoint.x || fromPoint.y !== toPoint.y) return false;
  }
  return true;
};

const interpolateAttackArrow = (fromArrow, toArrow, t) => {
  if (!canInterpolateAttackArrows(fromArrow, toArrow)) return toArrow;

  const fallbackX = toFiniteNumber(toArrow.path?.[0]?.x, 0);
  const fallbackY = toFiniteNumber(toArrow.path?.[0]?.y, 0);
  const fromHeadX = toFiniteNumber(fromArrow.headX, fallbackX);
  const fromHeadY = toFiniteNumber(fromArrow.headY, fallbackY);
  const toHeadX = toFiniteNumber(toArrow.headX, fallbackX);
  const toHeadY = toFiniteNumber(toArrow.headY, fallbackY);
  const fromIdx = toFiniteNumber(fromArrow.currentIndex, 1);
  const toIdx = toFiniteNumber(toArrow.currentIndex, 1);
  const fromFrontWidth = toFiniteNumber(fromArrow.frontWidth, 0);
  const toFrontWidth = toFiniteNumber(toArrow.frontWidth, 0);
  const fromDensity = toFiniteNumber(fromArrow.effectiveDensityAtFront, 0);
  const toDensity = toFiniteNumber(toArrow.effectiveDensityAtFront, 0);
  const fromPower = toFiniteNumber(fromArrow.remainingPower, 0);
  const toPower = toFiniteNumber(toArrow.remainingPower, 0);

  return {
    ...toArrow,
    headX: lerpNumber(fromHeadX, toHeadX, t),
    headY: lerpNumber(fromHeadY, toHeadY, t),
    currentIndex: lerpNumber(fromIdx, toIdx, t),
    frontWidth: lerpNumber(fromFrontWidth, toFrontWidth, t),
    effectiveDensityAtFront: lerpNumber(fromDensity, toDensity, t),
    remainingPower: lerpNumber(fromPower, toPower, t),
  };
};

// Simple thin-line arrow for drawing-in-progress and defend arrows
const renderArrowPath = (
  path,
  cellSize,
  type,
  isActive,
  key,
  troopCount = null,
  scale = 1,
  colorOverride = null
) => {
  if (!path || path.length < 2) return null;

  const color = colorOverride ?? (type === "attack" ? 0xff4444 : 0x4444ff);
  const alpha = isActive ? 0.8 : 0.6;

  const midIndex = Math.floor(path.length / 2);
  const midPoint = path[midIndex];
  const midX = midPoint.x * cellSize + cellSize / 2;
  const midY = midPoint.y * cellSize + cellSize / 2;
  const invScale = 1 / Math.max(0.35, scale || 1);

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
        <Container
          x={midX}
          y={midY - cellSize * 0.8}
          zIndex={202}
          scale={{ x: invScale, y: invScale }}
        >
          <Graphics
            zIndex={201}
            draw={(g) => {
              g.clear();
              const radius = Math.max(10, Math.min(18, cellSize * 0.55));
              g.beginFill(0x000000, 0.75);
              g.drawCircle(0, 0, radius);
              g.endFill();
              g.lineStyle(2, color, 1);
              g.drawCircle(0, 0, radius);
            }}
          />
          <Text
            text={Math.round(troopCount).toString()}
            x={0}
            y={0}
            anchor={0.5}
            zIndex={202}
            style={{
              fontFamily: "Barlow Semi Condensed, system-ui",
              fill: "#ffffff",
              fontSize: Math.max(14, cellSize * 0.6),
              fontWeight: "700",
            }}
          />
        </Container>
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
  const isDensityArrow = arrow.troopCommitment != null && arrow.troopCommitment > 0;
  const troopCount = isDensityArrow
    ? (arrow.effectiveDensityAtFront || 0)
    : (arrow.remainingPower || 0);
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
      {/* Arrow status badge at head — fixed screen size via inverse scale */}
      {(() => {
        const invScale = 1 / Math.max(0.35, scale || 1);
        const labelAlpha = scale > 2 ? Math.max(0.3, 1.0 - (scale - 2) * 0.15) : 0.85;
        const badgeW = 120;
        const badgeH = opposingForces.length > 0 ? 52 : 38;
        const commitment = arrow.troopCommitment || 0;
        return (
          <Container
            x={headX}
            y={headY - cellSize * 1.2}
            zIndex={211}
            alpha={labelAlpha}
            scale={{ x: invScale, y: invScale }}
          >
            {/* Dark background pill */}
            <Graphics
              draw={(g) => {
                g.clear();
                g.beginFill(0x000000, 0.7);
                g.drawRoundedRect(-badgeW / 2, -badgeH / 2, badgeW, badgeH, 6);
                g.endFill();
                // Status color stripe at top
                g.beginFill(color, 0.9);
                g.drawRoundedRect(-badgeW / 2, -badgeH / 2, badgeW, 3, 1);
                g.endFill();
                // Commitment bar background
                const barY = opposingForces.length > 0 ? 8 : 6;
                g.beginFill(0x333333, 0.8);
                g.drawRoundedRect(-badgeW / 2 + 8, barY, badgeW - 16, 4, 2);
                g.endFill();
                // Commitment bar fill
                const fillW = (badgeW - 16) * Math.min(1, commitment);
                if (fillW > 0) {
                  g.beginFill(color, 0.9);
                  g.drawRoundedRect(-badgeW / 2 + 8, barY, fillW, 4, 2);
                  g.endFill();
                }
                // Status dot
                g.beginFill(color, 1);
                g.drawCircle(-badgeW / 2 + 14, -4, 4);
                g.endFill();
              }}
            />
            {/* Troop count text */}
            <Text
              text={`${Math.round(troopCount).toLocaleString()}  ${Math.round(commitment * 100)}%`}
              x={-badgeW / 2 + 24}
              y={-10}
              anchor={{ x: 0, y: 0.5 }}
              style={{
                fontFamily: "system-ui, -apple-system, sans-serif",
                fill: "#ffffff",
                fontSize: 13,
                fontWeight: "600",
              }}
            />
            {/* Opposition text */}
            {opposingForces.length > 0 && (
              <Text
                text={opposingForces.map((o) => `vs ${o.nationName}`).join(" ")}
                x={0}
                y={badgeH / 2 - 8}
                anchor={{ x: 0.5, y: 0.5 }}
                style={{
                  fontFamily: "system-ui, -apple-system, sans-serif",
                  fill: "#ff6666",
                  fontSize: 11,
                  fontWeight: "400",
                }}
              />
            )}
          </Container>
        );
      })()}
    </React.Fragment>
  );
};

// Troop density heatmap overlay — renders density as colored cells on owned territory.
// Memoized to avoid re-draws when data hasn't meaningfully changed.
const TroopDensityHeatmap = React.memo(({ densityMap, cellSize, visibleBounds }) => {
  if (!densityMap || densityMap.length < 3) return null;

  return (
    <Graphics
      zIndex={105}
      draw={(g) => {
        g.clear();
        const minX = visibleBounds?.minX ?? -Infinity;
        const maxX = visibleBounds?.maxX ?? Infinity;
        const minY = visibleBounds?.minY ?? -Infinity;
        const maxY = visibleBounds?.maxY ?? Infinity;

        for (let i = 0; i < densityMap.length; i += 3) {
          const x = densityMap[i];
          const y = densityMap[i + 1];
          const density = densityMap[i + 2]; // 0-255 quantized

          if (x < minX || x > maxX || y < minY || y > maxY) continue;
          if (density <= 0) continue;

          const t = Math.min(1, density / 255);
          // Color gradient: blue (low) -> cyan (mid-low) -> green (mid) -> yellow (mid-high) -> red (high)
          let r, gVal, b;
          if (t < 0.25) {
            // Blue -> Cyan
            const s = t * 4;
            r = 0;
            gVal = Math.round(s * 200);
            b = 180 + Math.round(s * 75);
          } else if (t < 0.5) {
            // Cyan -> Green
            const s = (t - 0.25) * 4;
            r = 0;
            gVal = 200 + Math.round(s * 55);
            b = Math.round((1 - s) * 255);
          } else if (t < 0.75) {
            // Green -> Yellow
            const s = (t - 0.5) * 4;
            r = Math.round(s * 255);
            gVal = 255;
            b = 0;
          } else {
            // Yellow -> Red
            const s = (t - 0.75) * 4;
            r = 255;
            gVal = Math.round((1 - s) * 255);
            b = 0;
          }
          const color = (r << 16) | (gVal << 8) | b;
          // Higher alpha so density is always visible: 0.20 (low) to 0.55 (high)
          const alpha = 0.20 + t * 0.35;

          g.beginFill(color, alpha);
          g.drawRect(x * cellSize, y * cellSize, cellSize, cellSize);
          g.endFill();
        }
      }}
    />
  );
}, (prev, next) => {
  // Custom comparison: skip re-render if densityMap data is identical
  if (prev.cellSize !== next.cellSize) return false;
  if (prev.visibleBounds !== next.visibleBounds) return false;
  const a = prev.densityMap;
  const b = next.densityMap;
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  // Sample comparison — check every 3rd triple for changes
  const step = Math.max(3, Math.floor(a.length / 30) * 3);
  for (let i = 0; i < a.length; i += step) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) return false;
  }
  return true;
});

// Completed arrow rendering removed — troops return to population silently

// Helper: interpolate position along a polyline path
const interpolateAlongPath = (path, t, endIdx, cellSize) => {
  if (!path || path.length < 2) return null;
  const last = Math.min(endIdx ?? path.length - 1, path.length - 1);
  // Compute total length of path segments 0..last
  let totalLen = 0;
  const segLens = [];
  for (let i = 1; i <= last; i++) {
    const dx = (path[i].x - path[i - 1].x) * cellSize;
    const dy = (path[i].y - path[i - 1].y) * cellSize;
    const len = Math.hypot(dx, dy);
    segLens.push(len);
    totalLen += len;
  }
  if (totalLen === 0) return null;
  let target = t * totalLen;
  let acc = 0;
  for (let i = 0; i < segLens.length; i++) {
    if (acc + segLens[i] >= target) {
      const frac = (target - acc) / segLens[i];
      return {
        x: (path[i].x + (path[i + 1].x - path[i].x) * frac) * cellSize + cellSize / 2,
        y: (path[i].y + (path[i + 1].y - path[i].y) * frac) * cellSize + cellSize / 2,
      };
    }
    acc += segLens[i];
  }
  return {
    x: path[last].x * cellSize + cellSize / 2,
    y: path[last].y * cellSize + cellSize / 2,
  };
};

// Animated marching dots along arrow paths
const ArrowTroopFlow = React.memo(({ arrow, cellSize, scale, visibleBounds }) => {
  const graphicsRef = useRef(null);
  const phaseRef = useRef(0);
  const rafRef = useRef(null);

  const path = arrow?.path;
  const status = arrow?.status || "advancing";
  const color = ARROW_STATUS_COLORS[status] || 0x44cc44;
  const density = arrow?.effectiveDensityAtFront || 0;
  const commitment = arrow?.troopCommitment || 0;
  const endIdx = arrow?.currentIndex || (path ? path.length - 1 : 0);

  useEffect(() => {
    if (!path || path.length < 2) return;
    let lastTime = performance.now();

    const animate = (now) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      // Speed: faster with higher commitment
      const speed = 0.15 + commitment * 0.35;
      phaseRef.current = (phaseRef.current + dt * speed) % 1;

      const g = graphicsRef.current;
      if (!g) {
        rafRef.current = requestAnimationFrame(animate);
        return;
      }

      g.clear();

      // Dot parameters
      const dotCount = Math.max(8, Math.min(50, Math.round(10 + density * 0.15)));
      const spacing = 1 / dotCount;
      const dotRadius = cellSize * 0.12;
      const baseAlpha = 0.5 + Math.min(0.4, density / 500);

      for (let i = 0; i < dotCount; i++) {
        const t = (i * spacing + phaseRef.current * spacing) % 1;
        const pos = interpolateAlongPath(path, t, endIdx, cellSize);
        if (!pos) continue;

        // Visibility culling
        if (visibleBounds) {
          const cx = pos.x / cellSize;
          const cy = pos.y / cellSize;
          if (cx < visibleBounds.minX - 1 || cx > visibleBounds.maxX + 1 ||
              cy < visibleBounds.minY - 1 || cy > visibleBounds.maxY + 1) continue;
        }

        g.beginFill(color, baseAlpha);
        g.drawCircle(pos.x, pos.y, dotRadius);
        g.endFill();
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [path, cellSize, endIdx, commitment, density, color, visibleBounds]);

  if (!path || path.length < 2) return null;

  return (
    <Graphics
      ref={graphicsRef}
      zIndex={195}
    />
  );
});

// Border pressure visualization — border cells glow green (strong) to red (thin) based on troop density
const BorderPressureOverlay = React.memo(({ playerNation, densityMap, cellSize, visibleBounds }) => {
  if (!playerNation || !densityMap || densityMap.length < 3) return null;

  const territory = playerNation.territory;
  if (!territory?.x?.length) return null;

  return (
    <Graphics
      zIndex={107}
      draw={(g) => {
        g.clear();

        // Build density lookup from flat [x,y,density,...] array
        const densityLookup = new Map();
        for (let i = 0; i < densityMap.length; i += 3) {
          densityLookup.set((densityMap[i + 1] << 16) | densityMap[i], densityMap[i + 2]);
        }

        // Build territory set
        const terrSet = new Set();
        for (let i = 0; i < territory.x.length; i++) {
          terrSet.add((territory.y[i] << 16) | territory.x[i]);
        }

        // Find border cells and compute average density
        const borderCells = [];
        let totalDensity = 0;
        let densityCount = 0;

        for (let i = 0; i < territory.x.length; i++) {
          const x = territory.x[i];
          const y = territory.y[i];

          // Visibility culling
          if (visibleBounds) {
            if (x < visibleBounds.minX || x > visibleBounds.maxX ||
                y < visibleBounds.minY || y > visibleBounds.maxY) continue;
          }

          // Check if border cell (has non-owned neighbor)
          const isBorder =
            !terrSet.has(((y - 1) << 16) | x) ||
            !terrSet.has((y << 16) | (x + 1)) ||
            !terrSet.has(((y + 1) << 16) | x) ||
            !terrSet.has((y << 16) | (x - 1));
          if (!isBorder) continue;

          const d = densityLookup.get((y << 16) | x) || 0;
          borderCells.push({ x, y, density: d });
          totalDensity += d;
          densityCount++;
        }

        if (borderCells.length === 0) return;
        const avgDensity = Math.max(1, totalDensity / densityCount);

        for (const cell of borderCells) {
          // t: 0 = red (thin/no troops), 0.5 = yellow (average), 1 = green (strong)
          const t = Math.min(1, Math.max(0, cell.density / (avgDensity * 2)));

          let r, gVal, b;
          if (t < 0.5) {
            const s = t * 2;
            r = 255;
            gVal = Math.round(s * 200);
            b = 0;
          } else {
            const s = (t - 0.5) * 2;
            r = Math.round((1 - s) * 255);
            gVal = 200 + Math.round(s * 55);
            b = 0;
          }
          const color = (r << 16) | (gVal << 8) | b;
          // Higher alpha so border defense is clearly visible
          const alpha = 0.35 + Math.abs(t - 0.5) * 0.3;

          g.beginFill(color, alpha);
          g.drawRect(cell.x * cellSize, cell.y * cellSize, cellSize, cellSize);
          g.endFill();
        }
      }}
    />
  );
}, (prev, next) => {
  if (prev.cellSize !== next.cellSize) return false;
  if (prev.playerNation !== next.playerNation) return false;
  if (prev.visibleBounds !== next.visibleBounds) return false;
  const a = prev.densityMap;
  const b = next.densityMap;
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  const step = Math.max(3, Math.floor(a.length / 30) * 3);
  for (let i = 0; i < a.length; i += step) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) return false;
  }
  return true;
});

// Combat flash effects at cells where territory changes hands
const COMBAT_FLASH_DURATION = 800;
const CombatFlashLayer = React.memo(({ combatFlashes, cellSize, animTime, visibleBounds }) => {
  if (!combatFlashes || combatFlashes.length === 0) return null;

  return (
    <Graphics
      zIndex={108}
      draw={(g) => {
        g.clear();
        const now = animTime || performance.now();
        for (const flash of combatFlashes) {
          const age = now - flash.createdAt;
          if (age < 0 || age > COMBAT_FLASH_DURATION) continue;

          // Visibility culling
          if (visibleBounds) {
            if (flash.x < visibleBounds.minX || flash.x > visibleBounds.maxX ||
                flash.y < visibleBounds.minY || flash.y > visibleBounds.maxY) continue;
          }

          const t = age / COMBAT_FLASH_DURATION;
          // Quick fade-in (first 15%), then fade-out
          let alpha;
          if (t < 0.15) {
            alpha = (t / 0.15) * 0.7;
          } else {
            alpha = 0.7 * (1 - (t - 0.15) / 0.85);
          }

          const color = flash.type === "capture" ? 0x44ff44 : 0xff4444;
          const size = cellSize * 1.2;
          const offset = (size - cellSize) / 2;

          g.beginFill(color, Math.max(0, alpha));
          g.drawRect(
            flash.x * cellSize - offset,
            flash.y * cellSize - offset,
            size,
            size
          );
          g.endFill();
        }
      }}
    />
  );
});

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

  const setOffsetClamped = useCallback(
    (next) => {
      const resolved =
        typeof next === "function" ? next(offsetRef.current) : next;
      setOffset(clampOffsetFinal(resolved, scaleRef.current));
    },
    [clampOffsetFinal]
  );

  const panBy = useCallback(
    (dx, dy) => {
      setOffset((prev) =>
        clampOffsetFinal(
          { x: prev.x + dx, y: prev.y + dy },
          scaleRef.current
        )
      );
    },
    [clampOffsetFinal]
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
    setOffsetClamped,
    panBy,
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
    const subSet = new Set();
    const subX = nation.territoryDeltaForClient.sub.x;
    const subY = nation.territoryDeltaForClient.sub.y;
    for (let i = 0; i < subX.length; i++) {
      subSet.add((subY[i] << 16) | subX[i]);
    }
    const merged = { x: [], y: [] };
    for (let i = 0; i < territory.x.length; i++) {
      if (!subSet.has((territory.y[i] << 16) | territory.x[i])) {
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

const NationOverlay = React.memo(({
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
    nation.color ||
    nationColors?.[nation.owner] ||
    palette[nationIndex % palette.length];
  const baseColor = string2hex(nationColor);

  // Compute the merged territory for this nation.
  const territory = useMemo(() => getMergedTerritory(nation), [nation]);
  const territorySet = useMemo(() => {
    const set = new Set();
    for (let i = 0; i < territory.x.length; i++) {
      set.add((territory.y[i] << 16) | territory.x[i]);
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
    const base = 14;
    const size = base + popScale * 7;
    return Math.min(44, Math.max(16, size));
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
        !territorySet.has(((y - 1) << 16) | x) ||
        !territorySet.has((y << 16) | (x + 1)) ||
        !territorySet.has(((y + 1) << 16) | x) ||
        !territorySet.has((y << 16) | (x - 1));
      if (hasNonOwned) bSet.add((y << 16) | x);
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
              let segIsEdge = borderTileSet.has((run.y << 16) | run.start);
              for (let x = run.start + 1; x <= run.end; x++) {
                const isEdge = borderTileSet.has((run.y << 16) | x);
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
          text={nation.nationName || nation.displayName || nation.owner}
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
                texture={buildIconMap[city.type] || `/${city.type.toLowerCase().replace(" ", "_")}.png`}
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
                  text={city.type === "capital" ? `${city.name} (Capital)` : city.name}
                  x={centerX}
                  y={centerY + iconSize * 0.6}
                  fontSize={Math.max(12, labelFontSize * 0.75)}
                  alpha={0.9}
                  scale={scale}
                />
              )}
            </React.Fragment>
          );
        })}
    </>
  );
});

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
  drawingArrowType,
  onStartDrawArrow,
  currentArrowPath,
  onArrowPathUpdate,
  onSendArrow,
  onCancelArrow,
  activeAttackArrows,
  activeDefendArrow,
  uiMode,
  isMobile,
  onInspectCell,
  troopDensityMap,
  combatFlashes,
  setCombatFlashes,
  regionData,
  isDiscord,
}) => {
  const stageWidth = window.innerWidth;
  const stageHeight = window.innerHeight;

  const {
    cellSize,
    scale,
    offset,
    setOffsetClamped,
    panBy,
    handleWheel,
    zoomAtPoint,
    getCellCoordinates,
  } = usePanZoom({ mapMetadata, stageWidth, stageHeight });

  // Local state for unit selections and hovered cell
  const [hoveredCell, setHoveredCell] = useState(null);
  const hoverFrameRef = useRef(null);
  const pendingHoverRef = useRef(null);
  const nations = gameState?.gameState?.nations || [];
  const playerNation = useMemo(() =>
    nations.find((n) => n.owner === userId && n.status !== "defeated") || null,
    [nations, userId]
  );
  const resourceNodeClaims = gameState?.gameState?.resourceNodeClaims || {};
  const captureTicks =
    config?.territorial?.resourceCaptureTicks || 20;
  const [captureEffects, setCaptureEffects] = useState([]);
  const [captureEffectTime, setCaptureEffectTime] = useState(0);
  const captureInitRef = useRef(false);
  const lastClaimOwnersRef = useRef({});
  const [attackInterpAlpha, setAttackInterpAlpha] = useState(1);
  const attackInterpRef = useRef({
    from: [],
    to: (activeAttackArrows || []).map(cloneAttackArrow),
    startMs: performance.now(),
    durationMs: Math.max(120, config?.territorial?.tickRateMs || 200),
  });
  const ownershipMap = useMemo(() => {
    const map = new Map();
    nations.forEach((nation) => {
      const tx = nation?.territory?.x || [];
      const ty = nation?.territory?.y || [];
      for (let i = 0; i < tx.length; i++) {
        map.set((ty[i] << 16) | tx[i], nation.owner);
      }
    });
    return map;
  }, [nations]);

  useEffect(() => {
    if (!resourceNodeClaims) return;
    const currentOwners = {};
    const newEffects = [];
    Object.entries(resourceNodeClaims).forEach(([key, claim]) => {
      const owner = claim?.owner || null;
      currentOwners[key] = owner;
      if (!owner || !captureInitRef.current) return;
      const prevOwner = lastClaimOwnersRef.current?.[key] || null;
      if (owner === prevOwner) return;
      if (userId && owner !== userId) return;
      const [xStr, yStr] = key.split(",");
      const x = Number(xStr);
      const y = Number(yStr);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const resourceName = String(claim?.type || "resource").replace(/_/g, " ");
      newEffects.push({
        id: `${key}-${owner}-${Date.now()}`,
        x,
        y,
        text: `${resourceName} node captured`,
        createdAt: performance.now(),
      });
    });
    if (!captureInitRef.current) {
      captureInitRef.current = true;
      lastClaimOwnersRef.current = currentOwners;
      return;
    }
    lastClaimOwnersRef.current = currentOwners;
    if (newEffects.length) {
      setCaptureEffects((prev) => {
        if (prev.length === 0) return newEffects.slice(-CAPTURE_EFFECT_MAX);
        const combined = prev.concat(newEffects);
        return combined.length <= CAPTURE_EFFECT_MAX ? combined : combined.slice(-CAPTURE_EFFECT_MAX);
      });
    }
  }, [resourceNodeClaims, userId]);

  useEffect(() => {
    const nextTo = (activeAttackArrows || []).map(cloneAttackArrow);
    attackInterpRef.current = {
      from: attackInterpRef.current.to,
      to: nextTo,
      startMs: performance.now(),
      durationMs: Math.max(120, config?.territorial?.tickRateMs || 200),
    };
    setAttackInterpAlpha(0);
  }, [activeAttackArrows, config?.territorial?.tickRateMs]);

  useEffect(() => {
    let rafId;
    const animate = () => {
      const interp = attackInterpRef.current;
      const elapsed = performance.now() - interp.startMs;
      const nextAlpha = Math.min(1, elapsed / Math.max(1, interp.durationMs));
      setAttackInterpAlpha((prev) => {
        if (Math.abs(prev - nextAlpha) < 0.01) return prev;
        return nextAlpha;
      });
      if (nextAlpha < 1) {
        rafId = requestAnimationFrame(animate);
      }
    };

    rafId = requestAnimationFrame(animate);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [activeAttackArrows, config?.territorial?.tickRateMs]);

  const smoothedAttackArrows = useMemo(() => {
    const { from, to } = attackInterpRef.current;
    if (!to.length || attackInterpAlpha >= 0.999) return to;

    const fromByKey = new Map();
    for (let i = 0; i < from.length; i++) {
      fromByKey.set(getAttackArrowKey(from[i], i), from[i]);
    }

    return to.map((arrow, idx) => {
      const key = getAttackArrowKey(arrow, idx);
      const previous = fromByKey.get(key);
      return interpolateAttackArrow(previous, arrow, attackInterpAlpha);
    });
  }, [attackInterpAlpha]);

  const buildCellInfo = useCallback(
    (cell, x, y) => {
      if (!cell) return null;
      const biomeName =
        mappings?.biomes?.[cell[3]] || cell[3] || "UNKNOWN";
      const rawResources = Array.isArray(cell[5]) ? cell[5] : [];
      const resources = rawResources.map((r) =>
        typeof r === "string" ? r : mappings?.resources?.[r] ?? r
      );
      const owner = ownershipMap.get((y << 16) | x) || null;
      const ownerNation = owner
        ? nations.find((n) => n.owner === owner)
        : null;
      const structure = ownerNation?.cities?.find(
        (c) => c.x === x && c.y === y
      );
      const claim = resourceNodeClaims?.[`${x},${y}`] || null;
      return {
        x,
        y,
        biome: biomeName,
        resources,
        owner,
        ownerColor: owner ? nationColors?.[owner] : null,
        structure,
        claim,
      };
    },
    [mappings, ownershipMap, nations, resourceNodeClaims, nationColors]
  );

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
    if (captureEffects.length === 0) return undefined;
    let animationFrameId;
    let lastUpdate = performance.now();
    const tick = (now) => {
      if (now - lastUpdate >= 50) {
        lastUpdate = now;
        setCaptureEffectTime(now);
      }
      animationFrameId = requestAnimationFrame(tick);
    };
    animationFrameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrameId);
  }, [captureEffects.length]);

  useEffect(() => {
    if (captureEffects.length === 0) return;
    const now = captureEffectTime || performance.now();
    const cutoff = now - CAPTURE_EFFECT_DURATION_MS;
    const hasExpired = captureEffects.some((effect) => effect.createdAt < cutoff);
    if (!hasExpired) return;
    setCaptureEffects((prev) =>
      prev.filter((effect) => effect.createdAt >= cutoff)
    );
  }, [captureEffectTime, captureEffects]);

  // Prune expired combat flashes every second
  useEffect(() => {
    if (!combatFlashes || combatFlashes.length === 0) return;
    const interval = setInterval(() => {
      const now = performance.now();
      setCombatFlashes?.((prev) =>
        prev.filter((f) => now - f.createdAt < COMBAT_FLASH_DURATION)
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [combatFlashes?.length, setCombatFlashes]);

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
  const touchPointsRef = useRef(new Map());
  const longPressRef = useRef({
    armed: false,
    triggered: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    timer: null,
  });
  const pinchRef = useRef({
    active: false,
    ids: [],
    startDistance: 1,
    startScale: 1,
    lastMid: null,
  });
  const panRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startOffset: { x: 0, y: 0 },
    moved: false,
    button: null,
  });

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
  const panByRef = useRef(panBy);
  panByRef.current = panBy;
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
        panByRef.current(dx, dy);
      }
      animationFrameId = requestAnimationFrame(update);
    };
    animationFrameId = requestAnimationFrame(update);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  /* ----- Pointer Handlers ----- */
  const clearLongPress = useCallback(() => {
    const lp = longPressRef.current;
    if (lp.timer) {
      clearTimeout(lp.timer);
    }
    lp.armed = false;
    lp.triggered = false;
    lp.pointerId = null;
    lp.timer = null;
  }, []);

  const beginPinchGesture = useCallback(
    (points) => {
      if (!points || points.size < 2) return false;
      const entries = Array.from(points.entries());
      const [idA, a] = entries[0];
      const [idB, b] = entries[1];
      if (!a || !b) return false;
      const mid = {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
      };
      const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      pinchRef.current = {
        active: true,
        ids: [idA, idB],
        startDistance: distance,
        startScale: scale,
        lastMid: mid,
      };
      setIsPanning(true);
      return true;
    },
    [scale]
  );

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
      const originalEvent = e.data?.originalEvent || e.nativeEvent || {};
      const pointerId = originalEvent.pointerId ?? "mouse";
      const pointerType = originalEvent.pointerType || "mouse";
      const isTouchPointer = pointerType === "touch";
      if (isTouchPointer) {
        originalEvent.preventDefault?.();
      }

      const forcedDraw =
        uiMode === "drawAttack"
          ? "attack"
          : uiMode === "drawDefend"
          ? "defend"
          : drawingArrowType || "attack";
      const canDraw = !foundingNation && !buildingStructure;

      if (isTouchPointer) {
        touchPointsRef.current.set(pointerId, { x, y });
        if (touchPointsRef.current.size >= 2) {
          // Two-finger touch always switches to pan/zoom mode.
          clearLongPress();
          if (isDrawingArrowRef.current) {
            isDrawingArrowRef.current = false;
            arrowPathRef.current = [];
            lastArrowPointRef.current = null;
            drawTypeRef.current = null;
            onCancelArrow?.();
          }
          if (panRef.current.active) {
            panRef.current.active = false;
            panRef.current.moved = false;
            panRef.current.button = null;
          }
          beginPinchGesture(touchPointsRef.current);
          return;
        }

        // Single-finger touch drag pans by default.
        panRef.current.active = true;
        panRef.current.moved = false;
        panRef.current.startX = x;
        panRef.current.startY = y;
        panRef.current.startOffset = { ...offset };
        panRef.current.button = 0;
        setIsPanning(true);

        // Long-press converts this touch into arrow drawing.
        clearLongPress();
        if (canDraw) {
          const lp = longPressRef.current;
          lp.armed = true;
          lp.triggered = false;
          lp.pointerId = pointerId;
          lp.startX = x;
          lp.startY = y;
          lp.timer = setTimeout(() => {
            const current = longPressRef.current;
            if (
              !current.armed ||
              current.pointerId !== pointerId ||
              touchPointsRef.current.size !== 1
            ) {
              return;
            }
            const point = touchPointsRef.current.get(pointerId);
            if (!point) return;
            const moved = Math.hypot(
              point.x - current.startX,
              point.y - current.startY
            );
            if (moved > TOUCH_LONG_PRESS_MOVE_PX) return;

            current.triggered = true;
            if (panRef.current.active) {
              panRef.current.active = false;
              panRef.current.moved = false;
              panRef.current.button = null;
              setIsPanning(false);
            }

            const cell = getCellCoordinates(point.x, point.y);
            if (
              cell.x >= 0 &&
              cell.x < mapMetadata.width &&
              cell.y >= 0 &&
              cell.y < mapMetadata.height
            ) {
              drawTypeRef.current = forcedDraw;
              if (drawingArrowType !== forcedDraw) {
                onStartDrawArrow?.(forcedDraw);
              }
              isDrawingArrowRef.current = true;
              arrowPathRef.current = [{ x: cell.x, y: cell.y }];
              lastArrowPointRef.current = { x: cell.x, y: cell.y };
              onArrowPathUpdate?.([{ x: cell.x, y: cell.y }]);
            }
          }, TOUCH_LONG_PRESS_MS);
        }
        return;
      }
      // Check which button is pressed (0: left, 1: middle, 2: right)
      const button = originalEvent.button ?? e.nativeEvent?.button;
      const buttons =
        originalEvent.buttons ?? e.nativeEvent?.buttons ?? 0;
      const leftDown = (buttons & 1) === 1;
      const rightDown = (buttons & 2) === 2;
      const middleDown = (buttons & 4) === 4;
      const defendCombo = leftDown && rightDown;

      if (button === 2) {
        e.data?.originalEvent?.preventDefault?.();
        e.preventDefault?.();
      }
      const shouldPan =
        button === 1 ||
        button === 2 ||
        middleDown ||
        rightDown;

      if (defendCombo && canDraw) {
        if (panRef.current.active) {
          panRef.current.active = false;
          panRef.current.moved = false;
          panRef.current.button = null;
          setIsPanning(false);
        }
        const cell = getCellCoordinates(x, y);
        if (
          cell.x >= 0 &&
          cell.x < mapMetadata.width &&
          cell.y >= 0 &&
          cell.y < mapMetadata.height
        ) {
          drawTypeRef.current = "defend";
          if (drawingArrowType !== "defend") {
            onStartDrawArrow?.("defend");
          }
          isDrawingArrowRef.current = true;
          arrowPathRef.current = [{ x: cell.x, y: cell.y }];
          lastArrowPointRef.current = { x: cell.x, y: cell.y };
          onArrowPathUpdate?.([{ x: cell.x, y: cell.y }]);
        }
        return;
      }

      if (shouldPan) {
        panRef.current.active = true;
        panRef.current.moved = false;
        panRef.current.startX = x;
        panRef.current.startY = y;
        panRef.current.startOffset = { ...offset };
        panRef.current.button = button;
        setIsPanning(true);
        return;
      }

      // Arrow drawing mode
      const primaryDrawActivation = button === 0 || isTouchPointer;
      if (canDraw && primaryDrawActivation && forcedDraw) {
        const drawMode = forcedDraw;
        const cell = getCellCoordinates(x, y);
        if (
          cell.x >= 0 &&
          cell.x < mapMetadata.width &&
          cell.y >= 0 &&
          cell.y < mapMetadata.height
        ) {
          drawTypeRef.current = drawMode;
          if (drawingArrowType !== drawMode) {
            onStartDrawArrow?.(drawMode);
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
      drawingArrowType,
      uiMode,
      getCellCoordinates,
      mapMetadata,
      onArrowPathUpdate,
      onStartDrawArrow,
      onCancelArrow,
      clearLongPress,
      offset,
      beginPinchGesture,
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
      const originalEvent = e.data?.originalEvent || e.nativeEvent || {};
      const pointerId = originalEvent.pointerId ?? "mouse";
      const pointerType = originalEvent.pointerType || "mouse";
      const isTouchPointer = pointerType === "touch";
      if (isTouchPointer) {
        originalEvent.preventDefault?.();
      }

      if (isTouchPointer) {
        touchPointsRef.current.set(pointerId, { x, y });
        const lp = longPressRef.current;
        if (lp.armed && !lp.triggered && lp.pointerId === pointerId) {
          const moved = Math.hypot(x - lp.startX, y - lp.startY);
          if (moved > TOUCH_LONG_PRESS_MOVE_PX) {
            clearLongPress();
          }
        }
      }

      if (pinchRef.current.active) {
        const { ids, startDistance, startScale, lastMid } = pinchRef.current;
        const a = touchPointsRef.current.get(ids[0]);
        const b = touchPointsRef.current.get(ids[1]);
        if (a && b) {
          const mid = {
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
          };
          const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
          const targetScale =
            startScale * (distance / Math.max(1, startDistance));
          zoomAtPoint(mid.x, mid.y, targetScale);
          if (lastMid) {
            panBy(mid.x - lastMid.x, mid.y - lastMid.y);
          }
          pinchRef.current.lastMid = mid;
        }
        return;
      }

      if (panRef.current.active) {
        const dx = x - panRef.current.startX;
        const dy = y - panRef.current.startY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          panRef.current.moved = true;
        }
        setOffsetClamped({
          x: panRef.current.startOffset.x + dx,
          y: panRef.current.startOffset.y + dy,
        });
        return;
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
      setOffsetClamped,
      panBy,
      zoomAtPoint,
      clearLongPress,
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
        // Check affordability before sending
        const arrowCostCfg = config?.arrowCosts;
        if (arrowCostCfg && drawType === "attack") {
          let pathLen = 0;
          for (let i = 1; i < path.length; i++) {
            const dx = path[i].x - path[i-1].x;
            const dy = path[i].y - path[i-1].y;
            pathLen += Math.sqrt(dx*dx + dy*dy);
          }
          let foodCost = arrowCostCfg.food.base + arrowCostCfg.food.perTile * pathLen;
          let goldCost = arrowCostCfg.gold.base + arrowCostCfg.gold.perTile * pathLen;
          const pNation = nations.find((n) => n.owner === userId);
          const activeAttacks = pNation?.arrowOrders?.attacks?.length || 0;
          if (arrowCostCfg.firstArrowFree && activeAttacks === 0) {
            foodCost = 0;
            goldCost = 0;
          }
          foodCost = Math.ceil(foodCost);
          goldCost = Math.ceil(goldCost);
          const playerFood = pNation?.resources?.food || 0;
          const playerGold = pNation?.resources?.gold || 0;
          if (playerFood < foodCost || playerGold < goldCost) {
            onCancelArrow?.();
            return;
          }
        }

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
    [drawingArrowType, onSendArrow, onCancelArrow, config, nations, userId]
  );

  const handlePointerLeave = useCallback(() => {
    clearLongPress();
    touchPointsRef.current.clear();
    pinchRef.current = {
      active: false,
      ids: [],
      startDistance: 1,
      startScale: 1,
      lastMid: null,
    };
    // If the pointer leaves the canvas while drawing, cancel the arrow
    finishArrowDrawing(false);
    if (panRef.current.active) {
      panRef.current.active = false;
      panRef.current.moved = false;
      panRef.current.button = null;
      setIsPanning(false);
    }
  }, [finishArrowDrawing, clearLongPress]);

  const handlePointerUp = useCallback(
    (e) => {
      const originalEvent = e.data?.originalEvent || e.nativeEvent || {};
      const pointerId = originalEvent.pointerId ?? "mouse";
      const pointerType = originalEvent.pointerType || "mouse";
      const isTouchPointer = pointerType === "touch";
      if (isTouchPointer) {
        originalEvent.preventDefault?.();
      }
      if (isTouchPointer) {
        if (longPressRef.current.pointerId === pointerId) {
          clearLongPress();
        }
        touchPointsRef.current.delete(pointerId);
        if (pinchRef.current.active) {
          const [idA, idB] = pinchRef.current.ids;
          const keepPinch =
            touchPointsRef.current.has(idA) && touchPointsRef.current.has(idB);
          if (!keepPinch) {
            pinchRef.current = {
              active: false,
              ids: [],
              startDistance: 1,
              startScale: 1,
              lastMid: null,
            };
            setIsPanning(false);
          }
          return;
        }
      }
      if (panRef.current.active) {
        const wasMoved = panRef.current.moved;
        const panButton = panRef.current.button;
        panRef.current.active = false;
        panRef.current.moved = false;
        panRef.current.button = null;
        setIsPanning(false);
        if (panButton === 1 || panButton === 2 || wasMoved) {
          return;
        }
      }
      // Arrow drawing completed
      if (isDrawingArrowRef.current && (drawTypeRef.current || drawingArrowType)) {
        const hadArrowSegment = arrowPathRef.current.length >= 2;
        finishArrowDrawing(true);
        if (hadArrowSegment) {
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
        return;
      }
      if (foundingNation) {
        onFoundNation?.(cell.x, cell.y);
        return;
      }
      if (buildingStructure) {
        const gridCellData = mapGridByRow[cell.y]?.[cell.x];
        const resourceStructureMapping = {
          farm: "food",
          "lumber mill": "wood",
          mine: ["stone", "bronze", "steel"],
          stable: "horses",
        };
        const required = resourceStructureMapping[buildingStructure];
        const cellResources = gridCellData ? gridCellData[5] : [];
        let resourceValid = Array.isArray(required)
          ? required.some((r) => cellResources.includes(r))
          : cellResources.includes(required);
        const userNation = gameState?.gameState?.nations?.find(
          (n) => n.owner === userId
        );
        let territoryValid = false;
        if (userNation?.territory?.x && userNation?.territory?.y) {
          const tx = userNation.territory.x;
          const ty = userNation.territory.y;
          for (let ti = 0; ti < tx.length; ti++) {
            if (tx[ti] === cell.x && ty[ti] === cell.y) {
              territoryValid = true;
              break;
            }
          }
        }
        resourceValid =
          resourceValid ||
          ["town", "capital", "fort"].includes(buildingStructure);
        if (resourceValid && territoryValid) {
          onBuildCity?.(cell.x, cell.y, buildingStructure);
        }
        onCancelBuild();
        return;
      }
      if (uiMode === "idle" && onInspectCell) {
        const gridCellData = mapGridByRow[cell.y]?.[cell.x];
        const info = gridCellData
          ? buildCellInfo(gridCellData, cell.x, cell.y)
          : null;
        if (info) onInspectCell(info);
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
      drawingArrowType,
      finishArrowDrawing,
      onInspectCell,
      buildCellInfo,
      clearLongPress,
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
    result["default"] = `/biomes/grassland.png`;
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
      ownershipMap,
      resourceNodeClaims,
      captureTicks
    );
  }, [visibleMapGrid, cellSize, scale, ownershipMap, resourceNodeClaims, captureTicks]);

  const captureEffectNodes = useMemo(() => {
    if (!captureEffects.length) return null;
    const now = captureEffectTime || performance.now();
    const invScale = 1 / Math.max(0.35, scale || 1);
    const baseFontSize = Math.max(16, Math.min(26, cellSize * 0.9));
    const riseDistance = 22 / Math.max(scale || 1, 0.35);
    return captureEffects.map((effect) => {
      const t = Math.min(
        1,
        Math.max(0, (now - effect.createdAt) / CAPTURE_EFFECT_DURATION_MS)
      );
      const fade =
        t < 0.2 ? t / 0.2 : Math.max(0, 1 - (t - 0.2) / 0.8);
      const pulse = t < 0.25 ? 0.6 + 0.4 * Math.sin((t / 0.25) * Math.PI) : 1;
      const alpha = Math.min(1, fade * pulse);
      const baseX = effect.x * cellSize + cellSize / 2;
      const baseY = effect.y * cellSize + cellSize / 2 - cellSize * 0.2;
      return (
        <Text
          key={effect.id}
          text={effect.text}
          x={baseX}
          y={baseY - riseDistance * t}
          anchor={0.5}
          zIndex={230}
          alpha={alpha}
          scale={{ x: invScale, y: invScale }}
          style={{
            fontFamily: "Barlow Semi Condensed, system-ui",
            fill: "#7CFF6B",
            fontSize: baseFontSize,
            fontWeight: "600",
            stroke: "#0b2a16",
            strokeThickness: 3,
          }}
        />
      );
    });
  }, [captureEffects, captureEffectTime, scale, cellSize]);
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
  // Compute region info for build mode
  const hoveredRegionId = useMemo(() => {
    if (!regionData || !hoveredCell) return null;
    const { assignment, width } = regionData;
    const idx = hoveredCell.y * width + hoveredCell.x;
    if (idx < 0 || idx >= assignment.length) return null;
    return assignment[idx];
  }, [regionData, hoveredCell]);

  const regionBuildable = useMemo(() => {
    if (!regionData || hoveredRegionId === null || hoveredRegionId === 65535) return true;
    if (!buildingStructure) return true;
    const allNations = gameState?.gameState?.nations || [];
    const regionCfg = config?.regions;
    if (!regionCfg?.enabled) return true;

    const { assignment, width } = regionData;

    if (buildingStructure === "town") {
      let townCount = 0;
      for (const n of allNations) {
        for (const c of n.cities || []) {
          if ((c.type === "town" || c.type === "capital") &&
              c.y * width + c.x >= 0 && c.y * width + c.x < assignment.length &&
              assignment[c.y * width + c.x] === hoveredRegionId) {
            townCount++;
          }
        }
      }
      return townCount < (regionCfg.maxTownsPerRegion ?? 1);
    }

    if (buildingStructure === "tower") {
      const playerNation = allNations.find((n) => n.owner === userId);
      if (!playerNation) return true;
      let towerCount = 0;
      for (const c of playerNation.cities || []) {
        if (c.type === "tower" &&
            c.y * width + c.x >= 0 && c.y * width + c.x < assignment.length &&
            assignment[c.y * width + c.x] === hoveredRegionId) {
          towerCount++;
        }
      }
      return towerCount < (regionCfg.maxTowersPerRegion ?? 2);
    }

    return true;
  }, [regionData, hoveredRegionId, buildingStructure, gameState, config, userId]);

  let buildPreview = null;
  if (buildingStructure && hoveredCell) {
    const gridCellData = mapGridByRow[hoveredCell.y]?.[hoveredCell.x];
    const resourceStructureMapping = {
      farm: "food",
      "lumber mill": "wood",
      mine: ["stone", "bronze", "steel"],
      stable: "horses",
    };
    const required = resourceStructureMapping[buildingStructure];
    const cellResources = gridCellData ? gridCellData[5] : [];
    let resourceValid = Array.isArray(required)
      ? required.some((r) => cellResources.includes(r))
      : cellResources.includes(required);
    const userNation = gameState?.gameState?.nations?.find(
      (n) => n.owner === userId
    );
    let territoryValid = false;
    if (userNation?.territory?.x && userNation?.territory?.y) {
      const tx = userNation.territory.x;
      const ty = userNation.territory.y;
      for (let ti = 0; ti < tx.length; ti++) {
        if (tx[ti] === hoveredCell.x && ty[ti] === hoveredCell.y) {
          territoryValid = true;
          break;
        }
      }
    }
    resourceValid =
      resourceValid || ["town", "capital", "fort", "tower"].includes(buildingStructure);
    const valid = resourceValid && territoryValid;
    const borderColor = valid ? 0x00ff00 : 0xff0000;
    const previewTexture =
      buildIconMap[buildingStructure] ||
      `/${buildingStructure.toLowerCase().replace(" ", "_")}.png`;
    buildPreview = (
      <BorderedSprite
        texture={previewTexture}
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

    if (captureEffectNodes) {
      if (Array.isArray(captureEffectNodes)) {
        children.push(...captureEffectNodes);
      } else {
        children.push(captureEffectNodes);
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

    // Troop density heatmap (after territory, before arrows)
    if (troopDensityMap && scale > 0.3) {
      children.push(
        <TroopDensityHeatmap
          key="troop-density-heatmap"
          densityMap={troopDensityMap}
          cellSize={cellSize}
          visibleBounds={visibleBounds}
        />
      );
    }

    // Border pressure visualization
    if (troopDensityMap && scale > 0.35 && playerNation) {
      children.push(
        <BorderPressureOverlay
          key="border-pressure"
          playerNation={playerNation}
          densityMap={troopDensityMap}
          cellSize={cellSize}
          visibleBounds={visibleBounds}
        />
      );
    }

    // Combat flash effects
    if (combatFlashes && combatFlashes.length > 0 && scale > 0.5) {
      children.push(
        <CombatFlashLayer
          key="combat-flashes"
          combatFlashes={combatFlashes}
          cellSize={cellSize}
          animTime={captureEffectTime}
          visibleBounds={visibleBounds}
        />
      );
    }

    // NOTE: Attack and defend arrows are rendered OUTSIDE this useMemo
    // (directly in the JSX below) so they always reflect the latest state
    // and don't get stuck from stale memoization.

    // Region overlay
    if (regionData) {
      children.push(
        <RegionOverlay
          key="region-overlay"
          regionData={regionData}
          cellSize={cellSize}
          visibleBounds={visibleBounds}
          scale={scale}
          buildMode={!!buildingStructure}
          hoveredRegionId={hoveredRegionId}
          regionBuildable={regionBuildable}
        />
      );
    }

    if (drawingArrowType && currentArrowPath && currentArrowPath.length > 0) {
      const arrowCostCfg = config?.arrowCosts;
      let arrowAffordable = true;
      let arrowCostText = null;

      if (arrowCostCfg && drawingArrowType === "attack") {
        // Compute path length
        let pathLen = 0;
        for (let i = 1; i < currentArrowPath.length; i++) {
          const dx = currentArrowPath[i].x - currentArrowPath[i-1].x;
          const dy = currentArrowPath[i].y - currentArrowPath[i-1].y;
          pathLen += Math.sqrt(dx*dx + dy*dy);
        }

        let foodCost = arrowCostCfg.food.base + arrowCostCfg.food.perTile * pathLen;
        let goldCost = arrowCostCfg.gold.base + arrowCostCfg.gold.perTile * pathLen;

        // First arrow free check
        const pNation = nations.find((n) => n.owner === userId);
        const activeAttacks = pNation?.arrowOrders?.attacks?.length || 0;
        if (arrowCostCfg.firstArrowFree && activeAttacks === 0) {
          foodCost = 0;
          goldCost = 0;
        }

        foodCost = Math.ceil(foodCost);
        goldCost = Math.ceil(goldCost);

        const playerFood = pNation?.resources?.food || 0;
        const playerGold = pNation?.resources?.gold || 0;
        arrowAffordable = playerFood >= foodCost && playerGold >= goldCost;

        if (foodCost > 0 || goldCost > 0) {
          arrowCostText = `${foodCost} food, ${goldCost} gold`;
          if (!arrowAffordable) arrowCostText += " (insufficient)";
        } else {
          arrowCostText = "Free";
        }
      }

      const arrowColor = arrowAffordable
        ? (drawingArrowType === "attack" ? 0xff4444 : 0x4444ff)
        : 0x888888;

      const node = renderArrowPath(
        currentArrowPath,
        cellSize,
        drawingArrowType,
        false,
        "drawing-arrow",
        null,
        scale,
        arrowColor
      );
      if (node) children.push(node);

      // Arrow cost label near the end of the path
      if (arrowCostText && currentArrowPath.length >= 2) {
        const lastPt = currentArrowPath[currentArrowPath.length - 1];
        const invScale = 1 / Math.max(0.35, scale || 1);
        children.push(
          <Container
            key="arrow-cost-label"
            x={lastPt.x * cellSize + cellSize}
            y={lastPt.y * cellSize - cellSize}
            zIndex={250}
            scale={{ x: invScale, y: invScale }}
          >
            <Text
              text={arrowCostText}
              style={{
                fontSize: 12,
                fill: arrowAffordable ? "#44cc44" : "#ff4444",
                fontWeight: "bold",
                stroke: "#000000",
                strokeThickness: 2,
              }}
            />
          </Container>
        );
      }
    }

    if (buildPreview) children.push(buildPreview);

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
    captureEffectNodes,
    renderNationOverlays,
    troopDensityMap,
    playerNation,
    combatFlashes,
    captureEffectTime,
    visibleBounds,
    drawingArrowType,
    currentArrowPath,
    buildPreview,
    nations,
    nationColors,
    regionData,
    hoveredRegionId,
    regionBuildable,
    buildingStructure,
    config,
    userId,
    scale,
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
        touchAction: isDiscord || isMobile ? "none" : "auto",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
        cursor:
          buildingStructure ||
          foundingNation ||
          uiMode === "drawAttack" ||
          uiMode === "drawDefend" ||
          drawingArrowType
            ? "crosshair"
            : isPanning
            ? "grabbing"
            : uiMode === "pan"
            ? "grab"
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
        {/* Attack arrows rendered outside useMemo so they always reflect latest state */}
        {smoothedAttackArrows?.map((arrow, i) =>
          arrow?.path
            ? renderArrowV2(arrow, cellSize, `active-attack-${arrow.id || i}`, scale)
            : null
        )}
        {/* Animated troop flow dots along arrow paths */}
        {scale > 0.5 && smoothedAttackArrows?.map((arrow, i) =>
          arrow?.path ? (
            <ArrowTroopFlow
              key={`troop-flow-${arrow.id || i}`}
              arrow={arrow}
              cellSize={cellSize}
              scale={scale}
              visibleBounds={visibleBounds}
            />
          ) : null
        )}
        {activeDefendArrow?.path
          ? renderArrowPath(
              activeDefendArrow.path,
              cellSize,
              "defend",
              true,
              "active-defend-arrow",
              activeDefendArrow.remainingPower,
              scale
            )
          : null}
      </Container>
    </Stage>
  );
};

export default GameCanvas;
