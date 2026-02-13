// PlayerListModal.jsx
import React from "react";
import { X } from "lucide-react";

const PlayerListModal = ({ isOpen, onClose, gameState, getNationColor }) => {
  if (!isOpen) return null;
  const nations = gameState?.gameState?.nations || [];
  const nationsByOwner = new Map(nations.map((nation) => [nation.owner, nation]));
  const players =
    gameState?.players?.length > 0
      ? gameState.players
      : nations.map((nation) => ({
          userId: nation.owner,
          displayName: nation.displayName || nation.owner,
          ready: nation.status !== "defeated",
          isCreator: gameState?.roomCreator === nation.owner,
        }));

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
          {players.map((player) => {
            const nation = nationsByOwner.get(player.userId) || null;
            const defeated = nation?.status === "defeated";
            const ready = !!player.ready;
            const displayLabel =
              nation?.nationName ||
              nation?.displayName ||
              player.displayName ||
              player.userId;
            const borderColor = defeated
              ? "#4b5563"
              : ready
              ? "#10b981"
              : "#ef4444";
            return (
              <div
                key={player.userId}
                className="relative p-4 rounded-lg border overflow-hidden"
                style={{
                  borderColor,
                  backgroundColor: defeated
                    ? "rgba(15,23,42,0.65)"
                    : "rgba(15,23,42,0.45)",
                  opacity: defeated ? 0.55 : 1,
                  filter: defeated ? "grayscale(0.9)" : "none",
                }}
              >
                <div className="relative z-20 flex justify-between items-center mb-2">
                  <span className="font-medium">{displayLabel}</span>
                  <span
                    className={`text-xs font-semibold ${
                      defeated
                        ? "text-gray-400"
                        : ready
                        ? "text-emerald-400"
                        : "text-red-400"
                    }`}
                  >
                    {defeated ? "Defeated" : ready ? "Ready" : "Not Ready"}
                  </span>
                </div>
                <div className="relative z-20 flex gap-4 text-sm text-gray-600">
                  <span className="text-sm text-gray-400">
                    {player.displayName || player.userId}
                    {player.isCreator ? " (Host)" : ""}
                  </span>
                  <span className="text-sm text-gray-500">
                    {nation?.territory?.x?.length || 0} tiles
                  </span>
                  {!!nation && (
                    <span style={{ color: getNationColor(nation) }}>
                      Nation Active
                    </span>
                  )}
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
