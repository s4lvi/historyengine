// PlayerListModal.jsx
import React from "react";
import { Users, X } from "lucide-react";

const PlayerListModal = ({ isOpen, onClose, gameState, getNationColor }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 bg-opacity-75 text-white rounded-lg p-6 w-[90vw] max-w-md overflow-hidden relative flex flex-col"
        style={{ height: "70vh", maxHeight: "70vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Players</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        <div className="scrollbar-panel space-y-4 overflow-y-auto pr-2 flex-1 min-h-0">
          {[...(gameState?.gameState?.nations || [])]
            .sort((a, b) => (a?.owner || "").localeCompare(b?.owner || ""))
            .map((nation) => {
              const defeated = nation.status === "defeated";
              return (
                <div
                  key={nation.owner}
                  className="relative p-4 rounded-lg border overflow-hidden"
                  style={{
                    borderColor: defeated ? "#4b5563" : getNationColor(nation),
                    backgroundColor: defeated
                      ? "rgba(15,23,42,0.65)"
                      : undefined,
                    opacity: defeated ? 0.55 : 1,
                    filter: defeated ? "grayscale(0.9)" : "none",
                  }}
                >
                  {defeated && (
                    <svg
                      className="pointer-events-none absolute inset-0 z-10"
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                    >
                      <line
                        x1="0"
                        y1="0"
                        x2="100"
                        y2="100"
                        stroke="rgba(239,68,68,0.9)"
                        strokeWidth="2.5"
                      />
                    </svg>
                  )}
                  <div className="relative z-20 flex justify-between items-center mb-2">
                    <span className="font-medium">{nation.owner}</span>
                  </div>
                  <div className="relative z-20 flex gap-4 text-sm text-gray-600">
                    <span className="text-sm text-gray-500">
                      {nation.territory?.x?.length || 0} tiles
                    </span>
                    <span>{nation.territoryPercentage?.toLocaleString()}%.</span>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
};

export default PlayerListModal;
