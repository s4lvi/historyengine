import React from "react";
import {
  BrowserRouter as Router,
  NavLink,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import {
  FaDiscord,
  FaInfoCircle,
  FaNewspaper,
  FaUserCircle,
} from "react-icons/fa";
import Game from "./components/Game";
import GameRoomList from "./components/GameRoomList";
import { ErrorBoundary } from "./components/ErrorHandling";
import ProfileModal from "./components/ProfileModal";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { isDiscordActivity } from "./utils/discord";
import DiscordActivity from "./components/DiscordActivity";

const RELEASE_NOTES = [
  {
    version: "v0.9.0",
    date: "February 2026",
    items: [
      "Lobby UI refreshed with dedicated About and News sections.",
      "How to Play now has clearer sectioning and structure.",
      "Navigation is unified across all non-match pages.",
    ],
  },
  {
    version: "v0.8.2",
    date: "January 2026",
    items: [
      "Added profile editing and persistent display names.",
      "Improved room creation reliability for generated maps.",
      "Reduced join flow friction with clearer room metadata.",
    ],
  },
];

const COMMUNITY_NEWS = [
  {
    date: "February 10, 2026",
    title: "Community Match Night",
    summary:
      "Join the official Discord this weekend for coordinated multi-room matches and feedback sessions.",
  },
  {
    date: "February 3, 2026",
    title: "Balance Feedback Window",
    summary:
      "The team is reviewing combat pacing and expansion pressure in larger maps.",
  },
  {
    date: "January 28, 2026",
    title: "Creator Spotlight",
    summary:
      "Top players are sharing strategy guides and map control breakdowns in Discord.",
  },
];

const pageStyle = {
  backgroundImage: "url('/background.png')",
  backgroundColor: "#0b1320",
};

const overlayTintStyle = {
  backgroundColor: "rgba(2, 6, 23, 0.84)",
};

const chromeSurfaceStyle = {
  backgroundColor: "rgba(2, 6, 23, 0.92)",
};

const panelSurfaceStyle = {
  backgroundColor: "rgba(17, 24, 39, 0.92)",
};

const panelInnerStyle = {
  backgroundColor: "rgba(17, 24, 39, 0.78)",
};

const heroSurfaceStyle = {
  background:
    "linear-gradient(90deg, rgba(2, 6, 23, 0.94), rgba(15, 23, 42, 0.9), rgba(2, 6, 23, 0.94))",
};

const navLinkClassName = ({ isActive }) =>
  `px-3 py-2 rounded-md text-sm font-medium tracking-wide transition-colors ${
    isActive
      ? "bg-yellow-500 text-gray-900"
      : "text-gray-200 hover:text-white hover:bg-gray-800"
  }`;

const ProfileMenu = () => {
  const { user, profile, loading, loginWithGoogle, logout } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [showProfileModal, setShowProfileModal] = React.useState(false);
  const displayName = profile?.displayName || user?.id || "Player";

  if (loading) {
    return (
      <div
        className="rounded-md bg-gray-900 px-3 py-2 text-xs text-gray-300"
        style={panelInnerStyle}
      >
        Loading...
      </div>
    );
  }

  if (!user) {
    return (
      <button
        onClick={() => loginWithGoogle("/rooms")}
        className="flex items-center gap-2 rounded-md bg-gray-900 px-3 py-2 text-sm text-white hover:bg-gray-800"
        style={panelInnerStyle}
        aria-label="Sign in"
        title="Sign in"
      >
        <FaUserCircle className="text-lg" />
        <span>Sign in</span>
      </button>
    );
  }

  return (
    <div className="relative z-50">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded-md bg-gray-900 px-3 py-2 text-sm text-white hover:bg-gray-800"
        style={panelInnerStyle}
        aria-label="Profile"
        title="Profile"
      >
        <FaUserCircle className="text-lg" />
        <span className="max-w-28 truncate">{displayName}</span>
      </button>
      {open && (
        <div
          className="absolute right-0 z-50 mt-2 w-56 rounded-lg bg-gray-900 p-3 shadow-lg"
          style={panelSurfaceStyle}
        >
          <div className="text-xs text-gray-400">Signed in as</div>
          <div className="mb-2 truncate text-sm text-gray-200">
            {displayName}
          </div>
          <button
            onClick={() => {
              setOpen(false);
              setShowProfileModal(true);
            }}
            className="mb-2 w-full rounded bg-gray-800 px-3 py-2 text-left text-sm text-white hover:bg-gray-700"
          >
            Edit Profile
          </button>
          <button
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="w-full rounded bg-gray-800 px-3 py-2 text-left text-sm text-white hover:bg-gray-700"
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

const AppShell = ({ children }) => {
  const navigate = useNavigate();

  return (
    <div
      className="relative h-screen min-h-0 flex flex-col bg-cover bg-center text-white"
      style={pageStyle}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-black"
        style={overlayTintStyle}
      />
      <header
        className="relative z-30 overflow-visible bg-gray-900"
        style={chromeSurfaceStyle}
      >
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <button
            onClick={() => navigate("/rooms")}
            className="flex items-center gap-3"
            aria-label="Go to rooms"
          >
            <img
              src="annexilogo.png"
              alt="Annexi Logo"
              className="-my-4 h-20 w-auto"
            />
          </button>

          <nav className="flex flex-wrap items-center gap-1 sm:gap-2">
            <NavLink to="/rooms" className={navLinkClassName}>
              Rooms
            </NavLink>
            <NavLink to="/how-to-play" className={navLinkClassName}>
              How to Play
            </NavLink>
            <NavLink to="/about" className={navLinkClassName}>
              About
            </NavLink>
            <NavLink to="/news" className={navLinkClassName}>
              News
            </NavLink>
            <a
              href="https://discord.gg/6YRU8YP5q7"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium tracking-wide text-gray-200 transition-colors hover:bg-gray-800 hover:text-white"
            >
              <FaDiscord />
              Discord
            </a>
          </nav>

          <div className="ml-auto">
            <ProfileMenu />
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1 min-h-0 overflow-y-auto scrollbar-panel">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
          {children}
        </div>
      </main>

      <footer className="relative z-10 bg-gray-900" style={chromeSurfaceStyle}>
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-gray-300 sm:px-6">
          <p>&copy; 2026 annexi.io</p>
          <div className="flex items-center gap-4">
            <a
              href="https://discord.gg/6YRU8YP5q7"
              target="_blank"
              rel="noreferrer"
              className="hover:text-white"
            >
              Discord
            </a>
            <NavLink to="/about" className="hover:text-white">
              About
            </NavLink>
            <NavLink to="/news" className="hover:text-white">
              Release Notes & News
            </NavLink>
            <NavLink to="/terms" className="hover:text-white">
              Terms
            </NavLink>
            <NavLink to="/privacy" className="hover:text-white">
              Privacy
            </NavLink>
          </div>
        </div>
      </footer>
    </div>
  );
};

const Card = ({ title, icon, children }) => (
  <section
    className="rounded-lg bg-gray-900 p-5 shadow-xl"
    style={panelSurfaceStyle}
  >
    {(title || icon) && (
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="text-xl font-semibold text-white">{title}</h2>
      </div>
    )}
    {children}
  </section>
);

const ReleaseNotesBlock = ({ limit }) => {
  const notes = limit ? RELEASE_NOTES.slice(0, limit) : RELEASE_NOTES;
  return (
    <div className="space-y-4">
      {notes.map((note) => (
        <article
          key={`${note.version}-${note.date}`}
          className="rounded-lg bg-gray-900 p-4"
          style={panelInnerStyle}
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold">{note.version}</h3>
            <span className="text-xs text-gray-400">{note.date}</span>
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-200">
            {note.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
};

const NewsBlock = ({ limit }) => {
  const items = limit ? COMMUNITY_NEWS.slice(0, limit) : COMMUNITY_NEWS;
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <article
          key={`${item.date}-${item.title}`}
          className="rounded-lg bg-gray-900 p-4"
          style={panelInnerStyle}
        >
          <div className="text-xs text-gray-400">{item.date}</div>
          <h3 className="mt-1 text-base font-semibold">{item.title}</h3>
          <p className="mt-2 text-sm text-gray-200">{item.summary}</p>
        </article>
      ))}
    </div>
  );
};

const HomePage = () => (
  <AppShell>
    <div className="grid gap-5 lg:grid-cols-3">
      <section
        className="rounded-lg bg-gray-900 shadow-xl lg:col-span-2"
        style={panelSurfaceStyle}
      >
        <GameRoomList />
      </section>

      <aside className="space-y-6 lg:col-span-1">
        <Card
          title="About Annexi.io"
          icon={<FaInfoCircle className="text-blue-300" />}
        >
          <p className="text-sm leading-relaxed text-gray-100">
            Annexi is a territory control game focused on expansion pressure,
            defensive structure placement, and timing troop commitments. Wins
            come from map control, not just fights.
          </p>
          <NavLink
            to="/about"
            className="mt-3 inline-flex rounded-md bg-gray-800 px-3 py-2 text-sm text-white hover:bg-gray-700"
          >
            Read full overview
          </NavLink>
        </Card>

        <Card
          title="Release Notes"
          icon={<FaNewspaper className="text-blue-300" />}
        >
          <ReleaseNotesBlock limit={1} />
          <NavLink
            to="/news"
            className="mt-3 inline-flex rounded-md bg-gray-800 px-3 py-2 text-sm text-white hover:bg-gray-700"
          >
            View all notes
          </NavLink>
        </Card>

        <Card
          title="Community News"
          icon={<FaDiscord className="text-blue-300" />}
        >
          <NewsBlock limit={2} />
          <a
            href="https://discord.gg/6YRU8YP5q7"
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex rounded-md bg-yellow-500 px-3 py-2 text-sm font-medium text-gray-900 hover:bg-yellow-400"
          >
            Join Discord
          </a>
        </Card>
      </aside>
    </div>
  </AppShell>
);

const HowToPlayPage = () => (
  <AppShell>
    <Card title="How to Play">
      <div className="space-y-6 text-sm leading-relaxed text-gray-200">
        <section>
          <h3 className="text-lg font-semibold text-white">Getting Started</h3>
          <p className="mt-2">
            Join or create a room, then click the map to found your nation. Your
            first placement becomes your capital. If your capital falls and no
            town can be promoted, your run ends.
          </p>
        </section>

        <section>
          <h3 className="text-lg font-semibold text-white">
            Expansion and Combat
          </h3>
          <p className="mt-2">
            Draw arrows to push troops into neutral or enemy tiles. Territory
            also grows passively through diffusion. Combat resolves
            automatically when fronts collide, with defenders benefiting from
            structures and terrain.
          </p>
        </section>

        <section>
          <h3 className="text-lg font-semibold text-white">
            Resources and Structures
          </h3>
          <p className="mt-2">
            Control map nodes to generate food, wood, stone, iron, and gold.
            Spend those resources on towns, towers, and forts to boost growth
            and hold lines.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-300">
                  <th className="py-2 pr-4">Structure</th>
                  <th className="py-2 pr-4">Cost</th>
                  <th className="py-2">Effect</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-800">
                  <td className="py-2 pr-4">Town</td>
                  <td className="py-2 pr-4">400 wood, 200 stone, 1000 food</td>
                  <td className="py-2">
                    Raises max population and can replace a lost capital.
                  </td>
                </tr>
                <tr className="border-b border-gray-800">
                  <td className="py-2 pr-4">Tower</td>
                  <td className="py-2 pr-4">500 stone, 200 wood</td>
                  <td className="py-2">Projects a large defensive aura.</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Fort</td>
                  <td className="py-2 pr-4">2000 stone, 500 wood, 300 food</td>
                  <td className="py-2">Provides very strong local defense.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="text-lg font-semibold text-white">Win Condition</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Control 75% of land territory to win the match.</li>
            <li>Encirclement can instantly claim isolated enemy pockets.</li>
            <li>
              Avoid overcommitting troops or your core can collapse quickly.
            </li>
          </ul>
        </section>
      </div>
    </Card>
  </AppShell>
);

const AboutPage = () => (
  <AppShell>
    <Card title="About">
      <div className="space-y-4 text-sm leading-relaxed text-gray-200">
        <p>
          Annexi is a multiplayer strategy sandbox centered on map pressure and
          territorial momentum. Every match asks you to balance expansion,
          defense, and population survival.
        </p>
        <p>
          Players direct movement through drawn front-line arrows while passive
          influence spreads into nearby neutral land. The interaction between
          active aggression and passive control creates most of the strategic
          depth.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Real-time multiplayer rooms with custom map generation.</li>
          <li>Resource economy with structure-driven defense layers.</li>
          <li>
            Capital loss, town promotion, and refounding rules for comeback
            dynamics.
          </li>
        </ul>
      </div>
    </Card>
  </AppShell>
);

const NewsPage = () => (
  <AppShell>
    <div className="space-y-6">
      <Card title="Release Notes">
        <ReleaseNotesBlock />
      </Card>
      <Card title="Community News">
        <NewsBlock />
      </Card>
    </div>
  </AppShell>
);

const TermsPage = () => (
  <AppShell>
    <Card title="Terms of Service">
      <div className="space-y-4 text-sm leading-relaxed text-gray-200">
        <p className="text-xs text-gray-400">Last updated: February 12, 2026</p>

        <section>
          <h3 className="text-lg font-semibold text-white">1. Acceptance of Terms</h3>
          <p className="mt-2">
            By accessing or using annexi.io ("the Service"), you agree to be bound by
            these Terms of Service. If you do not agree to these terms, do not use the
            Service.
          </p>
        </section>

        <section>
          <h3 className="text-lg font-semibold text-white">2. Description of Service</h3>
          <p className="mt-2">
            Annexi.io is a free-to-play multiplayer browser-based strategy game. We
            provide the game client, matchmaking servers, and related services. The
            Service is provided "as is" and may change at any time without notice.
          </p>
        </section>

        <section>
          <h3 className="text-lg font-semibold text-white">3. User Accounts</h3>
          <p className="mt-2">
            You may sign in using a third-party authentication provider (e.g. Google
            or Discord). You are responsible for maintaining the security of your
            account. You must not share your account or impersonate other users.
          </p>
        </section>

        <section>
          <h3 className="text-lg font-semibold text-white">4. User Conduct</h3>
          <p className="mt-2">You agree not to:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Use cheats, exploits, bots, or automation tools.</li>
            <li>Harass, threaten, or abuse other players.</li>
            <li>Attempt to disrupt, overload, or interfere with the Service.</li>
            <li>Reverse-engineer or scrape any part of the Service.</li>
          </ul>
          <p className="mt-2">
            We reserve the right to suspend or terminate accounts that violate these
            rules at our sole discretion.
          </p>
        </section>

        <section>
          <h3 className="text-lg font-semibold text-white">5. Intellectual Property</h3>
          <p className="mt-2">
            All content, graphics, code, and game mechanics are owned by the annexi.io
            team. You may not reproduce, distribute, or create derivative works from
            any part of the Service without written permission.
          </p>
        </section>

        <section>
          <h3 className="text-lg font-semibold text-white">6. Disclaimer of Warranties</h3>
          <p className="mt-2">
            The Service is provided "as is" without warranty of any kind, express or
            implied, including but not limited to warranties of merchantability,
            fitness for a particular purpose, or non-infringement. We do not guarantee
            uninterrupted or error-free operation.
          </p>
        </section>

        <section>
          <h3 className="text-lg font-semibold text-white">7. Limitation of Liability</h3>
          <p className="mt-2">
            To the fullest extent permitted by law, annexi.io and its operators shall
            not be liable for any indirect, incidental, special, consequential, or
            punitive damages arising from your use of the Service.
          </p>
        </section>

        <section>
          <h3 className="text-lg font-semibold text-white">8. Changes to Terms</h3>
          <p className="mt-2">
            We may update these Terms at any time. Continued use of the Service after
            changes constitutes acceptance of the revised Terms. Material changes will
            be communicated through the Service or our Discord server.
          </p>
        </section>

        <section>
          <h3 className="text-lg font-semibold text-white">9. Contact</h3>
          <p className="mt-2">
            Questions about these Terms can be directed to us through our{" "}
            <a
              href="https://discord.gg/6YRU8YP5q7"
              target="_blank"
              rel="noreferrer"
              className="text-yellow-400 hover:text-yellow-300 underline"
            >
              Discord server
            </a>
            .
          </p>
        </section>
      </div>
    </Card>
  </AppShell>
);

const PrivacyPage = () => (
  <AppShell>
    <Card title="Privacy Policy">
      <div className="space-y-4 text-sm leading-relaxed text-gray-200">
        <p className="text-xs text-gray-400">Last updated: February 12, 2026</p>

        <section>
          <h3 className="text-lg font-semibold text-white">1. Information We Collect</h3>
          <p className="mt-2">When you use annexi.io, we may collect:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong>Account information:</strong> Display name and authentication
              identifiers provided by your sign-in provider (Google or Discord). We do
              not store your password.
            </li>
            <li>
              <strong>Game data:</strong> In-game actions, match history, and room
              participation for gameplay functionality.
            </li>
            <li>
              <strong>Technical data:</strong> Browser type, connection timestamps, and
              basic server logs for maintaining service reliability.
            </li>
          </ul>
        </section>

        <section>
          <h3 className="text-lg font-semibold text-white">2. How We Use Your Information</h3>
          <p className="mt-2">We use collected information to:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Provide, operate, and maintain the game service.</li>
            <li>Display your chosen display name to other players.</li>
            <li>Enforce our Terms of Service and prevent abuse.</li>
            <li>Improve game performance and fix bugs.</li>
          </ul>
          <p className="mt-2">
            We do not sell, rent, or share your personal information with third parties
            for marketing purposes.
          </p>
        </section>

        <section>
          <h3 className="text-lg font-semibold text-white">3. Cookies and Local Storage</h3>
          <p className="mt-2">
            We use browser cookies and local storage to maintain your authentication
            session and game preferences. These are essential for the Service to
            function and are not used for tracking or advertising.
          </p>
        </section>

        <section>
          <h3 className="text-lg font-semibold text-white">4. Third-Party Services</h3>
          <p className="mt-2">
            We use third-party authentication providers (Google, Discord) for sign-in.
            Their use of your data is governed by their respective privacy policies. We
            only receive the minimal profile information needed to identify your
            account.
          </p>
        </section>

        <section>
          <h3 className="text-lg font-semibold text-white">5. Data Retention</h3>
          <p className="mt-2">
            We retain your account data for as long as your account is active. Game
            match data may be retained for analysis and improvement. You may request
            deletion of your account data by contacting us through Discord.
          </p>
        </section>

        <section>
          <h3 className="text-lg font-semibold text-white">6. Data Security</h3>
          <p className="mt-2">
            We take reasonable measures to protect your information, including encrypted
            connections (HTTPS) and secure authentication flows. However, no method of
            transmission over the internet is 100% secure.
          </p>
        </section>

        <section>
          <h3 className="text-lg font-semibold text-white">7. Children's Privacy</h3>
          <p className="mt-2">
            The Service is not directed at children under 13. We do not knowingly
            collect personal information from children under 13. If you believe a child
            has provided us with personal information, please contact us so we can
            delete it.
          </p>
        </section>

        <section>
          <h3 className="text-lg font-semibold text-white">8. Changes to This Policy</h3>
          <p className="mt-2">
            We may update this Privacy Policy from time to time. Changes will be posted
            on this page with an updated revision date. Continued use of the Service
            constitutes acceptance of the revised policy.
          </p>
        </section>

        <section>
          <h3 className="text-lg font-semibold text-white">9. Contact</h3>
          <p className="mt-2">
            For privacy-related questions or data deletion requests, reach out through
            our{" "}
            <a
              href="https://discord.gg/6YRU8YP5q7"
              target="_blank"
              rel="noreferrer"
              className="text-yellow-400 hover:text-yellow-300 underline"
            >
              Discord server
            </a>
            .
          </p>
        </section>
      </div>
    </Card>
  </AppShell>
);

function App() {
  // In Discord Activity mode, skip the router and render the Discord entry point directly
  if (isDiscordActivity()) {
    return (
      <ErrorBoundary>
        <AuthProvider>
          <DiscordActivity />
        </AuthProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <AuthProvider>
        <Router>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/rooms" element={<HomePage />} />
            <Route path="/how-to-play" element={<HowToPlayPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/news" element={<NewsPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/rooms/:id" element={<Game />} />
          </Routes>
        </Router>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
