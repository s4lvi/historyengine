import React, { useState, useRef, useCallback, useEffect } from "react";
import { apiFetch } from "../utils/api";

const BIOME_COLORS = [
  [30, 60, 120],     // 0  OCEAN
  [160, 180, 140],   // 1  COASTAL
  [140, 140, 140],   // 2  MOUNTAIN
  [210, 190, 120],   // 3  DESERT
  [190, 190, 80],    // 4  SAVANNA
  [40, 140, 60],     // 5  TROPICAL_FOREST
  [20, 100, 40],     // 6  RAINFOREST
  [200, 210, 220],   // 7  TUNDRA
  [60, 100, 80],     // 8  TAIGA
  [130, 180, 80],    // 9  GRASSLAND
  [90, 140, 60],     // 10 WOODLAND
  [40, 120, 50],     // 11 FOREST
  [50, 90, 170],     // 12 RIVER
];

const BIOME_NAMES = [
  "OCEAN", "COASTAL", "MOUNTAIN", "DESERT", "SAVANNA",
  "TROPICAL_FOREST", "RAINFOREST", "TUNDRA", "TAIGA",
  "GRASSLAND", "WOODLAND", "FOREST", "RIVER",
];

const SLIDER_GROUPS = [
  {
    label: "Terrain Shape",
    params: [
      { key: "elevationOffset", label: "Elevation Offset", min: 0.2, max: 0.6, step: 0.01, desc: "Controls land/ocean ratio" },
      { key: "noiseWeight", label: "Noise Weight", min: 0.1, max: 0.9, step: 0.05, desc: "FBM noise influence" },
      { key: "anchorWeight", label: "Anchor Weight", min: 0.1, max: 0.9, step: 0.05, desc: "Continent anchor influence" },
      { key: "borderWidth", label: "Border Width", min: 0.05, max: 0.35, step: 0.01, desc: "Ocean border fade %" },
      { key: "subSeaPush", label: "Sub-Sea Push", min: 0.2, max: 1.0, step: 0.05, desc: "How much to flatten ocean floor" },
    ],
  },
  {
    label: "Domain Warping",
    params: [
      { key: "warp1Scale", label: "Warp 1 Scale", min: 0.001, max: 0.01, step: 0.001, desc: "Large warp frequency" },
      { key: "warp1Amplitude", label: "Warp 1 Amplitude", min: 0, max: 100, step: 5, desc: "Large warp strength" },
      { key: "warp2Scale", label: "Warp 2 Scale", min: 0.002, max: 0.02, step: 0.001, desc: "Detail warp frequency" },
      { key: "warp2Amplitude", label: "Warp 2 Amplitude", min: 0, max: 60, step: 5, desc: "Detail warp strength" },
    ],
  },
  {
    label: "FBM Noise",
    params: [
      { key: "fbmOctaves", label: "Octaves", min: 1, max: 8, step: 1, desc: "Noise detail layers" },
      { key: "fbmFrequency", label: "Frequency", min: 0.002, max: 0.02, step: 0.001, desc: "Base noise frequency" },
      { key: "fbmPersistence", label: "Persistence", min: 0.2, max: 0.8, step: 0.05, desc: "Octave amplitude falloff" },
    ],
  },
  {
    label: "Anchors",
    params: [
      { key: "anchorMargin", label: "Margin", min: 0.05, max: 0.3, step: 0.01, desc: "Min distance from edge" },
      { key: "anchorMinStrength", label: "Min Strength", min: 0.1, max: 0.7, step: 0.05, desc: "Minimum anchor strength" },
      { key: "anchorStrengthRange", label: "Strength Range", min: 0.1, max: 0.5, step: 0.05, desc: "Random strength variation" },
      { key: "anchorMinSigma", label: "Min Sigma", min: 0.05, max: 0.3, step: 0.01, desc: "Minimum spread (fraction)" },
      { key: "anchorSigmaRange", label: "Sigma Range", min: 0.05, max: 0.25, step: 0.01, desc: "Random spread variation" },
    ],
  },
  {
    label: "Biome Thresholds",
    params: [
      { key: "seaLevel", label: "Sea Level", min: 0.2, max: 0.5, step: 0.01, desc: "Ocean/land cutoff" },
      { key: "coastalLevel", label: "Coastal Level", min: 0.3, max: 0.55, step: 0.01, desc: "Coastal biome upper bound" },
      { key: "mountainLevel", label: "Mountain Level", min: 0.7, max: 0.95, step: 0.01, desc: "Mountain biome lower bound" },
      { key: "peakAmplifyStrength", label: "Peak Amplify", min: 0, max: 2.0, step: 0.1, desc: "Mountain peak boost" },
    ],
  },
  {
    label: "Rivers",
    params: [
      { key: "riverFlowMultiplier", label: "Flow Multiplier", min: 0.02, max: 0.4, step: 0.02, desc: "Lower = more rivers" },
      { key: "riverWidenMultiplier", label: "Widen Mult", min: 2, max: 8, step: 1, desc: "Widen threshold multiplier" },
    ],
  },
  {
    label: "Moisture",
    params: [
      { key: "moistureInfluenceRadius", label: "Water Influence", min: 5, max: 30, step: 1, desc: "Water proximity radius" },
      { key: "rainShadowDecay", label: "Rain Shadow Decay", min: 0.8, max: 0.99, step: 0.01, desc: "Shadow persistence" },
      { key: "moistureSmoothPasses", label: "Smooth Passes", min: 0, max: 6, step: 1, desc: "Moisture smoothing iterations" },
    ],
  },
];

const SIZE_PRESETS = [
  { label: "Small", width: 250, height: 250, numBlobs: 7 },
  { label: "Normal", width: 500, height: 500, numBlobs: 9 },
  { label: "Large", width: 1000, height: 1000, numBlobs: 12 },
];

const DEFAULTS = {
  seaLevel: 0.35, coastalLevel: 0.40, mountainLevel: 0.85,
  elevationOffset: 0.40, noiseWeight: 0.6, anchorWeight: 0.4,
  warp1Scale: 0.003, warp1Amplitude: 40, warp2Scale: 0.006,
  warp2Amplitude: 20, fbmOctaves: 6, fbmFrequency: 0.008,
  fbmPersistence: 0.5, borderWidth: 0.18, anchorMargin: 0.15,
  anchorMinStrength: 0.4, anchorStrengthRange: 0.35,
  anchorMinSigma: 0.15, anchorSigmaRange: 0.12,
  peakAmplifyStrength: 0.8, subSeaPush: 0.6,
  riverFlowMultiplier: 0.12, riverWidenMultiplier: 4,
  moistureInfluenceRadius: 15, rainShadowDecay: 0.92,
  moistureSmoothPasses: 3,
};

export default function MapPreview() {
  const canvasRef = useRef(null);
  const [mapConfig, setMapConfig] = useState({ ...DEFAULTS });
  const [width, setWidth] = useState(500);
  const [height, setHeight] = useState(500);
  const [numBlobs, setNumBlobs] = useState(9);
  const [seed, setSeed] = useState(42);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [saveMsg, setSaveMsg] = useState("");
  const [collapsed, setCollapsed] = useState({});

  // Load saved config on mount
  useEffect(() => {
    apiFetch("/api/maps/config")
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data === "object" && Object.keys(data).length > 0) {
          setMapConfig((prev) => ({ ...prev, ...data }));
        }
      })
      .catch(() => {});
  }, []);

  const abortRef = useRef(null);

  const generate = useCallback(async () => {
    // Abort any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setSaveMsg("");
    try {
      const res = await apiFetch("/api/maps/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          width, height, num_blobs: numBlobs, seed, mapConfig,
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      setStats(data.stats);
      setSeed(data.seed);

      // Decode base64 biome buffer and draw to canvas
      const biomeBytes = Uint8Array.from(atob(data.biomes), (c) => c.charCodeAt(0));
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = data.width;
      canvas.height = data.height;
      const ctx = canvas.getContext("2d");
      const img = ctx.createImageData(data.width, data.height);
      const d = img.data;
      for (let i = 0; i < biomeBytes.length; i++) {
        const [r, g, b] = BIOME_COLORS[biomeBytes[i]] || [0, 0, 0];
        const off = i * 4;
        d[off] = r;
        d[off + 1] = g;
        d[off + 2] = b;
        d[off + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    } catch (e) {
      if (e.name !== "AbortError") console.error("Preview error:", e);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [width, height, numBlobs, seed, mapConfig]);

  // Auto-generate on any parameter change (debounced 300ms)
  useEffect(() => {
    const timer = setTimeout(() => generate(), 300);
    return () => clearTimeout(timer);
  }, [generate]);

  const saveConfig = useCallback(async () => {
    try {
      const res = await apiFetch("/api/maps/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapGeneration: mapConfig }),
      });
      const data = await res.json();
      if (data.success) {
        setSaveMsg("Saved to gameConfig.json");
      } else {
        setSaveMsg("Save failed");
      }
    } catch (e) {
      setSaveMsg("Save error: " + e.message);
    }
    setTimeout(() => setSaveMsg(""), 3000);
  }, [mapConfig]);

  const resetDefaults = () => setMapConfig({ ...DEFAULTS });
  const randomSeed = () => setSeed(Math.floor(Math.random() * 100000));

  const toggleGroup = (label) =>
    setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }));

  const updateParam = (key, value) =>
    setMapConfig((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="flex h-full gap-4">
      {/* Left: Controls */}
      <div className="w-80 flex-shrink-0 overflow-y-auto rounded-lg bg-gray-900/90 p-4 scrollbar-panel">
        <h2 className="mb-3 text-lg font-bold text-white">Map Generator</h2>

        {/* Size presets */}
        <div className="mb-3">
          <label className="mb-1 block text-xs text-gray-400">Map Size</label>
          <div className="flex gap-1">
            {SIZE_PRESETS.map((p) => (
              <button key={p.label}
                onClick={() => { setWidth(p.width); setHeight(p.height); setNumBlobs(p.numBlobs); }}
                className={`flex-1 rounded px-2 py-1.5 text-xs font-semibold ${
                  width === p.width && height === p.height && numBlobs === p.numBlobs
                    ? "bg-yellow-500 text-gray-900"
                    : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                }`}>
                {p.label}
                <span className="block text-[10px] font-normal opacity-70">{p.width}x{p.height}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Basic params */}
        <div className="mb-4 space-y-2">
          <div className="flex items-center gap-2">
            <label className="w-20 text-xs text-gray-400">Width</label>
            <input type="number" min={50} max={1000} value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              className="w-20 rounded bg-gray-800 px-2 py-1 text-sm text-white" />
            <label className="w-20 text-xs text-gray-400">Height</label>
            <input type="number" min={50} max={1000} value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
              className="w-20 rounded bg-gray-800 px-2 py-1 text-sm text-white" />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-20 text-xs text-gray-400">Blobs</label>
            <input type="number" min={1} max={16} value={numBlobs}
              onChange={(e) => setNumBlobs(Number(e.target.value))}
              className="w-20 rounded bg-gray-800 px-2 py-1 text-sm text-white" />
            <label className="w-20 text-xs text-gray-400">Seed</label>
            <input type="number" value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
              className="w-20 rounded bg-gray-800 px-2 py-1 text-sm text-white" />
          </div>
          <div className="flex gap-2">
            <button onClick={randomSeed}
              className="flex-1 rounded bg-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-600">
              Random Seed
            </button>
          </div>
        </div>

        {/* Slider groups */}
        {SLIDER_GROUPS.map((group) => (
          <div key={group.label} className="mb-2">
            <button
              onClick={() => toggleGroup(group.label)}
              className="flex w-full items-center justify-between rounded bg-gray-800/80 px-2 py-1.5 text-left text-xs font-semibold text-gray-300 hover:bg-gray-700/80"
            >
              <span>{group.label}</span>
              <span className="text-gray-500">{collapsed[group.label] ? "+" : "-"}</span>
            </button>
            {!collapsed[group.label] && (
              <div className="mt-1 space-y-1.5 pl-1">
                {group.params.map((p) => (
                  <div key={p.key}>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-gray-400" title={p.desc}>{p.label}</span>
                      <span className="text-[11px] font-mono text-gray-300">
                        {typeof mapConfig[p.key] === "number"
                          ? (Number.isInteger(p.step) ? mapConfig[p.key] : mapConfig[p.key].toFixed(3))
                          : mapConfig[p.key]}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={p.min} max={p.max} step={p.step}
                      value={mapConfig[p.key]}
                      onChange={(e) => updateParam(p.key, Number(e.target.value))}
                      className="w-full accent-yellow-500"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Actions */}
        <div className="mt-4 space-y-2">
          <button onClick={saveConfig}
            className="w-full rounded bg-green-600 px-3 py-2 text-sm font-bold text-white hover:bg-green-500">
            Save to Config
          </button>
          <button onClick={resetDefaults}
            className="w-full rounded bg-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-600">
            Reset Defaults
          </button>
          {saveMsg && <p className="text-center text-xs text-green-400">{saveMsg}</p>}
        </div>
      </div>

      {/* Right: Canvas + Stats */}
      <div className="flex flex-1 flex-col items-center gap-3 overflow-y-auto">
        <div className="relative rounded-lg bg-gray-900/80 p-2">
          <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="rounded border border-gray-700"
            style={{
              imageRendering: "pixelated",
              maxWidth: "100%",
              maxHeight: "calc(100vh - 200px)",
            }}
          />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center rounded bg-black/50">
              <div className="text-lg font-bold text-yellow-400">Generating...</div>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
          {BIOME_NAMES.map((name, i) => (
            <div key={name} className="flex items-center gap-1">
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ backgroundColor: `rgb(${BIOME_COLORS[i].join(",")})` }}
              />
              <span className="text-[10px] text-gray-400">{name}</span>
            </div>
          ))}
        </div>

        {/* Stats */}
        {stats && (
          <div className="w-full max-w-lg rounded-lg bg-gray-900/80 p-3 text-sm text-gray-300">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span>Generated in <strong className="text-white">{stats.genTimeMs}ms</strong></span>
              <span>Land: <strong className="text-white">{stats.landPercent}%</strong></span>
              <span>Rivers: <strong className="text-white">{stats.riverCells}</strong></span>
            </div>
            <div className="grid grid-cols-4 gap-1 text-[10px]">
              {Object.entries(stats.biomeCounts).map(([name, count]) => (
                <div key={name} className="flex items-center gap-1">
                  <span
                    className="inline-block h-2 w-2 rounded-sm"
                    style={{ backgroundColor: `rgb(${BIOME_COLORS[BIOME_NAMES.indexOf(name)]?.join(",") || "0,0,0"})` }}
                  />
                  <span className="truncate">{name}</span>
                  <span className="ml-auto text-gray-500">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
