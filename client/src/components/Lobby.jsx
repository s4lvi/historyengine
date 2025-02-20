import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ErrorMessage, LoadingSpinner } from "./ErrorHandling";

const Lobby = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  // State for lobby details from backend
  const [lobby, setLobby] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // State for join form (for non-creators)
  const [joinForm, setJoinForm] = useState({
    userName: "",
    password: "",
    joinCode: "",
  });
  const [joinError, setJoinError] = useState(null);
  const [isJoining, setIsJoining] = useState(false);

  // State for creator settings form
  const [settingsForm, setSettingsForm] = useState({
    roomName: "",
    mapSize: "Normal",
    maxPlayers: 4,
  });
  const [settingsUpdating, setSettingsUpdating] = useState(false);
  const [settingsError, setSettingsError] = useState(null);

  // Check local storage for credentials:
  const localCreatorName = localStorage.getItem(`lobby-${id}-creator`);
  const localUserName = localStorage.getItem(`lobby-${id}-userName`);
  const localPassword = localStorage.getItem(`lobby-${id}-password`);

  // Consider the user joined if either creator or regular user credentials exist.
  const isJoined = (localCreatorName || localUserName) && localPassword;
  // The user is the creator if their creator credentials exist.
  const isCreator = Boolean(localCreatorName);

  // When lobby data is fetched, update settingsForm from the lobby.lobby object.
  useEffect(() => {
    if (lobby && lobby.lobby) {
      setSettingsForm({
        roomName: lobby.roomName || "",
        mapSize: lobby.lobby.mapSize || "Normal",
        maxPlayers: lobby.lobby.maxPlayers || 4,
      });
    }
  }, [lobby]);

  // Poll for lobby details every 2 seconds.
  useEffect(() => {
    let interval;
    const fetchLobbyDetails = async () => {
      try {
        const response = await fetch(
          `${process.env.REACT_APP_API_URL}api/gamerooms/${id}`
        );
        if (!response.ok) {
          throw new Error("Failed to fetch lobby details");
        }
        const data = await response.json();
        setLobby((prev) =>
          JSON.stringify(prev) !== JSON.stringify(data) ? data : prev
        );
        if (isLoading) {
          setIsLoading(false);
        }
        // Redirect if lobby status becomes "in-progress"
        if (data.status === "in-progress") {
          navigate(`/rooms/${id}`);
        }
      } catch (err) {
        setError(err.message);
        setIsLoading(false);
      }
    };
    fetchLobbyDetails();
    interval = setInterval(fetchLobbyDetails, 2000);
    return () => clearInterval(interval);
  }, [id, navigate, isLoading]);

  // Handle join form changes.
  const handleJoinChange = (e) => {
    const { name, value } = e.target;
    setJoinForm((prev) => ({ ...prev, [name]: value }));
  };

  // Handle join form submission.
  const handleJoin = async (e) => {
    e.preventDefault();
    setIsJoining(true);
    setJoinError(null);
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/join`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            joinCode: joinForm.joinCode, // use the join code entered by the player
            userName: joinForm.userName,
            password: joinForm.password,
          }),
        }
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to join lobby");
      }
      // Save joined user credentials locally.
      localStorage.setItem(`lobby-${id}-userName`, joinForm.userName);
      localStorage.setItem(`lobby-${id}-password`, joinForm.password);
      setIsJoining(false);
    } catch (err) {
      setJoinError(err.message);
      setIsJoining(false);
    }
  };

  // Handle settings form changes (for creator).
  const handleSettingsChange = (e) => {
    const { name, value, type } = e.target;
    setSettingsForm((prev) => ({
      ...prev,
      [name]: type === "number" ? Number(value) : value,
    }));
  };

  // Handle settings form submission.
  const handleSettingsSubmit = async (e) => {
    e.preventDefault();
    setSettingsUpdating(true);
    setSettingsError(null);
    try {
      const creatorName = localCreatorName;
      const creatorPassword = localPassword;
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/settings`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userName: creatorName,
            password: creatorPassword,
            lobby: settingsForm,
          }),
        }
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to update lobby settings");
      }
      const data = await response.json();
      setLobby((prev) => ({ ...prev, lobby: data.lobby }));
      setSettingsUpdating(false);
    } catch (err) {
      setSettingsError(err.message);
      setSettingsUpdating(false);
    }
  };

  // Handle start game action for the creator.
  const handleStartGame = async () => {
    try {
      const creatorName = localCreatorName;
      const creatorPassword = localPassword;
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userName: creatorName,
            password: creatorPassword,
          }),
        }
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to start game");
      }
      navigate(`/rooms/${id}`);
    } catch (err) {
      alert(err.message);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <div className="min-h-screen bg-gray-800 text-white flex items-center justify-center p-4">
      <div className="bg-gray-900 bg-opacity-75 rounded-lg shadow-xl p-8 w-full max-w-2xl">
        <h2 className="text-2xl font-bold mb-4">
          Lobby: {lobby.roomName || "Lobby"}
        </h2>
        <p className="mb-2">
          Join Code:{" "}
          <span className="font-mono bg-gray-700 px-2 py-1 rounded">
            {lobby.joinCode}
          </span>
        </p>
        <p className="mb-4">
          Players: {lobby.players?.length}/{lobby.lobby.maxPlayers}
        </p>

        {/* For non-creators, show join form */}
        {!isJoined && !isCreator && (
          <div className="mb-4">
            <h3 className="text-xl font-semibold mb-2">Join Lobby</h3>
            <form onSubmit={handleJoin} className="space-y-4">
              <div>
                <label htmlFor="userName" className="block text-sm font-medium">
                  Your Name
                </label>
                <input
                  type="text"
                  name="userName"
                  id="userName"
                  value={joinForm.userName}
                  onChange={handleJoinChange}
                  className="mt-1 block w-full rounded-md border-gray-600 bg-gray-700 px-3 py-2"
                  required
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium">
                  Password
                </label>
                <input
                  type="password"
                  name="password"
                  id="password"
                  value={joinForm.password}
                  onChange={handleJoinChange}
                  className="mt-1 block w-full rounded-md border-gray-600 bg-gray-700 px-3 py-2"
                  required
                />
              </div>
              {/* Editable join code field for players */}
              <div>
                <label htmlFor="joinCode" className="block text-sm font-medium">
                  Join Code
                </label>
                <input
                  type="text"
                  name="joinCode"
                  id="joinCode"
                  value={joinForm.joinCode}
                  onChange={handleJoinChange}
                  placeholder="Enter join code"
                  className="mt-1 block w-full rounded-md border-gray-600 bg-gray-700 px-3 py-2"
                  required
                />
              </div>
              {joinError && <ErrorMessage message={joinError} />}
              <button
                type="submit"
                disabled={isJoining}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded"
              >
                {isJoining ? "Joining..." : "Join Lobby"}
              </button>
            </form>
          </div>
        )}

        {/* For users who are joined */}
        {isJoined && (
          <>
            {isCreator && (
              <div className="mb-4">
                <h3 className="text-xl font-semibold mb-2">Lobby Settings</h3>
                <form onSubmit={handleSettingsSubmit} className="space-y-4">
                  <div>
                    <label
                      htmlFor="roomName"
                      className="block text-sm font-medium"
                    >
                      Lobby Name
                    </label>
                    <input
                      type="text"
                      id="roomName"
                      name="roomName"
                      value={settingsForm.roomName}
                      onChange={handleSettingsChange}
                      className="mt-1 block w-full rounded-md border-gray-600 bg-gray-700 px-3 py-2"
                      required
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="mapSize"
                      className="block text-sm font-medium"
                    >
                      Map Size
                    </label>
                    <select
                      id="mapSize"
                      name="mapSize"
                      value={settingsForm.mapSize}
                      onChange={handleSettingsChange}
                      className="mt-1 block w-full rounded-md border-gray-600 bg-gray-700 px-3 py-2"
                      required
                    >
                      <option value="Small">Small</option>
                      <option value="Normal">Normal</option>
                      <option value="Large">Large</option>
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="maxPlayers"
                      className="block text-sm font-medium"
                    >
                      Max Players
                    </label>
                    <input
                      type="number"
                      id="maxPlayers"
                      name="maxPlayers"
                      value={settingsForm.maxPlayers}
                      onChange={handleSettingsChange}
                      className="mt-1 block w-full rounded-md border-gray-600 bg-gray-700 px-3 py-2"
                      required
                    />
                  </div>
                  {settingsError && <ErrorMessage message={settingsError} />}
                  <div className="flex space-x-4">
                    <button
                      type="submit"
                      disabled={settingsUpdating}
                      className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded"
                    >
                      {settingsUpdating ? "Updating..." : "Update Settings"}
                    </button>
                    <button
                      type="button"
                      onClick={handleStartGame}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded"
                    >
                      Start Game
                    </button>
                  </div>
                </form>
              </div>
            )}
            <div className="mt-6">
              <h3 className="text-xl font-semibold mb-2">Players</h3>
              <ul className="list-disc list-inside">
                {lobby.players?.map((player, index) => (
                  <li key={index}>{player.userId}</li>
                ))}
              </ul>
            </div>
            <p className="mt-4 text-green-400">
              {isCreator
                ? "You are the lobby creator. Waiting for you to start the game..."
                : "You have joined the lobby. Waiting for the creator to start the game..."}
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default Lobby;
