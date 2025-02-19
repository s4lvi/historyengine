import React, { useState, useEffect } from "react";

const MapCreationPoller = ({
  mapId,
  onMapReady,
  onError,
  formData,
  pollingInterval = 5000,
}) => {
  const [attempts, setAttempts] = useState(0);
  const maxAttempts = 24; // 2 minutes maximum waiting time

  useEffect(() => {
    let timeoutId;

    const checkMapStatus = async () => {
      try {
        const response = await fetch(
          `${process.env.REACT_APP_API_URL}api/maps/${mapId}/metadata`
        );

        if (response.ok) {
          const mapData = await response.json();
          onMapReady(mapData);
          return;
        }

        setAttempts((prev) => {
          if (prev >= maxAttempts) {
            onError(new Error("Map generation timed out after 2 minutes"));
            return prev;
          }
          timeoutId = setTimeout(checkMapStatus, pollingInterval);
          return prev + 1;
        });
      } catch (error) {
        onError(error);
      }
    };

    checkMapStatus();

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [mapId, onMapReady, onError, pollingInterval]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black bg-opacity-50 flex items-center justify-center">
      <div className="bg-gray-800 p-6 rounded-lg shadow-xl max-w-md w-full border border-gray-700">
        <h3 className="text-xl font-semibold mb-4 text-white">
          Generating Map
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
              className="bg-blue-600 h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min((attempts / maxAttempts) * 100, 100)}%`,
              }}
            />
          </div>
        </div>

        <div className="bg-gray-700 border-l-4 border-blue-500 p-4 rounded">
          <div className="flex">
            <div className="ml-3">
              <p className="text-sm text-gray-300">
                Generating a {formData.width}x{formData.height} map... This may
                take up to 2 minutes.
              </p>
            </div>
          </div>
        </div>

        <div className="animate-pulse mt-4 flex justify-center">
          <div className="flex items-center space-x-2 text-blue-400">
            <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
            <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
            <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MapCreationPoller;
