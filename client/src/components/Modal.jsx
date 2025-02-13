import React from "react";

// A simple modal wrapper.
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

const BuildCityForm = ({ actionModal, onBuildCity, setActionModal }) => {
  const [cityName, setCityName] = React.useState("");
  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Build City</h2>
      <input
        type="text"
        value={cityName}
        onChange={(e) => setCityName(e.target.value)}
        placeholder="Enter city name"
        className="border p-2 rounded mb-4 w-full"
      />
      <div className="flex justify-end space-x-2">
        <button
          onClick={() => {
            setActionModal(null);
            setCityName("");
          }}
          className="px-4 py-2 bg-gray-300 rounded"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            onBuildCity(actionModal.x, actionModal.y, cityName);
            setActionModal(null);
            setCityName("");
          }}
          className="px-4 py-2 bg-green-500 text-white rounded"
        >
          Submit
        </button>
      </div>
    </div>
  );
};

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
        </ModalWrapper>
      )}
    </>
  );
};

export default Modal;
