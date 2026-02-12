import React, { useState, useEffect, useRef } from "react";

const MapCreationPoller = ({
  gameRoomId,
  onMapReady,
  onError,
  formData,
  pollingInterval = 5000,
}) => {
  const [, setAttempts] = useState(0);
  const [status, setStatus] = useState("generating");
  const [stage, setStage] = useState("queued");
  const [progress, setProgress] = useState(5);
  const maxAttempts = 24; // 2 minutes maximum waiting time
  const onMapReadyRef = useRef(onMapReady);
  const hasCompletedRef = useRef(false);

  useEffect(() => {
    onMapReadyRef.current = onMapReady;
  }, [onMapReady]);

  useEffect(() => {
    let mounted = true;
    let timeoutId = null;

    const checkMapStatus = async () => {
      try {
        if (hasCompletedRef.current || !mounted) return;

        const response = await fetch(
          `${process.env.REACT_APP_API_URL}api/gamerooms/${gameRoomId}/status`
        );

        if (!mounted) return;

        if (!response.ok) {
          throw new Error("Failed to fetch game room status");
        }

        const data = await response.json();
        setStatus(data.mapStatus || "generating");
        setStage(data.stage || null);

        const nextProgress = Number(data.progress);
        if (Number.isFinite(nextProgress)) {
          setProgress(Math.max(0, Math.min(100, nextProgress)));
        }

        if (data.mapStatus === "error") {
          onError(new Error("Map generation failed"));
          return;
        }

        if (!data.ready) {
          setAttempts((prev) => {
            if (prev >= maxAttempts) {
              onError(new Error("Map generation timed out after 2 minutes"));
              return prev;
            }
            if (mounted && !hasCompletedRef.current) {
              timeoutId = setTimeout(checkMapStatus, pollingInterval);
            }
            return prev + 1;
          });
          return;
        }

        if (data.ready && !hasCompletedRef.current) {
          hasCompletedRef.current = true;
          setProgress(100);
          onMapReadyRef.current(data);
          return;
        }
      } catch (error) {
        if (mounted) {
          onError(error);
        }
      }
    };

    checkMapStatus();

    return () => {
      mounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [gameRoomId, onError, pollingInterval, maxAttempts]);

  const getStatusMessage = () => {
    switch (status) {
      case "initializing":
        return "Initializing map generation...";
      case "generating":
        switch (stage) {
          case "generating_terrain":
            return "Generating terrain...";
          case "placing_resources":
            return "Placing resources...";
          case "saving_chunks":
            return "Saving map chunks...";
          case "finalizing_room":
            return "Finalizing room...";
          case "spawning_bots":
            return "Spawning nations...";
          default:
            return "Generating map...";
        }
      case "error":
        return "Error generating map";
      case "ready":
        return "Map generated successfully!";
      default:
        return "Checking map status...";
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black bg-opacity-50 flex items-center justify-center">
      <div className="bg-gray-800 p-6 rounded-lg shadow-xl max-w-md w-full border border-gray-700">
        <h3 className="text-xl font-semibold mb-4 text-white">
          {getStatusMessage()}
        </h3>

        <div className="mb-6">
          <div className="flex justify-between mb-2 text-gray-300">
            <span>Generating map for {formData.roomName}...</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                status === "error"
                  ? "bg-red-600"
                  : status === "ready"
                  ? "bg-green-600"
                  : "bg-blue-600"
              }`}
              style={{
                width: `${Math.min(Math.max(progress, 0), 100)}%`,
              }}
            />
          </div>
        </div>

        <div
          className={`border-l-4 p-4 rounded ${
            status === "error"
              ? "bg-red-900/20 border-red-500"
              : status === "ready"
              ? "bg-green-900/20 border-green-500"
              : "bg-gray-700 border-blue-500"
          }`}
        >
          <div className="flex">
            <div className="ml-3">
              <p className="text-sm text-gray-300">
                Generating a {formData.width}x{formData.height} map... This may
                take up to 2 minutes.
              </p>
            </div>
          </div>
        </div>

        {status !== "ready" && status !== "error" && (
          <div className="animate-pulse mt-4 flex justify-center">
            <div className="flex items-center space-x-2 text-blue-400">
              <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
              <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
              <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MapCreationPoller;
