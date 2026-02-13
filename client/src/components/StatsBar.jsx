import React, { useRef, useState, useEffect } from "react";

const StatsBar = ({ gameState, userId, topOffset = 0, isMobile = false }) => {
  const userNation = gameState?.gameState?.nations?.find(
    (n) => n.owner === userId
  );

  const prevResources = useRef({});
  const [deltas, setDeltas] = useState({});

  useEffect(() => {
    if (!userNation?.resources) return;
    const curr = userNation.resources;
    const prev = prevResources.current;
    const newDeltas = {};
    for (const res of ["food", "wood", "stone", "iron", "gold"]) {
      const c = curr[res] || 0;
      const p = prev[res];
      if (p !== undefined) {
        newDeltas[res] = c - p;
      }
    }
    prevResources.current = { ...curr };
    setDeltas(newDeltas);
  }, [userNation?.resources]);

  // Early return if no user nation or if user nation is defeated
  if (!userNation || userNation.status === "defeated") return null;

  // Safely access territory length
  const territoryLength = userNation.territory?.x?.length || 0;

  const formatDelta = (d) => {
    if (d === undefined || d === 0) return null;
    const sign = d > 0 ? "+" : "";
    const abs = Math.abs(d);
    const str = abs >= 1 ? `${sign}${d.toFixed(0)}` : `${sign}${d.toFixed(2)}`;
    return str;
  };

  const coreStats = [
    {
      label: "Population",
      value: (userNation.population || 0).toLocaleString(),
    },
    ...(userNation.troopCount != null
      ? [
          {
            label: "Troops",
            value: Math.round(userNation.troopCount).toLocaleString(),
          },
        ]
      : []),
    { label: "Territory", value: `${territoryLength} tiles` },
    { label: "Controlled", value: `${userNation.territoryPercentage}%` },
  ];

  const resourceStats = ["food", "wood", "stone", "iron", "gold"].map(
    (resource) => ({
      label: resource,
      value: (userNation.resources?.[resource] || 0).toFixed(0),
      delta: deltas[resource],
    })
  );

  return (
    <div
      className={`absolute left-0 right-0 bg-gray-900 bg-opacity-60 text-white z-40 overflow-x-auto ${
        isMobile ? "p-1.5" : "p-2"
      }`}
      style={{
        top: `calc(env(safe-area-inset-top, 0px) + ${topOffset}px)`,
      }}
    >
      {isMobile ? (
        <div className="flex items-center gap-4 flex-nowrap min-w-max whitespace-nowrap">
          {[...coreStats, ...resourceStats].map((stat) => {
            const deltaStr = formatDelta(stat.delta);
            return (
              <div key={stat.label} className="flex items-baseline gap-1.5">
                <span className="text-[11px] uppercase tracking-wide text-gray-300">
                  {stat.label}
                </span>
                <span className="text-sm font-semibold">{stat.value}</span>
                {deltaStr && (
                  <span
                    className={`text-[10px] ${
                      stat.delta > 0 ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {deltaStr}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center gap-6 flex-nowrap min-w-max whitespace-nowrap">
          <div className="flex gap-6 items-center">
            {coreStats.map((stat) => (
              <div key={stat.label}>
                <span className="text-sm opacity-80">{stat.label}</span>
                <div className="font-medium">{stat.value}</div>
              </div>
            ))}
          </div>

          <div className="h-8 w-px bg-white bg-opacity-20"></div>

          <div className="flex gap-6 items-center">
            {resourceStats.map((stat) => {
              const deltaStr = formatDelta(stat.delta);
              return (
                <div key={stat.label}>
                  <span className="text-sm opacity-80 capitalize">
                    {stat.label}
                  </span>
                  <div className="font-medium flex items-center gap-1">
                    <span>{stat.value}</span>
                    {deltaStr && (
                      <span
                        className={`text-xs ${
                          stat.delta > 0 ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {deltaStr}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default StatsBar;
