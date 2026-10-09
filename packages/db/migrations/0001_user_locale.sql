-- Expand-only upgrade used to prove a migrated database can move forward.
ALTER TABLE users ADD COLUMN locale text NOT NULL DEFAULT 'en';
CREATE INDEX users_status_created_idx ON users (status, created_at DESC);
