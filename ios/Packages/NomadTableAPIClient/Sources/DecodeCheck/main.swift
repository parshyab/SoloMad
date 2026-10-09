import Foundation
import NomadTableAPIClient

do {
    let accountJSON = Data("""
    {"account":{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","status":"active","onboardingStep":"complete","onboardingComplete":true,"adultEligible":true,"displayName":"Mina Alves","bio":"hi","plusActive":false,"languages":["en"],"interests":["food"]}}
    """.utf8)
    let account = try JSONDecoder().decode(AccountEnvelope.self, from: accountJSON)
    guard account.account.displayName == "Mina Alves", account.account.plusActive == false else {
        throw CheckError("account fields did not decode")
    }

    let discovery = Data("""
    {"mode":"items","items":[{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1","title":"sunset dinner in Alfama","emoji":"🍝","category":"food","startsAt":"2026-10-11T00:00:00Z","timezone":"Europe/Lisbon","cityName":"Lisbon","venueName":"Alfama Supper Club","latitude":38.71,"longitude":-9.13,"goingCount":2,"capacity":6,"host":{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","displayName":"Mina Alves"},"viewerState":"join"}]}
    """.utf8)
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    let parsed = try decoder.decode(DiscoveryResponse.self, from: discovery)
    guard parsed.items.count == 1, parsed.items[0].viewerState == "join" else {
        throw CheckError("discovery card did not decode")
    }

    let trips = try JSONDecoder().decode(TripList.self, from: Data("""
    {"trips":[{"id":"t1","city_name":"Lisbon","start_date":"2026-10-09","end_date":"2026-10-15","bucket":"upcoming"}]}
    """.utf8))
    guard trips.trips[0].cityName == "Lisbon" else { throw CheckError("trip field names did not decode") }

    guard (try? JSONDecoder().decode(AccountEnvelope.self, from: Data("{\"account\":{}}".utf8))) == nil else {
        throw CheckError("malformed account was accepted")
    }
    print("decode check passed")

    let environment = ProcessInfo.processInfo.environment
    if let rawURL = environment["SUPABASE_URL"], let url = URL(string: rawURL), let key = environment["SUPABASE_PUBLISHABLE_KEY"],
       let email = environment["SOLOMAD_TEST_EMAIL"], let password = environment["SOLOMAD_TEST_PASSWORD"] {
        let auth = SupabaseAuthClient(url: url, publishableKey: key)
        let signedIn = try await auth.signIn(email: email, password: password)
        let refreshed = try await auth.refresh(signedIn)
        guard refreshed.userID == signedIn.userID, refreshed.accessToken != signedIn.accessToken else {
            throw CheckError("refresh did not return a new token for the same user")
        }
        let api = APIClient(baseURL: URL(string: environment["API_BASE_URL"] ?? "http://127.0.0.1:3000")!)
        await api.setToken(refreshed.accessToken)
        let me = try await api.me()
        try await auth.signOut(refreshed)
        do {
            _ = try await auth.refresh(refreshed)
            throw CheckError("refresh succeeded after sign-out")
        } catch let error as SupabaseAuthError where error.endsSession {}
        print("swift supabase auth check passed: sign-in, refresh, API /v1/me (\(me.id)), sign-out, refresh rejected")
    } else {
        print("swift supabase auth check SKIPPED: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SOLOMAD_TEST_EMAIL, SOLOMAD_TEST_PASSWORD not set")
    }
} catch {
    fputs("decode check failed: \(error)\n", stderr)
    exit(1)
}

struct CheckError: Error, CustomStringConvertible {
    var description: String
    init(_ description: String) { self.description = description }
}
