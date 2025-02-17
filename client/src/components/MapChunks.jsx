// MapChunks.jsx
import React, { useMemo } from "react";
import { Sprite, useApp } from "@pixi/react";
import * as PIXI from "pixi.js";

const CHUNK_SIZE = 100; // Adjust as needed

const MapChunks = ({ mapGrid, cellSize, mappings, textures, mapMetadata }) => {
  const app = useApp();

  // Group cells into chunks by key (e.g., "chunkX-chunkY")
  const chunks = useMemo(() => {
    const chunkMap = {};
    mapGrid.forEach(({ cell, x, y }) => {
      const chunkX = Math.floor(x / CHUNK_SIZE);
      const chunkY = Math.floor(y / CHUNK_SIZE);
      const key = `${chunkX}-${chunkY}`;
      if (!chunkMap[key]) {
        chunkMap[key] = [];
      }
      chunkMap[key].push({ cell, x, y });
    });
    return chunkMap;
  }, [mapGrid]);

  // Pre-render each chunk into a RenderTexture.
  const chunkTextures = useMemo(() => {
    const texturesMap = {};
    Object.keys(chunks).forEach((key) => {
      const [chunkX, chunkY] = key.split("-").map(Number);
      const chunkPixelWidth = CHUNK_SIZE * cellSize;
      const chunkPixelHeight = CHUNK_SIZE * cellSize;

      // Create a container for the chunk
      const container = new PIXI.Container();

      // For each cell in the chunk, create a sprite and add it to the container.
      chunks[key].forEach(({ cell, x, y }) => {
        let biomeKey = "default";
        if (mappings && mappings.biomes && mappings.biomes[cell[3]]) {
          biomeKey = mappings.biomes[cell[3]].toLowerCase();
        }
        const textureUrl = textures[biomeKey] || textures["default"];
        if (!textureUrl) return;

        const sprite = new PIXI.Sprite(PIXI.Texture.from(textureUrl));
        // Position the sprite relative to the chunk.
        sprite.x = x * cellSize - chunkX * chunkPixelWidth;
        sprite.y = y * cellSize - chunkY * chunkPixelHeight;
        sprite.width = cellSize;
        sprite.height = cellSize;
        container.addChild(sprite);
      });

      // Create a render texture for the chunk.
      const renderTexture = PIXI.RenderTexture.create({
        width: chunkPixelWidth,
        height: chunkPixelHeight,
      });
      // Render the container to the texture using the options object.
      app.renderer.render(container, { renderTexture, clear: true });
      texturesMap[key] = renderTexture;
    });
    return texturesMap;
  }, [chunks, cellSize, mappings, textures, app.renderer]);

  // Render each chunk sprite in its correct world position.
  return (
    <>
      {Object.keys(chunkTextures).map((key) => {
        const [chunkX, chunkY] = key.split("-").map(Number);
        const posX = chunkX * CHUNK_SIZE * cellSize;
        const posY = chunkY * CHUNK_SIZE * cellSize;
        return (
          <Sprite
            key={key}
            texture={chunkTextures[key]}
            x={posX}
            y={posY}
            width={CHUNK_SIZE * cellSize}
            height={CHUNK_SIZE * cellSize}
          />
        );
      })}
    </>
  );
};

export default MapChunks;
