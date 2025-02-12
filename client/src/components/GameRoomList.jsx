import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorMessage, LoadingSpinner } from './ErrorHandling';

const CreateGameRoomForm = ({
  isOpen,
  onClose,
  onSubmit,
  isCreating,
  availableMaps,
}) => {
  const [formData, setFormData] = useState({
    roomName: '',
    selectedMapId: '',
    generateNewMap: false,
    // Map generation options (used when generateNewMap is true)
    mapName: '',
    width: 500,
    height: 500,
    erosion_passes: 3,
    num_blobs: 3,
    // New fields for game room creator credentials
    creatorName: '',
    creatorPassword: '',
    joinCode: '',
  });

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
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
        <div className="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
          <div className="sm:flex sm:items-start">
            <div className="mt-3 text-center sm:mt-0 sm:text-left w-full">
              <h3
                className="text-lg leading-6 font-medium text-gray-900"
                id="modal-title"
              >
                Create New Game Room
              </h3>
              <form onSubmit={handleSubmit} className="mt-4 space-y-4">
                <div>
                  <label
                    htmlFor="roomName"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Room Name
                  </label>
                  <input
                    type="text"
                    id="roomName"
                    name="roomName"
                    value={formData.roomName}
                    onChange={handleChange}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                </div>
                <div>
                  <label
                    htmlFor="joinCode"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Join Code
                  </label>
                  <input
                    type="text"
                    id="joinCode"
                    name="joinCode"
                    value={formData.joinCode}
                    onChange={handleChange}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                </div>

                {/* New creator credentials fields */}
                <div>
                  <label
                    htmlFor="creatorName"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Creator Name
                  </label>
                  <input
                    type="text"
                    id="creatorName"
                    name="creatorName"
                    value={formData.creatorName}
                    onChange={handleChange}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                </div>
                <div>
                  <label
                    htmlFor="creatorPassword"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Creator Password
                  </label>
                  <input
                    type="password"
                    id="creatorPassword"
                    name="creatorPassword"
                    value={formData.creatorPassword}
                    onChange={handleChange}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="generateNewMap"
                      name="generateNewMap"
                      checked={formData.generateNewMap}
                      onChange={handleChange}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label
                      htmlFor="generateNewMap"
                      className="ml-2 block text-sm text-gray-900"
                    >
                      Generate New Map
                    </label>
                  </div>

                  {formData.generateNewMap ? (
                    // Show map generation options if generating new map
                    <>
                      <div>
                        <label
                          htmlFor="mapName"
                          className="block text-sm font-medium text-gray-700"
                        >
                          Map Name
                        </label>
                        <input
                          type="text"
                          id="mapName"
                          name="mapName"
                          value={formData.mapName}
                          onChange={handleChange}
                          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          required
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="width"
                          className="block text-sm font-medium text-gray-700"
                        >
                          Width (pixels)
                        </label>
                        <input
                          type="number"
                          id="width"
                          name="width"
                          min="100"
                          max="2000"
                          value={formData.width}
                          onChange={handleChange}
                          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          required
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="height"
                          className="block text-sm font-medium text-gray-700"
                        >
                          Height (pixels)
                        </label>
                        <input
                          type="number"
                          id="height"
                          name="height"
                          min="100"
                          max="2000"
                          value={formData.height}
                          onChange={handleChange}
                          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          required
                        />
                      </div>
                    </>
                  ) : (
                    // Show map selection if using existing map
                    <div>
                      <label
                        htmlFor="selectedMapId"
                        className="block text-sm font-medium text-gray-700"
                      >
                        Select Map
                      </label>
                      <select
                        id="selectedMapId"
                        name="selectedMapId"
                        value={formData.selectedMapId}
                        onChange={handleChange}
                        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        required
                      >
                        <option value="">Select a map...</option>
                        {availableMaps.map((map) => (
                          <option key={map._id} value={map._id}>
                            {map.name} ({map.width}x{map.height})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                  <button
                    type="submit"
                    disabled={isCreating}
                    className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm disabled:bg-blue-300"
                  >
                    {isCreating ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
                        Creating...
                      </>
                    ) : (
                      'Create Game Room'
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:w-auto sm:text-sm"
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
  const navigate = useNavigate();

  const fetchGameRooms = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/gamerooms`
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to fetch game rooms');
      }

      const data = await response.json();

      if (!Array.isArray(data)) {
        throw new Error('Invalid data received from server');
      }

      setGameRooms(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAvailableMaps = async () => {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/maps`
      );
      if (!response.ok) {
        throw new Error('Failed to fetch available maps');
      }
      const data = await response.json();
      setAvailableMaps(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreateGameRoom = async (formData) => {
    if (isCreating) return;

    try {
      setIsCreating(true);
      setCreateError(null);

      let mapId = formData.selectedMapId;

      // If generating a new map, create it first
      if (formData.generateNewMap) {
        const mapResponse = await fetch(
          `${process.env.REACT_APP_API_URL}/api/maps`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: formData.mapName,
              width: formData.width,
              height: formData.height,
              erosion_passes: formData.erosion_passes,
              num_blobs: formData.num_blobs,
            }),
          }
        );

        if (!mapResponse.ok) {
          throw new Error('Failed to generate new map');
        }

        const newMap = await mapResponse.json();
        mapId = newMap._id;
      }

      // Create the game room with the map and the creator's credentials
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/gamerooms`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            mapId,
            roomName: formData.roomName,
            creatorName: formData.creatorName,
            creatorPassword: formData.creatorPassword,
            joinCode: formData.joinCode,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to create game room');
      }

      const newGameRoom = await response.json();
      setIsCreateDialogOpen(false);
      navigate(`/rooms/${newGameRoom._id}`); // Assuming you'll create this route
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setIsCreating(false);
    }
  };

  useEffect(() => {
    fetchGameRooms();
    fetchAvailableMaps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading && gameRooms.length === 0) return <LoadingSpinner />;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Game Rooms</h1>
        <button
          onClick={() => setIsCreateDialogOpen(true)}
          className="bg-blue-700 hover:bg-blue-600 disabled:bg-blue-300 text-white px-6 py-2 rounded-lg transition-colors duration-200 font-medium shadow-sm"
        >
          Create New Game Room
        </button>
      </div>

      <CreateGameRoomForm
        isOpen={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        onSubmit={handleCreateGameRoom}
        isCreating={isCreating}
        availableMaps={availableMaps}
      />

      {error && <ErrorMessage message={error} onRetry={fetchGameRooms} />}

      {createError && <ErrorMessage message={createError} />}

      <div className="space-y-4">
        {gameRooms.map((room) => (
          <div
            key={room._id}
            className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow duration-200"
          >
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-semibold text-gray-800">
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
                  className="bg-green-700 hover:bg-green-600 disabled:bg-green-300 text-white px-4 py-2 rounded-md transition-colors duration-200 flex items-center gap-2"
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
