import React, { useState } from "react";

const STATUS_COLORS = {
  advancing: "text-green-400",
  consolidating: "text-yellow-400",
  stalled: "text-orange-400",
  retreating: "text-red-400",
};

const STATUS_BG = {
  advancing: "bg-green-900/50",
  consolidating: "bg-yellow-900/50",
  stalled: "bg-orange-900/50",
  retreating: "bg-red-900/50",
};

const ArrowCard = ({ arrow, onReinforce, onRetreat, onClear }) => {
  const [showReinforce, setShowReinforce] = useState(false);
  const [reinforcePercent, setReinforcePercent] = useState(10);

  const status = arrow.status || "advancing";
  const statusColor = STATUS_COLORS[status] || "text-gray-400";
  const statusBg = STATUS_BG[status] || "bg-gray-900/50";
  const isDensityMode = arrow.troopCommitment != null && arrow.troopCommitment > 0;
  const troops = isDensityMode
    ? Math.round(arrow.effectiveDensityAtFront || 0)
    : Math.round(arrow.remainingPower || 0);
  const phase = arrow.phase || 1;
  const totalPhases = arrow.path?.length || 2;
  const opposingForces = arrow.opposingForces || [];

  return (
    <div className={`rounded-lg p-2 ${statusBg} border border-gray-700`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-white">Attack</span>
          <span className={`text-xs font-medium capitalize ${statusColor}`}>
            {status}
          </span>
        </div>
        <button
          onClick={() => onClear("attack", arrow.id)}
          className="text-gray-400 hover:text-red-400 text-xs px-1"
          title="Cancel arrow"
        >
          X
        </button>
      </div>

      <div className="flex items-center gap-3 text-xs text-gray-300 mb-1">
        <span>{isDensityMode ? `Front: ${troops}` : `Troops: ${troops}`}</span>
        {isDensityMode && (
          <span className="text-blue-300">
            {Math.round((arrow.troopCommitment || 0) * 100)}% committed
          </span>
        )}
        <span>
          Phase {Math.min(phase, totalPhases - 1)}/{totalPhases - 1}
        </span>
      </div>

      {opposingForces.length > 0 && (
        <div className="text-xs text-red-400 mb-1">
          {opposingForces.map((o, i) => (
            <span key={i}>
              vs {o.nationName} ({Math.round(o.estimatedStrength)})
              {i < opposingForces.length - 1 ? " " : ""}
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-1 mt-1">
        <button
          onClick={() => setShowReinforce(!showReinforce)}
          className="text-xs px-2 py-0.5 bg-blue-800 hover:bg-blue-700 rounded text-white"
        >
          +Reinforce
        </button>
        {status !== "retreating" && (
          <button
            onClick={() => onRetreat(arrow.id)}
            className="text-xs px-2 py-0.5 bg-orange-800 hover:bg-orange-700 rounded text-white"
          >
            Retreat
          </button>
        )}
      </div>

      {showReinforce && (
        <div className="mt-1 flex items-center gap-2">
          <input
            type="range"
            min="5"
            max="50"
            value={reinforcePercent}
            onChange={(e) => setReinforcePercent(Number(e.target.value))}
            className="w-20 h-1"
          />
          <span className="text-xs text-gray-300">{reinforcePercent}%</span>
          <button
            onClick={() => {
              onReinforce(arrow.id, reinforcePercent / 100);
              setShowReinforce(false);
            }}
            className="text-xs px-2 py-0.5 bg-green-800 hover:bg-green-700 rounded text-white"
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
};

const ArrowPanel = ({
  activeAttackArrows,
  activeDefendArrow,
  onReinforceArrow,
  onRetreatArrow,
  onClearArrow,
  isMobile = false,
  topOffset = 0,
  bottomOffset = 0,
}) => {
  const hasArrows =
    (activeAttackArrows && activeAttackArrows.length > 0) || activeDefendArrow;

  if (!hasArrows) return null;

  const panelStyle = isMobile
    ? {
        top: `${topOffset}px`,
        bottom: `${bottomOffset}px`,
      }
    : undefined;

  return (
    <div
      className={`fixed z-30 flex flex-col gap-2 ${
        isMobile
          ? "left-2 right-2 w-auto max-w-none overflow-y-auto"
          : "right-2 top-20 left-auto w-56"
      }`}
      style={panelStyle}
    >
      <div className="text-xs font-bold text-gray-400 uppercase tracking-wide px-1">
        Active Arrows
      </div>
      {activeAttackArrows &&
        activeAttackArrows.map((arrow) => (
          <ArrowCard
            key={arrow.id || `attack-${Math.random()}`}
            arrow={arrow}
            onReinforce={onReinforceArrow}
            onRetreat={onRetreatArrow}
            onClear={onClearArrow}
          />
        ))}
      {activeDefendArrow && (
        <div className="rounded-lg p-2 bg-blue-900/50 border border-gray-700">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-bold text-white">Defend</span>
            <button
              onClick={() => onClearArrow("defend")}
              className="text-gray-400 hover:text-red-400 text-xs px-1"
              title="Cancel arrow"
            >
              X
            </button>
          </div>
          <div className="text-xs text-gray-300">
            Troops: {Math.round(
              activeDefendArrow.troopCommitment != null
                ? (activeDefendArrow.effectiveDensityAtFront || 0)
                : (activeDefendArrow.remainingPower || 0)
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ArrowPanel;
