.PHONY: doctor bootstrap setup backend supabase-start supabase-stop supabase-seed dev auth-smoke supabase-hosted-auth supabase-live-smoke staging-check staging-db-migrate staging-dns-status staging-push-runtime-secret staging-deploy-ecs staging-enable-https staging-merge-operator-env ios-generate ios-resolve ios-build ios-test ios-run ios-staging-build ios-staging-auth ios-staging-run ios-archive verify-release release-check terraform-check terraform-apply-staging sync-staging-infra

SIMULATOR_ID = $(shell node scripts/simulator.mjs)
# Ad-hoc "sign to run locally" for the simulator only: no certificate or Team ID, but the Keychain works.
SIM_SIGNING = CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=NO DEVELOPMENT_TEAM=
TERRAFORM ?= $(shell test -x tools/terraform/terraform && echo tools/terraform/terraform || command -v terraform)

doctor:
	node scripts/doctor.mjs

bootstrap setup:
	node scripts/bootstrap.mjs

backend:
	set -a && . ./.env && set +a && pnpm --filter @solomad/api start

supabase-start:
	node scripts/supabase.mjs start
	node scripts/supabase-seed.mjs

supabase-stop:
	node scripts/supabase.mjs stop

supabase-seed:
	node scripts/supabase-seed.mjs

dev:
	docker compose -f infra/local/docker-compose.yml up -d
	node scripts/wait-ready.mjs
	pnpm build
	set -a && . ./.env && set +a && pnpm db:migrate
	node scripts/dev.mjs

auth-smoke:
	pnpm --filter @solomad/realtime build
	node apps/realtime/scripts/auth-smoke.mjs

supabase-hosted-auth:
	node scripts/supabase-hosted-auth.mjs

supabase-live-smoke:
	node apps/realtime/scripts/supabase-live-smoke.mjs

staging-check:
	node scripts/staging-check.mjs

ios-generate:
	@echo "ios-generate is retired. ios/NomadTable.xcodeproj is maintained directly. XcodeGen is not used."
	@exit 2

ios-resolve:
	@xcodebuild -version >/dev/null 2>&1 || { echo "Native resolve gate unavailable: xcodebuild requires a full Xcode installation. Active directory: $$(xcode-select -p)."; exit 1; }
	xcodebuild -project ios/NomadTable.xcodeproj -scheme NomadTable -destination "platform=iOS Simulator,id=$(SIMULATOR_ID)" -resolvePackageDependencies

ios-build:
	@xcodebuild -version >/dev/null 2>&1 || { echo "Native build gate unavailable: xcodebuild requires a full Xcode installation. Active directory: $$(xcode-select -p)."; exit 1; }
	xcodebuild -project ios/NomadTable.xcodeproj -scheme NomadTable -destination "platform=iOS Simulator,id=$(SIMULATOR_ID)" -configuration Debug -sdk iphonesimulator $(SIM_SIGNING) build

ios-test:
	@xcodebuild -version >/dev/null 2>&1 || { echo "Native test gate unavailable: xcodebuild requires a full Xcode installation. Active directory: $$(xcode-select -p)."; exit 1; }
	@set -a; \
	if [ -f .env.supabase.local ]; then . ./.env.supabase.local; fi; \
	set +a; \
	env -u XCODEGEN_BIN -u XCODEGEN_ZIP \
		TEST_RUNNER_SOLOMAD_TEST_PASSWORD="$${SOLOMAD_LOCAL_PASSWORD:-}" \
		xcodebuild -project ios/NomadTable.xcodeproj -scheme NomadTable -destination "platform=iOS Simulator,id=$(SIMULATOR_ID)" -configuration Debug -sdk iphonesimulator $(SIM_SIGNING) test

ios-run:
	node scripts/ios-run.mjs

ios-staging-build:
	node scripts/staging-env.mjs --write-client
	xcodebuild -project ios/NomadTable.xcodeproj -scheme NomadTable-Staging -destination "platform=iOS Simulator,id=$(SIMULATOR_ID)" -configuration Staging -sdk iphonesimulator $(SIM_SIGNING) -derivedDataPath /tmp/solomad-dd-staging build

ios-staging-auth:
	node scripts/ios-staging-auth.mjs

ios-staging-run:
	node scripts/ios-staging-run.mjs

ios-archive:
	@xcodebuild -version >/dev/null 2>&1 || { echo "Archive gate unavailable: xcodebuild requires a full Xcode installation. Active directory: $$(xcode-select -p)."; exit 1; }
	@echo "Archive requires Apple distribution signing. See docs/RELEASE_CHECKLIST.md."
	xcodebuild -project ios/NomadTable.xcodeproj -scheme NomadTable -configuration Release -destination "generic/platform=iOS" -archivePath build/NomadTable.xcarchive archive

verify-release:
	node scripts/verify-release.mjs

release-check:
	node scripts/release-check.mjs

terraform-apply-staging:
	@test -n "$(TERRAFORM)" || { echo "terraform not found; see docs/DEPLOYMENT.md"; exit 1; }
	cd infra/terraform/environments/staging && $(abspath $(TERRAFORM)) apply -input=false -auto-approve

sync-staging-infra:
	node scripts/sync-staging-infra-env.mjs

staging-db-migrate:
	node scripts/staging-db-migrate.mjs

staging-dns-status:
	node scripts/staging-dns-status.mjs

staging-push-runtime-secret:
	node scripts/push-staging-runtime-secret.mjs

staging-deploy-ecs:
	node scripts/deploy-staging-ecs.mjs

staging-enable-https:
	cd infra/terraform/environments/staging && $(abspath $(TERRAFORM)) apply -input=false -auto-approve -var=enable_https_listener=true

staging-finish-https:
	node scripts/staging-finish-https.mjs

staging-merge-operator-env:
	node scripts/merge-staging-operator-env.mjs

terraform-check:
	@test -n "$(TERRAFORM)" || { echo "terraform not found; see docs/DEPLOYMENT.md"; exit 1; }
	$(TERRAFORM) fmt -check -recursive infra/terraform
	cd infra/terraform/environments/staging && $(abspath $(TERRAFORM)) init -backend=false -input=false && $(abspath $(TERRAFORM)) validate
	cd infra/terraform/environments/production && $(abspath $(TERRAFORM)) init -backend=false -input=false && $(abspath $(TERRAFORM)) validate
