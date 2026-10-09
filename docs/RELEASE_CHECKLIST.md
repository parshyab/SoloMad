# Release checklist

Do not check an item that has not been done on this machine or in the target environment.

- [ ] Full Xcode selected with `xcode-select`, and `xcodebuild -version` succeeds.
- [ ] `ios/NomadTable.xcodeproj` is the maintained project. XcodeGen is not required.
- [ ] `make ios-build` compiles the shared NomadTable scheme for the simulator without a distribution certificate.
- [ ] `make ios-test` runs the test action.
- [ ] `make ios-run` boots a real simulator, installs `app.solomad.ios`, and the process stays running.
- [ ] Debug ATS allows only local networking. The Release plist does not.
- [ ] `ios/Config/Release.xcconfig` has the hosted `SUPABASE_URL` and publishable key only; no secret or `service_role` key.
- [ ] `make supabase-live-smoke` passes (not SKIPPED) against the staging project, API, and gateway.
- [ ] Sign in with Apple, Google (if kept), and phone complete against the staging Supabase project, including cancellation and logout.
- [ ] APNs sandbox delivery recorded for the staging topic.
- [ ] RevenueCat sandbox purchase, restore, and webhook update `entitlements`.
- [ ] Archive uses automatic signing with the real team id. `ExportOptions.plist` still contains `$(APPLE_TEAM_ID)` until that team is set.
- [ ] Fastlane upload uses an App Store Connect key stored outside the repo.
- [ ] `pnpm verify:release` passes with staging or production environment variables and rejects a development `.env`.
- [ ] Legal copy is approved and the contact address is real.
- [ ] Universal Links use the real team id and a domain the operator controls. The association route returns 404 until `APPLE_TEAM_ID` is 10 letters or digits.
- [ ] `make release-check` exits 0. A nonzero result lists missing configuration names only.
- [ ] No fixture auth, fixture Plus flag, or LocalStack endpoint remains in the Release configuration.

Current machine: the Xcode, signing, provider, and archive items are open.
