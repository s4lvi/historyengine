import React, { useState } from "react";

const ActionBar = ({
  onBuildCity,
  onRaiseArmy,
  onFoundNation,
  config,
  userState,
  hasFounded,
}) => {
  // State to track which structure button is hovered.
  const [hoveredStructure, setHoveredStructure] = useState(null);

  // If no userState, show the found-nation button.
  if (!hasFounded) {
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

  // Helper: check if the player has enough resources.
  const userResources = userState?.resources || {};
  const isAffordable = (cost) => {
    for (const [resource, required] of Object.entries(cost)) {
      if ((userResources[resource] || 0) < required) return false;
    }
    return true;
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-10">
      {/* The container is relative so we can position the info card absolutely */}
      <div className="relative bg-gray-900 bg-opacity-50 text-white p-4">
        <div className="max-w-7xl mx-auto">
          {/* Groups: Structures and Armies */}
          <div className="flex flex-row gap-8">
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
                          onClick={() => {
                            affordable && onBuildCity(null, null, structure);
                          }}
                          onMouseEnter={() => setHoveredStructure(structure)}
                          onMouseLeave={() => setHoveredStructure(null)}
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
                            src={`/${structure
                              .toLowerCase()
                              .replace(" ", "_")}.png`}
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
                          onClick={() => affordable && onRaiseArmy(armyType)}
                          onMouseEnter={() => setHoveredStructure(armyType)}
                          onMouseLeave={() => setHoveredStructure(null)}
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
          </div>
        </div>
        {/* Hover info card for structures */}
        {hoveredStructure && (
          <div
            className="absolute transform -translate-y-full translate-x-0 bg-gray-900 bg-opacity-75 text-white p-4 rounded shadow-lg"
            style={{
              width: "300px",
              top: "-8px",
            }}
          >
            <div className="flex flex-col items-center">
              <img
                src={`/${hoveredStructure.toLowerCase().replace(" ", "_")}.png`}
                alt={hoveredStructure}
                className="w-16 h-16 mb-2"
              />
              <h4 className="font-bold mb-1">{hoveredStructure}</h4>
              <p className="text-sm mb-2">
                Cost:{" "}
                {config?.buildCosts?.structures?.[hoveredStructure] &&
                  Object.entries(
                    config.buildCosts.structures[hoveredStructure]
                  ).map(([res, amt], index, arr) => (
                    <span key={res}>
                      {res}: {amt}
                      {index < arr.length - 1 ? ", " : ""}
                    </span>
                  ))}
              </p>
              <p className="text-sm">
                {config?.structures?.descriptions[hoveredStructure] ||
                  "No description available."}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ActionBar;
