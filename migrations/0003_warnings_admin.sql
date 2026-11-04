-- Official MetMalaysia warnings: each person's state (warnings are published per state), an on/off switch,
-- and the warnings they were already told about (so nobody is notified twice).
-- Existing users get warnings ON by default; they only ever apply to places in Malaysia.
ALTER TABLE users ADD COLUMN region       TEXT    NOT NULL DEFAULT '';   -- canonical state, '' = not worked out yet, '-' = not Malaysia / unknown
ALTER TABLE users ADD COLUMN district     TEXT    NOT NULL DEFAULT '';   -- district/county when the geocoder told us ('' = unknown)
ALTER TABLE users ADD COLUMN warnings_on  INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN warn_seen    TEXT    NOT NULL DEFAULT '';   -- comma list of the last ~12 warning ids already sent

-- Small key/value store for the admin tools: cron heartbeat, daily counters, health probes, the running broadcast.
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
