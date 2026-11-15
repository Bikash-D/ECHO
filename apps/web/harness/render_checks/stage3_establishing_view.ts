// Full establishing-view render check. Real pickIsoSlice(), projectBuilding(),
// scatterProps() from lib/isometricAdapter.ts, and drawLot/drawBuilding/
// drawTree/.../drawAgentSprite from lib/isoRenderer.ts, on a real
// node-canvas context. Mirrors the actual paint order in
// CityCanvasIso.tsx's render loop (ground -> street/sidewalks -> lots ->
// depth-sorted buildings+props+agents), just outside React/rAF.
import { createCanvas } from "canvas";
import {
  pickIsoSlice,
  projectBuilding,
  projectIso,
  scatterProps,
  IsoBuilding,
  PropPlacement,
} from "../../lib/isometricAdapter";
import {
  Camera,
  drawAgentSprite,
  drawBench,
  drawBuilding,
  drawFence,
  drawGroundStripLocal,
  drawLamp,
  drawLot,
  drawPlanter,
  drawSidewalkStub,
  drawBin,
  drawBush,
  drawSign,
  drawStall,
  drawTree,
  toScreen,
} from "../../lib/isoRenderer";
import { hash01 } from "../../lib/cityLayout";
import { Agent, Location, Neighborhood } from "../../lib/types";
import * as fs from "fs";

function buildHood(id: string, name: string) {
  const plan: [Location["type"], number, string][] = [
    ["residential", 4, "Residence"],
    ["workplace", 2, "Workplace"],
    ["market", 1, "Market"],
    ["leisure", 1, "Leisure Spot"],
  ];
  const locations: Location[] = [];
  for (const [type, count, label] of plan) {
    for (let i = 0; i < count; i++) {
      locations.push({
        id: `${id}-${type}-${i}`,
        name: `${name} ${label} ${i + 1}`,
        type,
        neighborhood_id: id,
        capacity: null,
        occupancy: 0,
        occupant_ids: [],
      });
    }
  }
  return {
    neighborhood: { id, name, city_id: "c1", number_of_locations: locations.length, population: 0, location_ids: locations.map((l) => l.id) } as Neighborhood,
    locations,
  };
}

function makeAgent(id: string, locationId: string, neighborhoodId: string): Agent {
  return {
    id,
    name: `Agent ${id}`,
    age: 30,
    occupation: "worker",
    wealth: 0,
    social_status: 0,
    location_id: locationId,
    neighborhood_id: neighborhoodId,
    personality: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 },
    needs: [],
    goals: [],
    relationships: [],
  } as unknown as Agent;
}

const HOOD = buildHood("hoodA", "Riverside");
// 12 agents scattered across all 8 real locations, like a live population.
const agents: Agent[] = [];
for (let i = 0; i < 12; i++) {
  agents.push(makeAgent(`agent-${i}`, HOOD.locations[i % HOOD.locations.length].id, "hoodA"));
}

const slice = pickIsoSlice({ neighborhoods: [HOOD.neighborhood], locations: HOOD.locations, agents });
if (!slice) {
  console.error("FAIL: no slice");
  process.exit(1);
}

const buildings: IsoBuilding[] = slice.tiles.map(projectBuilding);
const props: PropPlacement[] = scatterProps(slice.tiles);

// Fit camera to the whole slice (mirrors CityCanvasIso.tsx's fitToSlice)
let minX = Infinity,
  minY = Infinity,
  maxX = -Infinity,
  maxY = -Infinity;
for (const t of slice.tiles) {
  const corners = [
    projectIso(t.x, t.y, 0),
    projectIso(t.x + t.w, t.y, 0),
    projectIso(t.x, t.y + t.h, 0),
    projectIso(t.x + t.w, t.y + t.h, 0),
  ];
  for (const c of corners) {
    minX = Math.min(minX, c.sx);
    maxX = Math.max(maxX, c.sx);
    minY = Math.min(minY, c.sy);
    maxY = Math.max(maxY, c.sy);
  }
}
const W = 1400,
  H = 900;
const pad = 80;
const contentW = maxX - minX;
const contentH = maxY - minY;
const scale = Math.min((W - pad * 2) / Math.max(1, contentW), (H - pad * 2) / Math.max(1, contentH));
const cam: Camera = {
  scale,
  offsetX: W / 2 - ((minX + maxX) / 2) * scale,
  offsetY: H / 2 - ((minY + maxY) / 2) * scale,
};

const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#242f28";
ctx.fillRect(0, 0, W, H);

const street = slice.network.streets.get(slice.neighborhoodId);
if (street) {
  drawGroundStripLocal(ctx as any, cam, street.y, street.x1, street.x2, 7, "#3d4147");
  drawGroundStripLocal(ctx as any, cam, street.y - 12, street.x1, street.x2, 3, "#8d8a7e");
  drawGroundStripLocal(ctx as any, cam, street.y + 12, street.x1, street.x2, 3, "#8d8a7e");
}
for (const tile of slice.tiles) {
  const entrance = slice.network.entrances.get(tile.id);
  if (entrance) {
    drawSidewalkStub(ctx as any, cam, { x: tile.x + tile.w / 2, y: tile.y + tile.h / 2 }, entrance);
  }
}
for (const b of buildings) drawLot(ctx as any, cam, b);

type Drawable = { key: number; draw: () => void };
const drawables: Drawable[] = [];
for (const b of buildings) drawables.push({ key: b.depthKey, draw: () => drawBuilding(ctx as any, cam, b) });
for (const p of props) {
  drawables.push({
    key: p.depthKey,
    draw: () => {
      if (p.kind === "tree") drawTree(ctx as any, cam, p);
      else if (p.kind === "lamp") drawLamp(ctx as any, cam, p);
      else if (p.kind === "bench") drawBench(ctx as any, cam, p);
      else if (p.kind === "stall") drawStall(ctx as any, cam, p);
      else if (p.kind === "planter") drawPlanter(ctx as any, cam, p);
      else if (p.kind === "fence") drawFence(ctx as any, cam, p);
      else if (p.kind === "sign") drawSign(ctx as any, cam, p);
      else if (p.kind === "bush") drawBush(ctx as any, cam, p);
      else if (p.kind === "bin") drawBin(ctx as any, cam, p);
    },
  });
}
for (const agent of agents) {
  const tile = slice.layout.locationById.get(agent.location_id);
  if (!tile) continue;
  const wx = tile.x + tile.w / 2 + (hash01(agent.id + ":jx") - 0.5) * tile.w * 0.5;
  const wy = tile.y + tile.h / 2 + (hash01(agent.id + ":jy") - 0.5) * tile.h * 0.5;
  drawables.push({
    key: wx + wy,
    draw: () =>
      drawAgentSprite(ctx as any, cam, wx, wy, {
        phase: hash01(agent.id + ":phase") * Math.PI * 2,
        amplitude: 0,
        highlight: agent.id === "agent-0",
        facing: hash01(agent.id + ":facing") * Math.PI * 2,
        lod: agent.id === "agent-0" ? "detailed" : "readable",
        clothSeed: hash01(agent.id + ":cloth"),
      }),
  });
}
drawables.sort((a, b) => a.key - b.key);
for (const d of drawables) d.draw();

ctx.fillStyle = "#fff";
ctx.font = "16px sans-serif";
ctx.fillText(`Stage 3/4 -- establishing view, real ${HOOD.neighborhood.name} neighborhood, all ${slice.tiles.length} real locations, 12 real agents`, 10, 24);

fs.writeFileSync(__dirname + "/establishing_view.png", canvas.toBuffer("image/png"));
console.log("Wrote establishing_view.png");
console.log("tiles:", slice.tiles.length, "props:", props.length, "agents drawn:", agents.length);
