import React from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useNavigate,
} from "react-router-dom";
import Game from "./components/Game";
import GameRoomList from "./components/GameRoomList";
import { ErrorBoundary } from "./components/ErrorHandling";
import { FaDiscord } from "react-icons/fa";
import Lobby from "./components/Lobby";

const LandingPage = () => {
  const navigate = useNavigate();
  return (
    <div
      className="min-h-screen flex flex-col bg-cover bg-center"
      style={{
        backgroundImage: "url('/background.png')",
        imageRendering: "pixelated",
        imageRendering: "crisp-edges",
      }} // update with your background image URL
    >
      <div className=" bg-gray-900 w-full bg-opacity-75">
        <img
          src="annexilogo.png"
          alt="Annexi Logo"
          className="w-128 mx-auto"
          onClick={() => navigate("/")}
        />
      </div>

      {/* Main Content: Centered Game Room List Card */}
      <main className="flex-grow flex items-center justify-center ">
        <div className="bg-gray-900 text-white bg-opacity-75 rounded-lg shadow-xl p-8 m-4 w-full max-w-4xl">
          <GameRoomList />
        </div>
      </main>

      <footer className="w-full bg-gray-900 text-center p-4 text-white flex flex-row justify-between items-center px-12">
        <p>&copy; 2025 annexi.io</p>

        <a
          className="cursor-pointer hover:text-gray-300"
          href="https://discord.gg/6YRU8YP5q7"
        >
          <FaDiscord />
        </a>
        <p
          className="cursor-pointer hover:text-gray-300 w-32"
          onClick={() => navigate("/how-to-play")}
        >
          How to play
        </p>
      </footer>
    </div>
  );
};

const HowToPlay = () => {
  const navigate = useNavigate();
  return (
    <div
      className="min-h-screen flex flex-col bg-cover bg-center"
      style={{
        backgroundImage: "url('/background.png')",
        imageRendering: "pixelated",
        imageRendering: "crisp-edges",
      }} // update with your background image URL
    >
      <div className=" bg-gray-900 w-full bg-opacity-75">
        <img
          src="annexilogo.png"
          alt="Annexi Logo"
          className="w-128 mx-auto"
          onClick={() => navigate("/")}
        />
      </div>

      <main className="flex-grow flex items-center justify-center">
        <div className="bg-gray-900 text-white bg-opacity-75 rounded-lg shadow-xl p-8 m-4 w-full max-w-4xl">
          <h1 className="text-3xl font-bold mb-8 text-center">How to Play</h1>

          <div className="space-y-6">
            <div className="p-4 border border-gray-700 rounded-lg hover:bg-gray-800 transition-colors duration-200">
              <h2 className="text-xl font-semibold mb-2 text-blue-400">
                Victory Condition
              </h2>
              <p className="text-lg">
                Win by conquering 75% of the world's territory.
              </p>
            </div>

            <div className="p-4 border border-gray-700 rounded-lg hover:bg-gray-800 transition-colors duration-200">
              <h2 className="text-xl font-semibold mb-2 text-green-400">
                Territory Expansion
              </h2>
              <p className="text-lg">Expand by placing towns.</p>
            </div>

            <div className="p-4 border border-gray-700 rounded-lg hover:bg-gray-800 transition-colors duration-200">
              <h2 className="text-xl font-semibold mb-2 text-yellow-400">
                Resource Management
              </h2>
              <p className="text-lg">Build towns with wood, stone, and food.</p>
              <p className="text-lg mt-2">
                Acquire resources by placing structures on resource nodes.
              </p>
            </div>

            <div className="p-4 border border-gray-700 rounded-lg hover:bg-gray-800 transition-colors duration-200">
              <h2 className="text-xl font-semibold mb-2 text-red-400">
                Military Strategy
              </h2>
              <p className="text-lg">
                Cut off enemy territory by building and sending armies.
              </p>
              <p className="text-lg mt-2">
                Defeat enemy nations by eliminating the territory under their
                capital.
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="w-full bg-gray-900 text-center p-4 text-white flex flex-row justify-between items-center px-12">
        <p>&copy; 2025 annexi.io</p>
        <p
          className="cursor-pointer hover:text-gray-300"
          onClick={() => window.location("https://discord.gg/6YRU8YP5q7")}
        >
          <FaDiscord />
        </p>
        <p
          className="cursor-pointer hover:text-gray-300 w-32"
          onClick={() => navigate("/rooms")}
        >
          Back to rooms.
        </p>
      </footer>
    </div>
  );
};

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <div className="App min-h-screen bg-gray-50">
          {/* <Header /> */}
          <main className="pb-12 max-w-7xl mx-auto ">
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/rooms" element={<LandingPage />} />
              <Route path="/rooms/:id" element={<Game />} />
              <Route path="/lobby/:id" element={<Lobby />} />
              <Route path="/how-to-play" element={<HowToPlay />} />
            </Routes>
          </main>
        </div>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
