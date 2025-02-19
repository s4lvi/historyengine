import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ErrorMessage, LoadingSpinner } from "./ErrorHandling";
import MapCreationPoller from "./MapCreationPoller";

const MAP_SIZES = {
  Small: { width: 100, height: 100, erosion_passes: 3, num_blobs: 7 },
  Normal: { width: 150, height: 150, erosion_passes: 3, num_blobs: 9 },
  Large: { width: 250, height: 250, erosion_passes: 3, num_blobs: 10 },
};

const CreateGameRoomForm = ({
  isOpen,
  onClose,
  onSubmit,
  isCreating,
  availableMaps,
}) => {
  const [formData, setFormData] = useState({
    roomName: "",
    selectedMapId: "",
    generateNewMap: true,
    mapName: "",
    mapSize: "Normal", // New field for map size selection
    width: MAP_SIZES.Normal.width,
    height: MAP_SIZES.Normal.height,
    erosion_passes: MAP_SIZES.Normal.erosion_passes,
    num_blobs: MAP_SIZES.Normal.num_blobs,
    creatorName: "",
    creatorPassword: "",
    joinCode: "",
  });

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;

    if (name === "mapSize") {
      // When map size changes, update both width and height
      const selectedSize = MAP_SIZES[value];
      setFormData((prev) => ({
        ...prev,
        mapSize: value,
        width: selectedSize.width,
        height: selectedSize.height,
        erosion_passes: selectedSize.erosion_passes,
        num_blobs: selectedSize.num_blobs,
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        [name]: type === "checkbox" ? checked : value,
      }));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      aria-labelledby="modal-title"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        {/* Background overlay */}
        <div
          className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
          aria-hidden="true"
          onClick={onClose}
        ></div>

        {/* Modal panel */}
        <div className="inline-block align-bottom bg-gray-900 bg-opacity-75 rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
          <div className="sm:flex sm:items-start">
            <div className="mt-3 text-center sm:mt-0 sm:text-left w-full">
              <h3 className="text-lg leading-6 font-medium " id="modal-title">
                Create New Game Room
              </h3>
              <form onSubmit={handleSubmit} className="mt-4 space-y-4">
                {/* Room Name */}
                <div>
                  <label
                    htmlFor="roomName"
                    className="block text-sm font-medium text-gray-500"
                  >
                    Room Name
                  </label>
                  <input
                    type="text"
                    id="roomName"
                    name="roomName"
                    value={formData.roomName}
                    onChange={handleChange}
                    className="mt-1 text-black block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                </div>

                {/* Join Code */}
                <div>
                  <label
                    htmlFor="joinCode"
                    className="block text-sm font-medium text-gray-500"
                  >
                    Join Code
                  </label>
                  <input
                    type="text"
                    id="joinCode"
                    name="joinCode"
                    value={formData.joinCode}
                    onChange={handleChange}
                    className="mt-1 text-black block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                </div>

                {/* Creator Name */}
                <div>
                  <label
                    htmlFor="creatorName"
                    className="block text-sm font-medium text-gray-500"
                  >
                    Creator Name
                  </label>
                  <input
                    type="text"
                    id="creatorName"
                    name="creatorName"
                    value={formData.creatorName}
                    onChange={handleChange}
                    className="mt-1 text-black block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                </div>

                {/* Creator Password */}
                <div>
                  <label
                    htmlFor="creatorPassword"
                    className="block text-sm font-medium text-gray-500"
                  >
                    Creator Password
                  </label>
                  <input
                    type="password"
                    id="creatorPassword"
                    name="creatorPassword"
                    value={formData.creatorPassword}
                    onChange={handleChange}
                    className="mt-1 text-black block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                </div>

                {/* Map Generation Options */}
                <div className="space-y-2">
                  <div>
                    <label
                      htmlFor="mapSize"
                      className="block text-sm font-medium text-gray-500"
                    >
                      Map Size
                    </label>
                    <select
                      id="mapSize"
                      name="mapSize"
                      value={formData.mapSize}
                      onChange={handleChange}
                      className="mt-1 text-black block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      required
                    >
                      {Object.keys(MAP_SIZES).map((size) => (
                        <option key={size} value={size}>
                          {size} ({MAP_SIZES[size].width}x
                          {MAP_SIZES[size].height})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Form Buttons */}
                <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                  <button
                    type="submit"
                    disabled={isCreating}
                    className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium  hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm disabled:bg-blue-300"
                  >
                    {isCreating ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
                        Creating...
                      </>
                    ) : (
                      "Create Game Room"
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-gray-900 text-base font-medium text-gray-500 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:w-auto sm:text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const GameRoomList = () => {
  const [gameRooms, setGameRooms] = useState([]);
  const [availableMaps, setAvailableMaps] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState(null);
  const [createError, setCreateError] = useState(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const [mapGenerationState, setMapGenerationState] = useState({
    isPolling: false,
    mapId: null,
    formData: null,
  });
  const navigate = useNavigate();

  const fetchGameRooms = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms`
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to fetch game rooms");
      }

      const data = await response.json();

      if (!Array.isArray(data)) {
        throw new Error("Invalid data received from server");
      }

      setGameRooms(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateGameRoom = async (formData) => {
    if (isCreating) return;

    try {
      setIsCreating(true);
      setCreateError(null);

      // Start map generation
      const mapResponse = await fetch(
        `${process.env.REACT_APP_API_URL}api/maps`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: formData.roomName + "-Map",
            width: formData.width,
            height: formData.height,
            erosion_passes: formData.erosion_passes,
            num_blobs: formData.num_blobs,
          }),
        }
      );

      if (!mapResponse.ok) {
        throw new Error("Failed to start map generation");
      }

      const newMap = await mapResponse.json();

      // Start polling for map completion
      setMapGenerationState({
        isPolling: true,
        mapId: newMap._id,
        formData,
      });
    } catch (err) {
      setCreateError(err.message);
      setIsCreating(false);
    }
  };

  const handleMapReady = async (mapData) => {
    try {
      // Create the game room with the completed map
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            mapId: mapGenerationState.mapId,
            roomName: mapGenerationState.formData.roomName,
            creatorName: mapGenerationState.formData.creatorName,
            creatorPassword: mapGenerationState.formData.creatorPassword,
            joinCode: mapGenerationState.formData.joinCode,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to create game room");
      }

      const newGameRoom = await response.json();

      // Store credentials and navigate
      const roomKey = `gameRoom-${newGameRoom._id}-userId`;
      localStorage.setItem(
        `${roomKey}-userId`,
        mapGenerationState.formData.creatorName
      );
      localStorage.setItem(
        `${roomKey}-password`,
        mapGenerationState.formData.creatorPassword
      );
      localStorage.setItem(
        `${roomKey}-joinCode`,
        mapGenerationState.formData.joinCode
      );

      // Reset states
      setIsCreateDialogOpen(false);
      setIsCreating(false);
      setMapGenerationState({ isPolling: false, mapId: null, formData: null });

      // Navigate to the new room
      navigate(`/rooms/${newGameRoom._id}`);
    } catch (err) {
      setCreateError(err.message);
      setIsCreating(false);
      setMapGenerationState({ isPolling: false, mapId: null, formData: null });
    }
  };

  const handlePollingError = (error) => {
    setCreateError(error.message);
    setIsCreating(false);
    setMapGenerationState({ isPolling: false, mapId: null, formData: null });
  };

  useEffect(() => {
    fetchGameRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading && gameRooms.length === 0) return <LoadingSpinner />;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Open Games</h1>
        <button
          onClick={() => setIsCreateDialogOpen(true)}
          className="bg-blue-700 hover:bg-blue-600 disabled:bg-blue-300  px-6 py-2 rounded-lg transition-colors duration-200 font-medium shadow-sm"
        >
          Create New Game
        </button>
      </div>

      <CreateGameRoomForm
        isOpen={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        onSubmit={handleCreateGameRoom}
        isCreating={isCreating}
        availableMaps={availableMaps}
      />
      {mapGenerationState.isPolling && (
        <MapCreationPoller
          mapId={mapGenerationState.mapId}
          formData={mapGenerationState.formData}
          onMapReady={handleMapReady}
          onError={handlePollingError}
        />
      )}

      {error && <ErrorMessage message={error} onRetry={fetchGameRooms} />}

      {createError && <ErrorMessage message={createError} />}

      <div className="space-y-4">
        {gameRooms.length === 0 && (
          <div>No open games available. Try starting your own!</div>
        )}
        {gameRooms.map((room) => (
          <div
            key={room._id}
            className="bg-gray-900 rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow duration-200"
          >
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-semibold text-gray-100">
                  {room.roomName}
                </h2>
                <p className="text-gray-500 text-sm mt-1">
                  Created: {new Date(room.createdAt).toLocaleDateString()}
                </p>
                <p className="text-gray-500 text-sm">
                  Map: {room.map.name} ({room.map.width}x{room.map.height})
                </p>
                <p className="text-gray-500 text-sm">
                  Players: {room.players?.length + 1 || 1}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => navigate(`/rooms/${room._id}`)}
                  className="bg-green-700 hover:bg-green-600 disabled:bg-green-300  px-4 py-2 rounded-md transition-colors duration-200 flex items-center gap-2"
                >
                  Join Game
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default GameRoomList;
