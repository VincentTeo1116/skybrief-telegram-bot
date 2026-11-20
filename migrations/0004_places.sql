-- Saved places for the mini app (FR-12): up to 5 recent locations per person, as a JSON array.
-- The ACTIVE location stays in place_name / lat / lon / tz / region / district, exactly as before.
ALTER TABLE users ADD COLUMN places_json TEXT NOT NULL DEFAULT '';
