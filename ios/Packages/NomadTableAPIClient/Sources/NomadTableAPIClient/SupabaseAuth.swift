import CryptoKit
import Foundation

// Supabase Auth (GoTrue) REST client used by the app until the official supabase-swift package can be
// resolved. The pin is exact version 2.55.3 in ios/project.yml (swift-tools-version 6.1). git upload-pack
// and codeload.github.com currently return HTTP 403, so this file is still the runtime implementation.
// It is not the official SDK and must not be renamed to Supabase.
//
// Keychain migration for the SDK swap: SessionStore keeps one JSON session per Supabase host under
// service app.solomad.ios.session, account supabase-session.<host>
// (accessToken, refreshToken, expiresAt, userID, authHost). A legacy local item may still use
// account supabase-session. supabase-swift stores its own session via KeychainLocalStorage. On the
// first launch that links the SDK, read the record for the current host, call auth.setSession, then
// delete it, so an existing install is not signed out.
public struct SupabaseSession: Codable, Sendable, Equatable {
    public let accessToken: String
    public let refreshToken: String
    public let expiresAt: Date
    public let userID: String
    public let authHost: String?

    public init(accessToken: String, refreshToken: String, expiresAt: Date, userID: String, authHost: String? = nil) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
        self.userID = userID
        self.authHost = authHost
    }

    public func tagged(authHost: String) -> SupabaseSession {
        SupabaseSession(accessToken: accessToken, refreshToken: refreshToken, expiresAt: expiresAt, userID: userID, authHost: authHost)
    }

    public func needsRefresh(now: Date = .now, leeway: TimeInterval = 60) -> Bool {
        expiresAt.timeIntervalSince(now) < leeway
    }
}

public enum SupabaseAuthError: Error, Sendable, Equatable {
    case notConfigured
    case transport(String)
    case rejected(code: String, message: String, status: Int)
    case invalidResponse

    public var userMessage: String {
        switch self {
        case .notConfigured: return "Sign-in is not configured for this build."
        case .transport(let message): return message
        case .rejected(_, let message, _): return message
        case .invalidResponse: return "Sign-in returned an unexpected response."
        }
    }

    public var endsSession: Bool {
        if case .rejected(_, _, let status) = self { return status == 400 || status == 401 || status == 403 }
        return false
    }
}

public struct PKCEChallenge: Sendable {
    public let verifier: String
    public let challenge: String

    public static func make() -> PKCEChallenge {
        let verifier = randomURLSafe(bytes: 48)
        return PKCEChallenge(verifier: verifier, challenge: base64URL(Data(SHA256.hash(data: Data(verifier.utf8)))))
    }
}

public enum Nonce {
    public static func make() -> (raw: String, hashed: String) {
        let raw = randomURLSafe(bytes: 32)
        let hashed = SHA256.hash(data: Data(raw.utf8)).map { String(format: "%02x", $0) }.joined()
        return (raw, hashed)
    }
}

public actor SupabaseAuthClient {
    public let url: URL
    private let publishableKey: String
    private let session: URLSession
    private let now: @Sendable () -> Date

    public init(url: URL, publishableKey: String, session: URLSession = .shared, now: @escaping @Sendable () -> Date = { .now }) {
        self.url = url
        self.publishableKey = publishableKey
        self.session = session
        self.now = now
    }

    public nonisolated var host: String? { url.host }

    public var isLocal: Bool {
        guard let host = url.host else { return false }
        return host == "127.0.0.1" || host == "localhost"
    }

    public func signIn(email: String, password: String) async throws -> SupabaseSession {
        try await token(grant: "password", body: ["email": email, "password": password])
    }

    public func signInWithIDToken(provider: String, idToken: String, nonce: String?) async throws -> SupabaseSession {
        var body = ["provider": provider, "id_token": idToken]
        if let nonce { body["nonce"] = nonce }
        return try await token(grant: "id_token", body: body)
    }

    public func sendPhoneOTP(phone: String) async throws {
        _ = try await request("POST", "otp", body: ["phone": phone])
    }

    public func verifyPhoneOTP(phone: String, code: String) async throws -> SupabaseSession {
        try decodeSession(try await request("POST", "verify", body: ["type": "sms", "phone": phone, "token": code]))
    }

    public func authorizeURL(provider: String, redirectTo: String, pkce: PKCEChallenge) -> URL? {
        var components = URLComponents(url: url.appending(path: "auth/v1/authorize"), resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "provider", value: provider),
            URLQueryItem(name: "redirect_to", value: redirectTo),
            URLQueryItem(name: "code_challenge", value: pkce.challenge),
            URLQueryItem(name: "code_challenge_method", value: "s256"),
        ]
        return components?.url
    }

    public func exchange(code: String, verifier: String) async throws -> SupabaseSession {
        try await token(grant: "pkce", body: ["auth_code": code, "code_verifier": verifier])
    }

    public func refresh(_ current: SupabaseSession) async throws -> SupabaseSession {
        try await token(grant: "refresh_token", body: ["refresh_token": current.refreshToken])
    }

    public func signOut(_ current: SupabaseSession) async throws {
        _ = try await request("POST", "logout", query: [URLQueryItem(name: "scope", value: "local")], bearer: current.accessToken)
    }

    private func token(grant: String, body: [String: String]) async throws -> SupabaseSession {
        try decodeSession(try await request("POST", "token", query: [URLQueryItem(name: "grant_type", value: grant)], body: body))
    }

    private func decodeSession(_ data: Data) throws -> SupabaseSession {
        struct Body: Decodable {
            let access_token: String
            let refresh_token: String
            let expires_in: Double?
            let expires_at: Double?
            let user: User
            struct User: Decodable { let id: String }
        }
        guard let body = try? JSONDecoder().decode(Body.self, from: data) else { throw SupabaseAuthError.invalidResponse }
        let expiresAt = body.expires_at.map { Date(timeIntervalSince1970: $0) } ?? now().addingTimeInterval(body.expires_in ?? 3600)
        return SupabaseSession(accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: expiresAt, userID: body.user.id)
    }

    private func request(_ method: String, _ path: String, query: [URLQueryItem] = [], body: [String: String]? = nil, bearer: String? = nil) async throws -> Data {
        guard !publishableKey.isEmpty else { throw SupabaseAuthError.notConfigured }
        var components = URLComponents(url: url.appending(path: "auth/v1/\(path)"), resolvingAgainstBaseURL: false)
        components?.queryItems = query.isEmpty ? nil : query
        guard let endpoint = components?.url else { throw SupabaseAuthError.notConfigured }
        var request = URLRequest(url: endpoint, timeoutInterval: 15)
        request.httpMethod = method
        request.setValue(publishableKey, forHTTPHeaderField: "apikey")
        if let bearer { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            let code = (error as NSError).code
            throw SupabaseAuthError.transport("Sign-in could not reach the server. Check your connection and try again. (\(code))")
        }
        guard let http = response as? HTTPURLResponse else { throw SupabaseAuthError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            struct ErrorBody: Decodable { let error_code: String?; let msg: String?; let error_description: String?; let message: String? }
            let decoded = try? JSONDecoder().decode(ErrorBody.self, from: data)
            throw SupabaseAuthError.rejected(
                code: decoded?.error_code ?? "http_\(http.statusCode)",
                message: decoded?.msg ?? decoded?.error_description ?? decoded?.message ?? "Sign-in was rejected (HTTP \(http.statusCode)).",
                status: http.statusCode
            )
        }
        return data
    }
}

private func randomURLSafe(bytes count: Int) -> String {
    var generator = SystemRandomNumberGenerator()
    return base64URL(Data((0..<count).map { _ in UInt8.random(in: .min ... .max, using: &generator) }))
}

private func base64URL(_ data: Data) -> String {
    data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
}
