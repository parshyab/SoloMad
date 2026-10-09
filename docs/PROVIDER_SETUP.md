# Provider setup

None of the providers below are configured in this repository. Do not commit private keys. Public client configuration may contain the API origin, the Supabase project URL and publishable key, and the RevenueCat public SDK key.

## Supabase Authentication

Supabase Auth issues sessions; the solomad PostgreSQL database stays the authority for users, membership, entitlements, and messages. Enable Apple (bundle id `app.solomad.ios`), phone (with a real SMS provider), and Google only if kept. Add `app.solomad.ios://auth-callback` to the redirect allow list. For Google, use a Google OAuth Web application client whose authorized redirect URI is `https://<project-ref>.supabase.co/auth/v1/callback`; store its client ID and secret in Supabase Auth's Google provider settings. Local Supabase reads the same values from `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` in the untracked `.env`. The API and the realtime gateway use one verifier (`packages/domain/src/supabase-auth.ts`): JWKS signature (ES256/RS256), `exp`, issuer and audience from configuration, `sub`, `session_id`, `role=authenticated`, then a cached session/ban check. `AUTH_MODE=supabase` without `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` returns `auth_unconfigured`; staging and production also need `SUPABASE_SECRET_KEY` and reject local or non-https endpoints. See `docs/ACCOUNT_SETUP.md`.

## Sign in with Apple and Google

The Apple capability and the Google URL scheme belong in the Xcode project after a team is selected. Cancellation must return to the welcome screen. Apple name and email are available only on the first authorization. Do not merge accounts because two emails match. Link a second provider only after that provider's token is verified.

## APNs

Store the `.p8` key, key id, team id, and bundle topic in the server secret store. Register device tokens with `/v1/devices`, including sandbox or production. The HTTP/2 sender is not connected to a real key yet.

## RevenueCat and the App Store

Create the subscription products in App Store Connect, then map them in RevenueCat. The iOS app must use the public SDK key and the signed-in user id. Webhooks need the current Authorization secret. Local StoreKit files do not prove webhook handling. The entitlements table is the server decision for Plus.

## Anthropic

Set `ANTHROPIC_API_KEY` on the API only. Recommendations must cite venue ids returned by the database. If the key is absent, the API returns `source: "database"` and `ai: "unavailable"`. That fallback is not an Anthropic response.

## Maps

The app uses MapKit and Apple Maps directions. Do not put a Google places key in the app. Venue coordinates are checked against the selected city before insert.

## Admin

Local admin sign-in is a shared password plus an admin user's bearer token. That is a development limitation, not the production control. Production should replace it with a verified admin identity and audited role changes before any real moderation data exists.
