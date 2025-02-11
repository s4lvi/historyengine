import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorMessage, LoadingSpinner } from './ErrorHandling';

const CreateMapForm = ({ isOpen, onClose, onSubmit, isCreating }) => {
  const [formData, setFormData] = useState({
    name: '',
    width: 500,
    height: 500,
    erosion_passes: 3,
    num_blobs: 3
  });

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value } = e.target;
    const numValue = name === 'width' || name === 'height' ? parseInt(value, 10) : value;
    setFormData(prev => ({ ...prev, [name]: numValue }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
      <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        {/* Background overlay */}
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={onClose}></div>

        {/* Modal panel */}
        <div className="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
          <div className="sm:flex sm:items-start">
            <div className="mt-3 text-center sm:mt-0 sm:text-left w-full">
              <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                Create New Map
              </h3>
              <form onSubmit={handleSubmit} className="mt-4 space-y-4">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                    Map Name
                  </label>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="width" className="block text-sm font-medium text-gray-700">
                    Width (pixels)
                  </label>
                  <input
                    type="number"
                    id="width"
                    name="width"
                    min="100"
                    max="2000"
                    value={formData.width}
                    onChange={handleChange}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="height" className="block text-sm font-medium text-gray-700">
                    Height (pixels)
                  </label>
                  <input
                    type="number"
                    id="height"
                    name="height"
                    min="100"
                    max="2000"
                    value={formData.height}
                    onChange={handleChange}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="erosion_passes" className="block text-sm font-medium text-gray-700">
                    Erosion
                  </label>
                  <input
                    type="number"
                    id="erosion_passes"
                    name="erosion_passes"
                    min="0"
                    max="100"
                    value={formData.erosion_passes}
                    onChange={handleChange}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="num_blobs" className="block text-sm font-medium text-gray-700">
                    Number of Landmasses
                  </label>
                  <input
                    type="number"
                    id="num_blobs"
                    name="num_blobs"
                    min="1"
                    max="10"
                    value={formData.num_blobs}
                    onChange={handleChange}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="seed" className="block text-sm font-medium text-gray-700">
                    Random Seed
                  </label>
                  <input
                    type="number"
                    id="seed"
                    name="seed"
                    value={formData.seed}
                    onChange={handleChange}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                
                <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                  <button
                    type="submit"
                    disabled={isCreating}
                    className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm disabled:bg-blue-300"
                  >
                    {isCreating ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
                        Creating...
                      </>
                    ) : (
                      'Create Map'
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:w-auto sm:text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const MapList = () => {
  const [maps, setMaps] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [createError, setCreateError] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const navigate = useNavigate();

  const fetchMaps = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await fetch(`${process.env.REACT_APP_API_URL}/api/maps`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to fetch maps');
      }
      
      const data = await response.json();
      
      if (!Array.isArray(data)) {
        throw new Error('Invalid data received from server');
      }
      
      setMaps(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateMap = async (formData) => {
    if (isCreating) return;
    
    try {
      setIsCreating(true);
      setCreateError(null);
      
      const response = await fetch(`${process.env.REACT_APP_API_URL}/api/maps`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to create map');
      }
      
      const newMap = await response.json();
      
      if (!newMap._id) {
        throw new Error('Invalid response from server');
      }
      
      setIsCreateDialogOpen(false);
      navigate(`/map/${newMap._id}`);
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteMap = async (id) => {
    if (!window.confirm('Are you sure you want to delete this map?')) return;
    
    try {
      setIsDeleting(true);
      setDeleteError(null);
      
      const response = await fetch(`${process.env.REACT_APP_API_URL}/api/maps/${id}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to delete map');
      }
      
      await fetchMaps();
    } catch (err) {
      setDeleteError(`Failed to delete map: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    fetchMaps();
  }, []);

  if (isLoading && maps.length === 0) return <LoadingSpinner />;
  console.log(maps)
  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900">World Browser</h1>
        <button
          onClick={() => setIsCreateDialogOpen(true)}
          className="bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 
                   text-white px-6 py-2 rounded-lg transition-colors 
                   duration-200 font-medium shadow-sm"
        >
          Create New Map
        </button>
      </div>

      <CreateMapForm
        isOpen={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        onSubmit={handleCreateMap}
        isCreating={isCreating}
      />

      {error && (
        <ErrorMessage 
          message={error}
          onRetry={fetchMaps}
        />
      )}

      {createError && (
        <ErrorMessage 
          message={createError}
        />
      )}

      {deleteError && (
        <ErrorMessage 
          message={deleteError}
        />
      )}
      
      <div className="space-y-4">
        {maps.map((map) => (
          <div
            key={map._id}
            className="bg-white rounded-lg shadow-sm border border-gray-200 p-4
                     hover:shadow-md transition-shadow duration-200"
          >
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-semibold text-gray-800">{map.name}</h2>
                <p className="text-gray-500 text-sm mt-1">
                  Created: {new Date(map.createdAt).toLocaleDateString()}
                </p>
                <p className="text-gray-500 text-sm">
                  Size: {map.width}x{map.height} pixels
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => navigate(`/map/${map._id}`)}
                  className="bg-green-500 hover:bg-green-600 disabled:bg-green-300 
                           text-white px-4 py-2 rounded-md transition-colors duration-200
                           flex items-center gap-2"
                >
                  View
                </button>
                <button
                  onClick={() => handleDeleteMap(map._id)}
                  disabled={isDeleting}
                  className="bg-red-500 hover:bg-red-600 disabled:bg-red-300 
                           text-white px-4 py-2 rounded-md transition-colors duration-200
                           flex items-center gap-2"
                >
                  {isDeleting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                      <span>Deleting...</span>
                    </>
                  ) : (
                    'Delete'
                  )}
                </button>
              </div>
            </div>
          </div>
        ))}
        
        {maps.length === 0 && !isLoading && !error && (
          <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
            <p className="text-gray-500 text-lg mb-4">
              No maps yet. Create one to get started!
            </p>
            <button
              onClick={() => setIsCreateDialogOpen(true)}
              className="bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 
                       text-white px-6 py-2 rounded-lg transition-colors 
                       duration-200 font-medium shadow-sm flex items-center gap-2 mx-auto"
            >
              Create Your First Map
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default MapList;