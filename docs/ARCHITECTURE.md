# Architecture

solomad is a monorepo. The iOS app is SwiftUI. The API, realtime gateway, and worker are separate Node processes that share `@solomad/domain` and `@solomad/db`. PostgreSQL is the authority for accounts, memberships, entitlements, and message history. Redis holds short-lived discovery cache and the Socket.IO Redis Streams adapter. A transactional outbox plus SQS is the production queue path. Local development can keep `QUEUE_PROVIDER=database`.

## Request path

The app signs in with Supabase Auth and sends the Supabase access token, refreshing it before it expires. Development HS256 tokens are accepted only when `APP_ENV` is development or test. The API and gateway verify the token with the project JWKS plus a cached session/ban check, load the user by provider and subject, and ignores any user id in the body. Join, leave, cancel, and message send commit in a database transaction before the HTTP response. The gateway repeats the membership check on `room:join` and calls the same `sendMessage` function, which dedupes on `(conversation_id, client_message_id)`.

## Clients

`ios/Packages/NomadTableAPIClient` is the typed HTTP client. The app stores the session token in the Keychain, not UserDefaults. SwiftData holds activity drafts and outgoing chat rows so a failed send can be retried. Release builds point at HTTPS. Debug allows local networking only through `Info-Debug.plist`.

## Web

`apps/web` serves public activity pages, draft legal pages, and the Apple App Site Association file for `/a/*`. `apps/admin` starts an admin session and can request operational counts. Admin routes also require an admin user's bearer token and the `x-admin-session` header.

## What is still a plan

ECS services, Aurora, ElastiCache, the CDN, and multi-region growth are described in Terraform and in `docs/DEPLOYMENT.md`. They are not running. Discovery may later use a read replica. Membership, entitlements, and the read immediately after a write stay on the primary.
