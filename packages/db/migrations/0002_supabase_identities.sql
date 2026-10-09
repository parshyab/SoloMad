-- Supabase Auth subjects become identities with provider 'supabase' and provider_subject = auth.users.id.
-- Internal users.id values do not change, so profiles, activities, memberships, messages, trips,
-- reports, blocks, uploads, and RevenueCat app user ids (users.id) keep their relationships.
-- Earlier provider rows are kept for history and for an audited legacy mapping; they are not deleted.
ALTER TABLE identities DROP CONSTRAINT IF EXISTS identities_provider_check;
ALTER TABLE identities ADD CONSTRAINT identities_provider_check
  CHECK (provider IN ('apple', 'google', 'phone', 'supabase'));

CREATE TABLE IF NOT EXISTS identity_migrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  legacy_provider text NOT NULL,
  legacy_subject text NOT NULL,
  supabase_subject text NOT NULL,
  method text NOT NULL CHECK (method IN ('development_seed', 'verified_link', 'operator_import')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (legacy_provider, legacy_subject),
  UNIQUE (supabase_subject)
);
