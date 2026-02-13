import React, { useRef, useState, useEffect } from "react";
import {
  Users,
  Swords,
  Map,
  Percent,
  Wheat,
  TreePine,
  Mountain,
  Pickaxe,
  Coins,
} from "lucide-react";

const sameOwner = (ownerId, currentUserId) =>
  ownerId != null &&
  currentUserId != null &&
  String(ownerId) === String(currentUserId);

const STAT_ICONS = {
  population: Users,
  troops: Swords,
  territory: Map,
  controlled: Percent,
  food: Wheat,
  wood: TreePine,
  stone: Mountain,
  iron: Pickaxe,
  gold: Coins,
};

const StatIcon = ({ statKey, label, size = 14 }) => {
  const Icon = STAT_ICONS[statKey] || Map;
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center text-gray-300">
      <Icon size={size} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
};

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

  if (!userNation || userNation.status === "defeated") return null;

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
      key: "population",
      label: "Population",
      value: (userNation.population || 0).toLocaleString(),
    },
    ...(userNation.troopCount != null
      ? [
          {
            key: "troops",
            label: "Troops",
            value: Math.round(userNation.troopCount).toLocaleString(),
          },
        ]
      : []),
    {
      key: "territory",
      label: "Territory",
      value: `${territoryLength} tiles`,
    },
    {
      key: "controlled",
      label: "Controlled",
      value: `${userNation.territoryPercentage}%`,
    },
  ];

  const resourceStats = ["food", "wood", "stone", "iron", "gold"].map(
    (resource) => ({
      key: resource,
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
    {
      key: "population",
      label: "Population",
      value: compactNumber(userNation.population || 0),
    },
    {
      key: "troops",
      label: "Troops",
      value:
        userNation.troopCount != null ? compactNumber(userNation.troopCount) : "0",
    },
    {
      key: "territory",
      label: "Territory",
      value: territoryLength.toLocaleString(),
    },
    {
      key: "controlled",
      label: "Controlled",
      value: `${userNation.territoryPercentage}%`,
    },
    {
      key: "food",
      label: "Food",
      value: compactNumber(userNation.resources?.food || 0),
      delta: deltas.food,
    },
    {
      key: "wood",
      label: "Wood",
      value: compactNumber(userNation.resources?.wood || 0),
      delta: deltas.wood,
    },
  ];

  return (
    <div
      ref={barRef}
      className={`absolute left-0 right-0 z-40 bg-gray-900/72 text-white backdrop-blur-sm ${
        isMobile ? "px-2 py-1.5 overflow-hidden" : "p-2 overflow-x-auto"
      }`}
      style={{ top: `${topOffset}px` }}
    >
      {isMobile ? (
        <div className="grid grid-cols-3 gap-x-3 gap-y-1">
          {mobileStats.map((stat) => {
            const deltaStr = formatDelta(stat.delta);
            return (
              <div key={stat.key} className="min-w-0">
                <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                  <StatIcon statKey={stat.key} label={stat.label} size={12} />
                  <span className="truncate text-sm font-semibold tabular-nums">
                    {stat.value}
                  </span>
                  <span
                    className={`inline-block w-8 text-right text-[10px] tabular-nums ${
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
              <div key={stat.key} className="flex items-center gap-2">
                <StatIcon statKey={stat.key} label={stat.label} size={14} />
                <div className="font-medium tabular-nums">{stat.value}</div>
              </div>
            ))}
          </div>

          <div className="h-8 w-px bg-white/20"></div>

          <div className="flex gap-6 items-center">
            {resourceStats.map((stat) => {
              const deltaStr = formatDelta(stat.delta);
              return (
                <div key={stat.key} className="flex items-center gap-2">
                  <StatIcon statKey={stat.key} label={stat.label} size={14} />
                  <div className="font-medium flex items-center gap-1 whitespace-nowrap tabular-nums">
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
