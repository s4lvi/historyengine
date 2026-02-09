// Modal.jsx
import React from "react";

// A simple modal wrapper component.
const ModalWrapper = ({ children, onClose }) => (
  <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
    <div className="bg-white p-6 rounded-lg shadow-lg relative">
      <button
        onClick={onClose}
        className="absolute top-0 right-0 m-2 text-xl font-bold"
      >
        &times;
      </button>
      {children}
    </div>
  </div>
);

// ====================
// BuildCityForm Component (example)
// ====================
const BuildCityForm = ({
  actionModal,
  onBuildCity,
  setActionModal,
  config,
  userState,
}) => {
  const [structureName, setStructureName] = React.useState("");

  // Fallback if config or userState is missing.
  if (!config || !userState) {
    return (
      <div className="p-4">
        <p>Loading build options...</p>
      </div>
    );
  }

  // Assume config.buildCosts.structures is an object with structure types and their cost objects.
  const structureOptions = Object.entries(config.buildCosts.structures || {});

  const canAfford = (cost) =>
    Object.entries(cost).every(
      ([resource, required]) => (userState.resources[resource] || 0) >= required
    );

  const displayCost = (cost) =>
    Object.entries(cost)
      .map(([resource, amount]) => `${amount} ${resource}`)
      .join(", ");

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Build City</h2>
      <input
        type="text"
        value={structureName}
        onChange={(e) => setStructureName(e.target.value)}
        placeholder="Enter city name"
        className="border p-2 rounded mb-4 w-full"
      />
      <div className="flex flex-col space-y-2">
        {structureOptions.map(([type, cost]) => {
          const affordable = canAfford(cost);
          return (
            <button
              key={type}
              onClick={() => {
                if (affordable) {
                  onBuildCity(
                    actionModal.x,
                    actionModal.y,
                    type,
                    structureName
                  );
                  setActionModal(null);
                  setStructureName("");
                }
              }}
              disabled={!affordable}
              className={`px-4 py-2 rounded ${
                affordable
                  ? "bg-green-500 hover:bg-green-600 text-white"
                  : "bg-gray-400 text-gray-200 cursor-not-allowed"
              }`}
            >
              Build {type.charAt(0).toUpperCase() + type.slice(1)} (Cost:{" "}
              {displayCost(cost)})
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ====================
// Main Modal Component
// ====================
const Modal = ({
  showLoginModal,
  onLoginSubmit,
  loginName,
  setLoginName,
  loginPassword,
  setLoginPassword,
  joinCode,
  setJoinCode,
  loginError,
  actionModal,
  setActionModal,
  onBuildCity,
  config,
  userState,
}) => {
  return (
    <>
      {showLoginModal && (
        <ModalWrapper onClose={() => {}}>
          <h2 className="text-xl font-semibold mb-4 text-center">Join Game</h2>
          <form onSubmit={onLoginSubmit}>
            <div className="mb-3">
              <label className="block text-sm font-medium mb-1">
                User Name
              </label>
              <input
                type="text"
                value={loginName}
                onChange={(e) => setLoginName(e.target.value)}
                required
                className="w-full border rounded p-2"
              />
            </div>
            <div className="mb-3">
              <label className="block text-sm font-medium mb-1">Password</label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
                className="w-full border rounded p-2"
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">
                Join Code
              </label>
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                required
                className="w-full border rounded p-2"
              />
            </div>
            {loginError && (
              <p className="text-red-500 text-sm mb-3">{loginError}</p>
            )}
            <button
              type="submit"
              className="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 rounded"
            >
              Join Game
            </button>
          </form>
        </ModalWrapper>
      )}

      {actionModal && (
        <ModalWrapper onClose={() => setActionModal(null)}>
          {actionModal.type === "buildCity" && (
            <BuildCityForm
              actionModal={actionModal}
              onBuildCity={onBuildCity}
              setActionModal={setActionModal}
              config={config}
              userState={userState}
            />
          )}
          {actionModal?.type === "defeat" && (
            <div>
              <h2 className="text-xl font-bold mb-4">Nation Defeated</h2>
              <p className="mb-4">{actionModal.message}</p>
              <div className="flex justify-end gap-2">
                {actionModal.onSpectate && (
                  <button
                    onClick={actionModal.onSpectate}
                    className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded"
                  >
                    Spectate
                  </button>
                )}
                {actionModal.onRefound && (
                  <button
                    onClick={actionModal.onRefound}
                    className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded"
                  >
                    Found New Nation
                  </button>
                )}
                {!actionModal.onSpectate && !actionModal.onRefound && (
                  <button
                    onClick={actionModal.onClose}
                    className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded"
                  >
                    Continue
                  </button>
                )}
              </div>
            </div>
          )}
          {actionModal?.type === "win" && (
            <div>
              <h2 className="text-xl font-bold mb-4">Victory!</h2>
              <p className="mb-4">{actionModal.message}</p>
              <div className="flex justify-end">
                <button
                  onClick={actionModal.onClose}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded"
                >
                  Continue
                </button>
              </div>
            </div>
          )}
        </ModalWrapper>
      )}
    </>
  );
};

export default Modal;
