import React from "react";
import { Sprite } from "@pixi/react";

const MapTiles = React.memo(({ mapGrid, cellSize, mappings, textures }) => {
  return (
    <>
      {mapGrid.map(({ cell, x, y }) => {
        let biomeKey = "default";
        if (mappings && mappings.biomes && mappings.biomes[cell[3]]) {
          biomeKey = mappings.biomes[cell[3]].toLowerCase();
        }
        const texture = textures[biomeKey] || textures["default"];

        if (!texture) {
          //console.error(`Texture not found for biome key: ${biomeKey}`);
          return null;
        }

        return (
          <Sprite
            key={`${x}-${y}`}
            image={texture}
            x={x * cellSize}
            y={y * cellSize}
            width={cellSize}
            height={cellSize}
          />
        );
      })}
    </>
  );
});

export default MapTiles;
