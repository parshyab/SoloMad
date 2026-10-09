CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  onboarding_step text NOT NULL DEFAULT 'name',
  onboarding_completed_at timestamptz,
  pending_deep_link text,
  birth_date date,
  adult_eligible boolean NOT NULL DEFAULT false,
  deletion_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  provider text NOT NULL CHECK (provider IN ('apple', 'google', 'phone')),
  provider_subject text NOT NULL,
  email text,
  phone_e164 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject)
);
CREATE INDEX identities_user_idx ON identities (user_id);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users (id),
  role text NOT NULL CHECK (role IN ('member', 'moderator', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE profiles (
  user_id uuid PRIMARY KEY REFERENCES users (id),
  display_name text NOT NULL DEFAULT '',
  gender text,
  home_country_code char(2),
  bio text,
  avatar_media_id uuid,
  verification_status text NOT NULL DEFAULT 'none' CHECK (verification_status IN ('none', 'pending', 'approved', 'rejected')),
  visibility text NOT NULL DEFAULT 'members' CHECK (visibility IN ('public', 'members', 'hidden')),
  show_approximate_location boolean NOT NULL DEFAULT false,
  current_city_id uuid,
  location_permission text NOT NULL DEFAULT 'unknown' CHECK (location_permission IN ('unknown', 'granted', 'denied', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (bio IS NULL OR char_length(bio) <= 200)
);

CREATE TABLE profile_languages (
  user_id uuid NOT NULL REFERENCES profiles (user_id) ON DELETE CASCADE,
  language_code text NOT NULL,
  PRIMARY KEY (user_id, language_code)
);

CREATE TABLE profile_interests (
  user_id uuid NOT NULL REFERENCES profiles (user_id) ON DELETE CASCADE,
  interest text NOT NULL,
  PRIMARY KEY (user_id, interest)
);

CREATE TABLE preferences (
  user_id uuid PRIMARY KEY REFERENCES users (id),
  push_enabled boolean NOT NULL DEFAULT false,
  email_enabled boolean NOT NULL DEFAULT false,
  activity_updates boolean NOT NULL DEFAULT true,
  chat_alerts boolean NOT NULL DEFAULT true,
  trip_overlaps boolean NOT NULL DEFAULT true,
  marketing boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE countries (
  code char(2) PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE cities (
  id uuid PRIMARY KEY,
  country_code char(2) NOT NULL REFERENCES countries (code),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  timezone text NOT NULL,
  location geography(Point, 4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cities_location_gix ON cities USING GIST (location);

ALTER TABLE profiles
  ADD CONSTRAINT profiles_current_city_fk FOREIGN KEY (current_city_id) REFERENCES cities (id);

CREATE TABLE venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES cities (id),
  name text NOT NULL,
  address text,
  location geography(Point, 4326) NOT NULL,
  provider text,
  provider_place_id text,
  attribution text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX venues_location_gix ON venues USING GIST (location);
CREATE INDEX venues_city_idx ON venues (city_id);

CREATE TABLE media_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users (id),
  kind text NOT NULL CHECK (kind IN ('avatar', 'verification', 'chat')),
  status text NOT NULL CHECK (status IN ('pending', 'ready', 'rejected')),
  content_type text NOT NULL,
  byte_size integer,
  width integer,
  height integer,
  storage_key text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('public', 'private')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_owner_idx ON media_objects (owner_id, created_at DESC);

ALTER TABLE profiles
  ADD CONSTRAINT profiles_avatar_fk FOREIGN KEY (avatar_media_id) REFERENCES media_objects (id);

CREATE TABLE activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id uuid NOT NULL REFERENCES users (id),
  city_id uuid NOT NULL REFERENCES cities (id),
  venue_id uuid REFERENCES venues (id),
  category text NOT NULL,
  emoji text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  timezone text NOT NULL,
  meeting_point geography(Point, 4326) NOT NULL,
  capacity integer NOT NULL CHECK (capacity BETWEEN 2 AND 50),
  going_count integer NOT NULL DEFAULT 1 CHECK (going_count >= 0 AND going_count <= capacity),
  expense_guidance text,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'started', 'completed', 'cancelled')),
  cancel_reason text,
  version integer NOT NULL DEFAULT 1,
  reminder_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activities_discovery_idx ON activities (status, starts_at);
CREATE INDEX activities_city_idx ON activities (city_id, starts_at);
CREATE INDEX activities_meeting_gix ON activities USING GIST (meeting_point);
CREATE INDEX activities_host_idx ON activities (host_user_id);

CREATE TABLE activity_memberships (
  activity_id uuid NOT NULL REFERENCES activities (id),
  user_id uuid NOT NULL REFERENCES users (id),
  status text NOT NULL CHECK (status IN ('host', 'active', 'left', 'removed')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  PRIMARY KEY (activity_id, user_id)
);
CREATE INDEX activity_memberships_user_idx ON activity_memberships (user_id, status);

CREATE TABLE activity_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_drafts_user_idx ON activity_drafts (user_id, updated_at DESC);

CREATE TABLE activity_saves (
  user_id uuid NOT NULL REFERENCES users (id),
  activity_id uuid NOT NULL REFERENCES activities (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, activity_id)
);

CREATE TABLE attendance (
  activity_id uuid NOT NULL REFERENCES activities (id),
  user_id uuid NOT NULL REFERENCES users (id),
  host_confirmed boolean NOT NULL DEFAULT false,
  attendee_confirmed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, user_id)
);

CREATE TABLE feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES activities (id),
  author_id uuid NOT NULL REFERENCES users (id),
  subject_id uuid NOT NULL REFERENCES users (id),
  rating text NOT NULL CHECK (rating IN ('up', 'down')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (activity_id, author_id, subject_id),
  CHECK (author_id <> subject_id)
);
CREATE INDEX feedback_subject_idx ON feedback (subject_id) WHERE rating = 'up';

CREATE TABLE trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  city_id uuid NOT NULL REFERENCES cities (id),
  start_date date NOT NULL,
  end_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX trips_user_idx ON trips (user_id, start_date);
CREATE INDEX trips_overlap_gist ON trips USING GIST (city_id, daterange(start_date, end_date, '[]'));

CREATE TABLE visited_countries (
  user_id uuid NOT NULL REFERENCES users (id),
  country_code char(2) NOT NULL REFERENCES countries (code),
  PRIMARY KEY (user_id, country_code)
);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('activity', 'city', 'direct')),
  activity_id uuid,
  city_id uuid REFERENCES cities (id),
  shard integer NOT NULL DEFAULT 0,
  direct_low uuid,
  direct_high uuid,
  title text NOT NULL,
  member_limit integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'activity' AND activity_id IS NOT NULL)
    OR (kind = 'city' AND city_id IS NOT NULL)
    OR (kind = 'direct' AND direct_low IS NOT NULL AND direct_high IS NOT NULL AND direct_low < direct_high)
  )
);
CREATE UNIQUE INDEX conversations_activity_uidx ON conversations (activity_id) WHERE kind = 'activity';
CREATE UNIQUE INDEX conversations_city_shard_uidx ON conversations (city_id, shard) WHERE kind = 'city';
CREATE UNIQUE INDEX conversations_direct_uidx ON conversations (direct_low, direct_high) WHERE kind = 'direct';

CREATE TABLE conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations (id),
  user_id uuid NOT NULL REFERENCES users (id),
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('host', 'member')),
  muted boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_members_user_idx ON conversation_members (user_id) WHERE removed_at IS NULL;

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations (id),
  sender_id uuid NOT NULL REFERENCES users (id),
  client_message_id text NOT NULL,
  body text,
  kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'image', 'poll', 'location', 'system')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, client_message_id),
  CHECK (body IS NULL OR char_length(body) <= 4000)
);
CREATE INDEX messages_conversation_recent_idx ON messages (conversation_id, created_at DESC);

CREATE TABLE message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages (id),
  media_id uuid NOT NULL REFERENCES media_objects (id),
  UNIQUE (message_id, media_id)
);

CREATE TABLE polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations (id),
  message_id uuid REFERENCES messages (id),
  creator_id uuid NOT NULL REFERENCES users (id),
  question text NOT NULL,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX polls_conversation_idx ON polls (conversation_id);

CREATE TABLE poll_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES polls (id),
  label text NOT NULL,
  position integer NOT NULL,
  UNIQUE (poll_id, position)
);

CREATE TABLE poll_votes (
  poll_id uuid NOT NULL REFERENCES polls (id),
  user_id uuid NOT NULL REFERENCES users (id),
  option_id uuid NOT NULL REFERENCES poll_options (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, user_id)
);

CREATE TABLE read_cursors (
  conversation_id uuid NOT NULL REFERENCES conversations (id),
  user_id uuid NOT NULL REFERENCES users (id),
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE location_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations (id),
  user_id uuid NOT NULL REFERENCES users (id),
  expires_at timestamptz NOT NULL,
  stopped_at timestamptz,
  latitude double precision,
  longitude double precision,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);
CREATE INDEX location_shares_active_idx ON location_shares (conversation_id, expires_at) WHERE stopped_at IS NULL;

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  resource_type text,
  resource_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  token text NOT NULL UNIQUE,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  bundle_id text NOT NULL,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_tokens_user_idx ON device_tokens (user_id) WHERE disabled_at IS NULL;

CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid REFERENCES notifications (id),
  device_token_id uuid REFERENCES device_tokens (id),
  channel text NOT NULL CHECK (channel IN ('push', 'email', 'in_app')),
  status text NOT NULL,
  provider_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE entitlements (
  user_id uuid PRIMARY KEY REFERENCES users (id),
  plus_active boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'none',
  product_id text,
  expires_at timestamptz,
  will_renew boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscription_events (
  id text PRIMARY KEY,
  user_id uuid,
  event_type text NOT NULL,
  raw jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE blocks (
  blocker_id uuid NOT NULL REFERENCES users (id),
  blocked_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked_idx ON blocks (blocked_id);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES users (id),
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'actioned', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_status_idx ON reports (status, created_at DESC);

CREATE TABLE moderation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES users (id),
  report_id uuid REFERENCES reports (id),
  target_user_id uuid,
  action text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  moderation_action_id uuid NOT NULL REFERENCES moderation_actions (id),
  body text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE verification_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  media_id uuid NOT NULL REFERENCES media_objects (id),
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewer_id uuid REFERENCES users (id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE INDEX verification_pending_idx ON verification_requests (status, created_at);

CREATE TABLE support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets (id),
  author_id uuid NOT NULL REFERENCES users (id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed')),
  storage_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE deletion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  dead_lettered_at timestamptz
);
CREATE INDEX outbox_pending_idx ON outbox_events (available_at) WHERE published_at IS NULL AND dead_lettered_at IS NULL;

CREATE TABLE processed_jobs (
  id text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_records (
  user_id uuid NOT NULL REFERENCES users (id),
  key text NOT NULL,
  request_hash text NOT NULL,
  status_code integer NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);

CREATE TABLE profile_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_user_id uuid NOT NULL REFERENCES users (id),
  viewer_user_id uuid NOT NULL REFERENCES users (id),
  viewed_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_user_id, viewer_user_id, viewed_on),
  CHECK (profile_user_id <> viewer_user_id)
);
CREATE INDEX profile_views_profile_idx ON profile_views (profile_user_id, viewed_on DESC);

CREATE TABLE feature_flags (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_usage (
  user_id uuid NOT NULL REFERENCES users (id),
  used_on date NOT NULL,
  requests integer NOT NULL DEFAULT 0,
  tokens integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, used_on)
);

CREATE TABLE recommendation_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key text NOT NULL UNIQUE,
  source text NOT NULL,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
