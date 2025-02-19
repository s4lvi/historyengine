import React, { useState, useEffect, useRef } from "react";

const MapCreationPoller = ({
  mapId,
  onMapReady,
  onError,
  formData,
  pollingInterval = 5000,
}) => {
  const [attempts, setAttempts] = useState(0);
  const [status, setStatus] = useState("generating");
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
        // Don't proceed if we've already completed
        if (hasCompletedRef.current || !mounted) return;

        const response = await fetch(
          `${process.env.REACT_APP_API_URL}api/maps/${mapId}/status`
        );

        if (!mounted) return;

        if (!response.ok) {
          throw new Error("Failed to fetch map status");
        }

        const data = await response.json();
        setStatus(data.status);

        if (data.status === "error") {
          onError(new Error("Map generation failed"));
          return;
        }

        if (data.ready === false) {
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
  }, [mapId, onError, pollingInterval, maxAttempts]);

  const getStatusMessage = () => {
    switch (status) {
      case "generating":
        return "Generating map...";
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
            <span>
              {Math.min(Math.round((attempts / maxAttempts) * 100), 100)}%
            </span>
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
                width: `${Math.min((attempts / maxAttempts) * 100, 100)}%`,
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
