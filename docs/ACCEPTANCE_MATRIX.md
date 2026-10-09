# Acceptance matrix

Status words mean only what they say. "Code" means the behavior exists in the repository. "Verified" means a command or a manual call in this workspace showed it. "Blocked" means a missing tool or credential stopped the check.

| Journey | Status | Evidence |
| --- | --- | --- |
| Intro, welcome, three tabs | Verified | Simulator launch on iPhone 16 / iOS 18.4 showed the intro and, after local Supabase sign-in, Discover with the Discover, Trips, and Chats tabs. |
| Traveler count from the database | Verified | `GET /v1/public/stats` returned `source: database`. The count included integration-test users, not a marketing number. |
| Apple, Google, phone sign-in | Blocked | Code exchanges Apple ID tokens with a nonce, Google via PKCE, and phone OTP through Supabase Auth. Apple needs a team-signed build with the capability; Google and phone need hosted provider configuration. Not exercised. |
| Local Supabase session | Verified | `make auth-smoke` (26 checks) and the Debug app signed in as mina@solomad.test, restored the session from Keychain on relaunch, and loaded Discover. |
| Logout, ban, deletion, refresh | Verified locally | `make auth-smoke`: signed-out, banned, and deleted users rejected by the API and gateway within the 2 s test window; refreshed tokens accepted for the same user only. |
| Onboarding saved on the server | Code | `PATCH /v1/me/onboarding`. Seeded accounts are already complete. |
| Discover map and list use one query | Verified for the API | Discovery SQL is shared. The SwiftUI map and list both read `discovery.items`. The map was not rendered. |
| Join is transactional and idempotent | Verified | Integration test: one of two final-seat joins succeeds, the retry does not take another place. A later curl replay for Leila stayed at the same `goingCount`. |
| Offline join does not claim a reservation | Code | The client appends "No place was reserved." on transport and server errors. Not exercised in a simulator. |
| Host edit, cancel, complete, attendance, feedback | Code | Domain functions and API routes. Not all branches re-run in this session. |
| Trips and inclusive overlap | Verified | `sharedDates` and the overlap SQL test. Trip list curl returned Jonah and Mina's seeded dates. |
| Chat history and dedupe | Verified | Domain test dedupes `clientMessageId`. The Socket.IO smoke acknowledged a send, replayed the retry, rejected a bad token, and refused an unjoined room. |
| Polls and live location expiry | Code | Domain and API routes. No dedicated test run in this session. |
| Recommendations | Code | Database ranking is the fallback. Anthropic is unused without a key. |
| Plus purchase | Blocked | No RevenueCat key or App Store product. The profile screen does not grant Plus locally. |
| Uploads and verification review | Code | Local upload URL in development. Approval requires an admin route. No moderator session was exercised here. |
| Account deletion | Code | Outbox event and `anonymizeUser`. Not run against a real Apple revocation. |
| Public share page | Verified | Next.js 16.4.0 production build, then curl of `/privacy` and `/a/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1` on port 3020. The activity page showed the dinner title and venue and said participant lists stay in the app. Playwright was not run. |
| Admin health | Code | Password session plus admin bearer. Not clicked in a browser in this session. |
| Performance targets | Not measured | Discovery p95 under 300 ms, join under 500 ms, message ack under 300 ms, and the error-rate target are goals. Smoke timing of `/health` is not that result. |

Visual comparison against the Figma frames is still open; the app has been launched but not compared frame by frame.
