// The animated sky behind the current weather (FR-3): sun, moon and stars, drifting clouds, rain, lightning,
// wind streaks with leaves, fog. One <canvas>, no libraries.
//
// Design rules:
//  * Every position is a pure function of time. Nothing accumulates, so pausing, resizing or jumping to a still
//    frame can never leave the scene in an odd state.
//  * It stops when the page is hidden or the sky is scrolled away, and under "reduce motion" it draws ONE still
//    frame and never animates.
//  * Bright things (sun, moon, lightning) live in the top-right corner, away from the text on the left.
//  * The sky colour itself is a CSS gradient on the parent; the canvas only adds the moving parts.

const TAU = Math.PI * 2;
const STILL_TIME = 2.4; // the frame shown under "reduce motion" (no lightning flash at this moment)

/** Small seeded random generator: the same scene always looks the same. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEEDS = { clear: 11, partly: 23, cloudy: 37, fog: 41, rain: 53, storm: 67, windy: 79 };

// cloud colours: [top, bottom]
const CLOUDS = {
  day: ["#ffffff", "#d9e6f5"],
  grey: ["#e2e7ee", "#a5b0be"],
  dark: ["#a9b3c1", "#667284"],
  night: ["#8792ad", "#4c5771"],
  nightDark: ["#636c80", "#363e50"],
};

const CLOUD_SHAPES = [
  [[70, 100, 42], [122, 72, 54], [188, 84, 50], [240, 106, 36]],
  [[58, 106, 34], [108, 86, 46], [166, 66, 56], [226, 92, 46], [264, 110, 28]],
  [[82, 100, 46], [152, 76, 58], [222, 100, 44]],
];

function cloudSprite(colors, variant) {
  const c = document.createElement("canvas");
  c.width = 320;
  c.height = 170;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 20, 0, 150);
  g.addColorStop(0, colors[0]);
  g.addColorStop(1, colors[1]);
  x.fillStyle = g;
  x.shadowColor = colors[1];
  x.shadowBlur = 10;
  x.beginPath();
  for (const [cx, cy, r] of CLOUD_SHAPES[variant]) {
    x.moveTo(cx + r, cy);
    x.arc(cx, cy, r, 0, TAU);
  }
  x.moveTo(280, 122);
  x.ellipse(160, 122, 120, 24, 0, 0, TAU);
  x.fill();
  return c;
}

function moonSprite(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const x = c.getContext("2d");
  const r = size / 2;
  x.fillStyle = "#f6f2e2";
  x.beginPath();
  x.arc(r, r, r * 0.92, 0, TAU);
  x.fill();
  x.globalCompositeOperation = "destination-out"; // bite a circle out of the disc: a crescent on any sky colour
  x.beginPath();
  x.arc(r * 1.42, r * 0.72, r * 0.84, 0, TAU);
  x.fill();
  return c;
}

const wrap = (v, span) => ((v % span) + span) % span;

/**
 * The colour of the haze veil for a scene, or null when the air is fine. A DARK dusty tone on purpose: blending the
 * sky towards it keeps white text readable (it is darker than every sky's lightest stop), unlike a pale smog colour.
 */
export function hazeTint(scene) {
  const alpha = [0, 0.3, 0.5][scene && scene.haze] || 0;
  return alpha ? `rgba(${scene.night ? "74,66,56" : "120,104,84"},${alpha})` : null;
}

/**
 * Everything needed to draw one scene at one size. Pure: it only draws on the context it is given, so the same
 * painter serves the live sky and the still picture on the share card.
 *
 * @param {number} w  width in CSS pixels
 * @param {number} h  height in CSS pixels
 * @param {{kind: string, night: boolean, wind: number, rain: number}} scene
 * @param {{unit?: number, right?: number, veil?: boolean}} [opts]  unit = size factor (default follows the width);
 *                                                  right = x of the right edge the sun / moon hangs from;
 *                                                  veil = false leaves the flat haze tint to the caller (the share card)
 * @returns {{ draw(ctx: CanvasRenderingContext2D, t: number): void }}
 */
export function makePainter(w, h, scene, opts = {}) {
  let parts = null;
  build();
  return { draw };

  // ---------------------------------------------------------------- build (once per scene / size)
  function build() {
    if (!scene || !w || !h) return;
    const R = seeded(SEEDS[scene.kind] ?? 1);
    const kind = scene.kind;
    const night = scene.night;
    const wet = kind === "rain" || kind === "storm";
    const u = opts.unit ?? Math.max(0.85, Math.min(1.5, w / 390)); // scale everything a little with the screen
    const right = opts.right ?? Math.min(w, w / 2 + 480) - 16; // right edge of the page column on wide screens
    const body = { x: right - 54 * u, y: 112 * u, r: 30 * u };

    parts = { u, body, sun: false, moon: null, stars: [], clouds: [], drops: [], streaks: [], leaves: [], fog: [], bolts: null, haze: null, hazeBands: [] };

    const showBody = kind === "clear" || kind === "partly" || kind === "windy";
    if (showBody && !night) parts.sun = true;
    if (showBody && night) {
      parts.moon = moonSprite(Math.round(body.r * 2.4));
      const n = kind === "clear" ? 46 : 26;
      for (let i = 0; i < n; i++) {
        parts.stars.push({ x: R() * w, y: R() * h * 0.7, r: 0.6 + R() * 1.1, speed: 0.6 + R() * 1.6, phase: R() * TAU });
      }
    }

    // clouds
    const count = { clear: 0, partly: 3, windy: 3, fog: 3, cloudy: 6, rain: 5 + scene.rain, storm: 8 }[kind] ?? 0;
    const palette = night ? (wet ? CLOUDS.nightDark : CLOUDS.night) : wet ? CLOUDS.dark : kind === "cloudy" || kind === "fog" ? CLOUDS.grey : CLOUDS.day;
    const sprites = count ? [0, 1, 2].map((v) => cloudSprite(palette, v)) : [];
    const drift = kind === "windy" ? 70 + 80 * scene.wind : 6 + 46 * scene.wind;
    const heavy = kind === "cloudy" || wet;
    for (let i = 0; i < count; i++) {
      const wd = (heavy ? 190 + R() * 150 : 130 + R() * 110) * u;
      const y = (heavy ? -0.06 + R() * 0.46 : 0.02 + R() * 0.3) * h;
      parts.clouds.push({
        sprite: sprites[i % 3],
        wd,
        ht: (wd * 170) / 320,
        y,
        x0: R() * (w + wd),
        speed: drift * (0.6 + R() * 0.8),
        // clouds lower down pass behind the text, so they are fainter
        alpha: (heavy ? 0.8 : 0.9) * (y > h * 0.3 ? 0.45 : 1) * (night ? 0.8 : 1),
      });
    }
    parts.clouds.sort((a, b) => a.wd - b.wd); // small (far) ones first

    // fog bands
    if (kind === "fog") {
      for (let i = 0; i < 6; i++) {
        parts.fog.push({ y: (0.2 + R() * 0.75) * h, ht: (44 + R() * 50) * u, speed: 0.05 + R() * 0.09, phase: R() * TAU, alpha: 0.1 + R() * 0.1 });
      }
    }

    // haze: slow dusty bands in the upper sky, on top of the flat veil
    parts.haze = hazeTint(scene);
    if (parts.haze) {
      const H = seeded(97);
      for (let i = 0; i < 4 + scene.haze * 2; i++) {
        parts.hazeBands.push({ y: (0.04 + H() * 0.5) * h, ht: (50 + H() * 60) * u, speed: 0.03 + H() * 0.05, phase: H() * TAU, alpha: 0.05 + H() * 0.05 * scene.haze });
      }
    }

    // rain
    if (scene.rain > 0) {
      const slant = 0.12 + 0.5 * scene.wind;
      const n = Math.round([0, 70, 130, 210][scene.rain] * Math.max(0.8, Math.min(2.4, w / 390)));
      for (let i = 0; i < n; i++) {
        parts.drops.push({
          x0: R() * (w + 60),
          y0: R() * (h + 40),
          len: (9 + R() * 12) * (1 + scene.rain * 0.18),
          speed: 520 + R() * 380,
          bucket: i % 3,
        });
      }
      parts.slant = slant;
    }

    // lightning: two fixed bolts on the right, used in turn
    if (kind === "storm") {
      parts.bolts = [0, 1].map(() => {
        const pts = [];
        let x = right - (40 + R() * 150) * u;
        let y = h * 0.08;
        pts.push([x, y]);
        while (y < h * 0.62) {
          x += (R() - 0.45) * 46 * u;
          y += (18 + R() * 26) * u;
          pts.push([x, y]);
        }
        return pts;
      });
    }

    // wind
    if (kind === "windy") {
      for (let i = 0; i < 13; i++) {
        const len = (70 + R() * 110) * u;
        parts.streaks.push({
          y: (0.1 + R() * 0.8) * h,
          len,
          x0: R() * (w + len * 2),
          speed: (240 + R() * 240) * (0.7 + scene.wind),
          amp: 3 + R() * 7,
          phase: R() * TAU,
          width: 1.3 + R() * 1.3,
          alpha: 0.28 + R() * 0.3,
        });
      }
      const leafColours = ["#b9e08c", "#f2d16b", "#e9a35a"];
      for (let i = 0; i < 8; i++) {
        parts.leaves.push({
          y: (0.15 + R() * 0.7) * h,
          x0: R() * (w + 40),
          speed: (150 + R() * 170) * (0.7 + scene.wind),
          sway: 10 + R() * 18,
          phase: R() * TAU,
          size: (3.5 + R() * 2.5) * u,
          colour: leafColours[i % 3],
        });
      }
    }
  }

  // ---------------------------------------------------------------- draw one frame at time t (seconds)
  function draw(ctx, t) {
    if (!parts) return;
    const { body, u } = parts;

    if (parts.sun) {
      const pulse = 1 + 0.05 * Math.sin(t * 1.3);
      const halo = ctx.createRadialGradient(body.x, body.y, body.r * 0.6, body.x, body.y, body.r * 3.5 * pulse);
      halo.addColorStop(0, "rgba(255,228,140,0.55)");
      halo.addColorStop(0.45, "rgba(255,214,110,0.16)");
      halo.addColorStop(1, "rgba(255,214,110,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(body.x, body.y, body.r * 3.5 * pulse, 0, TAU);
      ctx.fill();

      ctx.save();
      ctx.translate(body.x, body.y);
      ctx.rotate(t * 0.12);
      ctx.fillStyle = "rgba(255,238,175,0.5)";
      for (let i = 0; i < 12; i++) {
        ctx.rotate(TAU / 12);
        const reach = body.r * (1.85 + 0.3 * (i % 2)) * pulse;
        ctx.beginPath();
        ctx.moveTo(body.r * 1.22, -body.r * 0.1);
        ctx.lineTo(reach, 0);
        ctx.lineTo(body.r * 1.22, body.r * 0.1);
        ctx.fill();
      }
      ctx.restore();

      const core = ctx.createRadialGradient(body.x - body.r * 0.25, body.y - body.r * 0.25, body.r * 0.1, body.x, body.y, body.r);
      core.addColorStop(0, "#fffbe2");
      core.addColorStop(0.6, "#ffe37c");
      core.addColorStop(1, "#ffc93c");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(body.x, body.y, body.r, 0, TAU);
      ctx.fill();
    }

    if (parts.moon) {
      ctx.fillStyle = "#ffffff";
      for (const s of parts.stars) {
        ctx.globalAlpha = 0.3 + 0.7 * Math.abs(Math.sin(t * s.speed + s.phase));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      const glow = ctx.createRadialGradient(body.x, body.y, body.r * 0.5, body.x, body.y, body.r * 2.8);
      glow.addColorStop(0, "rgba(200,214,255,0.3)");
      glow.addColorStop(1, "rgba(200,214,255,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(body.x, body.y, body.r * 2.8, 0, TAU);
      ctx.fill();
      const size = parts.moon.width;
      ctx.drawImage(parts.moon, body.x - size / 2, body.y - size / 2 + Math.sin(t * 0.5) * 2 * u);
    }

    for (const c of parts.clouds) {
      ctx.globalAlpha = c.alpha;
      ctx.drawImage(c.sprite, wrap(c.x0 + c.speed * t, w + c.wd) - c.wd, c.y, c.wd, c.ht);
    }
    ctx.globalAlpha = 1;

    for (const f of parts.fog) {
      const x = -w * 0.25 + Math.sin(t * f.speed + f.phase) * w * 0.2;
      const g = ctx.createLinearGradient(x, 0, x + w * 1.5, 0);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, `rgba(255,255,255,${f.alpha})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x, f.y, w * 1.5, f.ht);
    }

    if (parts.haze) {
      if (opts.veil !== false) {
        ctx.fillStyle = parts.haze;
        ctx.fillRect(0, 0, w, h);
      }
      for (const b of parts.hazeBands) {
        const x = -w * 0.25 + Math.sin(t * b.speed + b.phase) * w * 0.2;
        const g = ctx.createLinearGradient(x, 0, x + w * 1.5, 0);
        g.addColorStop(0, "rgba(196,176,140,0)");
        g.addColorStop(0.5, `rgba(196,176,140,${b.alpha})`);
        g.addColorStop(1, "rgba(196,176,140,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x, b.y, w * 1.5, b.ht);
      }
    }

    if (parts.drops.length) {
      const slant = parts.slant;
      ctx.lineCap = "round";
      for (let bucket = 0; bucket < 3; bucket++) {
        ctx.strokeStyle = `rgba(226,238,255,${0.3 + bucket * 0.14})`;
        ctx.lineWidth = 1 + bucket * 0.3;
        ctx.beginPath();
        for (const d of parts.drops) {
          if (d.bucket !== bucket) continue;
          const fallen = d.speed * t;
          const y = wrap(d.y0 + fallen, h + 40) - 20;
          const x = wrap(d.x0 + fallen * slant, w + 60) - 30;
          ctx.moveTo(x, y);
          ctx.lineTo(x - slant * d.len, y - d.len);
        }
        ctx.stroke();
      }
    }

    if (parts.bolts) {
      // one strike every 7.5 s: flash, flicker, fade. At most two flashes per second (well under the seizure-safety limit of three).
      const cycle = Math.floor(t / 7.5);
      const p = t - cycle * 7.5;
      const f = p < 0.07 ? 1 : p < 0.14 ? 0.2 : p < 0.22 ? 0.85 : p < 0.6 ? 0.85 * (1 - (p - 0.22) / 0.38) : 0;
      if (f > 0) {
        ctx.fillStyle = `rgba(214,226,255,${f * 0.14})`;
        ctx.fillRect(0, 0, w, h);
        const pts = parts.bolts[cycle % 2];
        ctx.save();
        ctx.strokeStyle = `rgba(255,255,236,${f})`;
        ctx.lineWidth = 2.2 * u;
        ctx.lineJoin = "round";
        ctx.shadowColor = "rgba(190,210,255,0.9)";
        ctx.shadowBlur = 14;
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
        ctx.restore();
      }
    }

    if (parts.streaks.length) {
      ctx.lineCap = "round";
      for (const s of parts.streaks) {
        const head = wrap(s.x0 + s.speed * t, w + s.len * 2) - s.len;
        const g = ctx.createLinearGradient(head - s.len, 0, head, 0);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(1, `rgba(255,255,255,${s.alpha})`);
        ctx.strokeStyle = g;
        ctx.lineWidth = s.width;
        ctx.beginPath();
        for (let i = 0; i <= 14; i++) {
          const x = head - (s.len * i) / 14;
          const y = s.y + s.amp * Math.sin(x * 0.02 + s.phase);
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
      for (const l of parts.leaves) {
        const x = wrap(l.x0 + l.speed * t, w + 40) - 20;
        const y = l.y + l.sway * Math.sin(t * 1.7 + l.phase);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * 3 + l.phase);
        ctx.fillStyle = l.colour;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.ellipse(0, 0, l.size, l.size * 0.45, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }
  }

}

/** The moment shown when nothing may move (reduced motion, the share card). */
export const STILL = STILL_TIME;

/**
 * The live, animated sky.
 * @param {HTMLCanvasElement} canvas
 * @returns {{ set(scene: {kind: string, night: boolean, wind: number, rain: number}): void } | null}
 *          null when the browser has no 2D canvas (the CSS sky is still shown).
 */
export function createSky(canvas) {
  const ctx = canvas.getContext ? canvas.getContext("2d") : null;
  if (!ctx) return null;

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  let w = 0;
  let h = 0;
  let scene = null;
  let painter = null;
  let raf = 0;
  let origin = 0;
  let onScreen = true;

  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    if (painter) painter.draw(ctx, t);
  }

  // ---------------------------------------------------------------- loop control
  function frame(now) {
    raf = 0;
    if (!origin) origin = now;
    draw((now - origin) / 1000);
    run();
  }
  function run() {
    if (!scene || reduce.matches) return;
    if (!raf && onScreen && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function refresh() {
    if (!scene) return;
    canvas.dataset.animated = String(!reduce.matches);
    if (reduce.matches) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      draw(STILL_TIME);
    } else run();
  }
  function resize() {
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = box.width;
    h = box.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    painter = scene ? makePainter(w, h, scene) : null;
    if (scene) draw(reduce.matches || !origin ? STILL_TIME : (performance.now() - origin) / 1000);
  }

  if ("ResizeObserver" in window) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener("resize", resize);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      onScreen = entries[entries.length - 1].isIntersecting;
      run();
    }).observe(canvas);
  }
  document.addEventListener("visibilitychange", run);
  reduce.addEventListener?.("change", refresh);

  return {
    set(next) {
      scene = next;
      canvas.dataset.scene = `${next.kind}-${next.night ? "night" : "day"}`;
      canvas.dataset.haze = String(next.haze || 0);
      resize();
      refresh();
    },
  };
}
