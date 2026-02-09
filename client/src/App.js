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
import { FaDiscord, FaUserCircle } from "react-icons/fa";
import { AuthProvider } from "./context/AuthContext";
import { useAuth } from "./context/AuthContext";
import ProfileModal from "./components/ProfileModal";

const ProfileMenu = () => {
  const { user, profile, loginWithGoogle, logout } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [showProfileModal, setShowProfileModal] = React.useState(false);
  const displayName = profile?.displayName || user?.id || "Player";

  if (!user) {
    return (
      <button
        onClick={() => loginWithGoogle("/rooms")}
        className="bg-gray-900/80 hover:bg-gray-700 px-3 py-2 rounded-lg text-sm text-white border border-gray-700 shadow"
        aria-label="Sign in"
        title="Sign in"
      >
        <FaUserCircle className="text-xl" />
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="bg-gray-900/80 hover:bg-gray-700 px-3 py-2 rounded-lg text-sm text-white border border-gray-700 shadow"
        aria-label="Profile"
        title="Profile"
      >
        <FaUserCircle className="text-xl" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-48 rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-lg">
          <div className="text-xs text-gray-400">Signed in as</div>
          <div className="text-sm text-gray-200 mb-2 truncate">{displayName}</div>
          <button
            onClick={() => {
              setOpen(false);
              setShowProfileModal(true);
            }}
            className="w-full bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded text-sm text-white mb-2"
          >
            Edit Profile
          </button>
          <button
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="w-full bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded text-sm text-white"
          >
            Sign out
          </button>
        </div>
      )}
      <ProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
      />
    </div>
  );
};

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
      <div style={{ position: "fixed", top: 24, right: 24, zIndex: 1000 }}>
        <ProfileMenu />
      </div>
      <div className="bg-gray-900 w-full bg-opacity-75 relative">
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
      <div style={{ position: "fixed", top: 24, right: 24, zIndex: 1000 }}>
        <ProfileMenu />
      </div>
      <div className="bg-gray-900 w-full bg-opacity-75 relative">
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
        <p>&copy; 2025 annexi.io</p>
        <p
          className="cursor-pointer hover:text-gray-300"
          onClick={() => window.location.assign("https://discord.gg/6YRU8YP5q7")}
        >
          <FaDiscord />
        </p>
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
      <AuthProvider>
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
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
