import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const Header = ({ title }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const isMapView = location.pathname.startsWith('/map/');

  return (
    <div className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-7xl mx-auto">
        {/* Main header with logo and title */}
        <div className="px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            {/* Left section with logo and title */}
            <div className="flex items-center space-x-4">
              <button 
                onClick={() => navigate('/')}
                className="flex items-center space-x-3 hover:opacity-80 transition-opacity"
              >
                {/* Logo placeholder - replace src with your actual logo */}
                <img
                  src="/historyenginelogo.png"
                  alt="Logo"
                  className="w-20 h-20"
                />
                <h1 className="text-5xl font-bold text-gray-900 font-estonia">
                  History Engine
                </h1>
              </button>
            </div>

            {/* Right section with navigation/actions */}
            <div className="flex items-center space-x-4">
              {isMapView ?? (
                <div className="flex space-x-3">
                  <button
                    onClick={() => navigate('/')}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    ← Back to Maps
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Header;