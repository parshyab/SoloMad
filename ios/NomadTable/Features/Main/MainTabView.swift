import MapKit
import NomadTableAPIClient
import SwiftData
import SwiftUI

struct MainTabView: View {
    @Environment(SessionModel.self) private var session

    var body: some View {
        TabView {
            DiscoverView().tabItem { Label("Discover", systemImage: "map") }
            TripsView().tabItem { Label("Trips", systemImage: "airplane") }
            ChatsView().tabItem { Label("Chats", systemImage: "message") }
        }
        .task { await session.refreshHome() }
    }
}

struct DiscoverView: View {
    @Environment(SessionModel.self) private var session
    @State private var position: MapCameraPosition = .region(MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 38.7223, longitude: -9.1393),
        span: MKCoordinateSpan(latitudeDelta: 0.08, longitudeDelta: 0.08)
    ))
    @State private var selected: ActivityCard?
    @State private var showProfile = false
    private let categories = ["all", "food", "coffee", "outdoors", "culture", "nightlife", "entertainment", "rideshare"]

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button { showProfile = true } label: {
                    Image(systemName: "person.crop.circle.fill").font(.title)
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Profile")
                Spacer()
                Wordmark(size: 18)
                Spacer()
                Image(systemName: "bell").frame(width: 44, height: 44).accessibilityLabel("Notifications")
            }
            .padding(.horizontal, 16)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach(categories, id: \.self) { category in
                        Button(category) {
                            session.selectedCategory = category
                            Task { await session.refreshHome() }
                        }
                        .font(.system(size: 14, weight: .semibold))
                        .padding(.horizontal, 14)
                        .frame(minHeight: 36)
                        .background(session.selectedCategory == category ? SoloColor.primary : SoloColor.subtle, in: Capsule())
                        .foregroundStyle(session.selectedCategory == category ? .white : SoloColor.text)
                    }
                }
                .padding(.horizontal, 24)
            }
            ZStack(alignment: .bottomTrailing) {
                if session.showList {
                    List(session.activities) { activity in
                        Button { selected = activity } label: { ActivityRow(activity: activity) }
                    }
                    .listStyle(.plain)
                } else {
                    Map(position: $position) {
                        ForEach(session.activities) { activity in
                            Annotation(activity.title, coordinate: CLLocationCoordinate2D(latitude: activity.latitude, longitude: activity.longitude)) {
                                Button(activity.emoji) { selected = activity }
                                    .font(.title2)
                                    .frame(width: 44, height: 44)
                                    .background(.white, in: Circle())
                            }
                        }
                    }
                }
                Button(session.showList ? "map" : "list") { session.showList.toggle() }
                    .font(.system(size: 16, weight: .semibold))
                    .padding(.horizontal, 18)
                    .frame(minHeight: 44)
                    .background(.white, in: Capsule())
                    .padding(24)
            }
            if !session.statusMessage.isEmpty {
                Text(session.statusMessage).font(.footnote).foregroundStyle(SoloColor.secondary).padding(.horizontal, 24)
            }
        }
        .sheet(item: $selected) { activity in
            ActivityDetailView(activity: activity)
                .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showProfile) { ProfileView() }
    }
}

struct ActivityRow: View {
    var activity: ActivityCard
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(activity.emoji) \(activity.title)").font(.headline)
            Text("\(activity.cityName) · \(activity.goingCount)/\(activity.capacity) going")
                .font(.subheadline)
                .foregroundStyle(SoloColor.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: 44)
    }
}

struct ActivityDetailView: View {
    @Environment(SessionModel.self) private var session
    var activity: ActivityCard

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("\(activity.emoji)  \(activity.category)").font(.subheadline).foregroundStyle(SoloColor.secondary)
            Text(activity.title).font(.system(size: 28, weight: .bold))
            Text("Hosted by \(activity.host.displayName)")
            Text(activity.startsAt.formatted(date: .abbreviated, time: .shortened) + " · \(activity.timezone)")
                .foregroundStyle(SoloColor.secondary)
            Text(activity.venueName ?? activity.cityName)
            Text("\(activity.goingCount) of \(activity.capacity) places")
            if !session.joinNotice.isEmpty {
                Text(session.joinNotice).foregroundStyle(SoloColor.secondary)
            }
            Spacer()
            action
        }
        .padding(24)
    }

    @ViewBuilder private var action: some View {
        switch activity.viewerState {
        case "join":
            Button("join") { Task { await session.join(activity) } }
                .buttonStyle(PrimaryButtonStyle())
        case "going":
            Text("You're going. Open Chats for this activity.")
        case "manage":
            Text("You host this activity.")
        case "full":
            Text("This activity is full.")
        default:
            Text(activity.viewerState.replacingOccurrences(of: "_", with: " "))
        }
    }
}

struct TripsView: View {
    @Environment(SessionModel.self) private var session
    @State private var startDate = "2026-11-01"
    @State private var endDate = "2026-11-07"

    var body: some View {
        NavigationStack {
            List {
                Section("your trips") {
                    if session.trips.isEmpty {
                        Text("No trips yet.")
                    }
                    ForEach(session.trips) { trip in
                        VStack(alignment: .leading) {
                            Text(trip.cityName).font(.headline)
                            Text("\(trip.startDate) – \(trip.endDate) · \(trip.bucket)")
                                .font(.subheadline)
                                .foregroundStyle(SoloColor.secondary)
                        }
                    }
                }
                Section("add Lisbon") {
                    TextField("start date", text: $startDate)
                    TextField("end date", text: $endDate)
                    Button("save trip") { Task { await session.addTrip(startDate: startDate, endDate: endDate) } }
                }
            }
            .navigationTitle("trips")
        }
    }
}

struct ChatsView: View {
    @Environment(SessionModel.self) private var session
    @State private var selected: ConversationSummary?

    var body: some View {
        NavigationStack {
            List(session.conversations) { conversation in
                Button { selected = conversation } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(conversation.title ?? conversation.kind).font(.headline)
                        Text(conversation.lastBody ?? "No messages yet")
                            .font(.subheadline)
                            .foregroundStyle(SoloColor.secondary)
                            .lineLimit(1)
                    }
                    .frame(minHeight: 44)
                }
                .accessibilityIdentifier("chat-\(conversation.id)")
            }
            .navigationTitle("chats")
            .navigationDestination(item: $selected) { conversation in
                ConversationView(conversation: conversation)
            }
            .overlay {
                if session.conversations.isEmpty {
                    Text("Activity chats appear after you join or host.").foregroundStyle(SoloColor.secondary)
                }
            }
        }
    }
}

struct ConversationView: View {
    @Environment(SessionModel.self) private var session
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \OutgoingMessageRecord.updatedAt) private var outgoing: [OutgoingMessageRecord]
    var conversation: ConversationSummary
    @State private var draft = ""

    private var pending: [OutgoingMessageRecord] {
        outgoing.filter { $0.conversationID == conversation.id && $0.state != "sent" }
    }

    var body: some View {
        VStack {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        ForEach(session.messages) { message in
                            Text(message.body ?? "")
                                .padding(12)
                                .background(message.senderId == session.account?.id ? SoloColor.primary : SoloColor.subtle, in: RoundedRectangle(cornerRadius: 16))
                                .foregroundStyle(message.senderId == session.account?.id ? .white : SoloColor.text)
                                .accessibilityIdentifier("message-\(message.id)")
                                .id(message.id)
                        }
                        ForEach(pending) { record in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(record.body)
                                Text(record.state == "failed" ? "Not sent." : "Sending…")
                                    .font(.caption)
                                if record.state == "failed" {
                                    Button("retry") { Task { await deliver(record) } }
                                        .accessibilityIdentifier("chat-retry")
                                }
                            }
                            .padding(12)
                            .background(SoloColor.subtle, in: RoundedRectangle(cornerRadius: 16))
                            .id(record.clientMessageID)
                        }
                    }
                    .padding(24)
                }
                .onChange(of: session.messages.last?.id) { _, id in
                    guard let id else { return }
                    Task { @MainActor in proxy.scrollTo(id, anchor: .bottom) }
                }
                .onChange(of: pending.last?.clientMessageID) { _, id in
                    guard let id else { return }
                    Task { @MainActor in proxy.scrollTo(id, anchor: .bottom) }
                }
            }
            if !session.statusMessage.isEmpty {
                Text(session.statusMessage).font(.footnote).foregroundStyle(SoloColor.secondary).padding(.horizontal, 16)
            }
            HStack {
                TextField("message", text: $draft)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("chat-draft")
                Button("send") { Task { await send() } }
                    .frame(minWidth: 44, minHeight: 44)
                    .accessibilityIdentifier("chat-send")
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
        .navigationTitle(conversation.title ?? "chat")
        .task { await session.open(conversation) }
    }

    private func send() async {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        let record = OutgoingMessageRecord(clientMessageID: UUID().uuidString, ownerID: session.account?.id ?? "", conversationID: conversation.id, body: body, state: "pending")
        modelContext.insert(record)
        draft = ""
        await deliver(record)
    }

    private func deliver(_ record: OutgoingMessageRecord) async {
        record.state = "pending"
        record.updatedAt = .now
        if await session.send(record.body, conversationID: conversation.id, clientMessageID: record.clientMessageID) != nil {
            record.state = "sent"
        } else {
            record.state = "failed"
        }
    }
}

struct ProfileView: View {
    @Environment(SessionModel.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(session.account?.displayName ?? "Traveler").font(.title2.bold())
                    Text(session.account?.bio ?? "No bio yet").foregroundStyle(SoloColor.secondary)
                }
                Section("plus") {
                    Text(session.entitlements?.plusActive == true ? "Plus is active on the server." : "Plus is not active. Prices come from the App Store through RevenueCat, which is not configured.")
                    Text("Purchase, restore, and subscription management stay disabled until RevenueCat and App Store products are configured.")
                        .font(.footnote)
                        .foregroundStyle(SoloColor.secondary)
                }
                Section {
                    Button("sign out", role: .destructive) {
                        clearPrivateCache()
                        Task { await session.signOut() }
                        dismiss()
                    }
                }
            }
            .navigationTitle("profile")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("close") { dismiss() } } }
        }
    }

    private func clearPrivateCache() {
        let owner = session.account?.id
        let drafts = (try? modelContext.fetch(FetchDescriptor<ActivityDraftRecord>())) ?? []
        let messages = (try? modelContext.fetch(FetchDescriptor<OutgoingMessageRecord>())) ?? []
        for draft in drafts where owner == nil || draft.ownerID == owner { modelContext.delete(draft) }
        for message in messages where owner == nil || message.ownerID == owner { modelContext.delete(message) }
    }
}

struct OnboardingView: View {
    @Environment(SessionModel.self) private var session
    @State private var name = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("what should people call you?")
                .font(.system(size: 28, weight: .bold))
            Text("This step saves your name through the API. Birthday, photo, and the rest of onboarding resume from the server step \(session.account?.onboardingStep ?? "name").")
                .foregroundStyle(SoloColor.secondary)
            TextField("name", text: $name)
                .textFieldStyle(.plain)
                .padding()
                .frame(minHeight: 56)
                .background(SoloColor.subtle, in: RoundedRectangle(cornerRadius: 16))
            if !session.statusMessage.isEmpty {
                Text(session.statusMessage).font(.footnote).foregroundStyle(SoloColor.secondary)
            }
            Spacer()
            Button("continue") {
                Task {
                    do { _ = try await session.saveName(name) }
                    catch let error as APIClientError {
                        session.statusMessage = error.localizedDescription
                    } catch {
                        session.statusMessage = error.localizedDescription
                    }
                }
            }
            .buttonStyle(PrimaryButtonStyle(enabled: name.trimmingCharacters(in: .whitespaces).count >= 2))
            .disabled(name.trimmingCharacters(in: .whitespaces).count < 2)
        }
        .padding(24)
    }
}
