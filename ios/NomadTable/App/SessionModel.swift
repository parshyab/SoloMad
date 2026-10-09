import Foundation
import NomadTableAPIClient
import Observation

@MainActor
@Observable
final class SessionModel {
    enum Phase { case intro, welcome, onboarding, main }

    var phase: Phase = .intro
    var statusMessage = ""
    var account: Account?
    var activities: [ActivityCard] = []
    var trips: [TripSummary] = []
    var conversations: [ConversationSummary] = []
    var messages: [ChatMessage] = []
    var travelerCount: Int?
    var selectedCategory = "all"
    var showList = false
    var joinNotice = ""
    var entitlements: Entitlements?
    var isSigningIn = false
    private let client: APIClient
    let auth: SupabaseAuthClient?
    private var authSession: SupabaseSession?
    private var pendingPKCE: PKCEChallenge?
    static let authCallback = "app.solomad.ios://auth-callback"

    init() {
        let info = Bundle.main.infoDictionary ?? [:]
        let apiBase = (info["APIBaseURL"] as? String).flatMap(URL.init(string:)) ?? URL(string: "http://127.0.0.1:3000")!
        client = APIClient(baseURL: apiBase)
        if let raw = info["SupabaseURL"] as? String, let url = URL(string: raw), url.host != nil,
           let key = info["SupabasePublishableKey"] as? String, !key.isEmpty {
            auth = SupabaseAuthClient(url: url, publishableKey: key)
        } else {
            auth = nil
        }
    }

    var authConfigured: Bool { auth != nil }

    func restore() async {
        let host = auth?.host
        #if DEBUG
        let environment = ProcessInfo.processInfo.environment
        if environment["SOLOMAD_TEST_RESET"] == "1", let host {
            SessionStore.clear(host: host)
            authSession = nil
            await client.setToken(nil)
        }
        #endif
        guard let host, let stored = SessionStore.load(host: host) else {
            authLog.info("restore: no stored session")
            #if DEBUG
            let environment = ProcessInfo.processInfo.environment
            if let email = environment["SOLOMAD_TEST_EMAIL"], let password = environment["SOLOMAD_TEST_PASSWORD"] {
                await signInLocalTestAccount(email: email, password: password)
            } else if let email = environment["SOLOMAD_STAGING_EMAIL"], let password = environment["SOLOMAD_STAGING_PASSWORD"] {
                guard let auth, await auth.isLocal == false else { return }
                await complete { try await auth.signIn(email: email, password: password) }
            }
            #endif
            return
        }
        if let storedHost = stored.authHost, storedHost != host {
            SessionStore.clear(host: host)
            authLog.info("restore: ignored a session from a different Supabase project")
            return
        }
        authSession = stored
        authLog.info("restore: stored session found, refresh needed: \(stored.needsRefresh(), privacy: .public)")
        guard await freshToken() != nil else { return }
        await loadAccount()
    }

    #if DEBUG
    func signInLocalTestAccount(email: String, password: String) async {
        guard let auth, await auth.isLocal else {
            statusMessage = "Local test accounts only work against the local Supabase stack."
            return
        }
        await complete { try await auth.signIn(email: email, password: password) }
    }
    #endif

    func signInWithApple(idToken: String, rawNonce: String) async {
        guard let auth else { statusMessage = SupabaseAuthError.notConfigured.userMessage; return }
        await complete { try await auth.signInWithIDToken(provider: "apple", idToken: idToken, nonce: rawNonce) }
    }

    func sendPhoneCode(_ phone: String) async -> Bool {
        guard let auth else { statusMessage = SupabaseAuthError.notConfigured.userMessage; return false }
        do {
            try await auth.sendPhoneOTP(phone: phone)
            statusMessage = "We sent a code to \(phone)."
            return true
        } catch let error as SupabaseAuthError {
            statusMessage = error.userMessage
            return false
        } catch {
            statusMessage = error.localizedDescription
            return false
        }
    }

    func verifyPhoneCode(_ phone: String, code: String) async {
        guard let auth else { statusMessage = SupabaseAuthError.notConfigured.userMessage; return }
        await complete { try await auth.verifyPhoneOTP(phone: phone, code: code) }
    }

    func googleAuthorizeURL() async -> URL? {
        guard let auth else { statusMessage = SupabaseAuthError.notConfigured.userMessage; return nil }
        let pkce = PKCEChallenge.make()
        pendingPKCE = pkce
        return await auth.authorizeURL(provider: "google", redirectTo: Self.authCallback, pkce: pkce)
    }

    func handleAuthCallback(_ url: URL) async {
        guard url.absoluteString.hasPrefix(Self.authCallback), let auth else { return }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let description = items.first(where: { $0.name == "error_description" })?.value
            ?? items.first(where: { $0.name == "error" })?.value {
            pendingPKCE = nil
            statusMessage = description
            return
        }
        guard let code = items.first(where: { $0.name == "code" })?.value, let pkce = pendingPKCE else {
            pendingPKCE = nil
            statusMessage = "Sign-in was cancelled."
            return
        }
        pendingPKCE = nil
        await complete { try await auth.exchange(code: code, verifier: pkce.verifier) }
    }

    private func complete(_ operation: @MainActor () async throws -> SupabaseSession) async {
        isSigningIn = true
        defer { isSigningIn = false }
        do {
            let created = try await operation()
            authSession = created
            store(created)
            authLog.info("sign-in stored")
            await client.setToken(created.accessToken)
            await loadAccount()
        } catch let error as SupabaseAuthError {
            authLog.error("sign-in failed: \(error.userMessage, privacy: .public)")
            statusMessage = error.userMessage
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    private func loadAccount() async {
        do {
            let account = try await authorized { try await self.client.me() }
            authLog.info("account loaded, onboarding complete: \(account.onboardingComplete, privacy: .public)")
            self.account = account
            statusMessage = ""
            phase = account.onboardingComplete ? .main : .onboarding
            if phase == .main { await refreshHome() }
        } catch let error as APIClientError {
            statusMessage = message(for: error)
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    /// Returns a token that is valid for at least a minute, refreshing first when needed.
    private func freshToken() async -> String? {
        guard let current = authSession else { return nil }
        if !current.needsRefresh() {
            await client.setToken(current.accessToken)
            return current.accessToken
        }
        guard let auth else { return nil }
        do {
            let refreshed = try await auth.refresh(current)
            authSession = refreshed
            store(refreshed)
            await client.setToken(refreshed.accessToken)
            return refreshed.accessToken
        } catch let error as SupabaseAuthError where error.endsSession {
            await endSession("Your session ended. Sign in again.")
            return nil
        } catch {
            statusMessage = "Couldn't refresh your session. Check your connection."
            return nil
        }
    }

    private func authorized<T>(_ call: @MainActor () async throws -> T) async throws -> T {
        guard await freshToken() != nil else { throw APIClientError.server(code: "unauthorized", message: "Sign in required", status: 401) }
        do {
            return try await call()
        } catch APIClientError.server(let code, _, 401) where code == "invalid_token" || code == "token_expired" {
            guard let current = authSession, let auth else { throw APIClientError.server(code: code, message: "Sign in required", status: 401) }
            let refreshed = try await auth.refresh(current)
            authSession = refreshed
            store(refreshed)
            await client.setToken(refreshed.accessToken)
            return try await call()
        } catch APIClientError.server(let code, let message, let status) where status == 401 || code == "account_banned" {
            await endSession(code == "account_banned" ? message : "Your session ended. Sign in again.")
            throw APIClientError.server(code: code, message: message, status: status)
        }
    }

    private func store(_ session: SupabaseSession) {
        guard let host = auth?.host else { return }
        SessionStore.save(session, host: host)
    }

    private func endSession(_ notice: String) async {
        authSession = nil
        if let host = auth?.host { SessionStore.clear(host: host) }
        await client.setToken(nil)
        account = nil
        phase = .welcome
        statusMessage = notice
    }

    func signOut() async {
        if let current = authSession, let auth { try? await auth.signOut(current) }
        authSession = nil
        if let host = auth?.host { SessionStore.clear(host: host) }
        await client.setToken(nil)
        account = nil
        activities = []
        trips = []
        conversations = []
        messages = []
        entitlements = nil
        phase = .welcome
    }

    func loadTravelerCount() async {
        do {
            let stats = try await client.stats()
            travelerCount = stats.activeTravelerCount
        } catch {
            travelerCount = nil
        }
    }

    func refreshHome() async {
        do {
            try await authorized {
                self.activities = try await self.client.discovery(latitude: 38.7223, longitude: -9.1393, category: self.selectedCategory).items
                self.trips = try await self.client.trips()
                self.conversations = try await self.client.inbox()
                self.entitlements = try? await self.client.entitlements()
            }
            statusMessage = ""
        } catch let error as APIClientError {
            statusMessage = message(for: error)
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func join(_ activity: ActivityCard) async {
        joinNotice = ""
        do {
            let idempotencyKey = UUID().uuidString
            let result = try await authorized { try await self.client.join(activityID: activity.id, idempotencyKey: idempotencyKey) }
            joinNotice = result.replayed
                ? "You were already going. \(result.body.goingCount) of \(result.body.capacity) places are taken."
                : "You're going. \(result.body.goingCount) of \(result.body.capacity) places are taken."
            await refreshHome()
        } catch let error as APIClientError {
            joinNotice = "\(message(for: error)) No place was reserved."
        } catch {
            joinNotice = "\(error.localizedDescription) No place was reserved."
        }
    }

    func open(_ conversation: ConversationSummary) async {
        do {
            messages = try await authorized { try await self.client.messages(conversationID: conversation.id) }
        } catch let error as APIClientError {
            statusMessage = message(for: error)
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func send(_ body: String, conversationID: String, clientMessageID: String = UUID().uuidString) async -> String? {
        let text = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        do {
            try await authorized {
                try await self.client.sendMessage(conversationID: conversationID, clientMessageId: clientMessageID, body: text)
                self.messages = try await self.client.messages(conversationID: conversationID)
                self.conversations = try await self.client.inbox()
            }
            return clientMessageID
        } catch let error as APIClientError {
            statusMessage = message(for: error)
            return nil
        } catch {
            statusMessage = error.localizedDescription
            return nil
        }
    }

    func saveName(_ name: String) async throws -> Account {
        let step = self.account?.onboardingStep ?? "name"
        let account = try await authorized {
            try await self.client.saveOnboarding([
                "step": .string(step),
                "displayName": .string(name),
            ])
        }
        self.account = account
        if account.onboardingComplete { phase = .main }
        return account
    }

    func addTrip(startDate: String, endDate: String) async {
        do {
            try await authorized {
                try await self.client.createTrip(cityId: "11111111-1111-4111-8111-111111111111", startDate: startDate, endDate: endDate)
                self.trips = try await self.client.trips()
            }
            statusMessage = "Trip saved."
        } catch let error as APIClientError {
            statusMessage = message(for: error)
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    private func message(for error: APIClientError) -> String {
        switch error {
        case .transport(let message): return message
        case .server(_, let message, _): return message
        case .decoding(let message): return message
        }
    }
}
