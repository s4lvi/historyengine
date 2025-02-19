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

      <footer className="w-full bg-gray-900 text-center p-4 text-white flex flex-row justify-between px-12">
        <p>&copy; 2025 annexi.io</p>{" "}
        <p
          className="cursor-pointer hover:text-gray-300"
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

      <main className="flex-grow flex items-center justify-center ">
        <div className="bg-gray-900 text-white bg-opacity-75 rounded-lg shadow-xl p-8 m-4 w-full max-w-4xl"></div>
      </main>

      <footer className="w-full bg-gray-900 text-center p-4 text-white flex flex-row justify-between px-12">
        <p>&copy; 2025 annexi.io</p>{" "}
        <p
          className="cursor-pointer hover:text-gray-300"
          onClick={() => navigate("/how-to-play")}
        >
          How to play
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
              <Route path="/how-to-play" element={<HowToPlay />} />
            </Routes>
          </main>
        </div>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
