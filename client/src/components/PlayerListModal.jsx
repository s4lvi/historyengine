// PlayerListModal.jsx
import React from "react";
import { Users, X } from "lucide-react";

const PlayerListModal = ({ isOpen, onClose, gameState, getNationColor }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-96 max-h-[80vh] overflow-y-auto relative">
        <div className="relative top-0 right-0">
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 absolute top-0 right-0"
          >
            <X size={24} />
          </button>
        </div>

        <h2 className="text-xl font-semibold mb-6">Players</h2>

        <div className="space-y-4">
          {gameState?.gameState?.nations?.map((nation) => (
            <div
              key={nation.owner}
              className="p-4 rounded-lg border"
              style={{ borderColor: getNationColor(nation) }}
            >
              <div className="flex justify-between items-center mb-2">
                <span className="font-medium">{nation.owner}</span>
                <span className="text-sm text-gray-500">
                  {nation.territory?.length || 0} tiles
                </span>
              </div>
              <div className="flex gap-4 text-sm text-gray-600">
                <span>{nation.cities?.length || 0} cities</span>
                <span>{nation.population?.toLocaleString()} pop.</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PlayerListModal;
