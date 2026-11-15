// Real pixel render check, Stage 1 (citizens). Uses the actual, unmodified
// exported drawAgentSprite() from lib/isoRenderer.ts against a real
// node-canvas 2D context -- not a mock. Output PNGs are inspected via the
// `view` tool before moving to the next milestone stage, per the
// mandated "render/test after every stage" process.
import { createCanvas } from "canvas";
import { drawAgentSprite, Camera } from "../../lib/isoRenderer";
import { hash01 } from "../../lib/cityLayout";

const cam: Camera = { scale: 6, offsetX: 0, offsetY: 0 };

function bg(ctx: any, w: number, h: number) {
  ctx.fillStyle = "#2a3a2c";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  for (let x = 0; x < w; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
}

// --- Gallery 1: 10 distinct agent identities, standing (phase=0), readable LOD ---
{
  const W = 900,
    H = 260;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  bg(ctx, W, H);
  const ids = Array.from({ length: 10 }, (_, i) => `agent-gallery-${i}`);
  ids.forEach((id, i) => {
    const wx = i * 2.2;
    const sx = 45 + i * 82;
    const localCam: Camera = { scale: 6, offsetX: sx, offsetY: 210 };
    drawAgentSprite(ctx as any, localCam, 0, 0, {
      phase: 0,
      amplitude: 0,
      highlight: false,
      facing: 0,
      lod: "readable",
      clothSeed: hash01(id + ":cloth"),
    });
  });
  ctx.fillStyle = "#fff";
  ctx.font = "14px sans-serif";
  ctx.fillText("Stage 1 -- 10 distinct citizen identities (readable LOD, standing)", 10, 20);
  require("fs").writeFileSync(__dirname + "/gallery_identities.png", canvas.toBuffer("image/png"));
}

// --- Gallery 2: one agent, walk cycle across 8 phases ---
{
  const W = 900,
    H = 260;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  bg(ctx, W, H);
  const phases = Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2);
  phases.forEach((phase, i) => {
    const sx = 55 + i * 105;
    const localCam: Camera = { scale: 7, offsetX: sx, offsetY: 220 };
    drawAgentSprite(ctx as any, localCam, 0, 0, {
      phase,
      amplitude: 1,
      highlight: false,
      facing: 0,
      lod: "readable",
      clothSeed: hash01("walker:cloth"),
    });
  });
  ctx.fillStyle = "#fff";
  ctx.font = "14px sans-serif";
  ctx.fillText("Stage 1 -- one citizen through a full walk-cycle (8 phases)", 10, 20);
  require("fs").writeFileSync(__dirname + "/gallery_walkcycle.png", canvas.toBuffer("image/png"));
}

// --- Gallery 3: facing directions (mirroring) ---
{
  const W = 700,
    H = 260;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  bg(ctx, W, H);
  const facings = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, Math.PI / 4];
  const labels = ["facing +x", "facing +y", "facing -x", "facing -y", "diagonal"];
  facings.forEach((facing, i) => {
    const sx = 70 + i * 130;
    const localCam: Camera = { scale: 7, offsetX: sx, offsetY: 220 };
    drawAgentSprite(ctx as any, localCam, 0, 0, {
      phase: 1.2,
      amplitude: 1,
      highlight: false,
      facing,
      lod: "readable",
      clothSeed: hash01("facer:cloth"),
    });
    ctx.fillStyle = "#fff";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(labels[i], sx, 250);
    ctx.textAlign = "left";
  });
  ctx.fillStyle = "#fff";
  ctx.font = "14px sans-serif";
  ctx.fillText("Stage 1 -- facing/mirroring across travel headings", 10, 20);
  require("fs").writeFileSync(__dirname + "/gallery_facing.png", canvas.toBuffer("image/png"));
}

// --- Gallery 4: LOD tiers side by side (simple / readable / detailed) + highlight ---
{
  const W = 500,
    H = 280;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  bg(ctx, W, H);
  const tiers: Array<{ lod: "simple" | "readable" | "detailed"; highlight: boolean; label: string }> = [
    { lod: "simple", highlight: false, label: "simple (distant)" },
    { lod: "readable", highlight: false, label: "readable (mid)" },
    { lod: "detailed", highlight: true, label: "detailed+followed" },
  ];
  tiers.forEach((t, i) => {
    const sx = 90 + i * 160;
    const localCam: Camera = { scale: 7, offsetX: sx, offsetY: 240 };
    drawAgentSprite(ctx as any, localCam, 0, 0, {
      phase: 0.8,
      amplitude: 1,
      highlight: t.highlight,
      facing: 0.3,
      lod: t.lod,
      tint: t.highlight ? "#f97316" : undefined,
      clothSeed: hash01("tierdemo:cloth"),
    });
    ctx.fillStyle = "#fff";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(t.label, sx, 260);
    ctx.textAlign = "left";
  });
  ctx.fillStyle = "#fff";
  ctx.font = "14px sans-serif";
  ctx.fillText("Stage 1 -- LOD tiers (same identity)", 10, 20);
  require("fs").writeFileSync(__dirname + "/gallery_lod.png", canvas.toBuffer("image/png"));
}

console.log("Wrote gallery_identities.png, gallery_walkcycle.png, gallery_facing.png, gallery_lod.png");
