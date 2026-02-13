import React from "react";

const ContextPanel = ({
  isMobile,
  cellInfo,
  onClose,
  nationColors,
  nationLabels,
  bottomOffset = 0,
}) => {
  if (!cellInfo) return null;

  const {
    x,
    y,
    biome,
    resources,
    owner,
    structure,
    claim,
  } = cellInfo;

  const ownerColor = owner ? nationColors?.[owner] : null;
  const ownerLabel = owner ? nationLabels?.[owner] || owner : "Unowned";
  const claimOwner =
    claim?.owner || claim?.progressOwner
      ? nationLabels?.[claim?.owner || claim?.progressOwner] ||
        claim?.owner ||
        claim?.progressOwner
      : "None";

  return (
    <div
      className={
        isMobile
          ? "fixed left-2 right-2 z-30 bg-gray-900 bg-opacity-90 text-white p-3 rounded"
          : "fixed left-2 top-14 z-30 w-64 bg-gray-900 bg-opacity-90 text-white p-3 rounded shadow-lg"
      }
      style={
        isMobile
          ? {
              bottom: `${bottomOffset}px`,
            }
          : undefined
      }
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold">Tile {x},{y}</div>
        <button className="text-xs text-gray-400" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="text-xs text-gray-300 mb-1">Biome: {biome}</div>
      <div className="text-xs text-gray-300 mb-1">
        Resources: {resources?.length ? resources.join(", ") : "None"}
      </div>
      <div className="text-xs text-gray-300 mb-1 flex items-center gap-2">
        Owner: {ownerLabel}
        {ownerColor && (
          <span
            className="inline-block w-3 h-3 rounded-full"
            style={{ backgroundColor: ownerColor }}
          />
        )}
      </div>
      {structure && (
        <div className="text-xs text-gray-300 mb-1">
          Structure: {structure.type} {structure.name ? `(${structure.name})` : ""}
        </div>
      )}
      {claim && (
        <div className="text-xs text-gray-400">
          Node claim: {claimOwner}
        </div>
      )}
    </div>
  );
};

export default ContextPanel;
