// StatsBar.jsx
import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

const StatsBar = ({ gameState, userId }) => {
  const [expandedGroup, setExpandedGroup] = useState(null);
  const userNation = gameState?.gameState?.nations?.find(
    (n) => n.owner === userId
  );

  if (!userNation) return null;

  const resourceGroups = {
    Minerals: [
      "iron ore",
      "precious metals",
      "gems",
      "stone",
      "copper ore",
      "salt",
    ],
    "Food & Water": [
      "fresh water",
      "fish",
      "wild fruits",
      "game animals",
      "grazing animals",
    ],
    Agriculture: ["arable land", "pastures", "fertile soil"],
    "Flora & Fauna": [
      "medicinal plants",
      "timber",
      "date palm",
      "fur animals",
      "herbs",
    ],
  };

  return (
    <div className="absolute top-0 left-0 right-0 bg-gray-900 bg-opacity-50 text-white p-2 z-40">
      <div className="flex items-center gap-6">
        {/* Core Stats */}
        <div className="flex gap-6 items-center">
          <div>
            <span className="text-sm opacity-80">Population</span>
            <div className="font-medium">
              {userNation.population.toLocaleString()}
            </div>
          </div>
          <div>
            <span className="text-sm opacity-80">National Will</span>
            <div className="font-medium">{userNation.nationalWill}</div>
          </div>
          <div>
            <span className="text-sm opacity-80">Territory</span>
            <div className="font-medium">
              {userNation.territory.length} tiles
            </div>
          </div>
          <div>
            <span className="text-sm opacity-80">Cities</span>
            <div className="font-medium">{userNation.cities.length}</div>
          </div>
        </div>

        {/* Resource Groups */}
        <div className="flex gap-4 items-center">
          {Object.entries(resourceGroups).map(([groupName, resources]) => {
            const totalResources = resources.reduce(
              (sum, r) => sum + (userNation.resources[r] || 0),
              0
            );

            return (
              <div key={groupName} className="relative">
                <button
                  onClick={() =>
                    setExpandedGroup(
                      expandedGroup === groupName ? null : groupName
                    )
                  }
                  className="flex items-center gap-1 hover:bg-white hover:bg-opacity-50 rounded px-2 py-1"
                >
                  {expandedGroup === groupName ? (
                    <ChevronDown size={16} />
                  ) : (
                    <ChevronRight size={16} />
                  )}
                  <span>{groupName}</span>
                  <span className="text-sm opacity-80">
                    ({totalResources.toFixed(0)})
                  </span>
                </button>

                {expandedGroup === groupName && (
                  <div className="absolute top-full left-0 mt-1 bg-gray-900 bg-opacity-50 rounded-lg p-2 w-48">
                    {resources.map((resource) => {
                      if (userNation.resources[resource] === 0) return null;
                      return (
                        <div
                          key={resource}
                          className="flex justify-between py-1"
                        >
                          <span className="capitalize text-sm">{resource}</span>
                          <span className="font-medium">
                            {userNation.resources[resource]?.toFixed(0) || 0}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default StatsBar;
