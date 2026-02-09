import React from "react";

const StatsBar = ({ gameState, userId }) => {
  const userNation = gameState?.gameState?.nations?.find(
    (n) => n.owner === userId
  );

  // Early return if no user nation or if user nation is defeated
  if (!userNation || userNation.status === "defeated") return null;

  // Safely access territory length
  const territoryLength = userNation.territory?.x?.length || 0;

  // Safely access cities length
  const citiesLength =
    userNation.cities?.filter((c) => c.type === "capital" || c.type === "town")
      .length || 0;

  return (
    <div className="absolute top-0 left-0 right-0 bg-gray-900 bg-opacity-50 text-white p-2 z-40 overflow-x-auto">
      <div className="flex items-center gap-6 flex-nowrap min-w-max whitespace-nowrap">
        {/* Core Stats */}
        <div className="flex gap-6 items-center">
          <div>
            <span className="text-sm opacity-80">Population</span>
            <div className="font-medium">
              {(userNation.population || 0).toLocaleString()}
            </div>
          </div>
          {userNation.troopCount != null && (
            <div>
              <span className="text-sm opacity-80">Troops</span>
              <div className="font-medium">
                {Math.round(userNation.troopCount).toLocaleString()}
              </div>
            </div>
          )}
          <div>
            <span className="text-sm opacity-80">Territory</span>
            <div className="font-medium">{territoryLength} tiles</div>
          </div>
          <div>
            <span className="text-sm opacity-80">Controlled</span>
            <div className="font-medium">{userNation.territoryPercentage}%</div>
          </div>
        </div>

        {/* Divider */}
        <div className="h-8 w-px bg-white bg-opacity-20"></div>

        {/* Resources Section */}
        <div className="flex gap-6 items-center">
          {["food", "wood", "stone", "iron", "gold"].map(
            (resource) => (
              <div key={resource}>
                <span className="text-sm opacity-80 capitalize">
                  {resource}
                </span>
                <div className="font-medium">
                  {(userNation.resources?.[resource] || 0).toFixed(0)}
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
};

export default StatsBar;
