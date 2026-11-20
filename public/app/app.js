// SkyBrief Mini App: boot, API calls, rendering, and the three sheets (location, settings, share).
//
// The server sends a ready-to-draw "dashboard" (already translated, already in the person's units), so this file
// holds no weather rules and formats no numbers. All text is written with textContent, never as HTML.
// Requirements: docs/REQUIREMENTS.md (FR-2 .. FR-18). Failure behaviour: docs/FALLBACKS.md.
import { BOOT, bootLang } from "./boot-strings.js";
import { drawCard } from "./card.js";
import { createSky } from "./scene.js";

const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
/** Telegram's script also loads in a normal browser, where it reports platform "unknown" and no initData. */
const inTelegram = !!tg && !!tg.initData;
const initData = inTelegram ? tg.initData : "";
const tgUser = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) || null;
const query = new URLSearchParams(location.search);
const demoScene = query.get("demo");

const REFRESH_AFTER_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 12000;
const GPS_TIMEOUT_MS = 15000;
const CACHE_KEY = `skybrief.dash.v2.${tgUser && tgUser.id ? tgUser.id : "anon"}`;
const DAYS_KEY = "skybrief.days";
const TIPS_KEY = "skybrief.tips.v1";
const SVG = "http://www.w3.org/2000/svg";
const AQI_STEPS = [0, 50, 100, 150, 200, 300, 500];
const HTML_LANG = { en: "en", ms: "ms", zh: "zh-Hans" };
const LANGUAGES = [["en", "English"], ["ms", "Bahasa Melayu"], ["zh", "中文"]];

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const boot = BOOT[bootLang(query.get("lang") || (tgUser && tgUser.language_code) || navigator.language)];

// Storage can be blocked or full (F11): never let that break the page.
const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* works without it */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* nothing to remove */
    }
  },
};

let dash = null; // the dashboard on screen
let S = {}; // its texts
let stale = false; // true while the data on screen is a saved copy that could not be refreshed
let loadedAt = 0;
let days = store.get(DAYS_KEY) === "7" ? 7 : 3;
let openDay = -1; // which forecast row is opened up
let toastTimer = 0;
let activeSheet = null; // the dialog that is open, and the button that opened it
let sheetOpener = null;
const sky = createSky($("sky"));

// ---------------------------------------------------------------- small helpers
function el(tag, props, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "data") for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = String(dv);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid);
  return node;
}

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
  return node;
}

/** An icon from the sprite. With a label it is announced as an image; without, it is decoration. */
function icon(name, cls = "ico", label) {
  const svg = svgEl("svg", { class: cls });
  if (label) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
  } else svg.setAttribute("aria-hidden", "true");
  svg.append(svgEl("use", { href: `#i-${name}` }));
  return svg;
}

const fill = (text, params) => String(text || "").replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const refused = (e) => !!e && (e.status === 401 || e.status === 403);

function haptic(kind) {
  try {
    if (inTelegram && tg.HapticFeedback) kind === "tap" ? tg.HapticFeedback.impactOccurred("light") : tg.HapticFeedback.notificationOccurred(kind);
  } catch {
    /* decoration only */
  }
}

/** Is this Telegram new enough for a feature? Old clients simply get the fallback. */
function telegramAtLeast(version) {
  try {
    return inTelegram && typeof tg.isVersionAtLeast === "function" && tg.isVersionAtLeast(version);
  } catch {
    return false;
  }
}

function card(titleText, extraClass, ...kids) {
  const title = el("h2", { class: "card-title", text: titleText });
  return el("section", { class: `card ${extraClass || ""}`.trim() }, el("div", { class: "card-head" }, title), ...kids);
}

// ---------------------------------------------------------------- API
/**
 * GET is retried once on a network error or a 5xx. `body` is sent as JSON, `raw` as it is (a picture).
 * Throws an Error carrying status / code / userMessage.
 */
async function api(path, { method = "GET", body, raw } = {}) {
  const tries = method === "GET" ? 2 : 1;
  let failure = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt) await sleep(700);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), raw ? TIMEOUT_MS * 2 : TIMEOUT_MS);
    try {
      const headers = {};
      if (initData) headers.Authorization = `tma ${initData}`;
      if (body) headers["content-type"] = "application/json";
      if (raw) headers["content-type"] = raw.type;
      const res = await fetch(path, { method, headers, body: raw || (body ? JSON.stringify(body) : undefined), signal: ctrl.signal, cache: "no-store" });
      let data = null;
      try {
        data = await res.json();
      } catch {
        /* not JSON: handled as a failure below */
      }
      if (res.ok && data && typeof data === "object") return data;
      failure = new Error("request failed");
      failure.status = res.status;
      failure.code = (data && data.error && data.error.code) || "bad_response";
      failure.userMessage = (data && data.error && typeof data.error.message === "string" && data.error.message) || null;
      if (res.status < 500) break; // our own mistake or a refusal: asking again changes nothing
    } catch (e) {
      failure = e; // offline or timed out
    } finally {
      clearTimeout(timer);
    }
  }
  throw failure;
}

/** Never draw half-trusted data: anything that isn't shaped like a dashboard counts as a failed load. */
function isDashboard(d) {
  return !!d && d.v === 1 && typeof d.place === "string" && !!d.now && !!d.scene && !!d.details && !!d.footer && !!d.strings
    && Array.isArray(d.hourly) && Array.isArray(d.daily) && Array.isArray(d.warnings) && Array.isArray(d.tips)
    && Array.isArray(d.best) && Array.isArray(d.presets) && Array.isArray(d.places) && !!d.rain;
}

// ---------------------------------------------------------------- theme + Telegram chrome
function applyTheme() {
  const scheme = inTelegram ? tg.colorScheme : null;
  if (scheme === "dark" || scheme === "light") root.dataset.theme = scheme;
  else delete root.dataset.theme; // outside Telegram: follow the system setting (CSS media query)
}

const cssVar = (node, name) => getComputedStyle(node).getPropertyValue(name).trim();

/** Make Telegram's own header and background continue the page's colours. */
function paintChrome() {
  if (!inTelegram) return;
  try {
    const top = cssVar($("hero"), "--sky-a");
    const bg = cssVar(root, "--bg");
    if (top && tg.setHeaderColor) tg.setHeaderColor(top);
    if (bg && tg.setBackgroundColor) tg.setBackgroundColor(bg);
    if (bg && tg.setBottomBarColor) tg.setBottomBarColor(bg);
  } catch {
    /* older Telegram clients: colours are decoration only */
  }
}

// ---------------------------------------------------------------- render: the sky and the header
function renderHero(d) {
  $("hero").dataset.sky = `${d.scene.kind}-${d.scene.night ? "night" : "day"}`;
  $("hero").dataset.haze = String(d.scene.haze || 0);
  $("page-title").textContent = d.title;
  $("place-name").textContent = d.place;
  $("place-btn").setAttribute("aria-label", `${d.place}. ${S.app_change_city}`);
  $("refresh-btn").setAttribute("aria-label", S.app_refresh);
  $("settings-btn").setAttribute("aria-label", S.app_settings);
  $("share-btn").setAttribute("aria-label", S.app_share);
  $("now-date").textContent = d.now.date;
  $("now-temp").textContent = d.now.temp;
  $("now-unit").textContent = d.now.unit;
  $("now-cond").textContent = d.now.cond;
  $("now-sub").replaceChildren(
    `${d.now.feels}  ·  `,
    el("span", { class: "sr-only", text: `${S.app_high} ` }),
    el("b", { text: `↑ ${d.now.hi}` }),
    "  ",
    el("span", { class: "sr-only", text: `${S.app_low} ` }),
    el("b", { text: `↓ ${d.now.lo}` }),
  );
  const trend = $("now-trend");
  trend.hidden = !d.now.trend;
  if (d.now.trend) {
    trend.dataset.dir = d.now.trend.warmer ? "up" : "down";
    trend.replaceChildren(icon("arrow"), d.now.trend.text);
  }

  // saved places, one tap apart (FR-12)
  const chips = $("place-chips");
  const many = !d.demo && d.places.length > 1;
  chips.hidden = !many;
  chips.setAttribute("aria-label", S.app_places);
  chips.replaceChildren(
    ...(many ? d.places : []).map((p, i) => {
      const b = el("button", { type: "button", class: "chip", "aria-pressed": String(!!p.active) }, p.home && icon("home", "ico", S.app_home), el("span", { class: "chip-text", text: p.name }));
      if (!p.active) b.addEventListener("click", () => switchPlace(i));
      return el("li", null, b);
    }),
  );
  if (sky) sky.set(d.scene);
}

function renderNotices() {
  const out = [];
  if (dash && dash.demo) out.push(el("div", { class: "banner", id: "demo-banner" }, icon("info"), el("p", { class: "banner-text", text: S.app_demo })));
  if (dash && stale) {
    const retry = el("button", { type: "button", class: "btn", id: "stale-retry", text: S.app_retry });
    retry.addEventListener("click", () => load({ fresh: true }));
    out.push(el("div", { class: "banner", id: "stale-banner" }, icon("alert"), el("p", { class: "banner-text", text: fill(S.app_stale, { t: dash.now.clock }) }), retry));
  }
  $("notices").replaceChildren(...out);
}

// ---------------------------------------------------------------- render: the cards
function warningsCard(d) {
  if (!d.warnings.length) return null;
  const items = d.warnings.map((w, i) =>
    el(
      "details",
      { class: "warn", open: i === 0 },
      el("summary", null, el("span", { class: "warn-name", text: w.title }), el("span", { class: "warn-until", text: w.until }), icon("chevron")),
      el(
        "div",
        { class: "warn-body" },
        el("p", { text: w.valid }),
        w.area && el("p", null, el("strong", { text: w.area })),
        w.text && el("p", { text: w.text }),
        w.instruction && el("p", null, el("em", { text: w.instruction })),
      ),
    ),
  );
  const section = el("section", { class: "card card-warn span2", id: "warnings" });
  section.append(el("div", { class: "card-head" }, el("h2", { class: "card-title" }, icon("alert"), S.warn_block_title)), ...items, el("p", { class: "warn-src", text: S.warn_source }));
  return section;
}

/**
 * The temperature over the next 24 hours as one smooth line (FR-16). One measure, one scale: rain chance keeps its
 * own row below. Every point sits exactly above its hour's column, whose own text gives the exact value, so the
 * drawing itself is decoration for assistive technology. Returns null when there are too few known temperatures.
 */
function hourChart(hours, id) {
  const points = hours.map((h, i) => ({ i, t: h.t })).filter((p) => typeof p.t === "number" && Number.isFinite(p.t));
  if (points.length < 2) return null;
  const COL = 100;
  const H = 100;
  const PAD = 14;
  const min = Math.min(...points.map((p) => p.t));
  const max = Math.max(...points.map((p) => p.t));
  const span = max - min || 1;
  const xy = points.map((p) => [(p.i + 0.5) * COL, PAD + (1 - (p.t - min) / span) * (H - PAD * 2)]);
  // a gentle curve through the points (Catmull-Rom turned into cubic Béziers)
  let line = `M${xy[0][0]} ${xy[0][1].toFixed(1)}`;
  for (let k = 0; k < xy.length - 1; k++) {
    const p0 = xy[Math.max(0, k - 1)];
    const p1 = xy[k];
    const p2 = xy[k + 1];
    const p3 = xy[Math.min(xy.length - 1, k + 2)];
    line += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0]} ${p2[1].toFixed(1)}`;
  }
  const svg = svgEl("svg", { class: "chart", viewBox: `0 0 ${hours.length * COL} ${H}`, preserveAspectRatio: "none", "aria-hidden": "true", focusable: "false" });
  svg.append(
    svgEl("path", { class: "chart-area", d: `${line} L${xy[xy.length - 1][0]} ${H} L${xy[0][0]} ${H} Z` }),
    svgEl("path", { class: "chart-line", d: line, "vector-effect": "non-scaling-stroke" }),
  );
  if (id) svg.id = id;
  return svg;
}

/** A row of hours that scrolls sideways, with the temperature line above it. Used for "next 24 hours" and for any day. */
function hourStrip(hours, label, ids = {}) {
  const list = el(
    "ul",
    { class: "hours", role: "list", id: ids.list },
    hours.map((x) => {
      const meter = el("span", { class: "hour-meter", "aria-hidden": "true" }, el("span"));
      meter.firstChild.style.setProperty("--size", `${Math.max(0, Math.min(100, x.prob))}%`);
      return el(
        "li",
        { class: "hour" },
        el("span", { class: "hour-time", text: x.label }),
        icon(x.icon, "wx", x.cond),
        el("span", { class: "hour-temp", text: x.temp }),
        el("span", { class: "hour-prob", data: { wet: x.prob >= 50 } }, icon("water"), el("span", { class: "sr-only", text: `${S.app_rain_chance} ` }), `${x.prob}%`),
        meter,
      );
    }),
  );
  return el("div", { class: "hours-scroll", id: ids.scroll, tabindex: "0", role: "group", "aria-label": label }, el("div", { class: "hours-inner" }, hourChart(hours, ids.chart), list));
}

const RAIN_ICON = { now: "water", likely: "water", chance: "water", none: "check" };

function hourlyCard(d) {
  const scroller = hourStrip(d.hourly, S.app_hourly, { list: "hours", scroll: "hours-scroll", chart: "hour-chart" });
  const line = el("p", { class: "rainline", id: "rainline", data: { level: d.rain.level } }, icon(RAIN_ICON[d.rain.level] || "water"), el("span", { text: d.rain.text }));
  const section = card(S.rain_title, "span2", line, el("h3", { class: "card-title block-title", text: S.app_hourly }), scroller);
  section.id = "hourly";
  return section;
}

function aqiPosition(aqi) {
  const v = Math.max(0, Math.min(500, aqi));
  let i = AQI_STEPS.findIndex((step, k) => k > 0 && v <= step);
  if (i < 1) i = AQI_STEPS.length - 1;
  return ((i - 1 + (v - AQI_STEPS[i - 1]) / (AQI_STEPS[i] - AQI_STEPS[i - 1])) / 6) * 100;
}

function bandDot(level) {
  const dot = el("span", { class: "aqi-dot" });
  dot.style.setProperty("--aqi-c", `var(--aqi-${Math.max(0, Math.min(5, level))})`);
  return dot;
}

/** Malaysia's official index (FR-14). Absent whenever there is no fresh official reading: no placeholder, no guess. */
function ipuBlock(d) {
  const u = d.ipu;
  if (!u) return null;
  return el(
    "div",
    { class: "ipu", id: "ipu" },
    el("h3", { class: "card-title", text: S.app_ipu_title }),
    el("div", { class: "aqi-top" }, el("p", { class: "ipu-num", id: "ipu-value", text: String(u.value) }), el("p", { class: "aqi-band" }, bandDot(u.level), el("span", { id: "ipu-label", text: u.label }))),
    el("p", { class: "small", id: "ipu-station", text: u.station }),
    el("p", { class: "small", text: u.source }),
  );
}

function airCard(d) {
  const a = d.air;
  if (!a) {
    const empty = card(S.air_title, "", el("p", { id: "air-none", text: S.air_unavail }), ipuBlock(d));
    empty.id = "air";
    return empty;
  }
  const pin = el("span", { class: "aqi-pin" });
  pin.style.setProperty("--pos", `${aqiPosition(a.aqi).toFixed(1)}%`);
  const facts = [a.pm25 && `PM2.5 ${a.pm25}`, a.pm10 && `PM10 ${a.pm10}`, a.dominant].filter(Boolean).join("  ·  ");
  const section = card(
    S.air_title,
    "",
    el("div", { class: "aqi-top" }, el("p", { class: "aqi-num", id: "aqi-value" }, el("span", { class: "sr-only", text: "AQI " }), String(a.aqi)), el("p", { class: "aqi-band" }, bandDot(a.level), el("span", { id: "aqi-label", text: a.label }))),
    el(
      "div",
      { class: "aqi-scale", role: "img", "aria-label": fill(S.app_aqi_scale, { n: a.aqi }) },
      el("div", { class: "aqi-bar" }, [0, 1, 2, 3, 4, 5].map(() => el("span"))),
      pin,
    ),
    el("div", { class: "aqi-ends", "aria-hidden": "true" }, el("span", { text: "0" }), el("span", { text: "500" })),
    el(
      "div",
      { class: "aqi-facts" },
      facts && el("p", { text: facts }),
      a.outlook && el("p", { class: "aqi-outlook", data: { kind: a.outlook.kind } }, icon("arrow"), el("span", { text: a.outlook.text })),
    ),
    ipuBlock(d),
    el("p", { class: "small note", id: "aqi-note", text: S.app_aqi_note }),
  );
  section.id = "air";
  return section;
}

/** What a day's row opens up to show (FR-15). A line with no data is left out. */
function dayDetail(x, id) {
  const t = x.detail;
  if (!t) return null;
  const facts = [t.rain, t.wind, t.uv, t.sun, t.air, t.best].filter(Boolean);
  return el(
    "div",
    { class: "day-detail", id, hidden: true },
    Array.isArray(t.periods) && t.periods.length > 0 &&
      el(
        "ul",
        { class: "periods", role: "list" },
        t.periods.map((p) =>
          el(
            "li",
            { class: "period" },
            el("span", { class: "period-name", text: p.label }),
            icon(p.icon, "wx", p.cond),
            el("span", { class: "period-temp", text: p.temp }),
            el("span", { class: "day-prob", data: { wet: p.prob >= 50 } }, icon("water"), el("span", { class: "sr-only", text: `${S.app_rain_chance} ` }), `${p.prob}%`),
          ),
        ),
      ),
    Array.isArray(t.hours) && t.hours.length > 1 && hourStrip(t.hours, fill(S.app_day_hours, { d: x.label })),
    facts.length > 0 && el("ul", { class: "facts", role: "list" }, facts.map((f) => el("li", { text: f }))),
    Array.isArray(t.tips) && t.tips.length > 0 && el("ul", { class: "tips", role: "list" }, t.tips.map((tip) => el("li", { text: tip }))),
  );
}

function renderDays(list, d) {
  const shown = d.daily.slice(0, days);
  if (openDay >= shown.length) openDay = -1;
  const lows = d.daily.map((x) => x.loN).filter((n) => n != null);
  const highs = d.daily.map((x) => x.hiN).filter((n) => n != null);
  const min = lows.length ? Math.min(...lows) : 0;
  const max = highs.length ? Math.max(...highs) : 0;
  const span = max - min || 1;
  list.replaceChildren(
    ...shown.map((x, i) => {
      const bar = el("span");
      const known = x.loN != null && x.hiN != null;
      if (known) {
        bar.style.setProperty("--from", `${(((x.loN - min) / span) * 100).toFixed(1)}%`);
        bar.style.setProperty("--size", `${Math.max(8, ((x.hiN - x.loN) / span) * 100).toFixed(1)}%`);
      }
      const detail = dayDetail(x, `day-detail-${i}`);
      // the whole row is one button; inside a button only inline elements are allowed, hence the spans
      const row = el(
        "button",
        { type: "button", class: "day", "aria-expanded": detail ? "false" : null, "aria-controls": detail ? `day-detail-${i}` : null, disabled: !detail },
        icon(x.icon, "wx"),
        el("span", { class: "day-main" }, el("span", { class: "day-name", data: { weekend: x.weekend } }, x.label, x.weekend && el("span", { class: "sr-only", text: ` (${S.app_weekend})` })), el("span", { class: "day-cond", text: x.cond })),
        el("span", { class: "day-prob", data: { wet: x.prob >= 50 } }, icon("water"), el("span", { class: "sr-only", text: `${S.app_rain_chance} ` }), `${x.prob}%`),
        el(
          "span",
          { class: "day-temps" },
          el("span", { class: "day-nums" }, el("span", { class: "day-lo" }, el("span", { class: "sr-only", text: `${S.app_low} ` }), x.lo), el("span", { class: "day-hi" }, el("span", { class: "sr-only", text: `${S.app_high} ` }), x.hi)),
          known && el("span", { class: "range", "aria-hidden": "true" }, bar),
        ),
        detail && icon("chevron", "ico day-chevron"),
      );
      const setOpen = (open) => {
        row.setAttribute("aria-expanded", String(open));
        detail.hidden = !open;
      };
      if (detail) {
        if (i === openDay) setOpen(true);
        row.addEventListener("click", () => {
          const opening = row.getAttribute("aria-expanded") !== "true";
          for (const other of list.querySelectorAll('.day[aria-expanded="true"]')) {
            other.setAttribute("aria-expanded", "false");
            other.nextElementSibling.hidden = true;
          }
          setOpen(opening);
          openDay = opening ? i : -1;
          haptic("tap");
        });
      }
      return el("li", { class: "day-item" }, row, detail);
    }),
  );
}

function forecastCard(d) {
  const list = el("ul", { class: "days", id: "days", role: "list" });
  const make = (n, label) => {
    const b = el("button", { type: "button", "aria-pressed": String(days === n), id: `days-${n}`, text: label });
    b.addEventListener("click", () => {
      days = n;
      store.set(DAYS_KEY, String(n));
      for (const other of seg.children) other.setAttribute("aria-pressed", String(other === b));
      renderDays(list, dash);
      haptic("tap");
    });
    return b;
  };
  const seg = el("div", { class: "seg", role: "group", "aria-label": S.app_forecast });
  seg.append(make(3, S.app_days3), make(7, S.app_days7));
  const section = el("section", { class: "card", id: "forecast" }, el("div", { class: "card-head card-head-forecast" }, el("h2", { class: "card-title", text: S.app_forecast }), seg), list);
  renderDays(list, d);
  return section;
}

function tile(iconName, label, value, sub) {
  return el("li", { class: "tile" }, el("p", { class: "tile-label" }, icon(iconName), label), el("p", { class: "tile-value" }, value), sub && el("p", { class: "tile-sub", text: sub }));
}

function detailsCard(d) {
  const x = d.details;
  const windValue = [x.wind.speed + (x.wind.dir ? ` ${x.wind.dir}` : "")];
  if (x.wind.deg != null) {
    const arrow = icon("arrow", "compass");
    arrow.style.setProperty("--deg", `${(x.wind.deg + 180) % 360}deg`); // points where the wind is going
    windValue.unshift(arrow);
  }
  const sun = el("li", { class: "tile" }, el("p", { class: "tile-label" }, icon("sunrise"), `${S.app_sunrise} · ${S.app_sunset}`), el("p", { class: "sun-times" }, el("span", { text: x.sunrise }), el("span", { text: x.sunset })));
  if (x.sunPos != null) {
    const dot = el("span");
    dot.style.setProperty("--pos", `${Math.round(x.sunPos * 100)}%`);
    sun.append(el("div", { class: "sun-track", "aria-hidden": "true" }, dot));
  }
  const section = card(
    S.app_details,
    "",
    el(
      "ul",
      { class: "tiles", role: "list" },
      tile("water", S.humidity, [x.humidity]),
      tile("wind", S.wind, windValue, x.wind.gust),
      x.uv && tile("clear-day", S.app_uv_index, [x.uv.value], x.uv.label),
      tile("gauge", S.app_pressure, [x.pressure]),
      tile("cloudy", S.cloud, [x.cloud]),
      sun,
    ),
  );
  section.id = "details";
  return section;
}

function bestCard(d) {
  const section = card(
    S.sec_best,
    "",
    d.best.map((line) => el("p", { class: "best-line", text: line })),
    el("p", { class: "small", text: S.best_hint }),
    el("h2", { class: "card-title block-title", text: S.tips_title }),
    el("ul", { class: "tips", role: "list" }, d.tips.map((tip) => el("li", { text: tip }))),
  );
  section.id = "best";
  return section;
}

/** Draw a dashboard. Returns false, with the error screen up, if drawing fails: never a half-drawn page (F12). */
function show(d) {
  const firstPaint = !dash;
  try {
    dash = d;
    S = d.strings;
    root.lang = HTML_LANG[d.lang] || "en";
    document.title = `${d.place} · SkyBrief`;
    renderHero(d);
    renderNotices();
    $("content").replaceChildren(...[warningsCard(d), hourlyCard(d), airCard(d), forecastCard(d), detailsCard(d), bestCard(d)].filter(Boolean));
    $("foot").replaceChildren(el("p", { id: "observed", text: d.footer.observed }), el("p", { id: "source", text: d.footer.source }));
    $("place-btn").disabled = !!d.demo; // the demo has no account to save a location or settings to
    $("settings-btn").disabled = !d.settings;
    $("share-btn").disabled = false;
    $("refresh-btn").disabled = false;
    $("gate").hidden = true;
    $("app").hidden = false;
    if (firstPaint) $("app").dataset.state = "ready";
    paintChrome();
    return true;
  } catch {
    gate(boot.offline, { retry: true });
    return false;
  }
}

/** A new dashboard arrived from the server: draw it and keep a copy for next time. */
function accept(d) {
  stale = false;
  loadedAt = Date.now();
  if (!show(d)) return false;
  if (!d.demo) store.set(CACHE_KEY, JSON.stringify(d));
  return true;
}

// ---------------------------------------------------------------- full-screen message
function gate(title, { hint = "", retry = false } = {}) {
  dash = null;
  $("app").hidden = true;
  $("gate-title").textContent = title;
  $("gate-hint").textContent = hint;
  $("gate-hint").hidden = !hint;
  const button = $("gate-retry");
  button.hidden = !retry;
  button.textContent = S.app_retry || boot.retry;
  $("gate").hidden = false;
  if (activeSheet) closeSheet();
}

function toast(text) {
  const node = $("toast");
  node.textContent = text;
  node.dataset.show = "true";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.dataset.show = "false";
  }, 2600);
}

// ---------------------------------------------------------------- loading
function setBusy(on) {
  const b = $("refresh-btn");
  if (on) b.setAttribute("aria-busy", "true");
  else b.removeAttribute("aria-busy");
  $("main").setAttribute("aria-busy", String(on && !dash));
}

/** Someone who is refused must not keep seeing saved data: fail closed. */
function refuse(error) {
  store.remove(CACHE_KEY);
  gate(error.userMessage || boot.offline);
}

async function load({ fresh = false } = {}) {
  setBusy(true);
  try {
    const path = demoScene
      ? `/api/app/demo?scene=${encodeURIComponent(demoScene)}&lang=${encodeURIComponent(query.get("lang") || navigator.language || "en")}`
      : `/api/app/dashboard${fresh ? "?fresh=1" : ""}`;
    const d = await api(path);
    if (!isDashboard(d)) throw Object.assign(new Error("unexpected answer"), { code: "bad_response" });
    if (!accept(d)) return;
    if (fresh) {
      toast(S.app_updated);
      haptic("success");
    } else maybeShowTips();
  } catch (e) {
    if (refused(e)) refuse(e);
    else if (e && e.status === 400) gate(e.userMessage || boot.offline);
    else if (dash) {
      stale = true; // keep what is on screen, and say plainly that it is a saved copy
      renderNotices();
      if (fresh) haptic("error");
    } else gate((e && e.userMessage) || boot.offline, { retry: true });
  } finally {
    setBusy(false);
  }
}

/** One of the saved places, straight from the chips on the sky (FR-12). */
async function switchPlace(index) {
  setBusy(true);
  for (const b of $("place-chips").querySelectorAll("button")) b.disabled = true;
  try {
    const d = await api("/api/app/place", { method: "POST", body: { saved: index } });
    if (!isDashboard(d)) throw Object.assign(new Error("unexpected answer"), { code: "bad_response" });
    accept(d);
    haptic("success");
  } catch (e) {
    if (refused(e)) return refuse(e);
    for (const b of $("place-chips").querySelectorAll("button")) b.disabled = false;
    toast((e && e.userMessage) || S.app_err_wx); // nothing changed: the old place is still on screen
    haptic("error");
  } finally {
    setBusy(false);
  }
}

// ---------------------------------------------------------------- sheets (dialogs)
function openSheet(sheet, opener) {
  if (activeSheet && activeSheet !== sheet) closeSheet(activeSheet); // one sheet at a time (e.g. the guide opened from Settings)
  activeSheet = sheet;
  sheetOpener = opener || null;
  for (const x of sheet.querySelectorAll("[data-close]")) x.setAttribute("aria-label", S.app_close || "Close");
  if (sheet.showModal) sheet.showModal();
  else sheet.setAttribute("open", "");
  try {
    if (inTelegram && tg.BackButton) tg.BackButton.show();
  } catch {
    /* the close button is always there */
  }
}

/**
 * Close a sheet: the one given, else the one we believe is open, else whichever dialog really is open.
 * The last step means a close button can never be left doing nothing, whatever the bookkeeping says.
 * (Also used directly as a click / back-button handler, where the argument is an event or nothing.)
 */
function closeSheet(which) {
  const given = which && which.tagName === "DIALOG" ? which : null;
  const sheet = given || activeSheet || document.querySelector("dialog.sheet[open]");
  if (!sheet) return;
  if (sheet.close) sheet.close();
  else {
    sheet.removeAttribute("open");
    onSheetClosed({ target: sheet });
  }
}

/**
 * A dialog's "close" event arrives a moment AFTER close() is called. When one sheet replaces another, the old
 * sheet's late event must not clear the record of the new one, or the new sheet's buttons would stop working.
 */
function onSheetClosed(event) {
  const closed = event && event.target;
  if (closed && closed !== activeSheet) return;
  activeSheet = null;
  try {
    if (inTelegram && tg.BackButton) tg.BackButton.hide();
  } catch {
    /* nothing to hide */
  }
  if (sheetOpener && !sheetOpener.disabled && !$("app").hidden) sheetOpener.focus();
  sheetOpener = null;
}

function setStatus(id, text, tone) {
  const node = $(id);
  node.textContent = text || "";
  if (tone) node.dataset.tone = tone;
  else delete node.dataset.tone;
}

function lock(sheet, locked) {
  if (locked) sheet.setAttribute("aria-busy", "true");
  else sheet.removeAttribute("aria-busy");
  for (const c of sheet.querySelectorAll("button:not([data-close]), input")) c.disabled = locked || c.dataset.off === "true";
}

// ---------------------------------------------------------------- change location (FR-9, FR-12, FR-17)
function choiceButton(label, payload) {
  const b = el("button", { type: "button", class: "choice" }, icon("pin"), el("span", { text: label }));
  b.addEventListener("click", () => savePlace(payload));
  return el("li", null, b);
}

function renderSavedPlaces() {
  const list = dash.places || [];
  $("saved-block").hidden = list.length < 2;
  $("saved-title").textContent = S.app_places;
  $("saved").replaceChildren(
    ...list.map((p, i) => {
      const main = el("button", { type: "button", class: "choice", data: { off: !!p.active }, disabled: !!p.active }, icon("pin"), el("span", { class: "choice-text", text: p.label }), p.active && el("span", { class: "tag", text: S.app_place_current }));
      if (!p.active) main.addEventListener("click", () => savePlace({ saved: i }));
      const home = el("button", { type: "button", class: "icon-btn", "aria-pressed": String(!!p.home), "aria-label": fill(p.home ? S.app_place_unhome : S.app_place_home, { p: p.name }) }, icon("home"));
      home.addEventListener("click", () => editPlace(i, p.home ? "unhome" : "home"));
      const canMoveUp = i > 0 && !list[i - 1].home && !p.home;
      const up = canMoveUp && el("button", { type: "button", class: "icon-btn", "aria-label": fill(S.app_place_up, { p: p.name }) }, icon("arrow"));
      if (up) up.addEventListener("click", () => editPlace(i, "up"));
      const remove = !p.active && el("button", { type: "button", class: "icon-btn", "aria-label": fill(S.app_place_remove, { p: p.name }) }, icon("close"));
      if (remove) remove.addEventListener("click", () => removePlace(i));
      return el("li", { class: "saved-row" }, main, el("span", { class: "saved-actions" }, home, up, remove));
    }),
  );
  $("saved-hint").textContent = S.app_places_hint;
}

function openLocation() {
  if (!dash || dash.demo) return;
  $("sheet-title").textContent = S.app_change_city;
  $("sheet-hint").textContent = S.app_city_hint;
  $("search-label").textContent = S.app_search_label;
  $("search-input").placeholder = S.app_search_ph;
  $("search-btn-text").textContent = S.app_search_btn;
  $("gps-btn-text").textContent = S.app_gps;
  $("results-title").textContent = S.app_results;
  $("shortcuts-title").textContent = S.app_shortcuts;
  $("results-block").hidden = true;
  $("results").replaceChildren();
  $("shortcuts").replaceChildren(...dash.presets.map((name, i) => choiceButton(name, { preset: i })));
  renderSavedPlaces();
  setStatus("sheet-status", "");
  lock($("sheet"), false);
  openSheet($("sheet"), $("place-btn"));
}

async function searchPlaces(event) {
  event.preventDefault();
  const q = $("search-input").value.trim();
  if (q.length < 2) return setStatus("sheet-status", S.app_err_query, "error");
  setStatus("sheet-status", S.app_working);
  lock($("sheet"), true);
  try {
    const data = await api(`/api/app/places?q=${encodeURIComponent(q)}`);
    const results = Array.isArray(data.results) ? data.results.filter((x) => typeof x === "string") : [];
    $("results").replaceChildren(...results.map((label, i) => choiceButton(label, { pick: i })));
    $("results-block").hidden = !results.length;
    setStatus("sheet-status", results.length ? "" : S.app_no_results, results.length ? undefined : "error");
  } catch (e) {
    if (refused(e)) return refuse(e);
    $("results-block").hidden = true;
    setStatus("sheet-status", (e && e.userMessage) || S.app_err_search, "error"); // the typed text stays in the box
  } finally {
    lock($("sheet"), false);
  }
}

async function savePlace(payload) {
  setStatus("sheet-status", S.app_working);
  lock($("sheet"), true);
  try {
    const d = await api("/api/app/place", { method: "POST", body: payload });
    if (!isDashboard(d)) throw Object.assign(new Error("unexpected answer"), { code: "bad_response" });
    if (!accept(d)) return;
    $("search-input").value = "";
    closeSheet();
    toast(S.app_saved);
    haptic("success");
  } catch (e) {
    if (refused(e)) return refuse(e);
    setStatus("sheet-status", (e && e.userMessage) || S.app_err_wx, "error"); // nothing was saved; the old location stays
    haptic("error");
  } finally {
    lock($("sheet"), false);
  }
}

async function removePlace(index) {
  setStatus("sheet-status", S.app_working);
  lock($("sheet"), true);
  try {
    const d = await api("/api/app/place/remove", { method: "POST", body: { saved: index } });
    if (!isDashboard(d)) throw Object.assign(new Error("unexpected answer"), { code: "bad_response" });
    if (!accept(d)) return;
    renderSavedPlaces();
    setStatus("sheet-status", S.app_place_removed);
  } catch (e) {
    if (refused(e)) return refuse(e);
    setStatus("sheet-status", (e && e.userMessage) || S.app_err_save, "error");
  } finally {
    lock($("sheet"), false);
  }
}

/** Mark a saved place as home, take the mark away, or move it up one step (FR-20). */
async function editPlace(index, action) {
  setStatus("sheet-status", S.app_working);
  lock($("sheet"), true);
  try {
    const d = await api("/api/app/place/edit", { method: "POST", body: { saved: index, action } });
    if (!isDashboard(d)) throw Object.assign(new Error("unexpected answer"), { code: "bad_response" });
    if (!accept(d)) return;
    renderSavedPlaces();
    setStatus("sheet-status", S.app_set_saved, "ok");
    haptic("tap");
  } catch (e) {
    if (refused(e)) return refuse(e);
    renderSavedPlaces(); // back to what is really saved
    setStatus("sheet-status", (e && e.userMessage) || S.app_err_save, "error");
  } finally {
    lock($("sheet"), false);
  }
}

/** Ask the browser where we are. Rejects when it can't or may not tell us. */
function browserPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("no geolocation"));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => reject(new Error("denied")),
      { timeout: GPS_TIMEOUT_MS, maximumAge: 5 * 60 * 1000 },
    );
  });
}

/** Telegram's own location service (Telegram 8.0+), which uses the permission the person gave the bot. */
function telegramPosition() {
  return new Promise((resolve, reject) => {
    const lm = tg && tg.LocationManager;
    if (!lm || !telegramAtLeast("8.0")) return reject(new Error("not available"));
    const timer = setTimeout(() => reject(new Error("timeout")), GPS_TIMEOUT_MS);
    const ask = () => {
      if (!lm.isLocationAvailable) {
        clearTimeout(timer);
        return reject(new Error("not available"));
      }
      lm.getLocation((loc) => {
        clearTimeout(timer);
        if (loc && typeof loc.latitude === "number" && typeof loc.longitude === "number") resolve({ lat: loc.latitude, lon: loc.longitude });
        else reject(new Error("denied"));
      });
    };
    try {
      if (lm.isInited) ask();
      else lm.init(ask);
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

/** FR-17. Telegram's service first, then the browser's. If neither works, say so and leave the search usable (F16). */
async function useMyLocation() {
  setStatus("sheet-status", S.app_working);
  lock($("sheet"), true);
  let where = null;
  try {
    where = await telegramPosition().catch(() => browserPosition());
  } catch {
    where = null;
  }
  if (!where || !Number.isFinite(where.lat) || !Number.isFinite(where.lon)) {
    lock($("sheet"), false);
    setStatus("sheet-status", S.app_gps_denied, "error");
    return;
  }
  await savePlace({ lat: where.lat, lon: where.lon });
}

// ---------------------------------------------------------------- settings (FR-13)
function settingRow(label, hint, control) {
  return el("div", { class: "set-row" }, el("div", { class: "set-text" }, el("p", { class: "set-label", text: label }), hint && el("p", { class: "small", text: hint })), control);
}

/** One choice out of a few. `key` is the setting's name; the chosen value is sent to the server as it is. */
function choiceGroup(label, key, options, current) {
  const group = el("div", { class: "seg seg-wrap", role: "group", "aria-label": label });
  for (const [value, text] of options) {
    const b = el("button", { type: "button", "aria-pressed": String(value === current), data: { focus: `${key}:${value}` }, text });
    b.addEventListener("click", () => {
      if (value !== current) saveSettings({ [key]: value }, `${key}:${value}`);
    });
    group.append(b);
  }
  return el("div", { class: "set-row set-row-stack" }, el("p", { class: "set-label", text: label }), group);
}

function switchControl(label, key, on, available = true) {
  const b = el("button", { type: "button", class: "switch", role: "switch", "aria-checked": String(!!on), "aria-label": label, data: { focus: key, off: !available }, disabled: !available }, el("span", { class: "switch-knob" }), el("span", { class: "switch-word", text: on ? S.app_on : S.app_off }));
  b.addEventListener("click", () => saveSettings({ [key]: !on }, key));
  return b;
}

function timeControl(label, key, value) {
  const input = el("input", { type: "time", class: "input input-time", value, required: true, "aria-label": `${label}: ${S.app_set_time}`, data: { focus: key } });
  input.addEventListener("change", () => {
    if (/^\d{2}:\d{2}$/.test(input.value) && input.value !== value) saveSettings({ [key]: input.value }, key);
  });
  return input;
}

function renderSettings(focusKey) {
  const s = dash && dash.settings;
  if (!s) return;
  $("settings-title").textContent = S.app_settings;
  const section = (title, ...rows) => el("section", { class: "set-group" }, el("h3", { class: "sheet-sub", text: title }), ...rows);
  $("settings-body").replaceChildren(
    section(
      S.app_set_display,
      choiceGroup(S.app_set_language, "lang", LANGUAGES, s.lang),
      choiceGroup(S.app_set_temp, "tempUnit", [["c", "°C"], ["f", "°F"]], s.tempUnit),
      choiceGroup(S.app_set_wind, "windUnit", [["kmh", "km/h"], ["ms", "m/s"], ["mph", "mph"]], s.windUnit),
      choiceGroup(S.app_set_clock, "clock", [["auto", S.app_clock_auto], ["12", S.app_clock_12], ["24", S.app_clock_24]], s.clock),
    ),
    section(
      S.app_set_reports,
      settingRow(S.app_set_morning, null, el("div", { class: "set-controls" }, s.dailyOn && timeControl(S.app_set_morning, "dailyTime", s.dailyTime), switchControl(S.app_set_morning, "dailyOn", s.dailyOn))),
      settingRow(S.app_set_evening, null, el("div", { class: "set-controls" }, s.eveningOn && timeControl(S.app_set_evening, "eveningTime", s.eveningTime), switchControl(S.app_set_evening, "eveningOn", s.eveningOn))),
      el("p", { class: "small", text: fill(S.app_set_tz, { tz: s.tz }) }),
    ),
    section(
      S.app_set_alerts,
      settingRow(S.app_set_rain, S.app_set_rain_hint, switchControl(S.app_set_rain, "rainAlerts", s.rainAlerts)),
      choiceGroup(S.app_set_aqi, "aqiAlert", [[0, S.app_off], [101, "101+"], [151, "151+"], [201, "201+"]], s.aqiAlert),
      el("p", { class: "small", text: S.app_set_aqi_hint }),
      settingRow(S.app_set_warnings, S.app_set_warnings_hint, switchControl(S.app_set_warnings, "warningsOn", s.warningsAvailable && s.warningsOn, s.warningsAvailable)),
    ),
  );
  const tipsAgain = el("button", { type: "button", class: "btn btn-wide", id: "tips-again" }, icon("info"), el("span", { text: S.app_tips_again }));
  tipsAgain.addEventListener("click", () => openTips($("settings-btn")));
  $("settings-body").append(el("section", { class: "set-group" }, tipsAgain));
  if (focusKey) {
    const again = [...$("settings-body").querySelectorAll("[data-focus]")].find((n) => n.dataset.focus === focusKey);
    if (again && !again.disabled) again.focus();
  }
}

function openSettings() {
  if (!dash || !dash.settings) return;
  renderSettings();
  setStatus("settings-status", "");
  openSheet($("settings"), $("settings-btn"));
}

async function saveSettings(change, focusKey) {
  const sheet = $("settings");
  setStatus("settings-status", S.app_working);
  lock(sheet, true);
  try {
    const d = await api("/api/app/settings", { method: "POST", body: change });
    if (isDashboard(d)) {
      if (!accept(d)) return;
    } else if (d && d.saved && d.settings && dash) {
      dash.settings = d.settings; // saved, but the weather couldn't be redrawn just now: the next refresh will show it
      if (d.strings) dash.strings = S = d.strings;
      stale = true;
      renderNotices();
    } else throw Object.assign(new Error("unexpected answer"), { code: "bad_response" });
    renderSettings(focusKey);
    setStatus("settings-status", S.app_set_saved, "ok");
    haptic("success");
  } catch (e) {
    if (refused(e)) return refuse(e);
    renderSettings(focusKey); // put every control back to what is really saved
    setStatus("settings-status", (e && e.userMessage) || S.app_err_save, "error");
    haptic("error");
  } finally {
    lock(sheet, false);
  }
}

// ---------------------------------------------------------------- first-time tips (FR-22)
function openTips(opener) {
  if (!dash) return;
  $("tips-title").textContent = S.app_tips_title;
  $("tips-ok").textContent = S.app_tips_ok;
  const rows = [["pin", S.app_tip_place], ["sliders", S.app_tip_settings], ["chevron", S.app_tip_day], ["share", S.app_tip_share]];
  $("tips-list").replaceChildren(...rows.map(([name, text]) => el("li", { class: "tip-row" }, el("span", { class: "tip-ico" }, icon(name)), el("span", { text }))));
  openSheet($("tips"), opener || $("place-btn"));
}

/**
 * Show the short guide once per device, the first time real data is on screen. If this device can't remember that
 * it was shown (storage blocked), it is not shown at all: better never than every single time.
 */
function maybeShowTips() {
  if (!dash || dash.demo || activeSheet || store.get(TIPS_KEY)) return;
  store.set(TIPS_KEY, "1");
  if (store.get(TIPS_KEY) !== "1") return;
  openTips();
}

// ---------------------------------------------------------------- share a picture card (FR-18)
async function openShare() {
  if (!dash) return;
  const canvas = $("card");
  $("share-title").textContent = S.app_share_title;
  $("share-send-text").textContent = S.app_share;
  $("share-hint").textContent = dash.demo ? S.app_share_demo : S.app_share_hint;
  setStatus("share-status", "");
  const send = $("share-send");
  send.dataset.off = String(!!dash.demo);
  send.disabled = !!dash.demo;
  openSheet($("share"), $("share-btn"));
  try {
    if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, sleep(1500)]); // the card uses the page's font
  } catch {
    /* draw with whatever font there is */
  }
  let drawn = false;
  try {
    const hero = $("hero");
    drawn = drawCard(canvas, dash, { top: cssVar(hero, "--sky-a"), bottom: cssVar(hero, "--sky-b"), bands: [0, 1, 2, 3, 4, 5].map((n) => cssVar(root, `--aqi-${n}`)) });
  } catch {
    drawn = false;
  }
  canvas.dataset.drawn = String(drawn);
  canvas.setAttribute("aria-label", fill(S.app_card_alt, { p: dash.place, t: `${dash.now.temp}${dash.now.unit}`, c: dash.now.cond }));
  if (!drawn) {
    send.dataset.off = "true";
    send.disabled = true;
    setStatus("share-status", S.app_err_share, "error");
  }
}

async function sendShare() {
  const sheet = $("share");
  setStatus("share-status", S.app_working);
  lock(sheet, true);
  try {
    const blob = await new Promise((resolve) => $("card").toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) throw new Error("no picture");
    const r = await api("/api/app/share", { method: "POST", raw: blob });
    if (!r.sent) throw Object.assign(new Error("unexpected answer"), { code: "bad_response" });
    closeSheet();
    haptic("success");
    // Newer Telegram can open its "share to a chat" picker. Otherwise the picture is already in the person's chat.
    if (r.prepared && telegramAtLeast("8.0") && typeof tg.shareMessage === "function") {
      try {
        tg.shareMessage(r.prepared, (ok) => toast(ok ? S.app_share_done : S.app_share_sent));
        return;
      } catch {
        /* fall through to the plain message */
      }
    }
    toast(S.app_share_sent);
  } catch (e) {
    if (refused(e)) return refuse(e);
    setStatus("share-status", (e && e.userMessage) || S.app_err_share, "error");
    haptic("error");
  } finally {
    lock(sheet, false);
  }
}

// ---------------------------------------------------------------- boot
function start() {
  applyTheme();
  if (inTelegram) {
    try {
      tg.ready();
      tg.expand();
      tg.onEvent("themeChanged", () => {
        applyTheme();
        paintChrome();
      });
      if (tg.BackButton) tg.BackButton.onClick(closeSheet);
    } catch {
      /* the page works without these */
    }
  }

  $("refresh-btn").addEventListener("click", () => {
    haptic("tap");
    load({ fresh: true });
  });
  $("gate-retry").addEventListener("click", () => {
    $("gate").hidden = true;
    $("app").hidden = false;
    load();
  });
  $("place-btn").addEventListener("click", openLocation);
  $("settings-btn").addEventListener("click", openSettings);
  $("share-btn").addEventListener("click", openShare);
  $("gps-btn").addEventListener("click", useMyLocation);
  $("share-send").addEventListener("click", sendShare);
  $("tips-ok").addEventListener("click", () => closeSheet($("tips")));
  $("search-form").addEventListener("submit", searchPlaces);
  for (const sheet of document.querySelectorAll("dialog.sheet")) {
    sheet.addEventListener("close", onSheetClosed);
    // every sheet's own controls close THAT sheet, not "whichever one we think is open"
    sheet.addEventListener("click", (e) => {
      if (e.target === sheet) closeSheet(sheet); // a tap on the dimmed area outside the sheet
    });
    for (const x of sheet.querySelectorAll("[data-close]")) x.addEventListener("click", () => closeSheet(sheet));
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && dash && Date.now() - loadedAt > REFRESH_AFTER_MS) load();
  });

  // F1: no signed session means we are not inside Telegram. Say so; do not call the API.
  if (!demoScene && !inTelegram) return gate(boot.outside, { hint: boot.outsideHint });

  $("now-cond").textContent = boot.loading;

  // Paint the copy saved on this device straight away; the fresh answer replaces it in a moment.
  if (!demoScene) {
    try {
      const saved = JSON.parse(store.get(CACHE_KEY) || "null");
      if (isDashboard(saved)) show(saved);
    } catch {
      store.remove(CACHE_KEY);
    }
  }
  load();
}

try {
  start();
} catch {
  gate(boot.offline, { retry: true });
}
