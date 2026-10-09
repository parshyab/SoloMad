# Account setup

Local simulator development does not need any value on this page. It runs against the local Supabase CLI stack (`make supabase-start`). `make release-check` stays nonzero until the release rows below are filled. Do not paste private keys into chat or commit them.

`ios/NomadTable.xcodeproj` and its shared scheme are the iOS project. XcodeGen is **RETIRED_AFTER_VERIFIED_REMOVAL**. Do not install it, and do not regenerate the project. `make ios-generate` exits 2.

The association file is published only when `APPLE_TEAM_ID` is 10 letters or digits. `TEAMID` is not served. Privacy, terms, guidelines, contact, and deletion stay drafts until `LEGAL_STATUS=approved` and the operator supplies final text.

## Summary

| Name | Source | Destination | Secrecy | Verify with | Blocks |
| --- | --- | --- | --- | --- | --- |
| `SUPABASE_URL` | Supabase dashboard → Project Settings → API | API, gateway, `ios/Config/Release.xcconfig` | public | `make supabase-live-smoke` | release |
| `SUPABASE_PUBLISHABLE_KEY` | Project Settings → API Keys → publishable | API, gateway, `ios/Config/Release.xcconfig` | public client key | `make supabase-live-smoke` | release |
| `SUPABASE_SECRET_KEY` | Project Settings → API Keys → secret | API and gateway hosts only | secret | `make release-check` | release |
| `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_AUDIENCE`, `SUPABASE_JWKS_URL` | derived from the URL (`<url>/auth/v1`, `authenticated`, `<url>/auth/v1/.well-known/jwks.json`) | API, gateway | public | unit tests + live smoke | none (defaults) |
| `SUPABASE_SMOKE_EMAIL`, `SUPABASE_SMOKE_PASSWORD` | an owner-created test user in the hosted project | CI/operator shell only | secret | `make supabase-live-smoke` | release |
| `APPLE_TEAM_ID` | developer.apple.com → Membership | web process (association file) | public | `pnpm test` (association) + device check | device, release |
| `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY`, `APNS_ENVIRONMENT` | developer.apple.com → Keys | worker host | key is secret | `make release-check` | release |
| `REVENUECAT_PUBLIC_SDK_KEY` | RevenueCat → API keys (iOS public) | iOS | public | sandbox purchase | release |
| `REVENUECAT_API_KEY`, `REVENUECAT_WEBHOOK_SECRET` | RevenueCat → API keys / Integrations → Webhooks | API only | secret | webhook delivery | release |
| `ANTHROPIC_API_KEY` | console.anthropic.com | API only | secret | `GET /v1/recommendations` returns `ai` not `unavailable` | none (optional) |
| `LEGAL_CONTACT_EMAIL`, `LEGAL_STATUS` | operator decision | web | public | `make release-check` | release |

## Supabase

solomad uses Supabase for **authentication only**. Membership, entitlements, profiles, and message history stay in the solomad PostgreSQL database, which is not exposed through Supabase's Data API, so no business table relies on Row Level Security. Every API and gateway path authorizes in application code from the verified `sub`. Media stays on S3 (LocalStack locally); Firebase Storage was never used, so Supabase Storage is not configured.

### Local (no account needed)

`make supabase-start` runs the pinned Supabase CLI (`2.90.0`, override with `SUPABASE_BIN`) with Auth, its Postgres, and the Kong gateway only. Ports are `554xx` (API `55421`) so they do not collide with other stacks. Local JWTs are ES256 signed by `supabase/signing_keys.json` (generated, gitignored, mode 600) and published at `http://127.0.0.1:55421/auth/v1/.well-known/jwks.json`.

The command writes `.env.supabase.local` (gitignored, mode 600) from `supabase status`, plus `ios/Config/Local.xcconfig` with the local publishable key, and links three labeled local test users (`mina@solomad.test`, `jonah@solomad.test`, `leila@solomad.test`) to the seeded application users. Their shared password is generated locally as `SOLOMAD_LOCAL_PASSWORD` in `.env.supabase.local` and never printed. `make supabase-stop` keeps the Docker volume.

### Staging file

Hosted values for this checkout live in `.env.supabase.staging.local` (gitignored, mode 600). The tracked template is `.env.supabase.staging.example` and contains empty values. `SUPABASE_SMOKE_EMAIL` and `SUPABASE_SMOKE_PASSWORD` are a dedicated user in that project's Supabase Auth, not the Supabase dashboard login. `API_PUBLIC_ORIGIN` and `REALTIME_PUBLIC_ORIGIN` are the deployed solomad API and gateway. They are not taken from `SUPABASE_URL`.

`make ios-run` stays on the local Debug scheme. `make ios-staging-build`, `make ios-staging-auth`, and `make ios-staging-run` use the shared `NomadTable-Staging` scheme. Only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are written to the gitignored `ios/Config/Staging.local.xcconfig`. The secret key and smoke password stay out of the app.

### Hosted project

1. Create a project at https://supabase.com/dashboard. Record the project URL as `SUPABASE_URL`.
2. Project Settings → JWT Keys: use asymmetric signing keys (ES256 or RS256). The API and gateway verify only against `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`; they never accept a token from another issuer, and do not use a symmetric JWT secret.
3. Project Settings → API Keys: copy the publishable key to `SUPABASE_PUBLISHABLE_KEY` (API, gateway, and `ios/Config/Release.xcconfig`). Copy the secret key to `SUPABASE_SECRET_KEY` on the API and gateway hosts only. It reads `banned_until` from the Auth admin API. It must never be in the app, logs, or Git. Legacy `anon`/`service_role` JWT keys are not used.
4. Authentication → Providers:
   - **Apple**: enable, set the Services ID / bundle id `app.solomad.ios` as an authorized client id. The app exchanges the native Apple identity token with a SHA-256 nonce (`grant_type=id_token`).
   - **Phone**: enable only with a real SMS provider (Twilio, MessageBird, Vonage, or Textlocal) configured in the dashboard.
   - **Google**: enable it with a Google OAuth **Web application** client if the "previously signed in with Google?" path is kept. In Google Cloud Console, add `https://<project-ref>.supabase.co/auth/v1/callback` as that client's authorized redirect URI, then paste its client ID and secret into the Supabase Google provider. The iOS app never receives the Google client secret; it starts Supabase's PKCE authorization flow in `ASWebAuthenticationSession` and returns through `app.solomad.ios://auth-callback`.
   - Email/password stays enabled only if the owner wants it; the iOS email/password screen is compiled into Debug builds only.
5. Authentication → URL Configuration: site URL is the operator web origin; add `app.solomad.ios://auth-callback` to the redirect allow list. Do not add wildcard redirects.
6. Authentication → SMTP: configure a real sender before enabling email confirmation or magic links.
7. Create one test user in Authentication → Users and put its credentials in `SUPABASE_SMOKE_EMAIL` / `SUPABASE_SMOKE_PASSWORD` inside `.env.supabase.staging.local`. That user is not the dashboard account. Leave `API_PUBLIC_ORIGIN` and `REALTIME_PUBLIC_ORIGIN` empty until those services are deployed.

### Session invalidation

A Supabase access token stays cryptographically valid until it expires, even after logout. The shared verifier (`packages/domain/src/supabase-auth.ts`, used by both the API and the gateway) therefore also confirms the session with Supabase Auth (`GET /auth/v1/user`) and, with the secret key, the account's `banned_until`. Results are cached per `session_id` for `SUPABASE_SESSION_CHECK_TTL_SECONDS` (default 30, max 300). That is the propagation window for logout, ban, and deletion. If Supabase Auth cannot be reached, requests fail closed with `auth_unavailable` (503). Established sockets re-check on every join/send, disconnect at token expiry, and accept `auth:refresh` only for the same user.

### Verification

- Local: `make auth-smoke` (26 checks against real local sessions, the API process, and the gateway).
- Hosted: `make supabase-live-smoke` with the hosted values and smoke account. It signs in, calls `/v1/me`, connects to the gateway, signs out, and confirms the API rejects the signed-out token within the window. Without values it prints `SKIPPED` and exits 3. A skip is not a pass, and `make release-check` treats it as missing.

### Identity and purchase mapping

Application users keep their internal `users.id`. A Supabase login adds an `identities` row (`provider='supabase'`, `provider_subject = auth.users.id`). Earlier provider rows are kept. `identity_migrations` records each legacy→Supabase link and how it was made (`development_seed`, `verified_link`, `operator_import`). Accounts are never merged by matching email. Linking an existing account to a new sign-in goes through `POST /v1/me/identities/link` while signed in to both.

RevenueCat's App User ID is `users.id`, not the auth subject, so changing the auth provider does not move or lose a purchase.

The current repository contains only development seed data; no Firebase users or production data existed. A real migration would need an export of each legacy provider subject plus a verified link per user. Passwords and existing provider sessions do not transfer, so users would sign in again with Apple/phone.

## Apple signing

Obtain the team from the Apple Developer account that owns `app.solomad.ios`.

1. Open `ios/NomadTable.xcodeproj` in the selected Xcode.
2. Sign in under Xcode Settings → Accounts.
3. Select the NomadTable target, then the team. Register bundle id `app.solomad.ios` if the account does not already have it. Enable the Sign in with Apple capability (required for the native Apple button) and Push Notifications when APNs is connected.
4. For a physical device, Xcode creates an Apple Development certificate and profile. For App Store or TestFlight distribution, use an Apple Distribution certificate and an App Store profile.
5. Put the 10-character Team ID in `APPLE_TEAM_ID` for the web process that serves `/.well-known/apple-app-site-association`. Confirm in the membership page whether the application identifier prefix equals the Team ID; for older App IDs it can differ.

Simulator Debug builds are ad-hoc signed (`CODE_SIGN_IDENTITY=-`, no team, no certificate) so the Keychain works; they do not use these identities. Sign in with Apple cannot complete in that build because it needs the capability on a team-signed build. `make ios-archive` still uses Release automatic signing.

A valid identity must include its private key in the login keychain. Do not export that key into the repository.

Dashboard: https://developer.apple.com/account

## APNs

Create an Apple Push Notifications key (.p8) in the developer account. Record the Key ID, Team ID, and topic `app.solomad.ios`. Enable the Push Notifications capability on the app id. Supabase does not replace these values.

This repository registers device tokens at `/v1/devices` and does not send through APNs yet. There was never an FCM path to remove. Leave `APNS_TEAM_ID`, `APNS_KEY_ID`, and `APNS_PRIVATE_KEY` empty until a sender is connected. Do not describe a local notification as live APNs delivery.

Dashboard: https://developer.apple.com/account/resources/authkeys/list

## RevenueCat

Create the subscription products in App Store Connect, then map them to a RevenueCat entitlement and offering.

- `REVENUECAT_PUBLIC_SDK_KEY` is the public iOS SDK key and may ship in the client.
- `REVENUECAT_API_KEY` and `REVENUECAT_WEBHOOK_SECRET` stay on the server.
- The App User ID is the internal `users.id` (see Identity and purchase mapping).

Until those exist, the profile screen says Plus is not active and does not grant Plus locally. Sandbox testing, after the products exist, is: purchase, cancel, restore, and confirm the webhook updates `entitlements`. A StoreKit file alone does not prove that path.

Dashboards: https://app.revenuecat.com/ and https://appstoreconnect.apple.com/

## Anthropic

Set `ANTHROPIC_API_KEY` on the API only. `GET /v1/recommendations` returns `ai: "unavailable"` and `source: "database"` when the key is absent. That database list is not an Anthropic response.

Docs: https://docs.anthropic.com/

## Associated domains and legal pages

Host `https://<the operator domain>/.well-known/apple-app-site-association` with `Content-Type: application/json` and no redirect. The app entitlement `applinks:<domain>` must match. Paths are `/a/*`. Verify on a physical device; simulator route tests do not prove universal links.

Outstanding content, still drafts in the web app:

- Location sharing lasts 5–120 minutes and precise location stays off public pages.
- Activities, messages, and photos are user-generated; block and report exist, and moderation copy is not approved.
- Account deletion is requested in the app and anonymizes shared messages.
- Subscriptions and Plus are not sold until RevenueCat and App Store products exist.
- Recommendations name Anthropic only when `ANTHROPIC_API_KEY` is set.
- The support address is `LEGAL_CONTACT_EMAIL`. The placeholder `privacy@solomad.invalid` is not a real inbox.

Do not remove the draft label to satisfy `make release-check`.

## Terraform

`infra/terraform/modules/stack/versions.tf` and both environment roots require Terraform `>= 1.10.0` and the AWS provider `~> 5.70`. The local binary is pinned at `infra/terraform/.terraform-version` to 1.16.5 (official zip, SHA256SUMS verified). `make terraform-check` runs `fmt -check`, `init -backend=false`, and `validate` in both roots without touching remote state.

Staging and production backends use an S3 bucket with native locking (`use_lockfile = true`) in `us-east-1`. The bucket name is still `REPLACE_WITH_STATE_BUCKET`. There is no DynamoDB lock table. Do not apply until the owner supplies a real bucket name, domain, and account that has opted into S3 and EC2. LocalStack does not prove those resources exist.
