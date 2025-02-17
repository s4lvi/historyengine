import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import WorldMap from "./components/WorldMap";
import WorldMap3D from "./components/WorldMap3d";
import Game from "./components/Game";
import MapList from "./components/MapList";
import GameRoomList from "./components/GameRoomList";
import Header from "./components/Header";
import { ErrorBoundary } from "./components/ErrorHandling";

const LandingPage = () => {
  return (
    <div
      className="min-h-screen flex flex-col bg-cover bg-center"
      style={{
        backgroundImage: "url('/background.png')",
        imageRendering: "pixelated",
        imageRendering: "crisp-edges",
      }} // update with your background image URL
    >
      {/* Banner Header */}
      <header
        className="w-full py-4 bg-cover bg-center bg-gray-900 bg-opacity-75 landing"
        style={{
          backgroundImage: "url('/b ackground.png')",
        }} // update with your banner background image URL
      >
        <div className="container mx-auto px-4">
          <h1 className="text-white text-4xl font-bold">ANNEXI.IO</h1>
        </div>
      </header>

      {/* Main Content: Centered Game Room List Card */}
      <main className="flex-grow flex items-center justify-center">
        <div className="bg-gray-900 text-white bg-opacity-75 rounded-lg shadow-xl p-8 m-4 w-full max-w-4xl">
          <GameRoomList />
        </div>
      </main>
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
            </Routes>
          </main>
        </div>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
