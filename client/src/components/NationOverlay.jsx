import React, { useMemo } from "react";
import { Stage, Container, Graphics, Text } from "@pixi/react";
import { string2hex } from "@pixi/utils";
import BorderedSprite from "./BorderedSprite";

const NationOverlay = React.memo(
  ({
    nation,
    nationIndex,
    cellSize,
    scale,
    gameMode,
    userId,
    onArmySelect,
  }) => {
    const isMobile = window.innerWidth <= 768;

    const palette = [
      "#ff0008",
      "#ff0084",
      "#ff00f7",
      "#a200ff",
      "#d4ff00",
      "#ffc400",
      "#ff6200",
    ];
    const nationColor =
      nation.owner === userId
        ? "#0000ff"
        : palette[nationIndex % palette.length];
    const baseColor = string2hex(nationColor);

    const territory = useMemo(() => {
      let result = { x: [], y: [] };

      if (nation.territory) {
        result = {
          x: [...nation.territory.x],
          y: [...nation.territory.y],
        };
      } else if (nation.territoryDeltaForClient?.add) {
        result = {
          x: [...nation.territoryDeltaForClient.add.x],
          y: [...nation.territoryDeltaForClient.add.y],
        };
      }

      if (nation.territoryDeltaForClient?.sub) {
        const subSet = new Set(
          nation.territoryDeltaForClient.sub.x.map(
            (x, i) => `${x},${nation.territoryDeltaForClient.sub.y[i]}`
          )
        );
        const filtered = { x: [], y: [] };
        for (let i = 0; i < result.x.length; i++) {
          const key = `${result.x[i]},${result.y[i]}`;
          if (!subSet.has(key)) {
            filtered.x.push(result.x[i]);
            filtered.y.push(result.y[i]);
          }
        }
        result = filtered;
      }

      return result;
    }, [nation.territory]);

    return (
      <>
        {/* Territory */}
        <Graphics
          zIndex={100}
          draw={(g) => {
            g.clear();
            g.beginFill(baseColor, 0.5);
            for (let i = 0; i < territory.x.length; i++) {
              g.drawRect(
                territory.x[i] * cellSize,
                territory.y[i] * cellSize,
                cellSize,
                cellSize
              );
            }
            g.endFill();
          }}
        />

        {/* Battle effects */}
        {nation.armiesAffectedCells?.length > 0 && (
          <Graphics
            zIndex={150}
            draw={(g) => {
              g.clear();
              g.beginFill(0xff0000, 0.4);
              nation.armiesAffectedCells.forEach(({ x, y }) => {
                g.drawRect(x * cellSize, y * cellSize, cellSize, cellSize);
              });
              g.endFill();
            }}
          />
        )}

        {/* Cities */}
        {nation.cities?.map((city, idx) => {
          const centerX = city.x * cellSize + cellSize / 2;
          const centerY = city.y * cellSize + cellSize / 2;
          return (
            <Graphics
              key={`city-${nation.owner}-${idx}`}
              zIndex={500 + centerY}
            >
              <BorderedSprite
                texture={`/${city.type.toLowerCase().replace(" ", "_")}.png`}
                x={centerX}
                y={centerY}
                width={cellSize}
                height={cellSize}
                borderColor={baseColor}
                borderWidth={2 * Math.sqrt(scale)}
                interactive={true}
                baseZ={500 + centerY}
              />
              {city.type === "capital" && (
                <Text
                  text={nation.owner}
                  x={centerX}
                  y={centerY + cellSize / 2 + 5}
                  anchor={0.5}
                  style={{
                    fill: 0xffffff,
                    fontSize: isMobile
                      ? Math.max(30 / scale, 6)
                      : Math.max(60 / scale, 16),
                  }}
                />
              )}
            </Graphics>
          );
        })}

        {/* Armies */}
        {nation.armies?.map((army, idx) => {
          const centerX = Math.floor(army.position.x) * cellSize + cellSize / 2;
          const centerY = Math.floor(army.position.y) * cellSize + cellSize / 2;
          const isSelected = gameMode.selectedArmies.some(
            (a) => a.id === army.id
          );

          return (
            <BorderedSprite
              key={`army-${nation.owner}-${idx}`}
              texture={`/${army.type.toLowerCase().replace(" ", "_")}.png`}
              x={centerX}
              y={centerY}
              width={cellSize}
              height={cellSize}
              borderColor={isSelected ? 0x00ff00 : baseColor}
              borderWidth={2 * Math.sqrt(scale)}
              interactive={true}
              isSelected={isSelected}
              pointerdown={(e) => {
                e.stopPropagation();
                if (nation.owner === userId) {
                  onArmySelect(army);
                }
              }}
              baseZ={500 + centerY}
              text={`${Math.round(army.currentPower)}`}
            />
          );
        })}
      </>
    );
  }
);

export default NationOverlay;
