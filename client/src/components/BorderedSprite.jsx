import React, { useMemo } from "react";
import { Container, Sprite, Text } from "@pixi/react";
import { OutlineFilter } from "@pixi/filter-outline";

const BorderedSprite = ({
  texture,
  x,
  y,
  width,
  height,
  borderColor = 0x000000,
  borderWidth = 0.1,
  outlineQuality = 0.2,
  interactive = false,
  pointerdown,
  isSelected = false, // New prop
  baseZ = 100,
  text = null, // Optional text to render
}) => {
  // Create the outline filter for the sprite.
  const filters = useMemo(
    () => [
      new OutlineFilter(
        1,
        isSelected ? "0x00ff00" : borderColor,
        outlineQuality
      ),
    ],
    [borderWidth, borderColor, outlineQuality, isSelected]
  );

  return (
    <Container x={x} y={y} zIndex={baseZ + y}>
      <Sprite
        image={texture}
        width={width}
        height={height}
        anchor={0.5}
        filters={isSelected && filters}
        interactive={interactive}
        pointerdown={(e) => {
          e.stopPropagation();
          if (pointerdown) pointerdown(e);
        }}
      />
      {text && (
        <Text
          text={text}
          // Place the text at the lower right corner relative to the sprite.
          // Since the sprite is centered (anchor = 0.5), its lower right is at (width/2, height/2)
          x={width / 2}
          y={height / 2 + 1}
          anchor={{ x: 1, y: 1 }}
          style={{
            fontFamily: "system-ui",
            fill: "#ffffff",
            fontSize: 16,
            stroke: "#000000",
            strokeThickness: 2,
          }}
          width={width / 2}
          height={height / 2}
        />
      )}
    </Container>
  );
};

export default BorderedSprite;
