import Foundation

public actor APIClient {
    public let baseURL: URL
    private let session: URLSession
    private var token: String?
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = fractional.date(from: value) { return date }
            if let date = ISO8601DateFormatter().date(from: value) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: value)
        }
        self.decoder = decoder
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        self.encoder = encoder
    }

    public func setToken(_ token: String?) {
        self.token = token
    }

    public func stats() async throws -> PublicStats {
        try await send(PublicStats.self, method: "GET", path: "/v1/public/stats")
    }

    public func me() async throws -> Account {
        try await send(AccountEnvelope.self, method: "GET", path: "/v1/me").account
    }

    public func discovery(latitude: Double?, longitude: Double?, category: String?) async throws -> DiscoveryResponse {
        var items = [URLQueryItem(name: "zoom", value: "14"), URLQueryItem(name: "radiusMeters", value: "25000")]
        if let latitude, let longitude {
            items.append(URLQueryItem(name: "latitude", value: String(latitude)))
            items.append(URLQueryItem(name: "longitude", value: String(longitude)))
        }
        if let category, category != "all" {
            items.append(URLQueryItem(name: "category", value: category))
        }
        return try await send(DiscoveryResponse.self, method: "GET", path: "/v1/discovery", query: items)
    }

    public func trips() async throws -> [TripSummary] {
        try await send(TripList.self, method: "GET", path: "/v1/trips").trips
    }

    public func createTrip(cityId: String, startDate: String, endDate: String) async throws {
        let body = try encoder.encode(["cityId": cityId, "startDate": startDate, "endDate": endDate])
        _ = try await send(JSONValue.self, method: "POST", path: "/v1/trips", body: body)
    }

    public func join(activityID: String, idempotencyKey: String) async throws -> JoinResult {
        try await send(JoinResult.self, method: "POST", path: "/v1/activities/\(activityID)/join", idempotencyKey: idempotencyKey)
    }

    public func leave(activityID: String, idempotencyKey: String) async throws {
        _ = try await send(JSONValue.self, method: "POST", path: "/v1/activities/\(activityID)/leave", idempotencyKey: idempotencyKey)
    }

    public func inbox() async throws -> [ConversationSummary] {
        try await send([ConversationSummary].self, method: "GET", path: "/v1/conversations")
    }

    public func messages(conversationID: String) async throws -> [ChatMessage] {
        try await send(MessagePage.self, method: "GET", path: "/v1/conversations/\(conversationID)/messages").messages
    }

    public func sendMessage(conversationID: String, clientMessageId: String, body: String) async throws {
        let payload = try encoder.encode(["clientMessageId": clientMessageId, "body": body, "kind": "text"])
        _ = try await send(JSONValue.self, method: "POST", path: "/v1/conversations/\(conversationID)/messages", body: payload)
    }

    public func entitlements() async throws -> Entitlements {
        try await send(Entitlements.self, method: "GET", path: "/v1/entitlements")
    }

    public func saveOnboarding(_ fields: [String: JSONValue]) async throws -> Account {
        let body = try encoder.encode(fields)
        _ = try await send(JSONValue.self, method: "PATCH", path: "/v1/me/onboarding", body: body)
        return try await me()
    }

    private func send<T: Decodable>(_ type: T.Type, method: String, path: String, query: [URLQueryItem] = [], body: Data? = nil, idempotencyKey: String? = nil) async throws -> T {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw APIClientError.transport("The API address is invalid")
        }
        let prefix = components.path.hasSuffix("/") ? String(components.path.dropLast()) : components.path
        components.path = prefix + path
        components.queryItems = query.isEmpty ? nil : query
        guard let url = components.url else { throw APIClientError.transport("The API address is invalid") }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let idempotencyKey { request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key") }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError {
            throw APIClientError.transport(error.code == .notConnectedToInternet || error.code == .networkConnectionLost
                ? "You appear to be offline. Nothing was reserved."
                : error.localizedDescription)
        } catch {
            throw APIClientError.transport(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else { throw APIClientError.transport("The server did not respond") }
        if !(200..<300).contains(http.statusCode) {
            if let decoded = try? decoder.decode(APIErrorBody.self, from: data) {
                throw APIClientError.server(code: decoded.error.code, message: decoded.error.message, status: http.statusCode)
            }
            throw APIClientError.transport("HTTP \(http.statusCode)")
        }
        if data.isEmpty, T.self == JSONValue.self {
            return try decoder.decode(T.self, from: Data("{}".utf8))
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIClientError.decoding(error.localizedDescription)
        }
    }
}

public enum JSONValue: Codable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([String: JSONValue].self) { self = .object(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON") }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}
