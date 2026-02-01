import React, { useMemo } from "react";
import { Graphics } from "@pixi/react";

const MapTiles = React.memo(({ mapGrid, cellSize, mappings }) => {
  const biomeColors = useMemo(
    () => ({
      OCEAN: 0x1b4f72,
      COASTAL: 0x2e86c1,
      RIVER: 0x3498db,
      MOUNTAIN: 0x7f8c8d,
      DESERT: 0xd4ac0d,
      SAVANNA: 0xa9c46a,
      TROPICAL_FOREST: 0x1e8449,
      RAINFOREST: 0x145a32,
      TUNDRA: 0xd6eaf8,
      TAIGA: 0x4d9078,
      GRASSLAND: 0x6aa84f,
      WOODLAND: 0x3d7b3f,
      FOREST: 0x1b5e20,
      default: 0x6aa84f,
    }),
    []
  );

  return (
    <Graphics
      draw={(g) => {
        g.clear();
        let currentColor = null;
        for (let i = 0; i < mapGrid.length; i++) {
          const { cell, x, y } = mapGrid[i];
          const biomeName =
            mappings && mappings.biomes && mappings.biomes[cell[3]]
              ? mappings.biomes[cell[3]]
              : "default";
          const color = biomeColors[biomeName] ?? biomeColors.default;
          if (color !== currentColor) {
            if (currentColor !== null) g.endFill();
            g.beginFill(color, 1);
            currentColor = color;
          }
          g.drawRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }
        if (currentColor !== null) g.endFill();
      }}
    />
  );
});

export default MapTiles;
