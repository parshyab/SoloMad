import Foundation

public struct APIErrorBody: Codable, Sendable, Error {
    public struct Detail: Codable, Sendable {
        public var code: String
        public var message: String
    }
    public var error: Detail
}

public struct Account: Codable, Sendable, Equatable {
    public var id: String
    public var status: String
    public var onboardingStep: String
    public var onboardingComplete: Bool
    public var adultEligible: Bool
    public var displayName: String
    public var bio: String?
    public var plusActive: Bool
    public var languages: [String]
    public var interests: [String]
}

public struct AccountEnvelope: Codable, Sendable {
    public var account: Account
}

public struct PublicStats: Codable, Sendable {
    public var activeTravelerCount: Int
    public var source: String
}

public struct ActivityCard: Codable, Sendable, Identifiable, Equatable {
    public var id: String
    public var title: String
    public var emoji: String
    public var category: String
    public var startsAt: Date
    public var timezone: String
    public var cityName: String
    public var venueName: String?
    public var latitude: Double
    public var longitude: Double
    public var goingCount: Int
    public var capacity: Int
    public var host: Host
    public var viewerState: String

    public struct Host: Codable, Sendable, Equatable {
        public var id: String
        public var displayName: String
    }
}

public struct DiscoveryResponse: Codable, Sendable {
    public var mode: String
    public var items: [ActivityCard]
}

public struct TripSummary: Codable, Sendable, Identifiable, Equatable {
    public var id: String
    public var cityName: String
    public var startDate: String
    public var endDate: String
    public var bucket: String

    enum CodingKeys: String, CodingKey {
        case id
        case cityName = "city_name"
        case startDate = "start_date"
        case endDate = "end_date"
        case bucket
    }
}

public struct TripList: Codable, Sendable {
    public var trips: [TripSummary]
}

public struct JoinResult: Codable, Sendable {
    public var statusCode: Int
    public var body: Body
    public var replayed: Bool
    public struct Body: Codable, Sendable {
        public var activityId: String
        public var conversationId: String?
        public var goingCount: Int
        public var capacity: Int
        public var alreadyMember: Bool?
    }
}

public struct ConversationSummary: Codable, Sendable, Identifiable, Equatable, Hashable {
    public var id: String
    public var kind: String
    public var title: String?
    public var lastBody: String?
    public var unreadCount: String

    enum CodingKeys: String, CodingKey {
        case id, kind, title
        case lastBody = "last_body"
        case unreadCount = "unread_count"
    }
}

public struct ChatMessage: Codable, Sendable, Identifiable, Equatable {
    public var id: String
    public var senderId: String
    public var clientMessageId: String
    public var body: String?
    public var createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id, body
        case senderId = "sender_id"
        case clientMessageId = "client_message_id"
        case createdAt = "created_at"
    }
}

public struct MessagePage: Codable, Sendable {
    public var messages: [ChatMessage]
}

public struct Entitlements: Codable, Sendable {
    public var plusActive: Bool
    public var status: String
    public var source: String
}

public enum APIClientError: Error, Sendable, Equatable, LocalizedError {
    case transport(String)
    case server(code: String, message: String, status: Int)
    case decoding(String)

    public var errorDescription: String? {
        switch self {
        case .transport(let message), .server(_, let message, _), .decoding(let message):
            return message
        }
    }
}
