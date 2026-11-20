// SkyBrief Mini App: boot, API calls, rendering, the change-location sheet.
//
// The server sends a ready-to-draw "dashboard" (already translated, already in the person's units), so this file
// holds no weather rules and formats no numbers. All text is written with textContent, never as HTML.
// Requirements: docs/REQUIREMENTS.md (FR-2 .. FR-11). Failure behaviour: docs/FALLBACKS.md.
import { BOOT, bootLang } from "./boot-strings.js";
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
const CACHE_KEY = `skybrief.dash.v1.${tgUser && tgUser.id ? tgUser.id : "anon"}`;
const DAYS_KEY = "skybrief.days";
const SVG = "http://www.w3.org/2000/svg";
const AQI_STEPS = [0, 50, 100, 150, 200, 300, 500];
const HTML_LANG = { en: "en", ms: "ms", zh: "zh-Hans" };

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
let toastTimer = 0;
const sky = createSky($("sky"));

// ---------------------------------------------------------------- small DOM helpers
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

/** An icon from the sprite. With a label it is announced as an image; without, it is decoration. */
function icon(name, cls = "ico", label) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", cls);
  if (label) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
  } else svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG, "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

const fill = (text, params) => String(text || "").replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const haptic = (kind) => {
  try {
    if (inTelegram && tg.HapticFeedback) kind === "tap" ? tg.HapticFeedback.impactOccurred("light") : tg.HapticFeedback.notificationOccurred(kind);
  } catch {
    /* decoration only */
  }
};

function card(titleText, extraClass, ...kids) {
  const title = el("h2", { class: "card-title", text: titleText });
  return el("section", { class: `card ${extraClass || ""}`.trim() }, el("div", { class: "card-head" }, title), ...kids);
}

// ---------------------------------------------------------------- API
/** GET is retried once on a network error or a 5xx. Throws an Error carrying status / code / userMessage. */
async function api(path, { method = "GET", body } = {}) {
  const tries = method === "GET" ? 2 : 1;
  let failure = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt) await sleep(700);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const headers = {};
      if (initData) headers.Authorization = `tma ${initData}`;
      if (body) headers["content-type"] = "application/json";
      const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal, cache: "no-store" });
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
    && Array.isArray(d.best) && Array.isArray(d.presets) && !!d.rain;
}

// ---------------------------------------------------------------- theme + Telegram chrome
function applyTheme() {
  const scheme = inTelegram ? tg.colorScheme : null;
  if (scheme === "dark" || scheme === "light") root.dataset.theme = scheme;
  else delete root.dataset.theme; // outside Telegram: follow the system setting (CSS media query)
}

/** Make Telegram's own header and background continue the page's colours. */
function paintChrome() {
  if (!inTelegram) return;
  try {
    const top = getComputedStyle($("hero")).getPropertyValue("--sky-a").trim();
    const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
    if (top && tg.setHeaderColor) tg.setHeaderColor(top);
    if (bg && tg.setBackgroundColor) tg.setBackgroundColor(bg);
    if (bg && tg.setBottomBarColor) tg.setBottomBarColor(bg);
  } catch {
    /* older Telegram clients: colours are decoration only */
  }
}

// ---------------------------------------------------------------- render
function renderHero(d) {
  const sceneKey = `${d.scene.kind}-${d.scene.night ? "night" : "day"}`;
  $("hero").dataset.sky = sceneKey;
  $("page-title").textContent = d.title;
  $("place-name").textContent = d.place;
  $("place-btn").setAttribute("aria-label", `${d.place}. ${S.app_change_city}`);
  $("refresh-btn").setAttribute("aria-label", S.app_refresh);
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

const RAIN_ICON = { now: "water", likely: "water", chance: "water", none: "check" };

function hourlyCard(d) {
  const list = el(
    "ul",
    { class: "hours", id: "hours", tabindex: "0", role: "list", "aria-label": S.app_hourly },
    d.hourly.map((x) =>
      el(
        "li",
        { class: "hour" },
        el("span", { class: "hour-time", text: x.label }),
        icon(x.icon, "wx", x.cond),
        el("span", { class: "hour-temp", text: x.temp }),
        el("span", { class: "hour-prob", data: { wet: x.prob >= 50 } }, icon("water"), el("span", { class: "sr-only", text: `${S.app_rain_chance} ` }), `${x.prob}%`),
      ),
    ),
  );
  const line = el("p", { class: "rainline", id: "rainline", data: { level: d.rain.level } }, icon(RAIN_ICON[d.rain.level] || "water"), el("span", { text: d.rain.text }));
  const section = card(S.rain_title, "span2", line, el("h3", { class: "card-title block-title", text: S.app_hourly }), list);
  section.id = "hourly";
  return section;
}

function aqiPosition(aqi) {
  const v = Math.max(0, Math.min(500, aqi));
  let i = AQI_STEPS.findIndex((step, k) => k > 0 && v <= step);
  if (i < 1) i = AQI_STEPS.length - 1;
  return ((i - 1 + (v - AQI_STEPS[i - 1]) / (AQI_STEPS[i] - AQI_STEPS[i - 1])) / 6) * 100;
}

function airCard(d) {
  const a = d.air;
  if (!a) {
    const empty = card(S.air_title, "", el("p", { id: "air-none", text: S.air_unavail }));
    empty.id = "air";
    return empty;
  }
  const dot = el("span", { class: "aqi-dot" });
  dot.style.setProperty("--aqi-c", `var(--aqi-${Math.max(0, Math.min(5, a.level))})`);
  const pin = el("span", { class: "aqi-pin" });
  pin.style.setProperty("--pos", `${aqiPosition(a.aqi).toFixed(1)}%`);
  const facts = [a.pm25 && `PM2.5 ${a.pm25}`, a.pm10 && `PM10 ${a.pm10}`, a.dominant].filter(Boolean).join("  ·  ");
  const section = card(
    S.air_title,
    "",
    el("div", { class: "aqi-top" }, el("p", { class: "aqi-num", id: "aqi-value" }, el("span", { class: "sr-only", text: "AQI " }), String(a.aqi)), el("p", { class: "aqi-band" }, dot, el("span", { id: "aqi-label", text: a.label }))),
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
    el("p", { class: "small note", id: "aqi-note", text: S.app_aqi_note }),
  );
  section.id = "air";
  return section;
}

function renderDays(list, d) {
  const shown = d.daily.slice(0, days);
  const lows = d.daily.map((x) => x.loN).filter((n) => n != null);
  const highs = d.daily.map((x) => x.hiN).filter((n) => n != null);
  const min = lows.length ? Math.min(...lows) : 0;
  const max = highs.length ? Math.max(...highs) : 0;
  const span = max - min || 1;
  list.replaceChildren(
    ...shown.map((x) => {
      const bar = el("span");
      const known = x.loN != null && x.hiN != null;
      if (known) {
        bar.style.setProperty("--from", `${(((x.loN - min) / span) * 100).toFixed(1)}%`);
        bar.style.setProperty("--size", `${Math.max(8, ((x.hiN - x.loN) / span) * 100).toFixed(1)}%`);
      }
      return el(
        "li",
        { class: "day" },
        icon(x.icon, "wx"),
        el("div", { class: "day-main" }, el("p", { class: "day-name", data: { weekend: x.weekend } }, x.label, x.weekend && el("span", { class: "sr-only", text: ` (${S.app_weekend})` })), el("p", { class: "day-cond", text: x.cond })),
        el("p", { class: "day-prob", data: { wet: x.prob >= 50 } }, icon("water"), el("span", { class: "sr-only", text: `${S.app_rain_chance} ` }), `${x.prob}%`),
        el(
          "div",
          { class: "day-temps" },
          el("p", { class: "day-nums" }, el("span", { class: "day-lo" }, el("span", { class: "sr-only", text: `${S.app_low} ` }), x.lo), el("span", { class: "day-hi" }, el("span", { class: "sr-only", text: `${S.app_high} ` }), x.hi)),
          known && el("div", { class: "range", "aria-hidden": "true" }, bar),
        ),
      );
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

function tile(iconName, label, value, sub, extraClass) {
  return el("li", { class: `tile ${extraClass || ""}`.trim() }, el("p", { class: "tile-label" }, icon(iconName), label), el("p", { class: "tile-value" }, value), sub && el("p", { class: "tile-sub", text: sub }));
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
    $("place-btn").disabled = !!d.demo; // the demo has no account to save a location to
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
  if ($("sheet").open) $("sheet").close();
}

function toast(text) {
  const node = $("toast");
  node.textContent = text;
  node.dataset.show = "true";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.dataset.show = "false";
  }, 2400);
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
    stale = false;
    loadedAt = Date.now();
    if (!show(d)) return;
    if (!d.demo) store.set(CACHE_KEY, JSON.stringify(d));
    if (fresh) {
      toast(S.app_updated);
      haptic("success");
    }
  } catch (e) {
    if (e && (e.status === 401 || e.status === 403)) refuse(e);
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

// ---------------------------------------------------------------- change location (FR-9)
function setSheetStatus(text, tone) {
  const node = $("sheet-status");
  node.textContent = text || "";
  if (tone) node.dataset.tone = tone;
  else delete node.dataset.tone;
}

function lockSheet(locked) {
  const sheet = $("sheet");
  if (locked) sheet.setAttribute("aria-busy", "true");
  else sheet.removeAttribute("aria-busy");
  for (const b of sheet.querySelectorAll("button.choice, #search-btn")) b.disabled = locked;
}

function choiceButton(label, payload) {
  const b = el("button", { type: "button", class: "choice" }, icon("pin"), el("span", { text: label }));
  b.addEventListener("click", () => savePlace(payload));
  return el("li", null, b);
}

function openSheet() {
  if (!dash || dash.demo) return;
  $("sheet-title").textContent = S.app_change_city;
  $("sheet-hint").textContent = S.app_city_hint;
  $("sheet-close").setAttribute("aria-label", S.app_close);
  $("search-label").textContent = S.app_search_label;
  $("search-input").placeholder = S.app_search_ph;
  $("search-btn-text").textContent = S.app_search_btn;
  $("results-title").textContent = S.app_results;
  $("shortcuts-title").textContent = S.app_shortcuts;
  $("results-block").hidden = true;
  $("results").replaceChildren();
  $("shortcuts").replaceChildren(...dash.presets.map((name, i) => choiceButton(name, { preset: i })));
  setSheetStatus("");
  lockSheet(false);
  const sheet = $("sheet");
  if (sheet.showModal) sheet.showModal();
  else sheet.setAttribute("open", "");
  if (inTelegram && tg.BackButton) {
    tg.BackButton.show();
    tg.BackButton.onClick(closeSheet);
  }
}

function closeSheet() {
  const sheet = $("sheet");
  if (sheet.close) sheet.close();
  else sheet.removeAttribute("open");
}

function onSheetClosed() {
  if (inTelegram && tg.BackButton) {
    tg.BackButton.offClick(closeSheet);
    tg.BackButton.hide();
  }
  $("place-btn").focus();
}

async function searchPlaces(event) {
  event.preventDefault();
  const q = $("search-input").value.trim();
  if (q.length < 2) return setSheetStatus(S.app_err_query, "error");
  setSheetStatus(S.app_working);
  lockSheet(true);
  try {
    const data = await api(`/api/app/places?q=${encodeURIComponent(q)}`);
    const results = Array.isArray(data.results) ? data.results.filter((x) => typeof x === "string") : [];
    $("results").replaceChildren(...results.map((label, i) => choiceButton(label, { pick: i })));
    $("results-block").hidden = !results.length;
    setSheetStatus(results.length ? "" : S.app_no_results, results.length ? undefined : "error");
  } catch (e) {
    if (e && (e.status === 401 || e.status === 403)) return refuse(e);
    $("results-block").hidden = true;
    setSheetStatus((e && e.userMessage) || S.app_err_search, "error"); // the typed text stays in the box
  } finally {
    lockSheet(false);
  }
}

async function savePlace(payload) {
  setSheetStatus(S.app_working);
  lockSheet(true);
  try {
    const d = await api("/api/app/place", { method: "POST", body: payload });
    if (!isDashboard(d)) throw Object.assign(new Error("unexpected answer"), { code: "bad_response" });
    stale = false;
    loadedAt = Date.now();
    if (!show(d)) return;
    store.set(CACHE_KEY, JSON.stringify(d));
    $("search-input").value = "";
    closeSheet();
    toast(S.app_saved);
    haptic("success");
  } catch (e) {
    if (e && (e.status === 401 || e.status === 403)) return refuse(e);
    setSheetStatus((e && e.userMessage) || S.app_err_wx, "error"); // nothing was saved; the old location stays
    haptic("error");
  } finally {
    lockSheet(false);
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
  $("place-btn").addEventListener("click", openSheet);
  $("sheet-close").addEventListener("click", closeSheet);
  $("sheet").addEventListener("close", onSheetClosed);
  $("sheet").addEventListener("click", (e) => {
    if (e.target === $("sheet")) closeSheet(); // a tap on the dimmed area outside the sheet
  });
  $("search-form").addEventListener("submit", searchPlaces);
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
