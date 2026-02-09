# Game Design Document: Casual Real-Time Territorial 4X

## Summary
Fast, real-time territory-control game inspired by Territorial.io and OpenFront.io, with lightweight strategic depth. Players grow population from territory, spend population to expand/attack, and gain bonuses from terrain and resource nodes. No unit objects exist; combat and expansion are resolved via pressure flows on tiles.

## Pillars
- **Fast expansion, low friction**: a click should create immediate pressure and visible movement.
- **Readable strategy**: terrain and resources matter, but the rules stay simple.
- **Short matches**: 15–20 minutes to resolution.

## Core Loop
1. **Grow** population based on owned territory and production bonuses.
2. **Expand or Attack** by spending population as pressure in a direction.
3. **Capture** tiles and resource nodes to improve stats.
4. **Snowball carefully**: expansion weakens defense temporarily.

## Map & Terrain
### Terrain Types (from generator)
`OCEAN, COASTAL, MOUNTAIN, DESERT, SAVANNA, TROPICAL_FOREST, RAINFOREST, TUNDRA, TAIGA, GRASSLAND, WOODLAND, FOREST, RIVER`
- **OCEAN**: non-claimable.
- All others are claimable.

### Terrain Similarity Matrix
Each terrain pair has similarity `S ∈ [0.2..1.0]`.
- Same terrain: `S = 1.0`
- Adjacent/close biomes: `S = 0.8`
- Distant biomes: `S = 0.2–0.3`

**Effects (both speed and losses):**
- `speedMult = 0.5 + 0.5 * S`
- `lossMult  = 1.0 + 0.6 * (1 - S)`

## Resources (5 types)
- **Food** → expansion power
- **Wood** → production power
- **Iron** → attack power
- **Stone** → defense power
- **Gold** → upgrade currency for resource nodes

### Resource Nodes
Resource tiles grant bonuses while controlled. Each node has **upgrade level**:
`Level 0 → 1.0x`, `Level 1 → 1.5x`, `Level 2 → 2.0x`, `Level 3 → 3.0x`.
- Upgrades are **per-node**.
- Capturing a tile **captures the upgrade level**.

## Population & Growth
Population is global per player (no unit objects).

**Base growth per tick:**
```
growth = baseGrowth * production * sqrt(ownedTiles)
production = 1 + woodBonus
```
- Target match length: 15–20 minutes with tick = 200ms.

## Expansion & Attack
Players click in a direction (or border tile) to send a **% of population** as pressure.

### Pressure Model
Pressure spreads across border tiles aligned with the click vector.

**Per-tile conquest:**
```
effectiveCost = baseCost * lossMult / attackPower
effectiveSpeed = speedBase * speedMult * expansionPower
```
If pressure ≥ cost, tile is captured; otherwise partial loss is applied.

### Stat Multipliers
```
expansionPower = 1 + foodBonus
attackPower    = 1 + ironBonus
defensePower   = 1 + stoneBonus
production     = 1 + woodBonus
```

### Defender Strength
```
defense = baseDefense * defensePower * terrainDefenseMult
```

## Inputs & UX
- **Click direction** creates an attack/expansion wave.
- **Attack % slider** (e.g., 10%–100%) determines committed population.
- Immediate feedback; server sends updates via WebSocket.

## Economy & Upgrades
Gold is used to upgrade resource nodes:
- L1: 50 gold
- L2: 150 gold
- L3: 400 gold

Upgrading is instant and can be captured.

## Victory
Primary: control % of claimable land (configurable).
Optional: capture all opponent capitals (future).

## Technical Targets
- Tick rate: **200ms**
- WebSocket broadcast: **100–200ms**
- Full state reconciliation: every 10–15s

## Implementation Plan (high-level)
1. Add terrain similarity table to config.
2. Add resource node upgrade levels on map tiles.
3. Implement pressure-based expansion/attack (no unit objects).
4. Wire client click-to-direction to new endpoints.
5. Balance constants to 15–20 min match length.
