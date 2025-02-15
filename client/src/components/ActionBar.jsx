import React from "react";

const ActionBar = ({
  onBuildCity,
  onRaiseArmy,
  onSetExpandTarget,
  onFoundNation,
  config,
  userState,
}) => {
  // If no userState, show the found-nation button.
  if (!userState) {
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

  // Helper function: check if user has enough resources.
  const userResources = userState?.resources || {};
  const isAffordable = (cost) => {
    // cost is an object like { stone: 20, "arable land": 30 }
    for (const [resource, required] of Object.entries(cost)) {
      if ((userResources[resource] || 0) < required) return false;
    }
    return true;
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-900 bg-opacity-50 text-white p-4">
      <div className="max-w-7xl mx-auto">
        {/* Groups: Structures, Armies, Expansion */}
        <div className="grid grid-cols-3 gap-8">
          {/* Structures Group */}
          <div>
            <h3 className="text-sm font-medium mb-2 text-gray-300">
              Structures
            </h3>
            <div className="grid grid-cols-4 gap-2">
              {config?.buildCosts?.structures &&
                Object.entries(config.buildCosts.structures).map(
                  ([structure, cost]) => {
                    const affordable = isAffordable(cost);
                    return (
                      <button
                        key={structure}
                        onClick={() => onBuildCity(null, null, structure)}
                        disabled={!affordable}
                        className={`p-2 bg-gray-800 rounded flex flex-col items-center ${
                          !affordable
                            ? "opacity-50 cursor-not-allowed"
                            : "hover:bg-gray-700"
                        }`}
                        title={`${structure}: ${Object.entries(cost)
                          .map(([res, amt]) => `${res}: ${amt}`)
                          .join(", ")}`}
                      >
                        <img
                          src={`/${structure.toLowerCase()}.png`}
                          alt={structure}
                          className="w-8 h-8 mb-1"
                        />
                        <span className="text-xs truncate w-full text-center">
                          {structure}
                        </span>
                      </button>
                    );
                  }
                )}
            </div>
          </div>

          {/* Armies Group */}
          <div>
            <h3 className="text-sm font-medium mb-2 text-gray-300">Armies</h3>
            <div className="grid grid-cols-4 gap-2">
              {config?.buildCosts?.armies &&
                Object.entries(config.buildCosts.armies).map(
                  ([armyType, cost]) => {
                    const affordable = isAffordable(cost);
                    return (
                      <button
                        key={armyType}
                        onClick={() => onRaiseArmy(armyType)}
                        disabled={!affordable}
                        className={`p-2 bg-gray-800 rounded flex flex-col items-center ${
                          !affordable
                            ? "opacity-50 cursor-not-allowed"
                            : "hover:bg-gray-700"
                        }`}
                        title={`${armyType}: ${Object.entries(cost)
                          .map(([res, amt]) => `${res}: ${amt}`)
                          .join(", ")}`}
                      >
                        <img
                          src={`/${armyType
                            .toLowerCase()
                            .replace(" ", "_")}.png`}
                          alt={armyType}
                          className="w-8 h-8 mb-1"
                        />
                        <span className="text-xs truncate w-full text-center">
                          {armyType}
                        </span>
                      </button>
                    );
                  }
                )}
            </div>
          </div>

          {/* Expansion Group */}
          <div>
            <h3 className="text-sm font-medium mb-2 text-gray-300">
              Expansion
            </h3>
            <div className="grid grid-cols-4 gap-2">
              <button
                onClick={() => onSetExpandTarget()}
                className="p-2 bg-gray-800 rounded flex flex-col items-center hover:bg-gray-700"
                title="Set Expansion Target"
              >
                <img
                  src="/banner.png"
                  alt="Set Target"
                  className="w-8 h-8 mb-1"
                />
                <span className="text-xs">Set Target</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ActionBar;
