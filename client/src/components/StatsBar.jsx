import React, { useRef, useState, useEffect } from "react";

const sameOwner = (ownerId, currentUserId) =>
  ownerId != null &&
  currentUserId != null &&
  String(ownerId) === String(currentUserId);

const StatsBar = ({
  gameState,
  userId,
  topOffset = 0,
  isMobile = false,
  onHeightChange,
}) => {
  const userNation = gameState?.gameState?.nations?.find(
    (n) => sameOwner(n.owner, userId)
  );

  const prevResources = useRef({});
  const barRef = useRef(null);
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

  useEffect(() => {
    if (!onHeightChange) return;
    if (!userNation || userNation.status === "defeated") {
      onHeightChange(0);
      return;
    }
    const node = barRef.current;
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
  }, [onHeightChange, userNation]);

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

  const compactNumber = (value) => {
    const num = Number(value) || 0;
    if (num >= 10000) {
      return new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(num);
    }
    return Math.round(num).toLocaleString();
  };

  const mobileStats = [
    { label: "Pop", value: compactNumber(userNation.population || 0) },
    {
      label: "Troops",
      value:
        userNation.troopCount != null
          ? compactNumber(userNation.troopCount)
          : "0",
    },
    { label: "Tiles", value: territoryLength.toLocaleString() },
    { label: "Ctrl", value: `${userNation.territoryPercentage}%` },
    {
      label: "Food",
      value: compactNumber(userNation.resources?.food || 0),
      delta: deltas.food,
    },
    {
      label: "Wood",
      value: compactNumber(userNation.resources?.wood || 0),
      delta: deltas.wood,
    },
  ];

  return (
    <div
      ref={barRef}
      className={`absolute left-0 right-0 bg-gray-900 bg-opacity-60 text-white z-40 ${
        isMobile ? "p-1.5 overflow-hidden" : "p-2 overflow-x-auto"
      }`}
      style={{
        top: `calc(env(safe-area-inset-top, 0px) + ${topOffset}px)`,
      }}
    >
      {isMobile ? (
        <div className="grid grid-cols-3 gap-x-4 gap-y-1">
          {mobileStats.map((stat) => {
            const deltaStr = formatDelta(stat.delta);
            return (
              <div key={stat.label} className="min-w-0">
                <span className="text-[10px] uppercase tracking-wide text-gray-300">
                  {stat.label}
                </span>
                <div className="flex items-baseline gap-1 whitespace-nowrap">
                  <span className="text-sm font-semibold truncate">{stat.value}</span>
                  <span
                    className={`inline-block w-8 text-right text-[10px] ${
                      deltaStr
                        ? stat.delta > 0
                          ? "text-green-400"
                          : "text-red-400"
                        : "opacity-0"
                    }`}
                  >
                    {deltaStr || "+0"}
                  </span>
                </div>
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
                  <div className="font-medium flex items-center gap-1 whitespace-nowrap">
                    <span>{stat.value}</span>
                    <span
                      className={`inline-block w-9 text-right text-xs ${
                        deltaStr
                          ? stat.delta > 0
                            ? "text-green-400"
                            : "text-red-400"
                          : "opacity-0"
                      }`}
                    >
                      {deltaStr || "+0"}
                    </span>
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
