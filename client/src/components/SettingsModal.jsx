// SettingsModal.jsx
import React from "react";
import { Settings, X } from "lucide-react";

const SettingsModal = ({
  isOpen,
  onClose,
  gameState,
  userId,
  paused,
  onPause,
  onUnpause,
  onEndGame,
  onLeaveGame,
  onBackToGameRooms,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-900 bg-opacity-75 text-white rounded-lg p-6 w-96 relative">
        <div className="relative top-0 right-0">
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 absolute top-0 right-0"
          >
            <X size={24} />
          </button>
        </div>

        <h2 className="text-xl font-semibold mb-6">Game Settings</h2>

        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-gray-500">Playing as:</span>
            <span className="font-medium">{userId}</span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-gray-500">Room:</span>
            <span className="font-medium">
              {gameState?.gameState?.roomName}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-gray-500">Tick Count:</span>
            <span className="font-medium">{gameState?.tickCount}</span>
          </div>

          <div className="flex flex-col gap-2 pt-4 border-t">
            {gameState?.roomCreator === userId && (
              <>
                <button
                  onClick={paused ? onUnpause : onPause}
                  className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded"
                >
                  {paused ? "Unpause Game" : "Pause Game"}
                </button>

                <button
                  onClick={onEndGame}
                  className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded"
                >
                  End Game
                </button>
              </>
            )}
            <button
              onClick={onLeaveGame}
              className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded"
            >
              Leave Game
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
