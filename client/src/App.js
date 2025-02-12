import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import WorldMap from "./components/WorldMap";
import WorldMap3D from "./components/WorldMap3d";
import Game from "./components/Game";
import MapList from "./components/MapList";
import GameRoomList from "./components/GameRoomList";
import Header from "./components/Header";
import { ErrorBoundary } from "./components/ErrorHandling";

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <div className="App min-h-screen bg-gray-50">
          <Header />
          <main className="pt-6 pb-12 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <Routes>
              <Route path="/" element={<MapList />} />
              <Route path="/map/:id" element={<WorldMap />} />
              <Route path="/map/:id/3d" element={<WorldMap3D />} />

              <Route path="/rooms" element={<GameRoomList />} />
              <Route path="/rooms/:id" element={<Game />} />
            </Routes>
          </main>
        </div>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
