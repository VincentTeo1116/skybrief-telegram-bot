/**
 * Telegram Mini App back end (docs/DESIGN.md).
 *
 *   GET  /api/app/dashboard[?fresh=1]   the signed-in person's dashboard            FR-2..FR-8, FR-10
 *   GET  /api/app/places?q=ipoh         city search (labels only)                    FR-9
 *   POST /api/app/place                 {"pick": n} or {"preset": n}: save a location FR-9
 *   GET  /api/app/demo?scene=rainy      labelled demo data, no sign-in               FR-11
 *
 * The page proves who it is with Telegram's signed `initData` in the header  Authorization: tma <initData>  (NFR-1).
 * The dashboard is a ready-to-draw view-model: every text is already translated and every number already in the
 * person's units, using the SAME functions as the chat report, so the two can never disagree.
 */
import { getUser, patchUser, placeOf } from "./db";
import { DEMO_SCENES, demoReport, isDemoScene } from "./demo";
import { aqiBand, aqiLevel, airOutlookInfo, bestLines, rainSummary, sourceText, tips, trendInfo, uvLabel, wInstruction, wLabel, wText, wTitle, type RainLevel } from "./format";
import * as i18n from "./i18n";
import { T, t } from "./i18n";
import { STORM_CODES, dailyIndex, hourIndex, hoursBetween, nextHours, pct } from "./insights";
import { savePlace } from "./location";
import { PRESET_COUNT, presetName, presetPlace } from "./presets";
import type { Env, Forecast, Lang, Place, Prefs, Report, User } from "./types";
import { cToDisplay, defaultPrefs, deg, prefsOf, speed, unitLetter } from "./units";
import { parseIdList, safeEqual } from "./util";
import { userWarnings } from "./views";
import { canonicalState, clip, stateSegment, type State, type Warning } from "./warnings";
import { WeatherError, makeWeather, placeLabel } from "./weather";

// ---------------------------------------------------------------- Telegram signature (NFR-1)
/** A signed session is accepted for this long. */
export const INIT_DATA_MAX_AGE_S = 24 * 3600;
const MAX_INIT_DATA_LENGTH = 4096;
const CLOCK_SKEW_S = 300;

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmac(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(message));
}

/** Telegram's rule: every field except `hash`, sorted by name, joined as "key=value" lines. */
export function dataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

/** hex(HMAC-SHA256(data-check-string, key = HMAC-SHA256(bot token, key = "WebAppData"))). Also used by the tests to sign. */
export async function signInitData(params: URLSearchParams, botToken: string): Promise<string> {
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  return hex(await hmac(secret, dataCheckString(params)));
}

/**
 * Check `Telegram.WebApp.initData`. Returns who it is, or null for anything that is missing, tampered with, signed
 * by another bot, too old, or dated in the future. Never throws: every doubt is a refusal.
 */
export async function verifyInitData(
  initData: string,
  botToken: string,
  nowMs = Date.now(),
  maxAgeS = INIT_DATA_MAX_AGE_S,
): Promise<{ id: number; languageCode: string } | null> {
  try {
    if (!botToken || !initData || initData.length > MAX_INIT_DATA_LENGTH) return null;
    const params = new URLSearchParams(initData);
    const hash = params.get("hash") ?? "";
    if (!/^[0-9a-f]{64}$/.test(hash)) return null;
    if (!safeEqual(await signInitData(params, botToken), hash)) return null;
    const authDate = Number(params.get("auth_date"));
    const nowS = nowMs / 1000;
    if (!Number.isFinite(authDate) || authDate <= 0 || nowS - authDate > maxAgeS || authDate - nowS > CLOCK_SKEW_S) return null;
    const user = JSON.parse(params.get("user") ?? "null") as { id?: unknown; language_code?: unknown } | null;
    if (!user || typeof user.id !== "number" || !Number.isSafeInteger(user.id) || user.id <= 0) return null;
    return { id: user.id, languageCode: typeof user.language_code === "string" ? user.language_code : "" };
  } catch {
    return null;
  }
}

/** "zh-hans" -> zh, "ms" -> ms, anything else -> en. Only used before we know the person's saved language. */
export function langHint(code: string | null | undefined): Lang {
  const c = (code ?? "").trim().toLowerCase();
  return c.startsWith("zh") ? "zh" : c.startsWith("ms") ? "ms" : "en";
}

// ---------------------------------------------------------------- scene + icons (FR-3)
export type SceneKind = "clear" | "partly" | "cloudy" | "fog" | "rain" | "storm" | "windy";
export interface Scene {
  kind: SceneKind;
  night: boolean;
  /** 0 = calm … 1 = gale (50 km/h or more). Drives cloud speed and how much the rain slants. */
  wind: number;
  /** 0 none, 1 drizzle / light, 2 rain, 3 heavy. */
  rain: 0 | 1 | 2 | 3;
}

/** "Windy" for a tropical city: sustained wind or gusts at these speeds (km/h), when it isn't raining. */
export const WINDY_KMH = 25;
export const WINDY_GUST_KMH = 40;

const LIGHT = new Set([51, 53, 56, 61, 80, 71, 73, 77, 85]);
const MEDIUM = new Set([55, 57, 63, 66, 81, 75, 86]);
const HEAVY = new Set([65, 67, 82]);
const SNOW = new Set([71, 73, 75, 77, 85, 86]);

/** Which sky to draw. Priority: storm > rain > fog > windy > cloud cover. One rule, unit-tested. */
export function sceneOf(c: Forecast["current"]): Scene {
  const code = c.weather_code;
  const windKmh = c.wind_speed_10m ?? 0;
  const precip = c.precipitation ?? 0;
  let rain: Scene["rain"] = 0;
  if (code != null) {
    if (STORM_CODES.has(code) || HEAVY.has(code)) rain = 3;
    else if (MEDIUM.has(code)) rain = 2;
    else if (LIGHT.has(code)) rain = 1;
  }
  if (!rain && precip >= 0.1) rain = precip >= 2.5 ? 2 : 1; // the code can lag behind the measured rain

  let kind: SceneKind;
  if (code != null && STORM_CODES.has(code)) kind = "storm";
  else if (rain) kind = "rain";
  else if (code === 45 || code === 48) kind = "fog";
  else if (windKmh >= WINDY_KMH || (c.wind_gusts_10m ?? 0) >= WINDY_GUST_KMH) kind = "windy";
  else if (code === 3) kind = "cloudy";
  else if (code === 1 || code === 2) kind = "partly";
  else if (code === 0) kind = "clear";
  else kind = c.cloud_cover >= 80 ? "cloudy" : c.cloud_cover >= 30 ? "partly" : "clear"; // unknown code: go by cloud cover

  return { kind, night: (c.is_day ?? 1) !== 1, wind: Math.round(Math.max(0, Math.min(1, windKmh / 50)) * 100) / 100, rain };
}

/** Name of the icon in the page's SVG sprite. */
export function iconOf(code: number | null | undefined, isDay: boolean): string {
  const dn = isDay ? "day" : "night";
  if (code == null) return "cloudy";
  if (code === 0) return `clear-${dn}`;
  if (code === 1 || code === 2) return `partly-${dn}`;
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (STORM_CODES.has(code)) return "storm";
  if (SNOW.has(code)) return "snow";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  return "cloudy";
}

// ---------------------------------------------------------------- the dashboard view-model
export interface Dashboard {
  v: 1;
  lang: Lang;
  demo: boolean;
  place: string;
  title: string;
  scene: Scene;
  now: {
    temp: string;
    unit: string;
    cond: string;
    icon: string;
    feels: string;
    hi: string;
    lo: string;
    date: string;
    trend: { warmer: boolean; text: string } | null;
    /** "8:15 AM": when the data was observed, for the "saved data from …" banner. */
    clock: string;
  };
  warnings: { title: string; until: string; valid: string; area: string | null; text: string; instruction: string }[];
  rain: { level: RainLevel; text: string };
  hourly: { label: string; icon: string; cond: string; temp: string; prob: number }[];
  air: {
    aqi: number;
    level: number;
    label: string;
    pm25: string | null;
    pm10: string | null;
    dominant: string | null;
    outlook: { kind: "rising" | "falling" | "steady"; text: string } | null;
    measured: boolean;
  } | null;
  daily: { label: string; date: string; weekend: boolean; icon: string; cond: string; lo: string; hi: string; loN: number | null; hiN: number | null; prob: number; mm: string | null }[];
  details: {
    humidity: string;
    wind: { speed: string; dir: string; deg: number | null; gust: string | null };
    uv: { value: string; label: string } | null;
    pressure: string;
    cloud: string;
    sunrise: string;
    sunset: string;
    /** 0 = sunrise … 1 = sunset; null at night. */
    sunPos: number | null;
  };
  best: string[];
  tips: string[];
  footer: { observed: string; source: string; backup: boolean };
  presets: string[];
  strings: Record<string, string>;
  /** Set on the answer to a successful location change. */
  saved?: true;
}

/** Bot texts that the page shows as well (section titles and the like), next to every "app_" row. */
const SHARED_KEYS = ["air_title", "air_unavail", "sec_best", "best_hint", "tips_title", "humidity", "wind", "cloud", "rain_title", "warn_block_title", "warn_source", "feels"] as const;

/** Every text the page needs, in one language. Placeholders such as {t} are filled in by the page. */
export function appStrings(lang: Lang): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(T)) if (key.startsWith("app_")) out[key] = t(lang, key);
  for (const key of SHARED_KEYS) out[key] = t(lang, key);
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildDashboard(r: Report, p: Prefs, warnings: Warning[] = [], opts: { state?: State | null; demo?: boolean } = {}): Dashboard {
  const lang = p.lang;
  const c = r.wx.current;
  const h = r.wx.hourly;
  const d = r.wx.daily;
  const di = dailyIndex(r);
  const isDay = (c.is_day ?? 1) === 1;
  const clock = (iso: string) => i18n.clock(iso, lang, p.clock);
  const label = placeLabel(r.place);

  // ---- next 24 hours
  const start = hourIndex(r);
  const hourly = nextHours(r, 24).map((row, k) => {
    const hour = Number(row.time.slice(11, 13));
    const flag = h.is_day?.[start + k];
    const day = flag != null ? flag === 1 : hour >= 7 && hour < 19;
    return {
      label: k === 0 ? t(lang, "app_now") : i18n.hourLabel(row.time, lang, p.clock),
      icon: iconOf(row.code, day),
      cond: i18n.wmoText(row.code, lang),
      temp: deg(row.temp, p),
      prob: row.prob,
    };
  });

  // ---- seven days, starting today
  const daily: Dashboard["daily"] = [];
  for (let i = di; i < Math.min(di + 7, d.time.length); i++) {
    const date = d.time[i];
    const lo = d.temperature_2m_min[i];
    const hi = d.temperature_2m_max[i];
    const mm = d.precipitation_sum?.[i];
    daily.push({
      label: i === di ? t(lang, "today") : i18n.weekday(date, lang, true),
      date: `${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`,
      weekend: i18n.isWeekend(date),
      icon: iconOf(d.weather_code[i], true),
      cond: i18n.wmoText(d.weather_code[i], lang),
      lo: deg(lo, p),
      hi: deg(hi, p),
      loN: lo == null ? null : round1(cToDisplay(lo, p.tempUnit)),
      hiN: hi == null ? null : round1(cToDisplay(hi, p.tempUnit)),
      prob: pct(d.precipitation_probability_max[i]),
      mm: mm != null && mm >= 1 ? `${mm.toFixed(0)} mm` : null,
    });
  }

  // ---- air
  const aq = r.aq;
  const air: Dashboard["air"] = aq
    ? {
        aqi: aq.aqi,
        level: aqiLevel(aq.aqi),
        label: aqiBand(aq.aqi, lang)[1],
        pm25: aq.pm25 != null ? `${aq.pm25.toFixed(0)} µg/m³` : null,
        pm10: aq.pm10 != null ? `${aq.pm10.toFixed(0)} µg/m³` : null,
        dominant: aq.dominant ? t(lang, "pollutant", { p: aq.dominant }) : null,
        outlook: airOutlookInfo(r, p),
        measured: !!aq.station,
      }
    : null;

  // ---- sun
  const sunrise = d.sunrise[di];
  const sunset = d.sunset[di];
  let sunPos: number | null = null;
  if (sunrise && sunset) {
    const span = hoursBetween(sunrise, sunset);
    const at = hoursBetween(sunrise, c.time);
    if (span > 0 && at >= 0 && at <= span) sunPos = Math.round((at / span) * 100) / 100;
  }
  const uv = d.uv_index_max[di];
  const rain = rainSummary(r, p);
  const state = opts.state ?? null;

  return {
    v: 1,
    lang,
    demo: opts.demo === true,
    place: label,
    title: t(lang, "app_title", { p: label }),
    scene: sceneOf(c),
    now: {
      temp: deg(c.temperature_2m, p),
      unit: unitLetter(p),
      cond: i18n.wmoText(c.weather_code, lang),
      icon: iconOf(c.weather_code, isDay),
      feels: `${t(lang, "feels")} ${deg(c.apparent_temperature, p)}`,
      hi: deg(d.temperature_2m_max[di], p),
      lo: deg(d.temperature_2m_min[di], p),
      date: i18n.dateLong(c.time, lang),
      trend: trendInfo(r, p),
      clock: clock(c.time),
    },
    warnings: warnings.slice(0, 3).map((w) => {
      const area = state ? stateSegment(w, state, lang === "ms") : null;
      const body = clip(wText(w, lang), area ? 380 : 560);
      return {
        title: wTitle(w, lang),
        until: t(lang, "warn_until", { t: wLabel(w.to!, p, c.time) }),
        valid: t(lang, "warn_valid", { a: wLabel(w.from!, p, c.time), b: wLabel(w.to!, p, c.time) }),
        area,
        text: body === area ? "" : body,
        instruction: clip(wInstruction(w, lang), 240),
      };
    }),
    rain: { level: rain.level, text: rain.text + rain.more },
    hourly,
    air,
    daily,
    details: {
      humidity: `${Math.round(c.relative_humidity_2m)}%`,
      wind: {
        speed: speed(c.wind_speed_10m, p),
        dir: c.wind_direction_10m != null ? i18n.compassDir(c.wind_direction_10m, lang) : "",
        deg: c.wind_direction_10m,
        gust: c.wind_gusts_10m != null ? t(lang, "app_gusts", { w: speed(c.wind_gusts_10m, p) }) : null,
      },
      uv: uv != null ? { value: uv.toFixed(0), label: uvLabel(uv, lang) } : null,
      pressure: `${Math.round(c.pressure_msl)} hPa`,
      cloud: `${Math.round(c.cloud_cover)}%`,
      sunrise: sunrise ? clock(sunrise) : "–",
      sunset: sunset ? clock(sunset) : "–",
      sunPos,
    },
    best: bestLines(r, p),
    tips: tips(r, lang),
    footer: { observed: t(lang, "observed", { t: clock(c.time) }), source: sourceText(r, p, (s) => s), backup: r.source === "met-no" },
    presets: Array.from({ length: PRESET_COUNT }, (_, i) => presetName(i, lang)),
    strings: appStrings(lang),
  };
}

// ---------------------------------------------------------------- HTTP
const API_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

export const apiJson = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...API_HEADERS, ...extra } });

/** Every error has the same shape: a stable code for the page and a plain sentence for the person. Nothing internal. */
export const apiError = (status: number, code: string, message: string, extra: Record<string, string> = {}) =>
  apiJson({ error: { code, message } }, status, extra);

/** A forced refresh is honoured at most this often per place: the page's refresh button can't hammer the weather services. */
export const MIN_REFRESH_MS = 60_000;
const MAX_BODY_CHARS = 200;

type Auth = { user: User } | { refused: Response };

/** Who is asking, and may they? Mirrors the chat's access rules without ever creating or changing a user. */
async function authorise(req: Request, env: Env): Promise<Auth> {
  const header = req.headers.get("authorization") ?? "";
  const who = await verifyInitData(header.startsWith("tma ") ? header.slice(4) : "", env.TELEGRAM_BOT_TOKEN);
  if (!who) return { refused: apiError(401, "unauthorized", t(langHint(req.headers.get("accept-language")), "app_err_expired")) };
  const user = await getUser(env.DB, who.id);
  if (!user) return { refused: apiError(403, "not_registered", t(langHint(who.languageCode), "app_err_start")) };
  if (user.status === "blocked") return { refused: apiError(403, "denied", t(user.lang, "app_err_denied")) };
  if (user.status !== "active" && !parseIdList(env.ADMIN_IDS).includes(who.id)) {
    return { refused: apiError(403, "pending", t(user.lang, "app_err_pending")) };
  }
  return { user };
}

async function userDashboard(env: Env, user: User, report: Report): Promise<Dashboard> {
  const wx = makeWeather(env);
  return buildDashboard(report, prefsOf(user), await userWarnings(wx, user), { state: canonicalState(user.region) });
}

async function onDashboard(env: Env, user: User, fresh: boolean): Promise<Response> {
  const wx = makeWeather(env);
  let report = await wx.fetchReport(placeOf(user));
  const wait = Number(env.APP_REFRESH_MS ?? MIN_REFRESH_MS);
  if (fresh && Date.now() - report.fetchedAt >= (Number.isFinite(wait) ? wait : MIN_REFRESH_MS)) report = await wx.fetchReport(placeOf(user), true);
  return apiJson(await userDashboard(env, user, report));
}

async function onPlaces(env: Env, user: User, query: string): Promise<Response> {
  const q = query.trim();
  if (q.length < 2 || q.length > 60) return apiError(400, "bad_query", t(user.lang, "app_err_query"));
  let results: Place[];
  try {
    results = await makeWeather(env).searchPlaces(q, 5, user.lang);
  } catch (e) {
    if (!(e instanceof WeatherError)) throw e;
    return apiError(503, "search_unavailable", t(user.lang, "app_err_search"), { "retry-after": "30" });
  }
  // The page gets labels only and answers with an INDEX, exactly like the chat's buttons: it can never make us store an arbitrary place.
  await patchUser(env.DB, user.chatId, { searchJson: JSON.stringify(results) });
  return apiJson({ results: results.map(placeLabel) });
}

async function onSavePlace(env: Env, user: User, req: Request): Promise<Response> {
  const bad = () => apiError(400, "bad_request", t(user.lang, "app_err_generic"));
  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) return bad();
  let body: { pick?: unknown; preset?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return bad();
  }
  if (!body || typeof body !== "object") return bad();

  let place: Place | undefined;
  if (Number.isInteger(body.preset)) {
    const i = body.preset as number;
    if (i >= 0 && i < PRESET_COUNT) place = presetPlace(i, user.lang);
  } else if (Number.isInteger(body.pick)) {
    let results: Place[] = [];
    try {
      results = JSON.parse(user.searchJson || "[]");
    } catch {
      /* treat as expired */
    }
    place = Array.isArray(results) ? results[body.pick as number] : undefined;
  }
  if (!place) return bad();

  const wx = makeWeather(env);
  const saved = await savePlace(env, wx, user, place);
  // Label the place exactly as every later load will (from the saved row), so the name doesn't change on the next visit.
  return apiJson({ ...(await userDashboard(env, saved.user, { ...saved.report, place: placeOf(saved.user) })), saved: true });
}

function onDemo(url: URL): Response {
  const scene = url.searchParams.get("scene");
  if (!isDemoScene(scene)) return apiError(400, "bad_scene", `Use one of: ${DEMO_SCENES.join(", ")}`);
  const lang = langHint(url.searchParams.get("lang"));
  const demo = demoReport(scene, lang);
  return apiJson(buildDashboard(demo.report, defaultPrefs(lang), demo.warnings, { state: demo.state, demo: true }));
}

const ROUTES: Record<string, "GET" | "POST"> = {
  "/api/app/dashboard": "GET",
  "/api/app/places": "GET",
  "/api/app/place": "POST",
  "/api/app/demo": "GET",
};

/** Everything under /api/. Always answers in JSON (NFR-7). */
export async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = ROUTES[path];
  if (!method) return apiError(404, "not_found", "Not found");
  if (req.method !== method) return apiError(405, "method_not_allowed", "Method not allowed", { allow: method });

  let lang: Lang = "en";
  try {
    if (path === "/api/app/demo") return onDemo(url);
    const auth = await authorise(req, env);
    if ("refused" in auth) return auth.refused;
    lang = auth.user.lang;
    if (path === "/api/app/dashboard") return await onDashboard(env, auth.user, url.searchParams.get("fresh") === "1");
    if (path === "/api/app/places") return await onPlaces(env, auth.user, url.searchParams.get("q") ?? "");
    return await onSavePlace(env, auth.user, req);
  } catch (e) {
    if (e instanceof WeatherError) return apiError(503, "weather_unavailable", t(lang, "app_err_wx"), { "retry-after": "30" });
    console.log(JSON.stringify({ event: "api_error", path, error: String(e).slice(0, 200) })); // never the request headers: they carry initData
    return apiError(500, "server_error", t(lang, "app_err_generic"));
  }
}
