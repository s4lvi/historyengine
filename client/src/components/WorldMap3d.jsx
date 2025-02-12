// WorldMap3D.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Sky, Environment } from '@react-three/drei';
import * as THREE from 'three';
import WaterPlane from './WaterPlane';
const CHUNK_SIZE = 10;

const WorldMap3D = () => {
  const [mapMetadata, setMapMetadata] = useState(null);
  const [mapChunks, setMapChunks] = useState([]);
  const [mappings, setMappings] = useState(null);
  const [loadedRows, setLoadedRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { id } = useParams();
  const navigate = useNavigate();
  const isFetchingChunk = useRef(false);

  // ── Fetch Metadata ────────────────────────────────────────────────
  const fetchMapMetadata = async () => {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/maps/${id}/metadata`
      );
      if (!response.ok) throw new Error('Failed to fetch map metadata');
      const data = await response.json();
      setMapMetadata(data);
    } catch (err) {
      setError(err.message);
    }
  };

  // ── Fetch One Chunk ───────────────────────────────────────────────
  const fetchMapChunk = async (startRow) => {
    try {
      const endRow = startRow + CHUNK_SIZE;
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/maps/${id}/data?startRow=${startRow}&endRow=${endRow}`
      );
      if (!response.ok) throw new Error('Failed to fetch map chunk');
      const data = await response.json();
      if (data.mappings && !mappings) {
        setMappings(data.mappings);
      }
      return data;
    } catch (err) {
      throw err;
    }
  };

  // ── Load Metadata When ID Changes ───────────────────────────────
  useEffect(() => {
    if (id) {
      fetchMapMetadata();
    }
  }, [id]);

  // ── Load Chunks Sequentially ──────────────────────────────────────
  useEffect(() => {
    const loadNextChunk = async () => {
      if (
        !mapMetadata ||
        error ||
        loadedRows >= mapMetadata.height ||
        isFetchingChunk.current
      )
        return;

      isFetchingChunk.current = true;
      setLoading(true);
      try {
        const nextChunk = await fetchMapChunk(loadedRows);
        if (nextChunk && nextChunk.chunk && nextChunk.chunk.length > 0) {
          setMapChunks((prev) => [...prev, nextChunk.chunk]);
          setLoadedRows(nextChunk.endRow);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
        isFetchingChunk.current = false;
      }
    };

    loadNextChunk();
  }, [mapMetadata, loadedRows, error]);

  // ── Combine Loaded Chunks Into a Grid ──────────────────────────────
  const gridData = useMemo(() => {
    if (!mapChunks.length) return null;
    const grid = [];
    for (const chunk of mapChunks) {
      if (Array.isArray(chunk)) {
        for (const row of chunk) {
          grid.push(row);
        }
      }
    }
    return grid;
  }, [mapChunks]);

  // ── TerrainMesh: Creates a 3D mesh from the grid data ──────────────
  const TerrainMesh = ({ mapMetadata, gridData, mappings, renderMode = 'biome' }) => {

    
    const geometry = useMemo(() => {
      // Ensure that the grid data is complete.
      if (!mapMetadata || !gridData || gridData.length < mapMetadata.height) {
        return null;
      }
      const { width, height } = mapMetadata;
      const vertices = [];
      const indices = [];
      const colors = [];
      const size = 10; // Size of the terrain in scene units.

      // Loop over each cell to create vertices.
      for (let y = 0; y < height; y++) {
        // Guard against incomplete row data.
        if (!gridData[y] || gridData[y].length < width) continue;
        for (let x = 0; x < width; x++) {
          const cell = gridData[y][x];
          if (!cell) continue;
          // cell[0] is the elevation (normalized). Multiply by 2 for vertical displacement.
          const elevation = cell[0];
          // Map grid coordinates into a plane centered at (0,0).
          const posX = ((x / (width - 1)) - 0.5) * size;
          const posY = ((y / (height - 1)) - 0.5) * size;
          const posZ = elevation /5; // Vertical displacement.

          vertices.push(posX, posZ, posY);

          // Compute vertex color based on render mode.
          let color = new THREE.Color(0.8, 0.8, 0.8);
          if (renderMode === 'biome' && mappings) {
            const biomeName = mappings.biomes[cell[3]];
            const biomeColors = {
              OCEAN: "#1E90FF",
              COASTAL: "#ccc79d",
              MOUNTAIN: "#979e88",
              DESERT: "#e3bf9a",
              SAVANNAH: "#a5ba84",
              TROPICAL_FOREST: "#30801f",
              RAINFOREST: "#1b570d",
              TUNDRA: "#616e2d",
              TAIGA: "#406b5f",
              GRASSLAND: "#6a9c5f",
              WOODLAND: "#557a4d",
              FOREST: "#395c31",
              RIVER: "#1E90FF",
            };
            color = new THREE.Color(biomeColors[biomeName] || "#ccc");
          } else if (renderMode === 'heightmap') {
            const clampedH = Math.min(Math.max(cell[0], 0), 1);
            color = new THREE.Color(clampedH, clampedH, clampedH);
          } else if (renderMode === 'temperature') {
            const temp = cell[2];
            const normalizedTemp = (temp - (-20)) / (100 - (-20));
            const clampedTemp = Math.min(Math.max(normalizedTemp, 0), 1);
            let red, blue;
            if (clampedTemp < 0.5) {
              red = clampedTemp * 2;
              blue = 1;
            } else {
              red = 1;
              blue = 1 - (clampedTemp - 0.5) * 2;
            }
            color = new THREE.Color(red, 0, blue);
          }
          colors.push(color.r, color.g, color.b);
        }
      }

      // Build indices to form triangles for the terrain mesh.
      for (let y = 0; y < height - 1; y++) {
        for (let x = 0; x < width - 1; x++) {
          const a = y * width + x;
          const b = y * width + (x + 1);
          const c = (y + 1) * width + x;
          const d = (y + 1) * width + (x + 1);
          indices.push(a, b, d);
          indices.push(a, d, c);
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return geo;
    }, [mapMetadata, gridData, mappings, renderMode]);

    if (!geometry) return null;

    return (
      <mesh geometry={geometry} receiveShadow castShadow>
        <meshStandardMaterial vertexColors side={THREE.DoubleSide} />
      </mesh>
    );
  };

  const waterNormalizedLevel = 0.37;
  const waterElevation = waterNormalizedLevel / 5; // This will be the Y-coordinate.

  const loadingProgress = mapMetadata ? (loadedRows / mapMetadata.height) * 100 : 0;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header with navigation buttons */}
      <div className="flex justify-between items-center mb-4">
        <div className="flex gap-2">
          <button
            onClick={() => navigate('/')}
            className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg"
          >
            ← Back to Maps
          </button>
          <button
            onClick={() => navigate(`/map/${id}`)}
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg"
          >
            Switch to 2D View
          </button>
        </div>
        {loading && (
          <div className="flex items-center gap-2">
            <div className="h-2 w-24 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${loadingProgress}%` }}
              />
            </div>
            <span className="text-sm text-gray-600">{loadingProgress.toFixed(0)}%</span>
          </div>
        )}
      </div>

      {error && <div className="text-red-500">{error}</div>}

      {(!gridData && loading) ? (
        <div>Loading...</div>
      ) : (
        <div style={{ width: '100%', height: '600px' }}>
<Canvas shadows camera={{ position: [0, 5, 10], fov: 60 }}>
{/* <color attach="background" args={['#87CEEB']} />
<axesHelper args={[10]} /> */}
   <Environment
      files="/kloofendal_48d_partly_cloudy_puresky_1k.hdr"
      background={false}
      blur={0.0}
      intensity={1} 
      environmentIntensity={.4}
        ground={{
          height: 0,
          radius: 1000,
          scale: 100
        }}
    />

  <OrbitControls />
  
  {/* Your scene objects */}
  <TerrainMesh
    mapMetadata={mapMetadata}
    gridData={gridData}
    mappings={mappings}
    renderMode="biome"
  />
    <WaterPlane waterElevation={waterElevation} />
</Canvas>
        </div>
      )}
    </div>
  );
};

export default WorldMap3D;
