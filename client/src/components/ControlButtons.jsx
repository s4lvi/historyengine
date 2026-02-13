// ControlButtons.jsx
import React from "react";
import { Settings, Users } from "lucide-react";

const ControlButtons = ({
  onOpenSettings,
  onOpenPlayerList,
  topOffset = 0,
  isMobile = false,
}) => {
  return (
    <div className="relative top-0 right-0">
      <div
        className={`absolute right-0 flex flex-row gap-2 z-50 ${
          isMobile ? "p-2" : "p-3"
        }`}
        style={{
          top: `${topOffset}px`,
        }}
      >
        <button
          onClick={onOpenPlayerList}
          className={`bg-gray-900 text-white rounded-xl shadow-lg hover:bg-gray-700 ${
            isMobile ? "p-2.5" : "p-2"
          }`}
        >
          <Users size={isMobile ? 26 : 24} />
        </button>
        <button
          onClick={onOpenSettings}
          className={`bg-gray-900 text-white rounded-xl shadow-lg hover:bg-gray-700 ${
            isMobile ? "p-2.5" : "p-2"
          }`}
        >
          <Settings size={isMobile ? 26 : 24} />
        </button>
      </div>
    </div>
  );
};

export { ControlButtons };
