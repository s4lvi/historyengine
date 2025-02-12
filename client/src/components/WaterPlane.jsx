import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
// Import ImprovedNoise from Three.js examples (make sure to install three if needed)
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';

const WaterPlane = ({ waterElevation = 0 }) => {
  const canvasSize = 256;
  
  // Create an offscreen canvas and its texture once.
  const canvasRef = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    return canvas;
  }, [canvasSize]);

  const normalTexture = useMemo(() => {
    const texture = new THREE.CanvasTexture(canvasRef);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }, [canvasRef]);

  // Create a noise generator instance.
  const noise = useMemo(() => new ImprovedNoise(), []);
  
  // A ref to animate the noise offset (our "time" parameter for noise).
  const noiseOffset = useRef(0);

  // In each frame, update the canvas (and thus our normal texture) with new Perlin noise.
  useFrame((state, delta) => {
    noiseOffset.current += delta * 0.1; // adjust speed as needed

    const ctx = canvasRef.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvasSize, canvasSize);
    const data = imageData.data;
    
    // First, compute a height field from noise.
    // We store heights in a flat array of length canvasSize * canvasSize.
    const heights = new Float32Array(canvasSize * canvasSize);
    let index = 0;
    for (let y = 0; y < canvasSize; y++) {
      for (let x = 0; x < canvasSize; x++) {
        // Normalize coordinates and scale frequency (here, 5.0 is an arbitrary frequency factor).
        const nx = x / canvasSize;
        const ny = y / canvasSize;
        const value = noise.noise(nx * 10, ny * 10, noiseOffset.current * 3);
        heights[index++] = value;
      }
    }

    // Next, compute normals via central differences.
    index = 0;
    for (let y = 0; y < canvasSize; y++) {
      for (let x = 0; x < canvasSize; x++) {
        // Sample neighboring heights (using edge clamping)
        const left   = x > 0 ? heights[y * canvasSize + (x - 1)] : heights[y * canvasSize + x];
        const right  = x < canvasSize - 1 ? heights[y * canvasSize + (x + 1)] : heights[y * canvasSize + x];
        const top    = y > 0 ? heights[(y - 1) * canvasSize + x] : heights[y * canvasSize + x];
        const bottom = y < canvasSize - 1 ? heights[(y + 1) * canvasSize + x] : heights[y * canvasSize + x];
        
        // Compute approximate derivatives.
        const dx = right - left;
        const dy = bottom - top;
        
        // Assume the z component is constant (here, 1) so that the normal vector is:
        // n = normalize( -dx, -dy, 1 )
        const nx = -dx;
        const ny = -dy;
        const nz = 1;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        const normX = nx / len;
        const normY = ny / len;
        const normZ = nz / len;
        
        // Map from [-1, 1] to [0, 255] for the RGB channels.
        const r = Math.floor((normX * 0.5 + 0.5) * 255);
        const g = Math.floor((normY * 0.5 + 0.5) * 255);
        const b = Math.floor((normZ * 0.5 + 0.5) * 255);
        
        const dataIndex = index * 4;
        data[dataIndex]     = r;
        data[dataIndex + 1] = g;
        data[dataIndex + 2] = b;
        data[dataIndex + 3] = 255; // Fully opaque
        index++;
      }
    }
    
    // Update the canvas and flag the texture for an update.
    ctx.putImageData(imageData, 0, 0);
    normalTexture.needsUpdate = true;
  });

  // Create the water material using the dynamic normal texture.
  const waterMaterial = useMemo(() => {
    return new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x77ccFF),
      normalMap: normalTexture,
      normalScale: new THREE.Vector2(1, 1), // Adjust for desired bump intensity
      transparent: true,
      opacity: 0.8,
      roughness: 0.6,
      metalness: 0.3,
      envMapIntensity: 1.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
      side: THREE.DoubleSide,
      transmission: 0.6,
      ior: 1.4,
    });
  }, [normalTexture]);

  // A simple bottom material for the pool/floor.
  const bottomMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color('#1180FF'),
      side: THREE.DoubleSide,
    });
  }, []);

  return (
    <group>
      {/* Bottom (static) plane */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, 0]}
        material={bottomMaterial}
        renderOrder={0}
      >
        <planeGeometry args={[200, 200]} />
      </mesh>
      
      {/* Water surface with animated normals */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, waterElevation, 0]}
        material={waterMaterial}
        renderOrder={1}
      >
        <planeGeometry args={[200, 200, 32, 32]} />
      </mesh>
    </group>
  );
};

export default WaterPlane;
