import React from "react";

const ActionBar = ({
  onFoundNation,
  userState,
  hasFounded,
  attackPercent,
  setAttackPercent,
  onStartPlaceTower,
  isSpectating,
  allowRefound,
}) => {
  // If no userState, show the found-nation button.
  if (!hasFounded) {
    if (isSpectating) {
      return (
        <div className="fixed bottom-0 left-0 right-0 bg-gray-900 bg-opacity-50 text-white p-4">
          <div className="max-w-7xl mx-auto flex justify-center items-center gap-4">
            <div className="text-sm text-gray-200">
              Spectating — your nation has been defeated.
            </div>
            {allowRefound && (
              <button
                onClick={onFoundNation}
                className="px-4 py-2 bg-gray-800 rounded hover:bg-gray-700"
              >
                Found New Nation
              </button>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="fixed bottom-0 left-0 right-0 bg-gray-900 bg-opacity-50 text-white p-4">
        <div className="max-w-7xl mx-auto flex justify-center">
          <div className="text-center">
            <h3 className="text-sm font-medium mb-2 text-gray-300">
              Found Your Nation
            </h3>
            <button
              onClick={onFoundNation}
              className="p-4 bg-gray-800 rounded-lg hover:bg-gray-700 flex flex-col items-center"
              title="Found a new nation"
            >
              <img
                src="/found.png"
                alt="Found Nation"
                className="w-12 h-12 mb-2"
              />
              <span className="text-sm">
                Click here then select a location on the map
              </span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-10">
      {/* The container is relative so we can position the info card absolutely */}
      <div className="relative bg-gray-900 bg-opacity-50 text-white p-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-row gap-8 items-center">
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-gray-300">
                Attack / Expand %
              </h3>
              <input
                type="range"
                min="5"
                max="100"
                value={Math.round((attackPercent || 0.25) * 100)}
                onChange={(e) =>
                  setAttackPercent?.(Number(e.target.value) / 100)
                }
              />
              <div className="text-xs text-gray-300">
                {Math.round((attackPercent || 0.25) * 100)}%
              </div>
            </div>
            <div>
              <button
                onClick={onStartPlaceTower}
                className="px-4 py-2 bg-gray-800 rounded hover:bg-gray-700 flex items-center gap-2"
              >
                <img src="/fort.png" alt="Tower" className="w-5 h-5" />
                Place Tower
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ActionBar;
