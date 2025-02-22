import React from "react";

const StatsBar = ({ gameState, userId }) => {
  const userNation = gameState?.gameState?.nations?.find(
    (n) => n.owner === userId
  );

  // Early return if no user nation or if user nation is defeated
  if (!userNation || userNation.status === "defeated") return null;

  // Safely access territory length
  const territoryLength = userNation.territory?.x?.length || 0;

  return (
    <div className="absolute top-0 left-0 right-0 bg-gray-900 bg-opacity-50 text-white p-2 z-40">
      <div className="flex flex-wrap items-center gap-2 md:gap-6">
        {/* Core Stats */}
        <div className="flex flex-wrap gap-2 md:gap-6 items-center">
          <div className="min-w-[80px]">
            <span className="text-xs md:text-sm opacity-80">Population</span>
            <div className="text-sm md:text-base font-medium">
              {(userNation.population || 0).toLocaleString()}
            </div>
          </div>
          <div className="min-w-[70px]">
            <span className="text-xs md:text-sm opacity-80">Territory</span>
            <div className="text-sm md:text-base font-medium">
              {territoryLength}
            </div>
          </div>
          <div className="min-w-[70px]">
            <span className="text-xs md:text-sm opacity-80">Controlled</span>
            <div className="text-sm md:text-base font-medium">
              {userNation.territoryPercentage}%
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="h-8 w-px bg-white bg-opacity-20"></div>

        {/* Resources Section */}
        <div className="flex-1 overflow-x-auto">
          <div className="flex gap-2 md:gap-6 items-center">
            {["food", "wood", "stone", "bronze", "steel", "horses"].map(
              (resource) => (
                <div key={resource} className="min-w-[60px]">
                  <span className="text-xs md:text-sm opacity-80 capitalize">
                    {resource}
                  </span>
                  <div className="text-sm md:text-base font-medium">
                    {(userNation.resources?.[resource] || 0).toFixed(0)}
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default StatsBar;
