// ControlButtons.jsx
import React from "react";
import { Settings, Users } from "lucide-react";

const ControlButtons = ({ onOpenSettings, onOpenPlayerList }) => {
  return (
    <div className="relative top-0 right-0">
      <div className="absolute p-3 top-0 right-0 flex flex-row gap-2 z-50">
        <button
          onClick={onOpenPlayerList}
          className="p-2 bg-white rounded-lg shadow-lg hover:bg-gray-100"
        >
          <Users size={24} />
        </button>
        <button
          onClick={onOpenSettings}
          className="p-2 bg-white rounded-lg shadow-lg hover:bg-gray-100"
        >
          <Settings size={24} />
        </button>
      </div>
    </div>
  );
};

export { ControlButtons };
