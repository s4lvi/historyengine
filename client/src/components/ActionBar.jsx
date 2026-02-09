import React from "react";

// Build costs fallback (should match server config)
const BUILD_COSTS = {
  town: { wood: 200, stone: 100, food: 500 },
  tower: { stone: 500, wood: 200 },
};

// Resource icon mapping
const RESOURCE_ICONS = {
  wood: "/wood.png",
  stone: "/stone.png",
  food: "/food.png",
  iron: "/steel.png",
  gold: "/bronze.png",
};

const BUILD_ICONS = {
  town: "/town.png",
  tower: "/fort.png",
  fort: "/fort.png",
  farm: "/farm.png",
  mine: "/mine.png",
  stable: "/stable.png",
  "lumber mill": "/lumber_mill.png",
  workshop: "/workshop.png",
};

const BuildButton = ({ type, icon, costs, resources, disabled, onClick }) => {
  const canAfford = Object.entries(costs).every(
    ([resource, amount]) => (resources?.[resource] || 0) >= amount
  );
  const isDisabled = disabled || !canAfford;

  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      className={`px-3 py-2 rounded flex flex-col items-center gap-1 transition-all ${
        isDisabled
          ? "bg-gray-700 opacity-50 cursor-not-allowed"
          : "bg-gray-800 hover:bg-gray-700 cursor-pointer"
      }`}
      title={`Build ${type}`}
    >
      <img src={icon} alt={type} className="w-8 h-8" />
      <span className="text-xs capitalize">{type}</span>
      <div className="flex gap-1 flex-wrap justify-center">
        {Object.entries(costs).map(([resource, amount]) => {
          const hasEnough = (resources?.[resource] || 0) >= amount;
          return (
            <div
              key={resource}
              className={`flex items-center gap-0.5 text-xs ${
                hasEnough ? "text-gray-300" : "text-red-400"
              }`}
            >
              <img
                src={RESOURCE_ICONS[resource] || `/${resource}.png`}
                alt={resource}
                className="w-3 h-3"
              />
              <span>{amount}</span>
            </div>
          );
        })}
      </div>
    </button>
  );
};

const ArrowButton = ({ type, icon, label, active, onClick }) => {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded flex flex-col items-center gap-1 transition-all ${
        active
          ? "bg-yellow-600 ring-2 ring-yellow-400"
          : "bg-gray-800 hover:bg-gray-700"
      }`}
      title={`Draw ${label} Arrow`}
    >
      <div className="w-8 h-8 flex items-center justify-center text-2xl">
        {icon}
      </div>
      <span className="text-xs">{label}</span>
    </button>
  );
};

const ModeButton = ({ icon, label, active, onClick }) => {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded flex flex-col items-center gap-1 transition-all ${
        active ? "bg-blue-700 ring-2 ring-blue-400" : "bg-gray-800 hover:bg-gray-700"
      }`}
      title={label}
    >
      <div className="w-8 h-8 flex items-center justify-center text-2xl">
        {icon}
      </div>
      <span className="text-xs">{label}</span>
    </button>
  );
};

const ActionBar = ({
  onFoundNation,
  userState,
  hasFounded,
  attackPercent,
  setAttackPercent,
  troopTarget,
  onSetTroopTarget,
  troopCount,
  onBuildStructure,
  playerResources,
  isSpectating,
  allowRefound,
  drawingArrowType,
  onStartDrawArrow,
  onCancelArrow,
  activeAttackArrows,
  activeDefendArrow,
  maxAttackArrows,
  buildCosts,
  uiMode,
  onSetMode,
  onExitMode,
}) => {
  const attackArrowCount = activeAttackArrows?.length || 0;
  const maxArrows = maxAttackArrows || 3;
  const atMaxAttackArrows = attackArrowCount >= maxArrows;
  const buildCostMap = buildCosts || BUILD_COSTS;
  const primaryBuilds = ["town", "tower"].filter((b) => buildCostMap[b]);
  // If no userState, show the found-nation button.
  if (!hasFounded) {
    if (isSpectating) {
      return (
        <div className="fixed bottom-0 left-0 right-0 bg-gray-900 bg-opacity-50 text-white p-4">
          <div className="max-w-7xl mx-auto flex justify-center items-center gap-4">
            <div className="text-sm text-gray-200">
              Spectating — your nation has been defeated.
            </div>
            {allowRefound && (
              <button
                onClick={onFoundNation}
                className="px-4 py-2 bg-gray-800 rounded hover:bg-gray-700"
              >
                Found New Nation
              </button>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="fixed bottom-0 left-0 right-0 bg-gray-900 bg-opacity-50 text-white p-4">
        <div className="max-w-7xl mx-auto flex justify-center">
          <div className="text-center">
            <h3 className="text-sm font-medium mb-2 text-gray-300">
              Found Your Nation
            </h3>
            <button
              onClick={onFoundNation}
              className="p-4 bg-gray-800 rounded-lg hover:bg-gray-700 flex flex-col items-center"
              title="Found a new nation"
            >
              <img
                src="/found.png"
                alt="Found Nation"
                className="w-12 h-12 mb-2"
              />
              <span className="text-sm">
                Click here then select a location on the map
              </span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-10">
      {/* The container is relative so we can position the info card absolutely */}
      <div className="relative bg-gray-900 bg-opacity-50 text-white p-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-row gap-8 items-center">
            {/* Arrow Commands Section */}
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium text-gray-300">Commands</h3>
              <div className="flex gap-2">
                <ArrowButton
                  type="attack"
                  icon="⚔️"
                  label={`Attack (${attackArrowCount}/${maxArrows})`}
                  active={uiMode === "drawAttack" || drawingArrowType === "attack" || attackArrowCount > 0}
                  onClick={() => {
                    if (uiMode === "drawAttack" || drawingArrowType === "attack") {
                      onCancelArrow?.();
                    } else if (!atMaxAttackArrows) {
                      onStartDrawArrow?.("attack");
                    }
                  }}
                />
                <ArrowButton
                  type="defend"
                  icon="🛡️"
                  label="Defend"
                  active={uiMode === "drawDefend" || drawingArrowType === "defend" || activeDefendArrow}
                  onClick={() => {
                    if (uiMode === "drawDefend" || drawingArrowType === "defend") {
                      onCancelArrow?.();
                    } else {
                      onStartDrawArrow?.("defend");
                    }
                  }}
                />
                <ModeButton
                  icon="🖐️"
                  label="Pan"
                  active={uiMode === "pan"}
                  onClick={() => {
                    if (uiMode === "pan") {
                      onExitMode?.();
                    } else {
                      onSetMode?.("pan");
                    }
                  }}
                />
              </div>
              {(attackArrowCount > 0 || activeDefendArrow) && (
                <div className="text-xs text-yellow-400 mt-1">
                  {attackArrowCount > 0 && `${attackArrowCount} attack arrow${attackArrowCount > 1 ? "s" : ""} active`}
                  {attackArrowCount > 0 && activeDefendArrow && " • "}
                  {activeDefendArrow && "Defend arrow active"}
                </div>
              )}
            </div>

            {/* Troop Mobilization */}
            {onSetTroopTarget && (
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-medium text-gray-300">
                  Mobilization
                </h3>
                <input
                  type="range"
                  min="0"
                  max="80"
                  value={Math.round((troopTarget || 0.2) * 100)}
                  onChange={(e) =>
                    onSetTroopTarget?.(Number(e.target.value) / 100)
                  }
                />
                <div className="text-xs text-gray-300">
                  {Math.round((troopTarget || 0.2) * 100)}% — Troops: {Math.round(troopCount || 0)}/{Math.round(userState?.population || 0)}
                </div>
              </div>
            )}

            {/* Arrow Commitment */}
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium text-gray-300">
                Arrow Commitment
              </h3>
              <input
                type="range"
                min="5"
                max="100"
                value={Math.round((attackPercent || 0.25) * 100)}
                onChange={(e) =>
                  setAttackPercent?.(Number(e.target.value) / 100)
                }
              />
              <div className="text-xs text-gray-300">
                {Math.round((attackPercent || 0.25) * 100)}%
              </div>
            </div>

            {/* Build Structures Section */}
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium text-gray-300">Build</h3>
              <div className="flex gap-2">
                {primaryBuilds.map((type) => (
                  <BuildButton
                    key={type}
                    type={type}
                    icon={BUILD_ICONS[type] || `/${type.replace(" ", "_")}.png`}
                    costs={buildCostMap[type]}
                    resources={playerResources}
                    onClick={() => onBuildStructure?.(type)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ActionBar;
