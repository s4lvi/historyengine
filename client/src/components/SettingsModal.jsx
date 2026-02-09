// SettingsModal.jsx
import React, { useEffect, useState } from "react";
import { X } from "lucide-react";

const SettingsModal = ({
  isOpen,
  onClose,
  gameState,
  userId,
  profile,
  onLogin,
  onLogout,
  onUpdateProfile,
  isAuthenticated,
  paused,
  onPause,
  onUnpause,
  onEndGame,
  onLeaveGame,
  onBackToGameRooms,
}) => {
  const [draft, setDraft] = useState({
    displayName: "",
    nationName: "",
    capitalName: "",
    color: "",
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const normalizeColor = (value) => {
    if (!value) return "";
    if (value.startsWith("#")) return value;
    const match = value.match(/hsl\\((\\d+),\\s*(\\d+)%?,\\s*(\\d+)%?\\)/i);
    if (!match) return "";
    const h = Number(match[1]);
    const s = Number(match[2]);
    const l = Number(match[3]);
    const sat = s / 100;
    const light = l / 100;
    const c = (1 - Math.abs(2 * light - 1)) * sat;
    const hh = h / 60;
    const x = c * (1 - Math.abs((hh % 2) - 1));
    let r = 0;
    let g = 0;
    let b = 0;
    if (hh >= 0 && hh < 1) {
      r = c;
      g = x;
    } else if (hh >= 1 && hh < 2) {
      r = x;
      g = c;
    } else if (hh >= 2 && hh < 3) {
      g = c;
      b = x;
    } else if (hh >= 3 && hh < 4) {
      g = x;
      b = c;
    } else if (hh >= 4 && hh < 5) {
      r = x;
      b = c;
    } else if (hh >= 5 && hh < 6) {
      r = c;
      b = x;
    }
    const m = light - c / 2;
    const toHex = (val) => {
      const v = Math.round((val + m) * 255);
      return v.toString(16).padStart(2, "0");
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };

  useEffect(() => {
    if (!profile) return;
    setDraft({
      displayName: profile.displayName || "",
      nationName: profile.nationName || "",
      capitalName: profile.capitalName || "",
      color: normalizeColor(profile.color || ""),
    });
  }, [profile]);

  if (!isOpen) return null;

  const handleSaveProfile = async () => {
    if (!onUpdateProfile) return;
    try {
      setSaving(true);
      setSaveError("");
      await onUpdateProfile(draft);
    } catch (err) {
      setSaveError(err.message || "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

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
            <span className="font-medium">
              {profile?.displayName || userId || "Guest"}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-gray-500">Room:</span>
            <span className="font-medium">{gameState?.roomName}</span>
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
              Surrender
            </button>
            <button
              onClick={onBackToGameRooms}
              className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded"
            >
              Back to Game Rooms
            </button>
          </div>

          <div className="pt-4 border-t space-y-3">
            <h3 className="text-sm font-semibold text-gray-300">Player Profile</h3>
            {!isAuthenticated ? (
              <button
                onClick={onLogin}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded w-full"
              >
                Sign in with Google
              </button>
            ) : (
              <>
                <div>
                  <label className="text-xs text-gray-400">Display Name</label>
                  <input
                    type="text"
                    value={draft.displayName}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, displayName: e.target.value }))
                    }
                    className="mt-1 w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">Nation Name</label>
                  <input
                    type="text"
                    value={draft.nationName}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, nationName: e.target.value }))
                    }
                    className="mt-1 w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">Capital Name</label>
                  <input
                    type="text"
                    value={draft.capitalName}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, capitalName: e.target.value }))
                    }
                    className="mt-1 w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs text-gray-400">Player Color</label>
                  <input
                    type="color"
                    value={draft.color || "#6b7280"}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, color: e.target.value }))
                    }
                    className="h-8 w-16 rounded border border-gray-700 bg-gray-800"
                  />
                </div>
                {saveError && (
                  <div className="text-xs text-red-400">{saveError}</div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveProfile}
                    disabled={saving}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded w-full"
                  >
                    {saving ? "Saving..." : "Save Profile"}
                  </button>
                  <button
                    onClick={onLogout}
                    className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded w-full"
                  >
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
