# Implementation status

Updated 2026-10-09. This file separates implemented code, local verification, configuration, and blockers. A row is not complete until the check named in it has actually run.

## Implemented and exercised locally

- PostGIS schema `0000_init`, `0001_user_locale`, and `0002_supabase_identities` (adds the `supabase` identity provider and the `identity_migrations` audit table without changing any `users.id`). `pnpm test:integration` passed 7 tests on 2026-10-09: empty-database migrate, upgrade from `0000`, legacy identity preservation across `0002`, capacity, message dedupe, trip dates, and the Socket.IO smoke.
- Domain rules for join capacity, idempotent retries, leave, message dedupe, and inclusive trip-date overlap.
- Authentication is Supabase Auth. One verifier (`packages/domain/src/supabase-auth.ts`, exported as `verifyIdentity`) is used by the API guard, `POST /v1/auth/session`, and the gateway: JWKS (ES256/RS256) signature, `exp`, trusted issuer and audience, `sub`, `session_id`, `role=authenticated`, then a session/ban check cached per session for `SUPABASE_SESSION_CHECK_TTL_SECONDS` (default 30). Unit tests cover valid, malformed, expired, wrong-issuer, wrong-audience, wrong-key, anon-role, missing-session, revoked, banned, offline, and locked-environment cases.
- Local Supabase CLI 2.90.0 stack (Auth, Postgres, Kong on `554xx`) with ES256 signing keys. `make auth-smoke` passed 26 checks on 2026-10-09 with real local sessions against the API process and the gateway: sub→seeded user mapping without duplicates, missing/malformed/foreign-key/wrong-issuer tokens rejected, two users exchanging a persisted message, spoofed `userId` ignored, non-member room refused, refresh accepted for the same user only, logout rejected on the API and on an established socket, reconnect refused then accepted after a new sign-in, other sessions unaffected, ban → `account_banned`, deletion → `session_revoked`.
- `apps/realtime/scripts/local-flow.mjs` with local Supabase sessions: profile, discovery (2 items), trips, Leila trip create/delete, join and leave dinner, inbox, history, recommendations (database fallback), entitlements, report, block, and missing-token 401.
- The development-token Socket.IO smoke (`apps/realtime/scripts/smoke.mjs`) still passes for `AUTH_MODE=development`.
- iOS Debug on iPhone 16 / iOS 18.4 (`345023AE-4CBF-4C70-81A3-788AB8603D3E`): `make ios-build` and `make ios-test` on 2026-10-09 with `XCODEGEN_BIN` and `XCODEGEN_ZIP` unset. Unit tests: 5 passed (nonce hashing, PKCE, refresh window, no secret or Firebase plist in the bundle, session-ending errors). UI test `ChatSendUITests`: Mina taps Send in the dinner chat, the API persists the body, Jonah sees that body after opening the same chat, and Mina's relaunch shows it once. A clean DerivedData build (`/tmp/solomad-dd-fresh-noxcodegen`) succeeded. `make ios-run` then launched `app.solomad.ios` (pid 55009) and the log recorded `restore: stored session found` followed by `account loaded, onboarding complete: true`. No Firebase plist or SDK is in the bundle. The persisted Send from `make ios-test` is message `649a4344-cee4-4313-97fb-75ffca0c1cc3` (`ui-send-A46CFC8B`).
- `swift run DecodeCheck` with the local stack: decode checks plus Swift sign-in, refresh, `/v1/me` (jonah's seeded id), sign-out, and refresh rejected after sign-out.
- Terraform 1.16.5 (official zip, SHA256SUMS verified, `>= 1.10.0`): backends use `use_lockfile`. `make terraform-check` passed (`fmt`, `init -backend=false`, `validate`) with AWS provider 5.100.0. Terraform authenticated as `147435199603` / `arn:aws:iam::147435199603:root` through profile `solomad-staging-terraform`. Direct `AWS_PROFILE=solomad-staging` is not enough for this provider version. S3 returned `NotSignedUp` and EC2 returned `OptInRequired` in `us-east-1`. No apply.
- Public Next.js pages. The association route returns 404 until `APPLE_TEAM_ID` matches 10 letters or digits. It does not publish `TEAMID`. Privacy, terms, guidelines, contact, and deletion remain drafts.
- `pnpm typecheck` (TypeScript 7.0.2), `pnpm lint` (JavaScript; `typescript-eslint` does not load TypeScript 7), and `pnpm test` (22 tests) pass.

## Configured only as local development

- Docker Compose: PostGIS 16-3.4, Redis 7, LocalStack 4, Mailpit. Supabase CLI containers `supabase_*_solomad`.
- `.env`, `.env.supabase.local`, `ios/Config/Local.xcconfig`, and `supabase/signing_keys.json` are gitignored and hold local-only values. Doctor and scripts print names, not values.
- Seed data is fictional. The three `@solomad.test` Supabase users are labeled local test accounts.

## Staging configuration

Checked 2026-10-09 against `.env.supabase.staging.local` (gitignored, mode 600). Values are not printed.

- Hosted Auth diagnostic passed after a confirmed Auth user was created for `SUPABASE_SMOKE_EMAIL` (the first password sign-in returned `invalid_credentials` and that user was not already present). A second run passed sign-in, user lookup, refresh, logout, and refresh rejection. The publishable key and secret key were both accepted by the same hosted project, and the publishable key was rejected by the admin API. JWKS returned one key.
- The staging app bundle's `SupabaseURL` matches that project and is https. The bundle does not contain the server secret or the smoke password. `APIBaseURL` stays the unconfigured placeholder because `API_PUBLIC_ORIGIN` is empty.
- Simulator sign-in from the staging app failed with URL error -1200 (secure connection failed). No hosted session was stored, so Keychain restoration after relaunch was not run. The simulator Keychain test that keeps two projects apart passed.
- `make supabase-live-smoke` skipped (exit 3): missing `API_PUBLIC_ORIGIN` and `REALTIME_PUBLIC_ORIGIN`.
- `make staging-check` failed closed: `DATABASE_URL` is required for `APP_ENV=staging`. Later locked checks were not reached. Local `make dev` was not pointed at the hosted project.
- Local Debug unit tests: 7 tests, 1 skipped (the hosted sign-in test), 0 failures.

## Retired

- XcodeGen is **RETIRED_AFTER_VERIFIED_REMOVAL**. `ios/NomadTable.xcodeproj` is the project. `make doctor`, `make ios-build`, and `make ios-test` do not invoke it. `make ios-generate` exits 2. `ios/project.yml` is a retired reference and is not applied.

## Blocked

- Official supabase-swift 2.55.3 is the compatible release (swift-tools-version 6.1, Xcode 16.3 / Swift 6.1, iOS 17) and is not linked. Rechecked 2026-10-09: POST `git-upload-pack` on `https://github.com/supabase/supabase-swift.git` returned HTTP 403. The app uses `SupabaseAuth.swift`, which is a temporary GoTrue client and not the official SDK. See `docs/LOCAL_DEVELOPMENT.md`.
- Archive and distribution signing: 0 code-signing identities. Sign in with Apple needs a team-signed build with the capability.
- Hosted Supabase project, Apple/Google/phone providers, APNs delivery, RevenueCat, Anthropic, Sentry, and App Store Connect. No credentials are in the repo, and none were invented. `make supabase-live-smoke` reports SKIPPED (exit 3) until hosted values and a smoke account are supplied.
- Terraform has not been applied. The state bucket name is still `REPLACE_WITH_STATE_BUCKET`. Native S3 locking replaced the DynamoDB lock table. There is no deployed URL. This repository has no command that creates the state bucket.
- Load numbers in the product brief are targets, not measurements.
- Legal pages are drafts. Operator contact is not set.
- Plus purchase, restore, and subscription management cannot run. The app does not mark Plus active from the client.

## Not claimed

No App Store build, no TestFlight upload, no production deployment, no hosted auth verification, and no capacity result.
