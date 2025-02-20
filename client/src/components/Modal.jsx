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

const Modal = ({ actionModal, setActionModal }) => {
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
