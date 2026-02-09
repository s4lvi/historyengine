// RegionOverlay.js — Renders region borders as dotted lines + build mode highlighting
import React, { useMemo } from "react";
import { Graphics } from "@pixi/react";

const RegionOverlay = React.memo(({
  regionData,
  cellSize,
  visibleBounds,
  scale,
  buildMode = false,
  hoveredRegionId = null,
  regionBuildable = true,
  regionInfo = null,
}) => {
  // Only render when zoomed in enough
  if (!regionData || !visibleBounds || scale <= 0.4) return null;

  const { assignment, width } = regionData;

  return (
    <Graphics
      zIndex={98}
      eventMode="none"
      interactiveChildren={false}
      draw={(g) => {
        g.clear();

        const minX = visibleBounds.minX;
        const maxX = visibleBounds.maxX;
        const minY = visibleBounds.minY;
        const maxY = visibleBounds.maxY;
        const height = regionData.height;
        const UNASSIGNED = 65535;

        // In build mode, fill the hovered region
        if (buildMode && hoveredRegionId !== null && hoveredRegionId !== UNASSIGNED) {
          const fillColor = regionBuildable ? 0x4488ff : 0xff4444;
          const fillAlpha = 0.08;
          g.beginFill(fillColor, fillAlpha);
          for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
              if (x < 0 || y < 0 || x >= width || y >= height) continue;
              const rId = assignment[y * width + x];
              if (rId === hoveredRegionId) {
                g.drawRect(x * cellSize, y * cellSize, cellSize, cellSize);
              }
            }
          }
          g.endFill();
        }

        // Draw border lines between regions (solid, single segment per edge)
        const borderColor = 0x888888;
        const borderAlpha = buildMode ? 0.4 : 0.2;
        const lineWidth = buildMode ? 1.5 : 1;

        g.lineStyle(lineWidth, borderColor, borderAlpha);

        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            const rId = assignment[y * width + x];
            if (rId === UNASSIGNED) continue;

            // Check right neighbor
            if (x + 1 < width) {
              const rightId = assignment[y * width + (x + 1)];
              if (rightId !== UNASSIGNED && rightId !== rId) {
                const bx = (x + 1) * cellSize;
                const by = y * cellSize;
                g.moveTo(bx, by);
                g.lineTo(bx, by + cellSize);
              }
            }

            // Check bottom neighbor
            if (y + 1 < height) {
              const bottomId = assignment[(y + 1) * width + x];
              if (bottomId !== UNASSIGNED && bottomId !== rId) {
                const bx = x * cellSize;
                const by = (y + 1) * cellSize;
                g.moveTo(bx, by);
                g.lineTo(bx + cellSize, by);
              }
            }
          }
        }

        // In build mode, draw solid borders around hovered region
        if (buildMode && hoveredRegionId !== null && hoveredRegionId !== UNASSIGNED) {
          const highlightColor = regionBuildable ? 0x4488ff : 0xff4444;
          g.lineStyle(2, highlightColor, 0.7);

          for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
              if (x < 0 || y < 0 || x >= width || y >= height) continue;
              const rId = assignment[y * width + x];
              if (rId !== hoveredRegionId) continue;

              const px = x * cellSize;
              const py = y * cellSize;

              if (x === 0 || assignment[y * width + (x - 1)] !== hoveredRegionId) {
                g.moveTo(px, py);
                g.lineTo(px, py + cellSize);
              }
              if (x + 1 >= width || assignment[y * width + (x + 1)] !== hoveredRegionId) {
                g.moveTo(px + cellSize, py);
                g.lineTo(px + cellSize, py + cellSize);
              }
              if (y === 0 || assignment[(y - 1) * width + x] !== hoveredRegionId) {
                g.moveTo(px, py);
                g.lineTo(px + cellSize, py);
              }
              if (y + 1 >= height || assignment[(y + 1) * width + x] !== hoveredRegionId) {
                g.moveTo(px, py + cellSize);
                g.lineTo(px + cellSize, py + cellSize);
              }
            }
          }
        }
      }}
    />
  );
}, (prev, next) => {
  return (
    prev.regionData === next.regionData &&
    prev.cellSize === next.cellSize &&
    prev.scale === next.scale &&
    prev.buildMode === next.buildMode &&
    prev.hoveredRegionId === next.hoveredRegionId &&
    prev.regionBuildable === next.regionBuildable &&
    prev.visibleBounds?.minX === next.visibleBounds?.minX &&
    prev.visibleBounds?.maxX === next.visibleBounds?.maxX &&
    prev.visibleBounds?.minY === next.visibleBounds?.minY &&
    prev.visibleBounds?.maxY === next.visibleBounds?.maxY
  );
});

export default RegionOverlay;
