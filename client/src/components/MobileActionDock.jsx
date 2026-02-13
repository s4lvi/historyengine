import React, { useState } from "react";

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
  activeDefendArrow,
  isRoomStarted = true,
  canStartRoom = false,
  onStartRoom,
  isStartingRoom = false,
  readyPlayerCount = 0,
  totalPlayers = 0,
}) => {
  const [showBuild, setShowBuild] = useState(false);
  const [showPower, setShowPower] = useState(false);
  const buildMap = buildCosts || {};
  const buildEntries = Object.entries(buildMap);

  if (!hasFounded) {
    if (isSpectating) {
      return (
        <div className="fixed bottom-0 left-0 right-0 bg-gray-900 bg-opacity-80 text-white p-4 z-20">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-200">
              Spectating — your nation has been defeated.
            </div>
            {allowRefound && (
              <button
                onClick={onFoundNation}
                className="px-4 py-2 bg-gray-800 rounded"
              >
                Found New Nation
              </button>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="fixed bottom-0 left-0 right-0 bg-gray-900 bg-opacity-80 text-white p-4 z-20">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-300">Found Your Nation</div>
            <div className="text-xs text-gray-400">
              Tap to choose a starting tile
            </div>
          </div>
          <button
            onClick={onFoundNation}
            className="px-4 py-2 bg-gray-800 rounded"
          >
            Found
          </button>
        </div>
      </div>
    );
  }

  if (!isRoomStarted) {
    return (
      <div className="fixed bottom-0 left-0 right-0 bg-gray-900 bg-opacity-85 text-white p-4 z-20">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-gray-100">
              Lobby: {readyPlayerCount}/{totalPlayers} ready
            </div>
            <div className="text-xs text-gray-300">Waiting for host to start</div>
          </div>
          {canStartRoom && (
            <button
              onClick={onStartRoom}
              disabled={isStartingRoom}
              className="px-4 py-2 rounded bg-emerald-600 text-sm font-semibold disabled:bg-emerald-900"
            >
              {isStartingRoom ? "Starting..." : "Start Room"}
            </button>
          )}
        </div>
      </div>
    );
  }

  const toggleMode = (mode) => {
    if (uiMode === mode) {
      onSetMode?.("idle");
      return;
    }
    if (mode !== "buildStructure") {
      setShowBuild(false);
    }
    onSetMode?.(mode);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-20">
      {showPower && (
        <div className="bg-gray-900 bg-opacity-80 text-white px-4 py-2">
          <div className="text-xs text-gray-300 mb-1">Troop Commitment</div>
          <input
            type="range"
            min="5"
            max="100"
            value={Math.round((attackPercent || 0.25) * 100)}
            onChange={(e) => setAttackPercent?.(Number(e.target.value) / 100)}
            className="w-full"
          />
          <div className="text-xs text-gray-300 mt-1">
            {Math.round((attackPercent || 0.25) * 100)}%
          </div>
        </div>
      )}
      {showBuild && (
        <div className="bg-gray-900 bg-opacity-90 text-white px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">Build</div>
            <button
              className="text-xs text-gray-400"
              onClick={() => {
                setShowBuild(false);
                onSetMode?.("idle");
              }}
            >
              Close
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {buildEntries.map(([type, cost]) => {
              const affordable = canAfford(playerResources, cost);
              return (
                <button
                  key={type}
                  disabled={!affordable}
                  onClick={() => {
                    onBuildStructure?.(type);
                    setShowBuild(false);
                  }}
                  className={`rounded px-2 py-2 text-xs text-left border ${
                    affordable
                      ? "border-gray-700 bg-gray-800"
                      : "border-gray-800 bg-gray-800/40 text-gray-500"
                  }`}
                >
                  <div className="capitalize font-semibold">{type}</div>
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
      <div className="bg-gray-900 bg-opacity-85 text-white px-2 py-2">
        <div className="flex items-center justify-around">
          <button
            className={`px-3 py-2 rounded text-xs ${
              uiMode === "drawAttack" ? "bg-red-700" : "bg-gray-800"
            }`}
            onClick={() => toggleMode("drawAttack")}
          >
            Attack ({activeAttackArrows?.length || 0})
          </button>
          <button
            className={`px-3 py-2 rounded text-xs ${
              uiMode === "drawDefend" ? "bg-blue-700" : "bg-gray-800"
            }`}
            onClick={() => toggleMode("drawDefend")}
          >
            Defend {activeDefendArrow ? "●" : ""}
          </button>
          <button
            className={`px-3 py-2 rounded text-xs ${
              showBuild || uiMode === "buildStructure" ? "bg-yellow-700" : "bg-gray-800"
            }`}
            onClick={() => {
              setShowBuild((prev) => {
                const next = !prev;
                onSetMode?.(next ? "buildStructure" : "idle");
                return next;
              });
            }}
          >
            Build
          </button>
          <button
            className={`px-3 py-2 rounded text-xs ${
              uiMode === "pan" ? "bg-green-700" : "bg-gray-800"
            }`}
            onClick={() => toggleMode("pan")}
          >
            Pan
          </button>
          <button
            className={`px-3 py-2 rounded text-xs ${
              showPower ? "bg-purple-700" : "bg-gray-800"
            }`}
            onClick={() => setShowPower((prev) => !prev)}
          >
            Power
          </button>
        </div>
      </div>
    </div>
  );
};

export default MobileActionDock;
