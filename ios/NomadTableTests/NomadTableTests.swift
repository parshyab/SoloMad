import CryptoKit
import NomadTableAPIClient
import XCTest
@testable import NomadTable

final class NomadTableTests: XCTestCase {
    func testAppleNonceIsHashedWithSHA256() {
        let nonce = Nonce.make()
        let expected = SHA256.hash(data: Data(nonce.raw.utf8)).map { String(format: "%02x", $0) }.joined()
        XCTAssertEqual(nonce.hashed, expected)
        XCTAssertNotEqual(Nonce.make().raw, nonce.raw)
    }

    func testPKCEChallengeIsURLSafe() {
        let pkce = PKCEChallenge.make()
        XCTAssertGreaterThanOrEqual(pkce.verifier.count, 43)
        XCTAssertNil(pkce.challenge.rangeOfCharacter(from: CharacterSet(charactersIn: "+/=")))
    }

    func testSessionRefreshesBeforeExpiry() {
        let now = Date()
        let soon = SupabaseSession(accessToken: "a", refreshToken: "r", expiresAt: now.addingTimeInterval(30), userID: "u")
        let later = SupabaseSession(accessToken: "a", refreshToken: "r", expiresAt: now.addingTimeInterval(600), userID: "u")
        XCTAssertTrue(soon.needsRefresh(now: now))
        XCTAssertFalse(later.needsRefresh(now: now))
    }

    func testBundleCarriesOnlyPublicSupabaseValues() {
        let info = Bundle.main.infoDictionary ?? [:]
        let key = info["SupabasePublishableKey"] as? String ?? ""
        XCTAssertFalse(key.hasPrefix("sb_secret_"))
        XCTAssertNil(info["SUPABASE_SECRET_KEY"])
        XCTAssertNil(Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist"))
    }

    func testRejectedAuthEndsSession() {
        XCTAssertTrue(SupabaseAuthError.rejected(code: "refresh_token_not_found", message: "x", status: 400).endsSession)
        XCTAssertFalse(SupabaseAuthError.transport("offline").endsSession)
    }

    func testKeychainSessionsStayWithTheirSupabaseProject() {
        let firstHost = "session-a.invalid"
        let secondHost = "session-b.invalid"
        let first = SupabaseSession(accessToken: "token-a", refreshToken: "refresh-a", expiresAt: Date().addingTimeInterval(600), userID: "user-a")
        let second = SupabaseSession(accessToken: "token-b", refreshToken: "refresh-b", expiresAt: Date().addingTimeInterval(600), userID: "user-b")
        SessionStore.save(first, host: firstHost)
        SessionStore.save(second, host: secondHost)
        XCTAssertEqual(SessionStore.load(host: firstHost)?.userID, "user-a")
        XCTAssertEqual(SessionStore.load(host: firstHost)?.authHost, firstHost)
        XCTAssertEqual(SessionStore.load(host: secondHost)?.userID, "user-b")
        SessionStore.clear(host: secondHost)
        XCTAssertNil(SessionStore.load(host: secondHost))
        XCTAssertEqual(SessionStore.load(host: firstHost)?.userID, "user-a")
        SessionStore.clear(host: firstHost)
    }

    func testHostedStagingSignInRestoresFromKeychain() async throws {
        let info = Bundle.main.infoDictionary ?? [:]
        let raw = info["SupabaseURL"] as? String ?? ""
        let key = info["SupabasePublishableKey"] as? String ?? ""
        guard let url = URL(string: raw), let host = url.host, host.hasSuffix(".supabase.co"), key.hasPrefix("sb_publishable_") else {
            throw XCTSkip("This build is not pointed at a hosted Supabase project.")
        }
        XCTAssertFalse(key.hasPrefix("sb_secret_"))
        XCTAssertFalse(raw.contains("127.0.0.1"))
        let environment = ProcessInfo.processInfo.environment
        let email = environment["SOLOMAD_STAGING_EMAIL"] ?? environment["TEST_RUNNER_SOLOMAD_STAGING_EMAIL"] ?? ""
        let password = environment["SOLOMAD_STAGING_PASSWORD"] ?? environment["TEST_RUNNER_SOLOMAD_STAGING_PASSWORD"] ?? ""
        try XCTSkipUnless(!email.isEmpty && !password.isEmpty && !password.hasPrefix("$("), "staging smoke credentials were not passed to the test runner")
        let client = SupabaseAuthClient(url: url, publishableKey: key)
        let session: SupabaseSession
        do {
            session = try await client.signIn(email: email, password: password)
        } catch let error as SupabaseAuthError {
            switch error {
            case .rejected(let code, _, let status):
                XCTFail("hosted sign-in rejected with status \(status) code \(code)")
            case .transport(let message):
                let endpoint = url.appending(path: "auth/v1/token").absoluteString
                XCTFail("\(message) endpoint \(endpoint)")
            case .invalidResponse:
                XCTFail("hosted sign-in returned an unexpected response")
            case .notConfigured:
                XCTFail("hosted sign-in client was not configured")
            }
            return
        } catch {
            XCTFail("hosted sign-in failed with \(String(describing: type(of: error)))")
            return
        }
        SessionStore.save(session, host: host)
        let restored = SessionStore.load(host: host)
        XCTAssertEqual(restored?.userID, session.userID)
        XCTAssertEqual(restored?.authHost, host)
        XCTAssertNotEqual(SessionStore.load(host: "127.0.0.1")?.accessToken, session.accessToken)
        let refreshed = try await client.refresh(session)
        SessionStore.save(refreshed, host: host)
        XCTAssertEqual(SessionStore.load(host: host)?.refreshToken, refreshed.refreshToken)
    }
}
