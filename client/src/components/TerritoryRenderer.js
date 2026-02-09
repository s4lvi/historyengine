/**
 * TerritoryRenderer - OpenFront-style optimized territory rendering
 *
 * Instead of using Pixi Graphics (which rebuilds geometry every frame),
 * this uses an OffscreenCanvas to render territory as ImageData,
 * then converts to a Pixi Texture for display.
 *
 * Key optimizations:
 * 1. Direct pixel manipulation via ImageData (faster than canvas draw calls)
 * 2. Only re-renders when territory actually changes (via delta tracking)
 * 3. Processes updates incrementally (not full redraw every frame)
 */

import { useRef, useEffect, useMemo, useCallback } from "react";
import { Sprite } from "@pixi/react";
import { Texture, BaseTexture, SCALE_MODES } from "pixi.js";

// Convert hex color to RGB components
function hexToRgb(hex) {
  const num = typeof hex === "string" ? parseInt(hex.replace("#", ""), 16) : hex;
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

// Color palette for nations
const NATION_PALETTE = [
  "#FF3B30", "#34C759", "#0A84FF", "#FF9F0A", "#BF5AF2",
  "#FF375F", "#64D2FF", "#FFD60A", "#32D74B", "#5E5CE6",
];

/**
 * TerritoryTextureManager - Manages territory rendering to a single shared canvas
 * This is used by the TerritoryLayer component
 */
export class TerritoryTextureManager {
  constructor(width, height, cellSize) {
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.pixelWidth = width * cellSize;
    this.pixelHeight = height * cellSize;

    // Create offscreen canvas for territory rendering
    this.canvas = new OffscreenCanvas(this.pixelWidth, this.pixelHeight);
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });

    // Track which cells need updating
    this.dirtyRegions = new Set();
    this.lastNationVersions = new Map(); // owner -> version hash

    // Create initial texture
    this.texture = null;
    this.needsTextureUpdate = true;

    // Nation color cache
    this.nationColors = new Map();
  }

  // Set color for a nation
  setNationColor(owner, colorHex) {
    this.nationColors.set(owner, hexToRgb(colorHex));
  }

  // Clear a cell (make transparent)
  clearCell(x, y) {
    const px = x * this.cellSize;
    const py = y * this.cellSize;
    this.ctx.clearRect(px, py, this.cellSize, this.cellSize);
    this.needsTextureUpdate = true;
  }

  // Fill a cell with a nation's color
  fillCell(x, y, owner, alpha = 0.6) {
    const color = this.nationColors.get(owner);
    if (!color) return;

    const px = x * this.cellSize;
    const py = y * this.cellSize;

    this.ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
    this.ctx.fillRect(px, py, this.cellSize, this.cellSize);
    this.needsTextureUpdate = true;
  }

  // Apply delta updates from server
  applyDelta(owner, delta) {
    if (!delta) return;

    const addX = delta.add?.x || [];
    const addY = delta.add?.y || [];
    const subX = delta.sub?.x || [];
    const subY = delta.sub?.y || [];

    // Process removals first
    for (let i = 0; i < subX.length; i++) {
      this.clearCell(subX[i], subY[i]);
    }

    // Then additions
    for (let i = 0; i < addX.length; i++) {
      this.fillCell(addX[i], addY[i], owner);
    }
  }

  // Full redraw for a nation (used on initial load or reconnect)
  fullRedraw(owner, territory) {
    if (!territory?.x || !territory?.y) return;

    const color = this.nationColors.get(owner);
    if (!color) return;

    this.ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, 0.6)`;

    for (let i = 0; i < territory.x.length; i++) {
      const px = territory.x[i] * this.cellSize;
      const py = territory.y[i] * this.cellSize;
      this.ctx.fillRect(px, py, this.cellSize, this.cellSize);
    }

    this.needsTextureUpdate = true;
  }

  // Clear entire canvas
  clear() {
    this.ctx.clearRect(0, 0, this.pixelWidth, this.pixelHeight);
    this.needsTextureUpdate = true;
  }

  // Get or create Pixi texture from canvas
  getTexture() {
    if (this.needsTextureUpdate || !this.texture) {
      // Convert OffscreenCanvas to ImageBitmap, then to texture
      if (this.texture) {
        this.texture.destroy(true);
      }

      // Create texture from canvas
      const imageData = this.ctx.getImageData(0, 0, this.pixelWidth, this.pixelHeight);
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = this.pixelWidth;
      tempCanvas.height = this.pixelHeight;
      const tempCtx = tempCanvas.getContext("2d");
      tempCtx.putImageData(imageData, 0, 0);

      this.texture = Texture.from(tempCanvas, {
        scaleMode: SCALE_MODES.NEAREST,
      });

      this.needsTextureUpdate = false;
    }
    return this.texture;
  }

  // Cleanup
  destroy() {
    if (this.texture) {
      this.texture.destroy(true);
      this.texture = null;
    }
  }
}

/**
 * Hook to manage territory texture
 */
export function useTerritoryTexture(mapWidth, mapHeight, cellSize, nations, nationColors) {
  const managerRef = useRef(null);
  const lastNationsRef = useRef(null);
  const textureRef = useRef(null);

  // Initialize manager
  useEffect(() => {
    if (!mapWidth || !mapHeight || !cellSize) return;

    managerRef.current = new TerritoryTextureManager(mapWidth, mapHeight, cellSize);

    return () => {
      if (managerRef.current) {
        managerRef.current.destroy();
        managerRef.current = null;
      }
    };
  }, [mapWidth, mapHeight, cellSize]);

  // Update nation colors
  useEffect(() => {
    if (!managerRef.current || !nationColors) return;

    Object.entries(nationColors).forEach(([owner, color]) => {
      managerRef.current.setNationColor(owner, color);
    });
  }, [nationColors]);

  // Process nation updates
  const texture = useMemo(() => {
    if (!managerRef.current || !nations) return null;

    const manager = managerRef.current;
    const prevNations = lastNationsRef.current || [];

    // Build lookup of previous nations
    const prevByOwner = new Map();
    prevNations.forEach((n) => prevByOwner.set(n.owner, n));

    // Assign colors to new nations
    nations.forEach((nation, idx) => {
      if (!manager.nationColors.has(nation.owner)) {
        const color = nationColors?.[nation.owner] || NATION_PALETTE[idx % NATION_PALETTE.length];
        manager.setNationColor(nation.owner, color);
      }
    });

    // Process each nation
    nations.forEach((nation) => {
      if (nation.status === "defeated") return;

      const prev = prevByOwner.get(nation.owner);

      // Check if we have delta updates
      if (nation.territoryDeltaForClient) {
        const delta = nation.territoryDeltaForClient;
        const hasChanges =
          (delta.add?.x?.length || 0) > 0 || (delta.sub?.x?.length || 0) > 0;

        if (hasChanges) {
          manager.applyDelta(nation.owner, delta);
        }
      } else if (!prev && nation.territory?.x?.length > 0) {
        // New nation, do full draw
        manager.fullRedraw(nation.owner, nation.territory);
      }
    });

    // Handle defeated/removed nations
    prevNations.forEach((prevNation) => {
      const current = nations.find((n) => n.owner === prevNation.owner);
      if (!current || current.status === "defeated") {
        // Nation was removed, clear their territory
        if (prevNation.territory?.x) {
          for (let i = 0; i < prevNation.territory.x.length; i++) {
            manager.clearCell(prevNation.territory.x[i], prevNation.territory.y[i]);
          }
        }
      }
    });

    lastNationsRef.current = nations;
    textureRef.current = manager.getTexture();
    return textureRef.current;
  }, [nations, nationColors]);

  return texture;
}

/**
 * TerritoryLayer Component - Renders all territory using cached texture
 */
export function TerritoryLayer({
  mapWidth,
  mapHeight,
  cellSize,
  nations,
  nationColors,
  x = 0,
  y = 0,
  zIndex = 100,
}) {
  const texture = useTerritoryTexture(mapWidth, mapHeight, cellSize, nations, nationColors);

  if (!texture) return null;

  return (
    <Sprite
      texture={texture}
      x={x}
      y={y}
      zIndex={zIndex}
    />
  );
}

export default TerritoryLayer;
