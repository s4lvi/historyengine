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
// BuildArmyForm Component
// ====================
const BuildArmyForm = ({ actionModal, onRaiseArmy, setActionModal }) => {
  const [armySize, setArmySize] = React.useState("");
  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Raise Army</h2>
      <input
        type="number"
        value={armySize}
        onChange={(e) => setArmySize(e.target.value)}
        placeholder="Enter army size"
        className="border p-2 rounded mb-4 w-full"
      />
      <div className="flex justify-end space-x-2">
        <button
          onClick={() => setActionModal(null)}
          className="px-4 py-2 bg-gray-300 rounded"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            if (armySize && Number(armySize) > 0) {
              onRaiseArmy(Number(armySize));
              setActionModal(null);
            }
          }}
          className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded"
        >
          Raise Army
        </button>
      </div>
    </div>
  );
};

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

  // Assume config.buildCosts.cities is an object with structure types and their cost objects.
  const structureOptions = Object.entries(config.buildCosts.cities || {});

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
  onAttack,
  onSetExpandTarget,
  onRaiseArmy, // For raising an army
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
          {actionModal.type === "attack" && (
            <div>
              <h2 className="text-xl font-bold mb-4">Attack</h2>
              <p className="mb-4">Do you want to attack this territory?</p>
              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => setActionModal(null)}
                  className="px-4 py-2 bg-gray-300 rounded"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    onAttack(actionModal.x, actionModal.y);
                    setActionModal(null);
                  }}
                  className="px-4 py-2 bg-red-500 text-white rounded"
                >
                  Confirm
                </button>
              </div>
            </div>
          )}
          {actionModal.type === "setExpandTarget" && (
            <div>
              <h2 className="text-xl font-bold mb-4">Set Expand Target</h2>
              <p className="mb-4">
                Do you want to set this cell as your expansion target?
              </p>
              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => setActionModal(null)}
                  className="px-4 py-2 bg-gray-300 rounded"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    onSetExpandTarget(actionModal.x, actionModal.y);
                    setActionModal(null);
                  }}
                  className="px-4 py-2 bg-yellow-500 text-white rounded"
                >
                  Confirm
                </button>
              </div>
            </div>
          )}
          {actionModal.type === "buildArmy" && (
            <BuildArmyForm
              actionModal={actionModal}
              onRaiseArmy={onRaiseArmy}
              setActionModal={setActionModal}
            />
          )}
          {actionModal.type === "setAttackTargetArmy" && (
            <div>
              <h2 className="text-xl font-bold mb-4">Set Attack Target</h2>
              <p className="mb-4">
                Please click on the map to choose the target for army ID:{" "}
                {actionModal.armyId}.
              </p>
              <div className="flex justify-end">
                <button
                  onClick={() => setActionModal(null)}
                  className="px-4 py-2 bg-gray-300 rounded"
                >
                  Cancel
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
