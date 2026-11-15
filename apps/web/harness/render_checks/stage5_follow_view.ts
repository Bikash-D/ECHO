// Real Follow-view render check. Uses the actual pickIsoSlice/
// projectBuilding/scatterProps pipeline plus real drawBuilding/drawTree/
// drawAgentSprite/drawRoutePath/drawDestinationMarker/drawWhyCard, camera
// composed with the REAL FOLLOW_ZOOM constant (copied from
// CityCanvasIso.tsx, since it's component-internal, not exported) so the
// on-screen citizen:building ratio in this render matches what the app
// would actually produce.
import { createCanvas } from "canvas";
import { pickIsoSlice, projectBuilding, scatterProps, projectIso, IsoBuilding, PropPlacement } from "../../lib/isometricAdapter";
import {
  Camera,
  actionGlyph,
  drawAgentSprite,
  drawBench,
  drawBuilding,
  drawDestinationMarker,
  drawFence,
  drawGroundStripLocal,
  drawLamp,
  drawLot,
  drawPlanter,
  drawRoutePath,
  drawSidewalkStub,
  drawBin,
  drawBush,
  drawSign,
  drawStall,
  drawTree,
  drawWhyCard,
} from "../../lib/isoRenderer";
import { hash01, routeBetweenLocations, Point } from "../../lib/cityLayout";
import { Agent, Location, Neighborhood } from "../../lib/types";
import * as fs from "fs";

const FOLLOW_ZOOM = 5.2; // copied verbatim from CityCanvasIso.tsx

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
  return {
    neighborhood: { id, name, city_id: "c1", number_of_locations: locations.length, population: 0, location_ids: locations.map((l) => l.id) } as Neighborhood,
    locations,
  };
}

function makeAgent(id: string, name: string, locationId: string, neighborhoodId: string, extras: Partial<Agent> = {}): Agent {
  return {
    id,
    name,
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
    ...extras,
  } as unknown as Agent;
}

const HOOD = buildHood("hoodA", "Riverside");
const slice = pickIsoSlice({ neighborhoods: [HOOD.neighborhood], locations: HOOD.locations, agents: [] });
if (!slice) throw new Error("no slice");
const buildings: IsoBuilding[] = slice.tiles.map(projectBuilding);
const props: PropPlacement[] = scatterProps(slice.tiles);

const pts = buildings.flatMap((b) => [b.floor.back, b.floor.right, b.floor.front, b.floor.left, b.roof.back, b.roof.right, b.roof.front, b.roof.left]);
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const p of pts) {
  minX = Math.min(minX, p.sx);
  maxX = Math.max(maxX, p.sx);
  minY = Math.min(minY, p.sy);
  maxY = Math.max(maxY, p.sy);
}
const VIEW_W = 1200,
  VIEW_H = 800;
const pad = 90;
const fitScale = Math.min((VIEW_W - pad * 2) / (maxX - minX), (VIEW_H - pad * 2) / (maxY - minY));
const followScale = fitScale * FOLLOW_ZOOM;

function renderFollowFrame(
  filename: string,
  title: string,
  agentWorld: Point,
  kavya: Agent,
  opts: { path?: Point[]; showWhyCard?: boolean; arrived?: boolean }
) {
  const canvas = createCanvas(VIEW_W, VIEW_H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#242f28";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const projected = projectIso(agentWorld.x, agentWorld.y, 0);
  const cam: Camera = {
    scale: followScale,
    offsetX: VIEW_W / 2 - projected.sx * followScale,
    offsetY: VIEW_H * 0.58 - projected.sy * followScale,
  };

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
  const bystanders = [
    { id: "bystander-1", wx: agentWorld.x + 60, wy: agentWorld.y - 40 },
    { id: "bystander-2", wx: agentWorld.x - 90, wy: agentWorld.y + 70 },
  ];
  for (const by of bystanders) {
    drawables.push({
      key: by.wx + by.wy,
      draw: () =>
        drawAgentSprite(ctx as any, cam, by.wx, by.wy, {
          phase: hash01(by.id + ":phase") * Math.PI * 2,
          amplitude: 0.6,
          highlight: false,
          facing: hash01(by.id + ":facing") * Math.PI * 2,
          lod: "readable",
          clothSeed: hash01(by.id + ":cloth"),
        }),
    });
  }

  drawables.push({
    key: agentWorld.x + agentWorld.y + 1000,
    draw: () =>
      drawAgentSprite(ctx as any, cam, agentWorld.x, agentWorld.y, {
        phase: opts.path && opts.path.length > 0 ? 1.4 : 0,
        amplitude: opts.path && opts.path.length > 0 ? 1 : 0,
        highlight: true,
        facing: opts.path && opts.path.length > 0 ? Math.atan2(opts.path[0].y - agentWorld.y, opts.path[0].x - agentWorld.x) : 0,
        lod: "detailed",
        tint: "#f97316",
        clothSeed: hash01(kavya.id + ":cloth"),
        glyph: opts.arrived ? actionGlyph((kavya as any).current_action?.action_type) : undefined,
      }),
  });

  drawables.sort((a, b) => a.key - b.key);
  for (const d of drawables) d.draw();

  if (opts.path && opts.path.length > 0) {
    drawRoutePath(ctx as any, cam, agentWorld, opts.path);
    const dest = opts.path[opts.path.length - 1];
    drawDestinationMarker(ctx as any, cam, dest.x, dest.y, 0.5);
  }

  if (opts.showWhyCard) {
    const lines: string[] = [];
    const goal = (kavya as any).current_goal?.description;
    if (goal) lines.push(`Goal: ${goal}`);
    const actionText = (kavya as any).current_action?.reasoning || (kavya as any).current_action?.message;
    if (actionText) lines.push(`${opts.path && opts.path.length > 0 ? "Heading out" : "Right now"}: ${actionText}`);
    if (lines.length > 0) drawWhyCard(ctx as any, cam, agentWorld.x, agentWorld.y, kavya.name, lines);
  }

  ctx.fillStyle = "#fff";
  ctx.font = "16px sans-serif";
  ctx.fillText(title, 10, 24);
  ctx.font = "12px sans-serif";
  ctx.fillText(`followScale=${followScale.toFixed(2)} (fitScale=${fitScale.toFixed(2)} x FOLLOW_ZOOM=${FOLLOW_ZOOM})`, 10, 44);

  fs.writeFileSync(__dirname + "/" + filename, canvas.toBuffer("image/png"));
  console.log("Wrote " + filename);
}

{
  const fromTile = slice.layout.locationById.get(HOOD.locations[0].id)!;
  const route = routeBetweenLocations(slice.layout, slice.network, HOOD.locations[0].id, HOOD.locations[5].id) || [];
  const kavya = makeAgent("kavya", "Kavya", HOOD.locations[0].id, "hoodA", {
    current_goal: { description: "Get to work on time" },
    current_action: { action_type: "move", reasoning: "Heading to the office before the morning shift starts" },
  } as any);
  const midPoint = route.length > 1 ? route[Math.floor(route.length / 2)] : { x: fromTile.x + fromTile.w / 2, y: fromTile.y + fromTile.h / 2 };
  renderFollowFrame("follow_1_walking.png", "Follow view 1 -- walking mid-route", midPoint, kavya, {
    path: route.slice(Math.floor(route.length / 2)),
  });
}

{
  const fromTile = slice.layout.locationById.get(HOOD.locations[0].id)!;
  const toTile = slice.layout.locationById.get(HOOD.locations[5].id)!;
  const route = routeBetweenLocations(slice.layout, slice.network, HOOD.locations[0].id, HOOD.locations[5].id) || [];
  const kavya = makeAgent("kavya", "Kavya", HOOD.locations[5].id, "hoodA", {
    current_goal: { description: "Get to work on time" },
    current_action: { action_type: "move", reasoning: "Almost at the office" },
  } as any);
  // Interpolate 80% of the way along the full polyline (start -> route
  // points -> destination) rather than reusing a discrete route index --
  // this neighborhood's routes are short (3 points), so "the second to
  // last point" and "the midpoint" can coincide, which isn't a real
  // rendering issue, just a harness sampling artifact.
  const full = [{ x: fromTile.x + fromTile.w / 2, y: fromTile.y + fromTile.h / 2 }, ...route];
  let totalLen = 0;
  for (let i = 1; i < full.length; i++) totalLen += Math.hypot(full[i].x - full[i - 1].x, full[i].y - full[i - 1].y);
  const targetLen = totalLen * 0.82;
  let acc = 0,
    nearEnd = full[full.length - 1];
  for (let i = 1; i < full.length; i++) {
    const segLen = Math.hypot(full[i].x - full[i - 1].x, full[i].y - full[i - 1].y);
    if (acc + segLen >= targetLen) {
      const t = (targetLen - acc) / segLen;
      nearEnd = { x: full[i - 1].x + (full[i].x - full[i - 1].x) * t, y: full[i - 1].y + (full[i].y - full[i - 1].y) * t };
      break;
    }
    acc += segLen;
  }
  const lastPt = route[route.length - 1] || { x: toTile.x + toTile.w / 2, y: toTile.y + toTile.h / 2 };
  renderFollowFrame("follow_2_approaching.png", "Follow view 2 -- approaching destination", nearEnd, kavya, {
    path: [lastPt],
  });
}

{
  const toTile = slice.layout.locationById.get(HOOD.locations[5].id)!;
  const kavya = makeAgent("kavya", "Kavya", HOOD.locations[5].id, "hoodA", {
    current_goal: { description: "Finish the morning's work" },
    current_action: { action_type: "work", reasoning: "Working through the morning task list" },
  } as any);
  const at = { x: toTile.x + toTile.w / 2 + 10, y: toTile.y + toTile.h / 2 + 10 };
  renderFollowFrame("follow_3_arrived_action.png", "Follow view 3 -- arrived, performing action", at, kavya, { arrived: true });
}

{
  const toTile = slice.layout.locationById.get(HOOD.locations[5].id)!;
  const kavya = makeAgent("kavya", "Kavya", HOOD.locations[5].id, "hoodA", {
    current_goal: { description: "Finish the morning's work" },
    current_action: { action_type: "work", reasoning: "Focused on finishing the quarterly report before lunch" },
  } as any);
  const at = { x: toTile.x + toTile.w / 2 + 10, y: toTile.y + toTile.h / 2 + 10 };
  renderFollowFrame("follow_4_causality.png", "Follow view 4 -- causality (WHY card) visible", at, kavya, { showWhyCard: true });
}
