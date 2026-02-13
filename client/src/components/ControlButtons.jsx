// ControlButtons.jsx
import React from "react";
import { Settings, Users } from "lucide-react";

const ControlButtons = ({
  onOpenSettings,
  onOpenPlayerList,
  topOffset = 0,
}) => {
  return (
    <div className="relative top-0 right-0">
      <div
        className="absolute p-3 right-0 flex flex-row gap-2 z-50"
        style={{
          top: `calc(env(safe-area-inset-top, 0px) + ${topOffset}px)`,
        }}
      >
        <button
          onClick={onOpenPlayerList}
          className="p-2 bg-gray-900 text-white rounded-lg shadow-lg hover:bg-gray-700"
        >
          <Users size={24} />
        </button>
        <button
          onClick={onOpenSettings}
          className="p-2 bg-gray-900 text-white rounded-lg shadow-lg hover:bg-gray-700"
        >
          <Settings size={24} />
        </button>
      </div>
    </div>
  );
};

export { ControlButtons };
