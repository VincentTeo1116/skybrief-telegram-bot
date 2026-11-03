export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  /** Shared secret: Telegram sends it with every webhook call, and it protects /setup. */
  WEBHOOK_SECRET: string;
  /** Comma-separated Telegram user IDs that administer the bot. */
  ADMIN_IDS?: string;
  WAQI_TOKEN?: string;
  /** open | approval | closed */
  ACCESS_MODE?: string;
  DEFAULT_DAILY_TIME?: string;
  /** Alerts are paused during these local hours, "22:00-06:30" (default) or "off". */
  QUIET_HOURS?: string;

  // ---- test hooks (never set in production)
  /** Point the Telegram client at a mock server. */
  TELEGRAM_API_BASE?: string;
  /** Point the data sources at mock servers. */
  OPEN_METEO_FORECAST_URL?: string;
  OPEN_METEO_AIR_URL?: string;
  OPEN_METEO_GEO_URL?: string;
  NOMINATIM_URL?: string;
  WAQI_URL?: string;
  METNO_URL?: string;
  /** "1" = run the alert pass on every cron tick instead of every 15 minutes. */
  ALERTS_EVERY_MINUTE?: string;
}

export type Lang = "en" | "ms" | "zh";
export type Status = "active" | "pending" | "blocked";
export type TempUnit = "c" | "f";
export type WindUnit = "kmh" | "ms" | "mph";
export type ClockMode = "auto" | "12" | "24";
export type Source = "open-meteo" | "met-no";

export interface Place {
  name: string;
  lat: number;
  lon: number;
  country: string;
  admin?: string;
  tz: string;
}

export interface User {
  chatId: number;
  firstName: string;
  username: string;
  status: Status;
  placeName: string;
  lat: number;
  lon: number;
  country: string;
  tz: string;
  lang: Lang;
  hidden: Set<string>;
  dailyOn: boolean;
  dailyTime: string;
  lastSent: string;
  searchJson: string;
  createdAt: string;
  // display
  tempUnit: TempUnit;
  windUnit: WindUnit;
  clock: ClockMode;
  compact: boolean;
  // alerts & evening report
  rainAlerts: boolean;
  aqiAlert: number;
  aqiAlertActive: boolean;
  lastRainAlert: number;
  lastAqiAlert: number;
  lastAlertCheck: number;
  eveningOn: boolean;
  eveningTime: string;
  lastEvening: string;
}

/** Everything that controls how a report is rendered for one person. */
export interface Prefs {
  lang: Lang;
  hidden: ReadonlySet<string>;
  tempUnit: TempUnit;
  windUnit: WindUnit;
  clock: ClockMode;
  compact: boolean;
}

// ---- Open-Meteo payloads (only the fields we read). Times are LOCAL "YYYY-MM-DDTHH:MM".
export interface Forecast {
  timezone: string;
  current: {
    time: string;
    temperature_2m: number;
    relative_humidity_2m: number;
    apparent_temperature: number | null;
    precipitation: number | null;
    weather_code: number | null;
    cloud_cover: number;
    pressure_msl: number;
    wind_speed_10m: number; // km/h
    wind_direction_10m: number | null;
    wind_gusts_10m: number | null;
    is_day?: number;
  };
  hourly: {
    time: string[];
    temperature_2m: (number | null)[];
    apparent_temperature?: (number | null)[];
    precipitation_probability: (number | null)[];
    precipitation?: (number | null)[];
    weather_code: (number | null)[];
    uv_index?: (number | null)[];
    is_day?: (number | null)[];
  };
  daily: {
    time: string[];
    weather_code: (number | null)[];
    temperature_2m_max: (number | null)[];
    temperature_2m_min: (number | null)[];
    apparent_temperature_max?: (number | null)[];
    precipitation_probability_max: (number | null)[];
    precipitation_sum?: (number | null)[];
    sunrise: string[];
    sunset: string[];
    uv_index_max: (number | null)[];
    wind_speed_10m_max?: (number | null)[];
  };
}

export interface Air {
  aqi: number;
  pm25: number | null;
  pm10: number | null;
  source: string;
  station: string | null;
  km: number | null;
  dominant: string | null;
}

/** Modelled hourly US AQI (used for the outlook and the "best time outside" hint). */
export interface AirHourly {
  time: string[];
  us_aqi: (number | null)[];
}

export interface Report {
  place: Place;
  wx: Forecast;
  aq: Air | null;
  aqHourly: AirHourly | null;
  fetchedAt: number;
  source: Source;
}

// ---- Telegram payloads (only the fields we read)
export interface TgUser {
  id: number;
  first_name?: string;
  username?: string;
}
export interface TgChat {
  id: number;
  type: string;
}
export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  location?: { latitude: number; longitude: number };
}
export interface TgCallback {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}
export interface TgInlineQuery {
  id: string;
  from: TgUser;
  query: string;
  offset?: string;
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallback;
  inline_query?: TgInlineQuery;
}
