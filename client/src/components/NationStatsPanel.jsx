import React, { useState } from 'react';

const NationStatsPanel = ({ gameState, userId }) => {
  const userNation = gameState?.gameState?.nations?.find(n => n.owner === userId);
  const [expandedGroups, setExpandedGroups] = useState({});
  
  if (!userNation) {
    return (
      <div className="bg-white p-4 rounded-lg shadow-lg">
        <h2 className="text-lg font-semibold mb-2">Nation Stats</h2>
        <p className="text-sm text-gray-500">Found a nation to view your stats</p>
      </div>
    );
  }

  const resourceGroups = {
    'Minerals': ['iron ore', 'precious metals', 'gems', 'stone', 'copper ore', 'salt'],
    'Food & Water': ['fresh water', 'fish', 'wild fruits', 'game animals', 'grazing animals'],
    'Agriculture': ['arable land', 'pastures', 'fertile soil'],
    'Flora & Fauna': ['medicinal plants', 'timber', 'date palm', 'fur animals', 'herbs']
  };

  const toggleGroup = (groupName) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupName]: !prev[groupName]
    }));
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow-lg">
      <h2 className="text-lg font-semibold mb-4">Nation Stats</h2>
      
      {/* Core Stats */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <div className="p-2 bg-blue-50 rounded">
          <p className="text-sm font-medium">Population</p>
          <p className="text-lg">{userNation.population.toLocaleString()}</p>
        </div>
        <div className="p-2 bg-blue-50 rounded">
          <p className="text-sm font-medium">National Will</p>
          <p className="text-lg">{userNation.nationalWill}</p>
        </div>
        <div className="p-2 bg-blue-50 rounded">
          <p className="text-sm font-medium">Territory</p>
          <p className="text-lg">{userNation.territory.length} tiles</p>
        </div>
        <div className="p-2 bg-blue-50 rounded">
          <p className="text-sm font-medium">Cities</p>
          <p className="text-lg">{userNation.cities.length}</p>
        </div>
      </div>
      {/* Resources */}
      <div className="space-y-2">
        {Object.entries(resourceGroups).map(([groupName, resources]) => {

          return (
            <div key={groupName} className="border rounded">
              <button 
                onClick={() => toggleGroup(groupName)}
                className="w-full text-left p-2 flex justify-between items-center bg-gray-50 hover:bg-gray-100"
              >
                <span className="font-medium">
                  {expandedGroups[groupName] ? '▼' : '▶'} {groupName}
                </span>
                <span className="text-sm text-gray-600">
                  {(resources.reduce((sum, r) => sum + (userNation.resources[r] || 0), 0)).toFixed(0)} total
                </span>
              </button>

              {expandedGroups[groupName] && (
                <div className="p-2 grid grid-cols-2 gap-2">
                  {resources.map(resource => {
                    if (userNation.resources[resource] === 0) return null;
                    return (
                      <div key={resource} className="p-2 bg-gray-50 rounded">
                        <p className="capitalize text-sm">{resource}</p>
                        <p className="font-medium">{userNation.resources[resource].toFixed(0)}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default NationStatsPanel;