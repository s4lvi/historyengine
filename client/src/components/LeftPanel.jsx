import React from "react";
import { FaUser } from "react-icons/fa6";
import { IconContext } from "react-icons";
import NationStatsPanel from "./NationStatsPanel";

const LeftPanel = ({
  gameState,
  userId,
  getNationColor,
  contextMenu,
  setContextMenu,
  onFoundNation,
  setActionModal,
}) => {
  const renderPlayerList = () => (
    <div className="bg-white p-4 rounded-lg shadow-lg h-64 flex flex-col">
      <h2 className="text-lg font-semibold mb-2">Players</h2>
      <div className="flex-1 overflow-y-auto">
        {gameState?.gameState?.nations?.map((nation) => (
          <div
            key={nation.owner}
            className={`p-2 rounded ${
              nation.owner === userId ? "bg-blue-50" : "bg-gray-50"
            } mb-2 flex flex-row items-center justify-between`}
          >
            <p className="text-sm pr-1">{nation.owner}</p>
            <IconContext.Provider value={{ color: getNationColor(nation) }}>
              <div>
                <FaUser />
              </div>
            </IconContext.Provider>
          </div>
        ))}
      </div>
    </div>
  );

  const renderContextActions = () => {
    if (!contextMenu) return <p>No context actions</p>;

    const currentUserNation = gameState?.gameState?.nations?.find(
      (n) => n.owner === userId
    );
    const cellOwnerNation = gameState?.gameState?.nations?.find((n) =>
      n.territory?.some((c) => c.x === contextMenu.x && c.y === contextMenu.y)
    );

    return (
      <div className="flex flex-col space-y-2">
        {!currentUserNation && (
          <button
            onClick={() => {
              onFoundNation(contextMenu.x, contextMenu.y);
              setContextMenu(null);
            }}
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded"
          >
            Found Nation Here
          </button>
        )}
        {currentUserNation && (
          <>
            {cellOwnerNation ? (
              cellOwnerNation.owner === userId ? (
                <button
                  onClick={() => {
                    setActionModal({
                      type: "buildCity",
                      x: contextMenu.x,
                      y: contextMenu.y,
                    });
                    setContextMenu(null);
                  }}
                  className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded"
                >
                  Build City Here
                </button>
              ) : (
                <button
                  onClick={() => {
                    setActionModal({
                      type: "attack",
                      x: contextMenu.x,
                      y: contextMenu.y,
                    });
                    setContextMenu(null);
                  }}
                  className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded"
                >
                  Attack
                </button>
              )
            ) : (
              <button
                onClick={() => {
                  setActionModal({
                    type: "setExpandTarget",
                    x: contextMenu.x,
                    y: contextMenu.y,
                  });
                  setContextMenu(null);
                }}
                className="bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded"
              >
                Set Expand Target
              </button>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="w-64 flex flex-col gap-4">
      {renderPlayerList()}
      <NationStatsPanel gameState={gameState} userId={userId} />
      <div className="bg-white p-4 rounded-lg shadow-lg">
        <h2 className="text-lg font-semibold mb-2">Context Actions</h2>
        {renderContextActions()}
      </div>
    </div>
  );
};

export default LeftPanel;
