import Foundation
import NomadTableAPIClient
import OSLog
import Security

let authLog = Logger(subsystem: "app.solomad.ios", category: "auth")
import SwiftData

@Model
final class ActivityDraftRecord {
    @Attribute(.unique) var id: String
    var ownerID: String
    var title: String
    var details: String
    var updatedAt: Date

    init(id: String = UUID().uuidString, ownerID: String, title: String, details: String, updatedAt: Date = .now) {
        self.id = id
        self.ownerID = ownerID
        self.title = title
        self.details = details
        self.updatedAt = updatedAt
    }
}

@Model
final class OutgoingMessageRecord {
    @Attribute(.unique) var clientMessageID: String
    var ownerID: String
    var conversationID: String
    var body: String
    var state: String
    var updatedAt: Date

    init(clientMessageID: String, ownerID: String, conversationID: String, body: String, state: String) {
        self.clientMessageID = clientMessageID
        self.ownerID = ownerID
        self.conversationID = conversationID
        self.body = body
        self.state = state
        self.updatedAt = .now
    }
}

enum SessionStore {
    private static let service = "app.solomad.ios.session"
    private static let legacyAccount = "supabase-session"

    static func save(_ session: SupabaseSession, host: String) {
        guard let data = try? JSONEncoder().encode(session.tagged(authHost: host)) else { return }
        let query = baseQuery(account: account(for: host))
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        if status != errSecSuccess { authLog.error("keychain save failed with status \(status, privacy: .public)") }
    }

    static func load(host: String) -> SupabaseSession? {
        if let session = read(account: account(for: host)) {
            guard session.authHost == nil || session.authHost == host else { return nil }
            return session
        }
        guard isLocalHost(host), let legacy = read(account: legacyAccount) else { return nil }
        guard legacy.authHost == nil || legacy.authHost == host else { return nil }
        return legacy
    }

    static func clear(host: String) {
        SecItemDelete(baseQuery(account: account(for: host)) as CFDictionary)
        guard isLocalHost(host) else { return }
        SecItemDelete(baseQuery(account: legacyAccount) as CFDictionary)
        SecItemDelete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "access-token",
        ] as CFDictionary)
    }

    private static func account(for host: String) -> String { "supabase-session.\(host)" }

    private static func isLocalHost(_ host: String) -> Bool {
        host == "127.0.0.1" || host == "localhost"
    }

    private static func read(account: String) -> SupabaseSession? {
        var query = baseQuery(account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else {
            if status != errSecItemNotFound { authLog.error("keychain load failed with status \(status, privacy: .public)") }
            return nil
        }
        return try? JSONDecoder().decode(SupabaseSession.self, from: data)
    }

    private static func baseQuery(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}
