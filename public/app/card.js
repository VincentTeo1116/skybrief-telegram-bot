// The picture card for sharing (FR-18): today's weather drawn on a 1080 x 1350 canvas, the 4:5 portrait size chat
// apps show large. It uses the same sky painter as the live page (one still frame) and only text that is already on
// the dashboard, so the picture can never say something the page doesn't.
import { STILL, hazeTint, makePainter } from "./scene.js";

export const CARD_W = 1080;
export const CARD_H = 1350;
const PAD = 72;
const FONT = '"Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif';
const TAU = Math.PI * 2;
const WHITE = "#ffffff";
const SOFT = "rgba(255,255,255,0.86)";

const font = (weight, size) => `${weight} ${size}px ${FONT}`;

/** Shrink the font until the text fits; as a last resort cut it with an ellipsis. Returns the text actually drawn. */
function fitText(ctx, text, x, y, maxWidth, weight, size, minSize) {
  let s = size;
  ctx.font = font(weight, s);
  while (s > minSize && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = font(weight, s);
  }
  let out = text;
  while (out.length > 1 && ctx.measureText(out).width > maxWidth) out = out.slice(0, -2).trimEnd() + "…";
  ctx.fillText(out, x, y);
  return out;
}

/** Break a sentence into at most `maxLines` lines. Works for Chinese too (no spaces): it then breaks between characters. */
function wrapLines(ctx, text, maxWidth, maxLines) {
  const units = text.includes(" ") ? text.split(" ").map((w, i) => (i ? " " + w : w)) : [...text];
  const lines = [];
  let line = "";
  for (const unit of units) {
    if (line && ctx.measureText(line + unit).width > maxWidth) {
      lines.push(line.trim());
      line = unit.trimStart();
    } else line += unit;
  }
  if (line.trim()) lines.push(line.trim());
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(last + "…").width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = last.trimEnd() + "…";
  }
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function cloud(ctx, cx, cy, s, colour) {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(cx - s * 0.28, cy + s * 0.06, s * 0.2, 0, TAU);
  ctx.arc(cx - s * 0.02, cy - s * 0.1, s * 0.27, 0, TAU);
  ctx.arc(cx + s * 0.27, cy + s * 0.05, s * 0.21, 0, TAU);
  ctx.rect(cx - s * 0.28, cy + s * 0.04, s * 0.55, s * 0.22);
  ctx.fill();
}

function sun(ctx, cx, cy, r) {
  ctx.strokeStyle = "#ffd24a";
  ctx.lineWidth = r * 0.24;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * TAU) / 8;
    ctx.moveTo(cx + Math.cos(a) * r * 1.45, cy + Math.sin(a) * r * 1.45);
    ctx.lineTo(cx + Math.cos(a) * r * 1.9, cy + Math.sin(a) * r * 1.9);
  }
  ctx.stroke();
  ctx.fillStyle = "#ffd24a";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
}

/** A small weather icon drawn with plain shapes (the page's SVG icons can't be painted onto a canvas reliably). */
function drawIcon(ctx, name, cx, cy, s) {
  ctx.save();
  const wet = name === "rain" || name === "storm";
  const cloudColour = wet ? "#c4cedb" : "#f3f7fc";
  if (name.startsWith("clear")) sun(ctx, cx, cy, s * 0.24);
  else if (name.startsWith("partly")) {
    sun(ctx, cx - s * 0.16, cy - s * 0.14, s * 0.16);
    cloud(ctx, cx + s * 0.06, cy + s * 0.08, s * 0.82, cloudColour);
  } else cloud(ctx, cx, name === "cloudy" ? cy : cy - s * 0.1, s, cloudColour);

  ctx.lineCap = "round";
  if (name === "rain" || name === "drizzle" || name === "storm") {
    ctx.strokeStyle = "#a9d4ff";
    ctx.lineWidth = s * 0.055;
    ctx.beginPath();
    const xs = name === "rain" ? [-0.24, 0, 0.24] : [-0.26, 0.26];
    for (const dx of xs) {
      ctx.moveTo(cx + dx * s, cy + s * 0.26);
      ctx.lineTo(cx + dx * s - s * 0.07, cy + s * 0.44);
    }
    ctx.stroke();
  }
  if (name === "storm") {
    ctx.fillStyle = "#ffd24a";
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.04, cy + s * 0.12);
    ctx.lineTo(cx - s * 0.12, cy + s * 0.36);
    ctx.lineTo(cx - s * 0.01, cy + s * 0.36);
    ctx.lineTo(cx - s * 0.07, cy + s * 0.56);
    ctx.lineTo(cx + s * 0.14, cy + s * 0.28);
    ctx.lineTo(cx + s * 0.02, cy + s * 0.28);
    ctx.closePath();
    ctx.fill();
  }
  if (name === "fog") {
    ctx.strokeStyle = "#dfe6ef";
    ctx.lineWidth = s * 0.06;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.34, cy + s * 0.3);
    ctx.lineTo(cx + s * 0.34, cy + s * 0.3);
    ctx.moveTo(cx - s * 0.22, cy + s * 0.44);
    ctx.lineTo(cx + s * 0.22, cy + s * 0.44);
    ctx.stroke();
  }
  if (name === "snow") {
    ctx.fillStyle = "#e6f1ff";
    for (const dx of [-0.24, 0, 0.24]) {
      ctx.beginPath();
      ctx.arc(cx + dx * s, cy + s * 0.36, s * 0.045, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** One "● AQI 62 · Moderate" pill. Returns its width. The band's name is always written: never colour alone. */
function pill(ctx, x, y, dotColour, text) {
  ctx.font = font(600, 34);
  const w = ctx.measureText(text).width + 86;
  ctx.fillStyle = "rgba(6,14,30,0.42)";
  roundRect(ctx, x, y, w, 64, 32);
  ctx.fill();
  ctx.fillStyle = dotColour;
  ctx.beginPath();
  ctx.arc(x + 34, y + 32, 11, 0, TAU);
  ctx.fill();
  ctx.fillStyle = WHITE;
  ctx.fillText(text, x + 58, y + 44);
  return w;
}

/**
 * Draw the card.
 * @param {HTMLCanvasElement} canvas
 * @param {object} d        the dashboard on screen
 * @param {{top: string, bottom: string, bands: string[]}} colours  the sky gradient and the air-quality band colours, read from the page's CSS
 */
export function drawCard(canvas, d, colours) {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  ctx.textBaseline = "alphabetic";

  // sky
  const sky = ctx.createLinearGradient(0, 0, 0, CARD_H);
  sky.addColorStop(0, colours.top);
  sky.addColorStop(1, colours.bottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const haze = hazeTint(d.scene); // over the whole card, so there is no edge where the sky scene ends
  if (haze) {
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, CARD_W, CARD_H);
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, CARD_W, 700);
  ctx.clip();
  makePainter(CARD_W, 700, d.scene, { unit: 2.5, right: CARD_W - 40, veil: false }).draw(ctx, STILL);
  ctx.restore();
  // a soft shade behind the words so they read on any sky, also where clouds pass behind the place name
  const top = ctx.createLinearGradient(0, 0, 0, 280);
  top.addColorStop(0, "rgba(4,10,24,0.34)");
  top.addColorStop(1, "rgba(4,10,24,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, CARD_W, 280);
  const shade = ctx.createLinearGradient(0, 300, 0, 800);
  shade.addColorStop(0, "rgba(4,10,24,0)");
  shade.addColorStop(1, "rgba(4,10,24,0.28)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 300, CARD_W, CARD_H - 300);

  ctx.shadowColor = "rgba(4,10,24,0.35)";
  ctx.shadowBlur = 18;
  ctx.fillStyle = WHITE;
  fitText(ctx, d.place, PAD, 128, CARD_W - PAD * 2 - 240, 700, 54, 34);
  ctx.fillStyle = SOFT;
  ctx.font = font(500, 34);
  ctx.fillText(d.now.date, PAD, 182);

  // temperature
  ctx.fillStyle = WHITE;
  // the number large, "°C" small beside its top: a degree sign at full size would dwarf the unit
  const figure = d.now.temp.replace("°", "");
  ctx.font = font(200, 300);
  ctx.fillText(figure, PAD - 14, 540);
  const tempWidth = ctx.measureText(figure).width;
  ctx.font = font(400, 104);
  ctx.fillText(`${d.now.temp.includes("°") ? "°" : ""}${d.now.unit}`, PAD - 14 + tempWidth + 10, 404);
  fitText(ctx, d.now.cond, PAD, 640, CARD_W - PAD * 2, 700, 68, 40);
  ctx.fillStyle = SOFT;
  fitText(ctx, `${d.now.feels}  ·  ↑ ${d.now.hi}  ↓ ${d.now.lo}`, PAD, 706, CARD_W - PAD * 2, 500, 38, 28);
  ctx.shadowBlur = 0;

  // air quality pills
  let x = PAD;
  const band = (level) => colours.bands[Math.max(0, Math.min(5, level))] || WHITE;
  if (d.air) x += pill(ctx, x, 760, band(d.air.level), `AQI ${d.air.aqi} · ${d.air.label}`) + 20;
  if (d.ipu) {
    const text = `IPU ${d.ipu.value} · ${d.ipu.label}`;
    ctx.font = font(600, 34);
    if (x + ctx.measureText(text).width + 86 <= CARD_W - PAD) pill(ctx, x, 760, band(d.ipu.level), text); // left out rather than clipped
  }

  // rain outlook
  ctx.fillStyle = WHITE;
  ctx.font = font(600, 38);
  wrapLines(ctx, d.rain.text, CARD_W - PAD * 2, 2).forEach((line, i) => ctx.fillText(line, PAD, 896 + i * 50));

  // next days
  const days = d.daily.slice(0, 3);
  const panelY = 1000;
  const panelH = 230;
  ctx.fillStyle = "rgba(255,255,255,0.13)";
  roundRect(ctx, PAD, panelY, CARD_W - PAD * 2, panelH, 36);
  ctx.fill();
  const colW = (CARD_W - PAD * 2) / Math.max(1, days.length);
  days.forEach((day, i) => {
    const cx = PAD + colW * i + colW / 2;
    ctx.textAlign = "center";
    ctx.fillStyle = WHITE;
    fitText(ctx, day.label, cx, panelY + 56, colW - 24, 700, 36, 26);
    drawIcon(ctx, day.icon, cx, panelY + 108, 92);
    ctx.fillStyle = WHITE;
    ctx.font = font(700, 38);
    ctx.fillText(`${day.hi}`, cx + 50, panelY + 200);
    ctx.fillStyle = SOFT;
    ctx.font = font(500, 38);
    ctx.fillText(`${day.lo}`, cx - 50, panelY + 200);
    ctx.textAlign = "left";
  });

  // footer
  ctx.fillStyle = WHITE;
  ctx.font = font(700, 36);
  ctx.fillText("SkyBrief", PAD, CARD_H - 48);
  ctx.fillStyle = SOFT;
  ctx.font = font(500, 28);
  ctx.textAlign = "right";
  fitText(ctx, d.footer.observed, CARD_W - PAD, CARD_H - 48, CARD_W - PAD * 2 - 220, 500, 28, 22);
  ctx.textAlign = "left";
  return true;
}
