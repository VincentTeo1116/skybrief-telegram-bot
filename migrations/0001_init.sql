-- One row per Telegram user. Location, language, layout and daily-report preferences are all per user.
CREATE TABLE IF NOT EXISTS users (
    chat_id     INTEGER PRIMARY KEY,
    first_name  TEXT    NOT NULL DEFAULT '',
    username    TEXT    NOT NULL DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'pending',   -- active | pending | blocked
    place_name  TEXT    NOT NULL,
    lat         REAL    NOT NULL,
    lon         REAL    NOT NULL,
    country     TEXT    NOT NULL DEFAULT '',
    tz          TEXT    NOT NULL DEFAULT 'UTC',
    lang        TEXT    NOT NULL DEFAULT 'en',
    hidden      TEXT    NOT NULL DEFAULT '',          -- comma list of hidden report sections
    daily_on    INTEGER NOT NULL DEFAULT 1,
    daily_time  TEXT    NOT NULL DEFAULT '08:30',     -- HH:MM in the location's own timezone
    last_sent   TEXT    NOT NULL DEFAULT '',          -- local date (YYYY-MM-DD) of the last daily report
    search_json TEXT    NOT NULL DEFAULT '',          -- city-search results awaiting a tap
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_daily ON users (status, daily_on);
