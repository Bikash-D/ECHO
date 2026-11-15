// Stage 6 QA views B, D, E, F: medium street view, market area,
// residential area, leisure area -- each at a zoom level between the
// full establishing view and Follow Mode's close-up, to check that the
// house->yard->path->sidewalk->road (and market/leisure equivalents)
// chain reads as connected, not isolated objects on empty ground.
import { createCanvas } from "canvas";
import { pickIsoSlice, projectBuilding, projectIso, scatterProps, IsoBuilding, PropPlacement } from "../../lib/isometricAdapter";
import {
  Camera,
  drawAgentSprite,
  drawBench,
  drawBin,
  drawBuilding,
  drawBush,
  drawFence,
  drawGroundStripLocal,
  drawLamp,
  drawLot,
  drawPlanter,
  drawSidewalkStub,
  drawSign,
  drawStall,
  drawTree,
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
      locations.push({ id: `${id}-${type}-${i}`, name: `${name} ${label} ${i + 1}`, type, neighborhood_id: id, capacity: null, occupancy: 0, occupant_ids: [] });
    }
  }
  return { neighborhood: { id, name, city_id: "c1", number_of_locations: locations.length, population: 0, location_ids: locations.map((l) => l.id) } as Neighborhood, locations };
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
const agents: Agent[] = [];
for (let i = 0; i < 14; i++) agents.push(makeAgent(`agent-${i}`, HOOD.locations[i % HOOD.locations.length].id, "hoodA"));
const slice = pickIsoSlice({ neighborhoods: [HOOD.neighborhood], locations: HOOD.locations, agents });
if (!slice) throw new Error("no slice");
const buildings: IsoBuilding[] = slice.tiles.map(projectBuilding);
const props: PropPlacement[] = scatterProps(slice.tiles);

type Drawable = { key: number; draw: (ctx: any) => void };

function renderScene(filename: string, title: string, cam: Camera, W: number, H: number) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#242f28";
  ctx.fillRect(0, 0, W, H);

  const street = slice!.network.streets.get(slice!.neighborhoodId);
  if (street) {
    drawGroundStripLocal(ctx as any, cam, street.y, street.x1, street.x2, 7, "#3d4147");
    drawGroundStripLocal(ctx as any, cam, street.y - 12, street.x1, street.x2, 3, "#8d8a7e");
    drawGroundStripLocal(ctx as any, cam, street.y + 12, street.x1, street.x2, 3, "#8d8a7e");
  }
  for (const tile of slice!.tiles) {
    const entrance = slice!.network.entrances.get(tile.id);
    if (entrance) drawSidewalkStub(ctx as any, cam, { x: tile.x + tile.w / 2, y: tile.y + tile.h / 2 }, entrance);
  }
  for (const b of buildings) drawLot(ctx as any, cam, b);

  const drawables: Drawable[] = [];
  for (const b of buildings) drawables.push({ key: b.depthKey, draw: (c) => drawBuilding(c, cam, b) });
  for (const p of props) {
    drawables.push({
      key: p.depthKey,
      draw: (c) => {
        if (p.kind === "tree") drawTree(c, cam, p);
        else if (p.kind === "lamp") drawLamp(c, cam, p);
        else if (p.kind === "bench") drawBench(c, cam, p);
        else if (p.kind === "stall") drawStall(c, cam, p);
        else if (p.kind === "planter") drawPlanter(c, cam, p);
        else if (p.kind === "fence") drawFence(c, cam, p);
        else if (p.kind === "sign") drawSign(c, cam, p);
        else if (p.kind === "bush") drawBush(c, cam, p);
        else if (p.kind === "bin") drawBin(c, cam, p);
      },
    });
  }
  for (const agent of agents) {
    const tile = slice!.layout.locationById.get(agent.location_id);
    if (!tile) continue;
    const wx = tile.x + tile.w / 2 + (hash01(agent.id + ":jx") - 0.5) * tile.w * 0.5;
    const wy = tile.y + tile.h / 2 + (hash01(agent.id + ":jy") - 0.5) * tile.h * 0.5;
    drawables.push({
      key: wx + wy,
      draw: (c) =>
        drawAgentSprite(c, cam, wx, wy, {
          phase: hash01(agent.id + ":phase") * Math.PI * 2,
          amplitude: 0,
          highlight: false,
          facing: hash01(agent.id + ":facing") * Math.PI * 2,
          lod: "readable",
          clothSeed: hash01(agent.id + ":cloth"),
        }),
    });
  }
  drawables.sort((a, b) => a.key - b.key);
  for (const d of drawables) d.draw(ctx);

  ctx.fillStyle = "#fff";
  ctx.font = "15px sans-serif";
  ctx.fillText(title, 10, 22);
  fs.writeFileSync(__dirname + "/" + filename, canvas.toBuffer("image/png"));
  console.log("Wrote", filename);
}

function camCenteredOn(tile: { x: number; y: number; w: number; h: number }, scale: number, W: number, H: number): Camera {
  const c = projectIso(tile.x + tile.w / 2, tile.y + tile.h / 2, 20);
  return { scale, offsetX: W / 2 - c.sx * scale, offsetY: H / 2 - c.sy * scale };
}

// B. Medium street view -- two adjacent lots + the street between them,
// zoomed further in than the establishing view but not as close as Follow.
{
  const W = 1200,
    H = 750;
  const midX = (slice.tiles[0].x + slice.tiles[1].x) / 2 + slice.tiles[0].w / 2;
  const midY = (slice.tiles[0].y + slice.tiles[1].y) / 2 + slice.tiles[0].h / 2;
  const c = projectIso(midX, midY, 10);
  const scale = 1.05;
  const cam: Camera = { scale, offsetX: W / 2 - c.sx * scale, offsetY: H / 2 - c.sy * scale };
  renderScene("stage6_B_medium_street.png", "B. Medium street view", cam, W, H);
}

// D. Market area close-up
{
  const marketTile = slice.tiles.find((t) => t.type === "market")!;
  renderScene("stage6_D_market_area.png", "D. Market area", camCenteredOn(marketTile, 1.15, 1200, 800), 1200, 800);
}

// E. Residential area close-up (two houses + the street between)
{
  const resTiles = slice.tiles.filter((t) => t.type === "residential").slice(0, 2);
  const midX = (resTiles[0].x + resTiles[1].x) / 2 + resTiles[0].w / 2;
  const midY = (resTiles[0].y + resTiles[1].y) / 2 + resTiles[0].h / 2;
  const c = projectIso(midX, midY, 10);
  const scale = 1.0;
  const cam: Camera = { scale, offsetX: 1200 / 2 - c.sx * scale, offsetY: 800 / 2 - c.sy * scale };
  renderScene("stage6_E_residential_area.png", "E. Residential area", cam, 1200, 800);
}

// F. Leisure area close-up
{
  const leisureTile = slice.tiles.find((t) => t.type === "leisure")!;
  renderScene("stage6_F_leisure_area.png", "F. Leisure area", camCenteredOn(leisureTile, 1.15, 1200, 800), 1200, 800);
}
