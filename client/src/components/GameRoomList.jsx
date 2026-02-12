import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ErrorMessage, LoadingSpinner } from "./ErrorHandling";
import MapCreationPoller from "./MapCreationPoller";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../utils/api";

const MAP_SIZES = {
  Small: { width: 250, height: 250, erosion_passes: 3, num_blobs: 7 },
  Normal: { width: 500, height: 500, erosion_passes: 3, num_blobs: 9 },
  Large: { width: 1000, height: 1000, erosion_passes: 3, num_blobs: 12 },
};

const buildDefaultRoomName = (creatorLabel) =>
  `${creatorLabel || "Player"}'s room`;

const CreateGameRoomForm = ({
  isOpen,
  onClose,
  onSubmit,
  isCreating,
  creatorLabel,
}) => {
  const [formData, setFormData] = useState({
    roomName: buildDefaultRoomName(creatorLabel),
    selectedMapId: "",
    generateNewMap: true,
    mapName: "",
    mapSize: "Normal", // New field for map size selection
    width: MAP_SIZES.Normal.width,
    height: MAP_SIZES.Normal.height,
    erosion_passes: MAP_SIZES.Normal.erosion_passes,
    num_blobs: MAP_SIZES.Normal.num_blobs,
    joinCode: "",
    botCount: 0,
    allowRefound: true,
  });

  useEffect(() => {
    if (!isOpen) return;
    setFormData((prev) => ({
      ...prev,
      roomName: buildDefaultRoomName(creatorLabel),
    }));
  }, [isOpen, creatorLabel]);

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
                  />
                </div>

                <div className="text-sm text-gray-400">
                  Creator: <span className="text-gray-200">{creatorLabel}</span>
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

                {/* Bot Count */}
                <div>
                  <label
                    htmlFor="botCount"
                    className="block text-sm font-medium text-gray-500"
                  >
                    Bot Opponents
                  </label>
                  <input
                    type="number"
                    id="botCount"
                    name="botCount"
                    min="0"
                    max="20"
                    value={formData.botCount}
                    onChange={handleChange}
                    className="mt-1 text-black block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    0 = no bots. Max 20.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="allowRefound"
                    name="allowRefound"
                    checked={formData.allowRefound}
                    onChange={handleChange}
                    className="h-4 w-4"
                  />
                  <label
                    htmlFor="allowRefound"
                    className="text-sm font-medium text-gray-500"
                  >
                    Allow refounding after defeat
                  </label>
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
  const { user, profile, loading: authLoading, loginWithGoogle } = useAuth();

  const fetchGameRooms = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await apiFetch("api/gamerooms");

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
    if (!user) {
      loginWithGoogle("/rooms");
      return;
    }

    try {
      setIsCreating(true);
      setCreateError(null);

      // Use the new endpoint to create a game room with asynchronous map generation
      const response = await apiFetch("api/gamerooms/init", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roomName: formData.roomName,
          joinCode: formData.joinCode,
          mapName: `Room:${profile?.displayName || user.id}`,
          width: formData.width,
          height: formData.height,
          erosion_passes: formData.erosion_passes,
          num_blobs: formData.num_blobs,
          botCount: Number(formData.botCount || 0),
          allowRefound: !!formData.allowRefound,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create game room");
      }

      const result = await response.json(); // { gameRoomId, joinCode }
      // Set polling state with the returned game room ID
      setMapGenerationState({
        isPolling: true,
        gameRoomId: result.gameRoomId,
        formData: formData,
      });

      setIsCreateDialogOpen(false);
    } catch (err) {
      setCreateError(err.message);
      setIsCreating(false);
    }
  };

  const handleMapReady = async (data) => {
    console.log(
      "Map is ready for game room",
      mapGenerationState.gameRoomId,
      data
    );

    // Store join code for convenience
    const roomKey = `gameRoom-${mapGenerationState.gameRoomId}-userId`;
    if (mapGenerationState.formData?.joinCode) {
      localStorage.setItem(
        `${roomKey}-joinCode`,
        mapGenerationState.formData.joinCode
      );
    }
    // Optionally, you can store credentials or any additional data here.
    navigate(`/rooms/${mapGenerationState.gameRoomId}`);
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
  const displayName = profile?.displayName || user?.id || "Unknown";

  return (
    <div className="w-full p-4 sm:p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-white sm:text-3xl">Open Game Rooms</h1>
        <button
          onClick={() => setIsCreateDialogOpen(true)}
          disabled={!user || authLoading}
          className="rounded-lg bg-yellow-500 px-5 py-2 font-semibold text-gray-900 shadow-sm transition-colors duration-200 hover:bg-yellow-400 disabled:cursor-not-allowed disabled:bg-yellow-200"
        >
          Create New Game
        </button>
      </div>

      {!user && !authLoading && (
        <p
          className="mb-4 rounded-md bg-gray-900 px-3 py-2 text-sm text-gray-200"
          style={{ backgroundColor: "rgba(17, 24, 39, 0.78)" }}
        >
          Sign in to create rooms and save your profile name.
        </p>
      )}

      {!mapGenerationState.isPolling && (
        <CreateGameRoomForm
          isOpen={isCreateDialogOpen}
          onClose={() => setIsCreateDialogOpen(false)}
          onSubmit={handleCreateGameRoom}
          isCreating={isCreating}
          creatorLabel={displayName}
        />
      )}
      {mapGenerationState.isPolling && (
        <MapCreationPoller
          gameRoomId={mapGenerationState.gameRoomId}
          formData={mapGenerationState.formData}
          onMapReady={handleMapReady}
          onError={handlePollingError}
        />
      )}

      {error && <ErrorMessage message={error} onRetry={fetchGameRooms} />}

      {createError && <ErrorMessage message={createError} />}

      <div className="space-y-4">
        {gameRooms.length === 0 && (
          <div
            className="rounded-lg bg-gray-900 p-4 text-sm text-gray-200"
            style={{ backgroundColor: "rgba(17, 24, 39, 0.78)" }}
          >
            No open games available. Start one and invite players from Discord.
          </div>
        )}
        {gameRooms.map((room) => (
          <div
            key={room._id}
            className="rounded-lg bg-gray-900 p-4 shadow-sm transition-shadow duration-200 hover:shadow-md"
            style={{ backgroundColor: "rgba(17, 24, 39, 0.78)" }}
          >
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-semibold text-gray-100">
                  {room.roomName}
                </h2>
                <p className="mt-1 text-sm text-gray-300">
                  Created: {new Date(room.createdAt).toLocaleDateString()}
                </p>
                <p className="text-sm text-gray-300">
                  Map: {room.map.name} ({room.map.width}x{room.map.height})
                </p>
                <p className="text-sm text-gray-300">
                  Players: {room.players?.length || 0}
                </p>
                <p className="text-sm text-gray-300">
                  Refounding: {room.allowRefound === false ? "Disabled" : "Allowed"}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => navigate(`/rooms/${room._id}`)}
                  className="flex items-center gap-2 rounded-md bg-green-700 px-4 py-2 text-white transition-colors duration-200 hover:bg-green-600 disabled:bg-green-300"
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
