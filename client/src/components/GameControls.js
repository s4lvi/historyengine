// GameControls.js
import { useState, useRef, useCallback, useEffect } from "react";

/**
 * Manages the current interaction mode of the game (founding, building, army selection)
 */
const useGameMode = () => {
  const [mode, setMode] = useState("default");
  const [buildingStructure, setBuildingStructure] = useState(null);
  const [selectedArmies, setSelectedArmies] = useState([]);
  const [selectionBox, setSelectionBox] = useState(null);

  const updateSelectionBox = (newBox) => {
    setSelectionBox(
      typeof newBox === "function" ? newBox(selectionBox) : newBox
    );
  };

  const clearSelectionBox = () => {
    setSelectionBox(null);
  };

  const enterBuildMode = useCallback((structure) => {
    setMode("building");
    setBuildingStructure(structure);
  }, []);

  const enterFoundingMode = useCallback(() => {
    setMode("founding");
  }, []);

  const enterArmyMode = useCallback((armies) => {
    setMode("army");
    setSelectedArmies(armies);
  }, []);

  const resetMode = useCallback(() => {
    setMode("default");
    setBuildingStructure(null);
    setSelectedArmies([]);
  }, []);

  return {
    mode,
    buildingStructure,
    selectedArmies,
    selectionBox,
    enterBuildMode,
    enterFoundingMode,
    enterArmyMode,
    resetMode,
    updateSelectionBox,
    clearSelectionBox,
  };
};

/**
 * Manages keyboard-based camera movement
 */
const useKeyboardControls = ({ setOffset, clampOffsetFinal, scale }) => {
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

    let lastFrameTime = performance.now();
    const panSpeed = 0.5;

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
        setOffset((prev) =>
          clampOffsetFinal(
            {
              x: prev.x + dx,
              y: prev.y + dy,
            },
            scale
          )
        );
      }

      requestAnimationFrame(update);
    };

    const animationFrameId = requestAnimationFrame(update);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      cancelAnimationFrame(animationFrameId);
    };
  }, [setOffset]);
};

/**
 * Manages pointer/touch interactions
 */
const usePointerControls = ({
  scale,
  offset,
  setOffset,
  getCellCoordinates,
  mapMetadata,
  gameMode,
  onFoundNation,
  onBuildCity,
  onArmyTargetSelect,
  userId,
  gameState,
  clampOffsetFinal,
  cellSize,
}) => {
  const pointerMap = useRef(new Map());
  const panStartRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const isMobile = typeof window !== "undefined" && "ontouchstart" in window;

  const handlePointerDown = useCallback(
    (e) => {
      const { position, button, pointerId } = e;

      pointerMap.current.set(pointerId, position);

      // Start panning on middle mouse button or touch
      if (button === 1 || (isMobile && pointerMap.current.size === 1)) {
        panStartRef.current = {
          position,
          offset: { ...offset },
        };
        setIsDragging(false);
      }
      if (gameMode.mode === "default" && e.button === 0) {
        console.log("setting selection box");
        const point = { x: e.position.x, y: e.position.y };
        gameMode.updateSelectionBox({ start: point, end: point });
      }
    },
    [offset, isMobile, gameMode] // Added gameMode
  );

  const handlePointerMove = useCallback(
    (e) => {
      const { position, pointerId } = e;
      const prevPosition = pointerMap.current.get(pointerId);

      if (!prevPosition) return;
      pointerMap.current.set(pointerId, position);

      // Handle panning
      if (panStartRef.current) {
        const deltaX = position.x - panStartRef.current.position.x;
        const deltaY = position.y - panStartRef.current.position.y;

        // Set dragging if movement is significant
        if (!isDragging && (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5)) {
          setIsDragging(true);
        }

        const newOffset = {
          x: panStartRef.current.offset.x + deltaX,
          y: panStartRef.current.offset.y + deltaY,
        };

        setOffset(clampOffsetFinal(newOffset, scale));
      }
      if (gameMode.selectionBox && !isMobile) {
        const point = { x: e.position.x, y: e.position.y };
        gameMode.updateSelectionBox((prev) => ({
          start: prev.start,
          end: point,
        }));
      }
    },
    [isDragging, scale, setOffset, clampOffsetFinal, gameMode] // Added gameMode
  );

  const handlePointerUp = useCallback(
    (e) => {
      const { position, pointerId } = e;
      pointerMap.current.delete(pointerId);

      // Handle click/tap if we weren't dragging
      if (pointerMap.current.size === 0) {
        if (gameMode.selectionBox) {
          // Convert box coordinates to world space (cell-based coordinates)
          const boxStart = getCellCoordinates(
            gameMode.selectionBox.start.x,
            gameMode.selectionBox.start.y
          );
          const boxEnd = getCellCoordinates(
            gameMode.selectionBox.end.x,
            gameMode.selectionBox.end.y
          );

          const boxMinX = Math.min(boxStart.x, boxEnd.x);
          const boxMaxX = Math.max(boxStart.x, boxEnd.x);
          const boxMinY = Math.min(boxStart.y, boxEnd.y);
          const boxMaxY = Math.max(boxStart.y, boxEnd.y);

          const selectedArmies = [];
          if (gameState?.gameState?.nations) {
            gameState.gameState.nations.forEach((nation) => {
              nation.armies?.forEach((army) => {
                const armyX = Math.floor(army.position.x);
                const armyY = Math.floor(army.position.y);

                if (
                  armyX >= boxMinX &&
                  armyX <= boxMaxX &&
                  armyY >= boxMinY &&
                  armyY <= boxMaxY &&
                  nation.owner === userId
                ) {
                  selectedArmies.push(army);
                }
              });
            });
          }

          if (selectedArmies.length > 0) {
            gameMode.enterArmyMode(selectedArmies);
          }
          gameMode.clearSelectionBox();
        } else if (!isDragging && position) {
          const cell = getCellCoordinates(position.x, position.y);

          if (
            cell.x >= 0 &&
            cell.x < mapMetadata.width &&
            cell.y >= 0 &&
            cell.y < mapMetadata.height
          ) {
            switch (gameMode.mode) {
              case "founding":
                onFoundNation?.(cell.x, cell.y);
                break;

              case "building":
                onBuildCity?.(cell.x, cell.y, gameMode.buildingStructure);
                gameMode.resetMode();
                break;

              case "army":
                gameMode.selectedArmies.forEach((army) =>
                  onArmyTargetSelect?.(army.id, cell.x, cell.y)
                );
                gameMode.resetMode();
                break;

              default:
                // Handle army selection
                if (gameState?.gameState?.nations) {
                  for (const nation of gameState.gameState.nations) {
                    const army = nation.armies?.find((army) => {
                      const armyX = Math.round(army.position.x);
                      const armyY = Math.round(army.position.y);
                      return (
                        armyX === cell.x &&
                        armyY === cell.y &&
                        !army.attackTarget
                      );
                    });
                    if (army && nation.owner === userId) {
                      gameMode.enterArmyMode([army]);
                      break;
                    }
                  }
                }
            }
          }
        }
      }

      // Reset panning state
      panStartRef.current = null;
      setIsDragging(false);
    },
    [
      isDragging,
      getCellCoordinates,
      mapMetadata,
      gameMode,
      onFoundNation,
      onBuildCity,
      onArmyTargetSelect,
      userId,
      gameState,
      scale,
      offset,
      cellSize,
    ]
  );

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    isDragging,
  };
};

/**
 * Main hook that combines all control systems
 */
export const useGameControls = ({
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
}) => {
  const gameMode = useGameMode();

  useKeyboardControls({ setOffset, clampOffsetFinal, scale });

  const handleZoom = useCallback(
    (position, delta) => {
      const zoomFactor = delta > 0 ? 1.1 : 0.9;

      setScale((prevScale) => {
        const newScale = Math.min(
          Math.max(prevScale * zoomFactor, computedMinScale),
          14
        );

        // Calculate world point (before zoom)
        const worldX = (position.x - offset.x) / prevScale;
        const worldY = (position.y - offset.y) / prevScale;

        // Calculate new offset to maintain zoom point
        const newOffset = {
          x: position.x - worldX * newScale,
          y: position.y - worldY * newScale,
        };

        setOffset(clampOffsetFinal(newOffset, newScale));
        return newScale;
      });
    },
    [scale, offset, setScale, setOffset, computedMinScale, clampOffsetFinal]
  );

  const pointerControls = usePointerControls({
    scale,
    offset,
    setOffset,
    getCellCoordinates,
    mapMetadata,
    gameMode,
    onFoundNation,
    onBuildCity,
    onArmyTargetSelect,
    userId,
    gameState,
    clampOffsetFinal,
  });

  return {
    gameMode,
    handleZoom,
    ...pointerControls,
  };
};
