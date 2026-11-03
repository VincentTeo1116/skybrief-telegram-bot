-- Display preferences, alerts and the optional evening report. Existing users get safe defaults
-- (metric units, full report, all alerts off), so nothing changes for them until they opt in.
ALTER TABLE users ADD COLUMN temp_unit        TEXT    NOT NULL DEFAULT 'c';      -- c | f
ALTER TABLE users ADD COLUMN wind_unit        TEXT    NOT NULL DEFAULT 'kmh';    -- kmh | ms | mph
ALTER TABLE users ADD COLUMN clock            TEXT    NOT NULL DEFAULT 'auto';   -- auto | 12 | 24
ALTER TABLE users ADD COLUMN compact          INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users ADD COLUMN rain_alerts      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN aqi_alert        INTEGER NOT NULL DEFAULT 0;        -- 0 = off, else the AQI level that triggers it
ALTER TABLE users ADD COLUMN aqi_alert_active INTEGER NOT NULL DEFAULT 0;        -- already alerted and not yet recovered
ALTER TABLE users ADD COLUMN last_rain_alert  INTEGER NOT NULL DEFAULT 0;        -- epoch ms
ALTER TABLE users ADD COLUMN last_aqi_alert   INTEGER NOT NULL DEFAULT 0;        -- epoch ms
ALTER TABLE users ADD COLUMN last_alert_check INTEGER NOT NULL DEFAULT 0;        -- epoch ms (fair rotation when many cities)

ALTER TABLE users ADD COLUMN evening_on       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN evening_time     TEXT    NOT NULL DEFAULT '18:00';
ALTER TABLE users ADD COLUMN last_evening     TEXT    NOT NULL DEFAULT '';       -- local date of the last evening report
