import React, { useMemo } from "react";
import { Container, Sprite, Graphics } from "@pixi/react";
import { OutlineFilter } from "@pixi/filter-outline";

const BorderedSprite = ({
  texture,
  x,
  y,
  width,
  height,
  borderColor = 0x000000,
  borderWidth = 2,
  outlineQuality = 0.5,
  interactive = false,
  pointerdown,
  isSelected = false, // New prop
}) => {
  // Create the outline filter for the sprite.
  const filters = useMemo(
    () => [
      new OutlineFilter(
        borderWidth,
        isSelected ? "0x00ff00" : borderColor,
        outlineQuality
      ),
    ],
    [borderWidth, borderColor, outlineQuality, isSelected]
  );

  return (
    <Container x={x} y={y}>
      {/* Optional selection outline */}
      {/* {isSelected && (
        <Graphics
          draw={(g) => {
            g.clear();
            // Draw a green rectangle around the sprite.
            // Since the sprite's anchor is 0.5, the top-left is at (-width/2, -height/2)
            g.lineStyle(3, 0x00ff00, 1);
            g.drawRect(-width / 2, -height / 2, width, height);
          }}
        />
      )} */}
      <Sprite
        image={texture}
        width={width}
        height={height}
        anchor={0.5}
        filters={filters}
        interactive={interactive}
        pointerdown={(e) => {
          e.stopPropagation();
          if (pointerdown) pointerdown(e);
        }}
      />
    </Container>
  );
};

export default BorderedSprite;
