// PanZoom.js
import { useState, useMemo, useCallback, useEffect } from "react";

/**
 * Hook to manage pan and zoom transformations for the game canvas
 */
export const usePanZoom = ({ mapMetadata, stageWidth, stageHeight }) => {
  // Calculate base cell size based on map width
  const cellSize = useMemo(() => {
    if (!mapMetadata) return 1;
    return stageWidth / mapMetadata.width;
  }, [mapMetadata, stageWidth]);

  // Calculate minimum scale to ensure map fills viewport appropriately
  const computedMinScale = useMemo(() => {
    if (!mapMetadata) return 1;

    // Calculate minimum scale based on both dimensions
    const minScaleWidth = mapMetadata.width / 32;
    const minScaleHeight =
      (stageHeight * mapMetadata.width) / (stageWidth * 32);

    return Math.max(minScaleWidth, minScaleHeight, 0.1);
  }, [mapMetadata, stageWidth, stageHeight]);

  // Initialize scale and offset
  const [scale, setScale] = useState(() => {
    const initialScale = computedMinScale > 2 ? computedMinScale : 2;
    return initialScale;
  });

  const [offset, setOffset] = useState(() => {
    if (!mapMetadata) return { x: 0, y: 0 };

    // Center the map initially
    return {
      x: (stageWidth * (1 - scale)) / 2,
      y:
        (stageHeight -
          (stageWidth * mapMetadata.height * scale) / mapMetadata.width) /
        2,
    };
  });

  // Ensure offset stays in bounds when window is resized
  useEffect(() => {
    const handleResize = () => {
      setOffset((prev) => clampOffsetFinal(prev, scale));
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [scale]);

  /**
   * Clamps offset to keep map within bounds and centered if smaller than viewport
   */
  const clampOffsetFinal = useCallback(
    (newOffset, currentScale) => {
      if (!mapMetadata) return newOffset;

      // Calculate map dimensions at current scale
      const mapWidth = stageWidth * currentScale;
      const mapHeight =
        (stageWidth * mapMetadata.height * currentScale) / mapMetadata.width;

      let minX, maxX, minY, maxY;

      // X-axis bounds
      if (mapWidth <= stageWidth) {
        // If map is smaller than viewport, center it
        minX = maxX = (stageWidth - mapWidth) / 2;
      } else {
        // Otherwise, prevent scrolling beyond edges
        minX = stageWidth - mapWidth;
        maxX = 0;
      }

      // Y-axis bounds
      if (mapHeight <= stageHeight) {
        // If map is smaller than viewport, center it
        minY = maxY = (stageHeight - mapHeight) / 2;
      } else {
        // Otherwise, prevent scrolling beyond edges
        minY = stageHeight - mapHeight;
        maxY = 0;
      }

      // Return clamped values
      return {
        x: Math.min(maxX, Math.max(newOffset.x, minX)),
        y: Math.min(maxY, Math.max(newOffset.y, minY)),
      };
    },
    [mapMetadata, stageWidth, stageHeight]
  );

  /**
   * Converts screen coordinates to cell coordinates
   */
  const getCellCoordinates = useCallback(
    (screenX, screenY) => {
      // Convert screen coordinates to world coordinates
      const worldX = (screenX - offset.x) / scale;
      const worldY = (screenY - offset.y) / scale;

      // Convert world coordinates to cell coordinates
      return {
        x: Math.floor(worldX / cellSize),
        y: Math.floor(worldY / cellSize),
      };
    },
    [offset, scale, cellSize]
  );

  /**
   * Converts cell coordinates to screen coordinates
   */
  const getScreenCoordinates = useCallback(
    (cellX, cellY) => {
      // Convert cell coordinates to world coordinates
      const worldX = cellX * cellSize;
      const worldY = cellY * cellSize;

      // Convert world coordinates to screen coordinates
      return {
        x: worldX * scale + offset.x,
        y: worldY * scale + offset.y,
      };
    },
    [cellSize, scale, offset]
  );

  /**
   * Sets zoom level while maintaining focus on a specific point
   */
  const setZoomLevel = useCallback(
    (newScale, focusPoint = null) => {
      if (!focusPoint) {
        // If no focus point, use center of screen
        focusPoint = {
          x: stageWidth / 2,
          y: stageHeight / 2,
        };
      }

      // Clamp scale to valid range
      const clampedScale = Math.min(Math.max(newScale, computedMinScale), 14);

      // Calculate world point (point before zoom)
      const worldX = (focusPoint.x - offset.x) / scale;
      const worldY = (focusPoint.y - offset.y) / scale;

      // Calculate new offset to maintain focus point
      const newOffset = {
        x: focusPoint.x - worldX * clampedScale,
        y: focusPoint.y - worldY * clampedScale,
      };

      // Update state
      setScale(clampedScale);
      setOffset(clampOffsetFinal(newOffset, clampedScale));
    },
    [scale, offset, computedMinScale, clampOffsetFinal, stageWidth, stageHeight]
  );

  /**
   * Smoothly pans to center a specific cell
   */
  const panToCell = useCallback(
    (cellX, cellY, duration = 500) => {
      // Get target screen coordinates
      const targetScreen = getScreenCoordinates(cellX, cellY);
      const startOffset = { ...offset };

      // Calculate target offset that centers the cell
      const targetOffset = {
        x: stageWidth / 2 - targetScreen.x + offset.x,
        y: stageHeight / 2 - targetScreen.y + offset.y,
      };

      // Animate the pan
      const startTime = performance.now();
      const animate = (currentTime) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Use easeInOutQuad for smooth animation
        const eased =
          progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        const newOffset = {
          x: startOffset.x + (targetOffset.x - startOffset.x) * eased,
          y: startOffset.y + (targetOffset.y - startOffset.y) * eased,
        };

        setOffset(clampOffsetFinal(newOffset, scale));

        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };

      requestAnimationFrame(animate);
    },
    [
      offset,
      scale,
      stageWidth,
      stageHeight,
      getScreenCoordinates,
      clampOffsetFinal,
    ]
  );

  /**
   * Resets view to initial state
   */
  const resetView = useCallback(() => {
    const initialScale = computedMinScale > 2 ? computedMinScale : 2;
    setScale(initialScale);
    setOffset({
      x: (stageWidth * (1 - initialScale)) / 2,
      y:
        (stageHeight -
          (stageWidth * mapMetadata.height * initialScale) /
            mapMetadata.width) /
        2,
    });
  }, [computedMinScale, mapMetadata, stageWidth, stageHeight]);

  return {
    cellSize,
    scale,
    setScale,
    offset,
    setOffset,
    computedMinScale,
    clampOffsetFinal,
    getCellCoordinates,
    getScreenCoordinates,
    setZoomLevel,
    panToCell,
    resetView,
  };
};
