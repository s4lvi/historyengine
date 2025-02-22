// Lobby.js
import React, { useState, useEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { ErrorMessage, LoadingSpinner } from "./ErrorHandling";

const Lobby = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { search } = useLocation();

  // Extract joincode from the URL query parameters
  const params = new URLSearchParams(search);
  const joinCodeFromQuery = params.get("joincode");

  const [lobby, setLobby] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const [joinForm, setJoinForm] = useState({
    userName: "",
    password: "",
    joinCode: joinCodeFromQuery || "",
  });
  const [joinError, setJoinError] = useState(null);
  const [isJoining, setIsJoining] = useState(false);

  const [settingsForm, setSettingsForm] = useState({
    roomName: "",
    mapSize: "Normal",
    maxPlayers: 4,
  });
  const [settingsUpdating, setSettingsUpdating] = useState(false);
  const [settingsError, setSettingsError] = useState(null);
  const [isStartingGame, setIsStartingGame] = useState(false);

  const localCreatorName = localStorage.getItem(`lobby-${id}-creator`);
  const localUserName = localStorage.getItem(`lobby-${id}-userName`);
  const localPassword = localStorage.getItem(`lobby-${id}-password`);

  const isJoined = (localCreatorName || localUserName) && localPassword;
  const isCreator = Boolean(localCreatorName);

  useEffect(() => {
    if (lobby && lobby.lobby) {
      setSettingsForm({
        roomName: lobby.roomName || "",
        mapSize: lobby.lobby.mapSize || "Normal",
        maxPlayers: lobby.lobby.maxPlayers || 4,
      });
    }
  }, [lobby]);

  useEffect(() => {
    let interval;
    const fetchLobbyDetails = async () => {
      try {
        const response = await fetch(
          `${process.env.REACT_APP_API_URL}api/gamerooms/${id}`
        );
        if (!response.ok) {
          setError("This game has started or the id is invalid");
        }
        const data = await response.json();
        setLobby((prev) =>
          JSON.stringify(prev) !== JSON.stringify(data) ? data : prev
        );
        if (isLoading) {
          setIsLoading(false);
        }
        if (data.status === "in-progress" || data.status === "paused") {
          navigate(`/rooms/${id}`);
        }
      } catch (err) {
        setError("This game has started or the id is invalid");
        setIsLoading(false);
      }
    };
    fetchLobbyDetails();
    interval = setInterval(fetchLobbyDetails, 2000);
    return () => clearInterval(interval);
  }, [id, navigate, isLoading]);

  // Update joinCode automatically if present in the URL
  useEffect(() => {
    if (joinCodeFromQuery && joinForm.joinCode !== joinCodeFromQuery) {
      setJoinForm((prev) => ({ ...prev, joinCode: joinCodeFromQuery }));
    }
  }, [joinCodeFromQuery, joinForm.joinCode]);

  const handleJoinChange = (e) => {
    const { name, value } = e.target;
    setJoinForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleStartGame = async () => {
    // Prevent duplicate clicks
    if (isStartingGame) return;
    setIsStartingGame(true);

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
      setIsStartingGame(false); // Reset so the user can try again if needed
    }
  };

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
            joinCode: joinForm.joinCode,
            userName: joinForm.userName,
            password: joinForm.password,
          }),
        }
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to join lobby");
      }
      localStorage.setItem(`lobby-${id}-userName`, joinForm.userName);
      localStorage.setItem(`lobby-${id}-password`, joinForm.password);
      setIsJoining(false);
    } catch (err) {
      setJoinError(err.message);
      setIsJoining(false);
    }
  };

  const handleSettingsChange = (e) => {
    const { name, value, type } = e.target;
    setSettingsForm((prev) => ({
      ...prev,
      [name]: type === "number" ? Number(value) : value,
    }));
  };

  // Converts the selected map size to width and height dimensions.
  const getDimensions = (size) => {
    switch (size) {
      case "Small":
        return { width: 100, height: 100 };
      case "Normal":
        return { width: 200, height: 200 };
      case "Large":
        return { width: 300, height: 300 };
      default:
        return { width: 200, height: 200 };
    }
  };

  // New function to update settings automatically (called on a debounced change)
  const updateSettings = async () => {
    setSettingsUpdating(true);
    setSettingsError(null);
    try {
      const creatorName = localCreatorName;
      const creatorPassword = localPassword;
      const dimensions = getDimensions(settingsForm.mapSize);
      const updatedSettings = { ...settingsForm, ...dimensions };
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/settings`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userName: creatorName,
            password: creatorPassword,
            lobby: updatedSettings,
          }),
        }
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to update lobby settings");
      }
      const data = await response.json();
      setLobby((prev) => ({ ...prev, lobby: data.lobby }));
    } catch (err) {
      setSettingsError(err.message);
    } finally {
      setSettingsUpdating(false);
    }
  };

  // Debounce updating settings when settingsForm changes (only for the creator)
  useEffect(() => {
    if (isCreator) {
      const timer = setTimeout(() => {
        updateSettings();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [settingsForm, isCreator]);

  // New function to close the lobby
  const handleCloseLobby = async () => {
    try {
      const creatorName = localCreatorName;
      const creatorPassword = localPassword;
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}api/gamerooms/${id}/end`,
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
        throw new Error(errorData.error || "Failed to close lobby");
      }
      navigate("/");
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
    return (
      <div className="min-h-screen bg-gray-800 text-white flex items-center justify-center p-4">
        <div className="bg-gray-900 bg-opacity-75 rounded-lg shadow-xl p-4 sm:p-8 w-full max-w-lg">
          <h2 className="text-2xl font-bold mb-4">This lobby is closed.</h2>
          <button
            type="submit"
            onClick={() => navigate("/")}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-800 text-white flex items-center justify-center p-4">
      <div className="bg-gray-900 bg-opacity-75 rounded-lg shadow-xl p-4 sm:p-8 w-full max-w-lg">
        <h2 className="text-2xl font-bold mb-4">
          Lobby: {lobby.roomName || "Lobby"}
        </h2>
        {isJoined && (
          <p className="mb-2">
            Join Code:{" "}
            <span className="font-mono bg-gray-700 px-2 py-1 rounded">
              {lobby.joinCode}
            </span>
          </p>
        )}
        <p className="mb-4">
          Players: {lobby.players?.length}/{lobby.lobby.maxPlayers}
        </p>

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

        {isJoined && (
          <>
            {isCreator && (
              <div className="mb-4">
                <h3 className="text-xl font-semibold mb-2">Lobby Settings</h3>
                <form className="space-y-4">
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
                  <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4">
                    <button
                      type="button"
                      onClick={handleCloseLobby}
                      className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded"
                    >
                      Close Lobby
                    </button>
                    <button
                      type="button"
                      onClick={handleStartGame}
                      disabled={isStartingGame}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded"
                    >
                      {isStartingGame ? "Starting..." : "Start Game"}
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
