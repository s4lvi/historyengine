import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ErrorMessage, LoadingSpinner } from "./ErrorHandling";

const MAP_SIZES = {
  Small: { width: 100, height: 100, erosion_passes: 3, num_blobs: 7 },
  Normal: { width: 150, height: 150, erosion_passes: 3, num_blobs: 9 },
  Large: { width: 250, height: 250, erosion_passes: 3, num_blobs: 10 },
};

const CreateLobbyForm = ({ isOpen, onClose, onSubmit, isCreating }) => {
  const [formData, setFormData] = useState({
    roomName: "",
    joinCode: "",
    creatorName: "",
    creatorPassword: "",
  });

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "number" ? Number(value) : value,
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
        <div className="inline-block align-bottom bg-gray-900 bg-opacity-75 rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
          <div className="sm:flex sm:items-start">
            <div className="mt-3 text-center sm:mt-0 sm:text-left w-full">
              <h3 className="text-lg leading-6 font-medium" id="modal-title">
                Create New Lobby
              </h3>
              <form onSubmit={handleSubmit} className="mt-4 space-y-4">
                {/* Lobby Name */}
                <div>
                  <label
                    htmlFor="roomName"
                    className="block text-sm font-medium text-gray-500"
                  >
                    Lobby Name
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
                    Your Name
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
                    Password
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

                {/* Form Buttons */}
                <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                  <button
                    type="submit"
                    disabled={isCreating}
                    className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm disabled:bg-blue-300"
                  >
                    {isCreating ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
                        Creating...
                      </>
                    ) : (
                      "Create Lobby"
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

const LobbyList = () => {
  const [lobbies, setLobbies] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState(null);
  const [createError, setCreateError] = useState(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const navigate = useNavigate();

  const fetchLobbies = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms`
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to fetch lobbies");
      }

      const data = await response.json();

      if (!Array.isArray(data)) {
        throw new Error("Invalid data received from server");
      }

      setLobbies(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };
  const handleCreateLobby = async (formData) => {
    if (isCreating) return;

    try {
      setIsCreating(true);
      setCreateError(null);

      // Create a lobby using the new endpoint.
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomName: formData.roomName,
            joinCode: formData.joinCode,
            creatorName: formData.creatorName,
            creatorPassword: formData.creatorPassword,
            lobby: {
              mapSize: formData.mapSize,
              width: formData.width,
              height: formData.height,
              erosion_passes: formData.erosion_passes,
              num_blobs: formData.num_blobs,
              maxPlayers: formData.maxPlayers,
            },
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to create lobby");
      }

      const result = await response.json(); // { lobbyId, joinCode }
      // Store the creator credentials so that Lobby knows this user is the creator.
      localStorage.setItem(
        `lobby-${result.lobbyId}-creator`,
        formData.creatorName
      );
      localStorage.setItem(
        `lobby-${result.lobbyId}-password`,
        formData.creatorPassword
      );
      // Redirect to the lobby waiting room.
      navigate(`/lobby/${result.lobbyId}`);
      setIsCreateDialogOpen(false);
    } catch (err) {
      setCreateError(err.message);
      setIsCreating(false);
    }
  };

  useEffect(() => {
    fetchLobbies();
  }, []);

  if (isLoading && lobbies.length === 0) return <LoadingSpinner />;
  console.log("lobbies", lobbies);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Open Lobbies</h1>
        <button
          onClick={() => setIsCreateDialogOpen(true)}
          className="bg-blue-700 hover:bg-blue-600 disabled:bg-blue-300 px-6 py-2 rounded-lg transition-colors duration-200 font-medium shadow-sm"
        >
          Create New Lobby
        </button>
      </div>

      {isCreateDialogOpen && (
        <CreateLobbyForm
          isOpen={isCreateDialogOpen}
          onClose={() => setIsCreateDialogOpen(false)}
          onSubmit={handleCreateLobby}
          isCreating={isCreating}
        />
      )}

      {error && <ErrorMessage message={error} onRetry={fetchLobbies} />}
      {createError && <ErrorMessage message={createError} />}

      <div className="space-y-4">
        {lobbies.length === 0 && (
          <div>No open lobbies available. Try starting your own!</div>
        )}
        {lobbies.map((lobby) => (
          <div
            key={lobby._id}
            className="bg-gray-900 rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow duration-200"
          >
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-semibold text-gray-100">
                  {lobby.roomName}
                </h2>
                <p className="text-gray-500 text-sm mt-1">
                  Created: {new Date(lobby.createdAt).toLocaleDateString()}
                </p>
                <p className="text-gray-500 text-sm">
                  Players: {lobby.players?.length}/{lobby.lobby.maxPlayers}
                </p>
                <p className="text-gray-500 text-sm">
                  Map Size: {lobby.lobby.mapSize} ({lobby.lobby.width}x
                  {lobby.lobby.height})
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => navigate(`/lobby/${lobby._id}`)}
                  className="px-4 py-2 rounded-md transition-colors duration-200 flex items-center gap-2 bg-green-700 hover:bg-green-600"
                >
                  Join Lobby
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default LobbyList;
