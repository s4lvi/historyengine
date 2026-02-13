import React, { useEffect, useRef, useState } from "react";

const canAfford = (resources, cost) =>
  Object.entries(cost || {}).every(
    ([resource, amount]) => (resources?.[resource] || 0) >= amount
  );

const MobileActionDock = ({
  onFoundNation,
  hasFounded,
  isSpectating,
  allowRefound,
  attackPercent,
  setAttackPercent,
  uiMode,
  onSetMode,
  onBuildStructure,
  playerResources,
  buildCosts,
  activeAttackArrows,
  isRoomStarted = true,
  canStartRoom = false,
  onStartRoom,
  isStartingRoom = false,
  readyPlayerCount = 0,
  totalPlayers = 0,
  bottomOffset = 0,
  onHeightChange,
}) => {
  const [activeMenu, setActiveMenu] = useState(null);
  const dockRef = useRef(null);
  const buildMap = buildCosts || {};
  const buildEntries = Object.entries(buildMap);
  const dockStyle = { bottom: `${bottomOffset}px` };

  useEffect(() => {
    if (uiMode === "buildStructure") {
      setActiveMenu("build");
    }
  }, [uiMode]);

  useEffect(() => {
    if (!onHeightChange) return;
    const node = dockRef.current;
    if (!node) {
      onHeightChange(0);
      return;
    }

    const report = () => {
      const next = Math.ceil(node.getBoundingClientRect().height || 0);
      onHeightChange(next);
    };

    report();
    let observer;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(report);
      observer.observe(node);
    }
    window.addEventListener("resize", report);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", report);
      onHeightChange(0);
    };
  }, [onHeightChange, activeMenu, hasFounded, isSpectating, isRoomStarted]);

  if (!hasFounded) {
    if (isSpectating) {
      return (
        <div
          ref={dockRef}
          className="fixed left-0 right-0 z-20 bg-gray-900/85 p-4 text-white"
          style={dockStyle}
        >
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-200">
              Spectating — your nation has been defeated.
            </div>
            {allowRefound && (
              <button
                onClick={onFoundNation}
                className="rounded bg-gray-800 px-4 py-2"
              >
                Found New Nation
              </button>
            )}
          </div>
        </div>
      );
    }
    return (
      <div
        ref={dockRef}
        className="fixed left-0 right-0 z-20 bg-gray-900/85 p-4 text-white"
        style={dockStyle}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-300">Found Your Nation</div>
            <div className="text-xs text-gray-400">Tap to choose a starting tile</div>
          </div>
          <button onClick={onFoundNation} className="rounded bg-gray-800 px-4 py-2">
            Found
          </button>
        </div>
      </div>
    );
  }

  if (!isRoomStarted) {
    return (
      <div
        ref={dockRef}
        className="fixed left-0 right-0 z-20 border-t border-gray-700/60 bg-gray-900/95 px-3 py-3 text-white"
        style={dockStyle}
      >
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-gray-100">
                Lobby Setup
              </div>
              <div className="text-xs text-gray-300">
                Players ready: {readyPlayerCount}/{totalPlayers}
              </div>
            </div>
            <div className="rounded bg-gray-800 px-2 py-1 text-[11px] text-gray-200">
              {readyPlayerCount}/{totalPlayers}
            </div>
          </div>
          {canStartRoom && (
            <button
              onClick={onStartRoom}
              disabled={isStartingRoom}
              className="w-full rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:bg-emerald-900"
            >
              {isStartingRoom ? "Starting Match..." : "Start Match"}
            </button>
          )}
          {!canStartRoom && (
            <div className="text-xs text-gray-400">Waiting for room creator to start.</div>
          )}
        </div>
      </div>
    );
  }

  const toggleAttackMenu = () => {
    if (uiMode === "buildStructure") {
      onSetMode?.("idle");
    }
    setActiveMenu((prev) => (prev === "attack" ? null : "attack"));
  };

  const toggleBuildMenu = () => {
    setActiveMenu((prev) => {
      const opening = prev !== "build";
      if (opening) {
        onSetMode?.("buildStructure");
        return "build";
      }
      if (uiMode === "buildStructure") {
        onSetMode?.("idle");
      }
      return null;
    });
  };

  return (
    <div ref={dockRef} className="fixed left-0 right-0 z-20" style={dockStyle}>
      {activeMenu === "attack" && (
        <div className="border-t border-gray-700/60 bg-gray-900/90 px-3 py-3 text-white">
          <div className="mb-2 text-sm text-gray-200">Attack Settings</div>
          <input
            type="range"
            min="5"
            max="100"
            value={Math.round((attackPercent || 0.25) * 100)}
            onChange={(e) => setAttackPercent?.(Number(e.target.value) / 100)}
            className="w-full"
          />
          <div className="mt-1 flex items-center justify-between text-xs text-gray-300">
            <span>Troop Commitment: {Math.round((attackPercent || 0.25) * 100)}%</span>
            <span>Arrows: {activeAttackArrows?.length || 0}</span>
          </div>
        </div>
      )}
      {activeMenu === "build" && (
        <div className="border-t border-gray-700/60 bg-gray-900/90 px-3 py-3 text-white">
          <div className="mb-2 text-sm font-medium">Build</div>
          <div className="grid grid-cols-2 gap-2">
            {buildEntries.map(([type, cost]) => {
              const affordable = canAfford(playerResources, cost);
              return (
                <button
                  key={type}
                  disabled={!affordable}
                  onClick={() => {
                    onBuildStructure?.(type);
                    setActiveMenu(null);
                  }}
                  className={`rounded border px-2 py-2 text-left text-xs ${
                    affordable
                      ? "border-gray-700 bg-gray-800"
                      : "border-gray-800 bg-gray-800/40 text-gray-500"
                  }`}
                >
                  <div className="font-semibold capitalize">{type}</div>
                  <div className="text-[10px] text-gray-400">
                    {Object.entries(cost)
                      .map(([res, amt]) => `${amt} ${res}`)
                      .join(", ")}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="border-t border-gray-700/60 bg-gray-900/95 px-3 py-2 text-white">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={toggleAttackMenu}
            className={`rounded px-3 py-2 text-sm font-medium ${
              activeMenu === "attack" ? "bg-blue-700" : "bg-gray-800"
            }`}
          >
            Attack Settings
          </button>
          <button
            onClick={toggleBuildMenu}
            className={`rounded px-3 py-2 text-sm font-medium ${
              activeMenu === "build" ? "bg-yellow-700 text-white" : "bg-gray-800"
            }`}
          >
            Build Menu
          </button>
        </div>
      </div>
    </div>
  );
};

export default MobileActionDock;
