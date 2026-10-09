# Local development

## Addresses

| Service | Address |
| --- | --- |
| API | http://127.0.0.1:3000 |
| Realtime | http://127.0.0.1:3001 |
| Worker health | http://127.0.0.1:3002 |
| Admin | http://127.0.0.1:3010 |
| Public web | http://127.0.0.1:3020 |
| Postgres | 127.0.0.1:5432 database `solomad` |
| Redis | 127.0.0.1:6379 |
| LocalStack | http://127.0.0.1:4566 |
| Mailpit | http://127.0.0.1:8025 |
| Supabase Auth (local CLI) | http://127.0.0.1:55421 (Postgres for Auth on 55422) |

The iOS Simulator can use `127.0.0.1`. A physical iPhone cannot. Use this Mac's LAN address and keep the Debug ATS exception. Release builds must use HTTPS.

## Commands

```sh
make doctor
make bootstrap
make supabase-start
make dev
make auth-smoke
make supabase-stop
pnpm db:migrate
pnpm db:seed
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm load:smoke
pnpm build
pnpm verify:release
make ios-resolve
make ios-build
make ios-test
make ios-run
make ios-archive
make release-check
make supabase-live-smoke
make terraform-check
```

`make bootstrap` starts Compose, waits for Postgres and Redis, migrates, and seeds. It writes `.env` only when that file is missing, and it does not print secret values.

`make supabase-start` starts the pinned Supabase CLI 2.90.0 stack (Auth, its Postgres, Kong; set `SUPABASE_BIN` if the CLI is not on PATH or at `~/.local/bin/supabase`), writes `.env.supabase.local` and `ios/Config/Local.xcconfig` (both gitignored), and links the labeled local test users `mina@solomad.test`, `jonah@solomad.test`, and `leila@solomad.test` to the seeded application users. Their password is `SOLOMAD_LOCAL_PASSWORD` in `.env.supabase.local`; it is never printed.

`make dev` starts Compose, migrates, builds, and runs the API and gateway with `AUTH_MODE=supabase` against that local stack. It does not read `.env.supabase.staging.local`. `make auth-smoke` signs real local sessions in and checks the API and gateway: profile mapping, persisted two-user messages, spoofing, non-member rooms, invalid and wrong-project tokens, refresh, logout, ban, and deletion.

Hosted staging is separate. Fill `.env.supabase.staging.local` from `.env.supabase.staging.example`. `make supabase-hosted-auth` checks that project's Auth API only. `make supabase-live-smoke` reads the same file and skips until `API_PUBLIC_ORIGIN` and `REALTIME_PUBLIC_ORIGIN` are https addresses of the deployed API and gateway. `make staging-check` loads `APP_ENV=staging` and fails closed while those services, the staging database, and the other locked settings are absent. `make ios-staging-build` / `make ios-staging-auth` / `make ios-staging-run` select the `NomadTable-Staging` scheme. `make ios-build` / `make ios-test` / `make ios-run` stay on local Debug.

Debug app sign-in: on the welcome screen choose "use a local test account" (Debug builds only) and enter the local password. Or launch already signed in:

```sh
SOLOMAD_TEST_EMAIL=mina@solomad.test SOLOMAD_TEST_PASSWORD=... make ios-run
```

`scripts/dev-token.mjs` HS256 tokens still work for backend scripts against an API started with `AUTH_MODE=development`; the iOS app no longer accepts pasted tokens.

## Native tools

`make ios-build`, `make ios-test`, and `make ios-run` target Debug and the iOS Simulator SDK. They ad-hoc sign for the simulator (`CODE_SIGN_IDENTITY=-`, no team), which the Keychain needs; no certificate, Team ID, or distribution identity is required. `make ios-archive` remains a Release device archive and still requires signing.

`SIMULATOR_UDID` overrides the simulator. Otherwise `scripts/simulator.mjs` selects the available iPhone 16 on the iOS 18.4 runtime, and creates that device when the runtime exists but the device does not.

`ios/NomadTable.xcodeproj` is the project. XcodeGen is **RETIRED_AFTER_VERIFIED_REMOVAL**. `make ios-build`, `make ios-test`, and `make ios-run` use the project directly and do not download or run XcodeGen. `make ios-generate` exits 2. `ios/project.yml` is a retired reference and is not applied.

`make ios-test` loads `SOLOMAD_LOCAL_PASSWORD` from the gitignored `.env.supabase.local` when that file exists and passes it to the UI test runner as `TEST_RUNNER_SOLOMAD_TEST_PASSWORD`. It does not print the password. Without that file, `ChatSendUITests` skips. The test signs in as Mina, taps Send in the dinner chat, signs in as Jonah and checks the same body, then relaunches Mina and checks the body appears once.

The official package `https://github.com/supabase/supabase-swift.git` at exact version 2.55.3 (swift-tools-version 6.1, iOS 16) matches Xcode 16.3 / Swift 6.1 and the app's iOS 17 target. It is not linked. The app signs in through `SupabaseAuth.swift`, a temporary GoTrue client, not the official SDK.

Checked on 2026-10-09 with bounded HTTPS (redirects, certificate verification, 10s connect, 45s total, one retry). No `http_proxy` or `https_proxy` was set.

| Endpoint | Result |
| --- | --- |
| `https://github.com/yonaskolb/XcodeGen` | HTTP 200 |
| `https://github.com/yonaskolb/XcodeGen/releases/download/2.46.0/xcodegen.zip` | HTTP 302 to `release-assets.githubusercontent.com`, then HTTP 403, HTML title "Noncompliant action" |
| GitHub release API for that tag | HTTP 200, and it publishes the zip digest above. The asset API redirects to the same blocked host |
| `https://github.com/supabase/supabase-swift` | HTTP 200 |
| `git-upload-pack` POST on that repo | HTTP 403. `git ls-remote` fails. GET `info/refs` returns 200 |
| `https://codeload.github.com/supabase/supabase-swift/tar.gz/refs/tags/v2.55.3` | HTTP 403, same "Noncompliant action" page |
| `https://raw.githubusercontent.com/.../Package.swift` | HTTP 403, same page |
| `https://objects.githubusercontent.com` | timed out with no bytes |
| `https://api.github.com` release metadata | HTTP 200 |

The package graph that must be reachable, all via git on github.com, is supabase-swift 2.55.3 plus swift-crypto, swift-http-types, opentelemetry-swift-core, swift-clocks, swift-concurrency-extras, swift-custom-dump, swift-snapshot-testing, xctest-dynamic-overlay, Mocker, swift-secp256k1, and CryptoSwift. None of those clones are possible while `git-upload-pack` returns 403, and no local SwiftPM checkout of them was present.

Ready-to-copy IT request (not sent):

```text
Please allow outbound HTTPS from this Mac to these official hosts, without a TLS intercept that presents a different certificate:

- github.com (including git smart HTTP: GET info/refs and POST git-upload-pack)
- codeload.github.com
- release-assets.githubusercontent.com
- raw.githubusercontent.com
- objects.githubusercontent.com
- api.github.com (already reachable)

Evidence from 2026-10-09: the XcodeGen 2.46.0 zip redirects from github.com to release-assets.githubusercontent.com and the response is HTTP 403 with title "Noncompliant action". The same page is returned for codeload.github.com and raw.githubusercontent.com. POST https://github.com/supabase/supabase-swift.git/git-upload-pack returns HTTP 403, so git clone and Swift Package Manager cannot resolve https://github.com/supabase/supabase-swift.git at tag 2.55.3. No http_proxy or https_proxy is set in the shell. Please do not require us to disable certificate verification.
```

Package tests that do not need the iOS SDK:

```sh
swift run --package-path ios/Packages/NomadTableAPIClient DecodeCheck
```
