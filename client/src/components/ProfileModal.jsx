import React, { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";

const ProfileModal = ({ isOpen, onClose }) => {
  const { profile, updateProfile, logout } = useAuth();
  const [draft, setDraft] = useState({
    displayName: "",
    nationName: "",
    capitalName: "",
    color: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const normalizeColor = (value) => {
    if (!value) return "";
    if (value.startsWith("#")) return value;
    const match = value.match(/hsl\((\d+),\s*(\d+)%?,\s*(\d+)%?\)/i);
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

  const handleSave = async () => {
    try {
      setSaving(true);
      setError("");
      await updateProfile(draft);
      onClose();
    } catch (err) {
      setError(err.message || "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 text-white rounded-lg p-6 w-[90vw] max-w-md shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Profile</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            ✕
          </button>
        </div>

        <div className="space-y-3">
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
          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded w-full"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            onClick={logout}
            className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded w-full"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProfileModal;
