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
  config,
  userState,
}) => {
  // Show login modal if either:
  // 1. Game is still loading (no config) and showLoginModal is true
  // 2. No userState exists and showLoginModal is true
  if (showLoginModal && (!config || !userState)) {
    return (
      <ModalWrapper onClose={() => {}}>
        <h2 className="text-xl font-semibold mb-4 text-center">Join Game</h2>
        <form onSubmit={onLoginSubmit}>
          <div className="mb-3">
            <label className="block text-sm font-medium mb-1">User Name</label>
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
            <label className="block text-sm font-medium mb-1">Join Code</label>
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
    );
  }

  // Always show action modals when they exist, regardless of other conditions
  if (actionModal) {
    return (
      <ModalWrapper onClose={() => setActionModal(null)}>
        {actionModal.type === "defeat" && (
          <div>
            <h2 className="text-xl font-bold mb-4">Nation Defeated</h2>
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
        {actionModal.type === "win" && (
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
    );
  }

  return null;
};

export default Modal;
