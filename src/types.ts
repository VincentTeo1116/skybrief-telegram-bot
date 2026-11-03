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
  /** Test hook: point the Telegram client at a mock server. */
  TELEGRAM_API_BASE?: string;
}

export type Lang = "en" | "ms" | "zh";
export type Status = "active" | "pending" | "blocked";

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
}

// ---- Open-Meteo payloads (only the fields we read)
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
    wind_speed_10m: number;
    wind_direction_10m: number | null;
    wind_gusts_10m: number | null;
    is_day?: number;
  };
  hourly: {
    time: string[];
    temperature_2m: (number | null)[];
    precipitation_probability: (number | null)[];
    weather_code: (number | null)[];
  };
  daily: {
    time: string[];
    weather_code: (number | null)[];
    temperature_2m_max: (number | null)[];
    temperature_2m_min: (number | null)[];
    precipitation_probability_max: (number | null)[];
    sunrise: string[];
    sunset: string[];
    uv_index_max: (number | null)[];
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

export interface Report {
  place: Place;
  wx: Forecast;
  aq: Air | null;
  fetchedAt: number;
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
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallback;
}
