import SwiftData
import SwiftUI

@main
struct NomadTableApp: App {
    @State private var session = SessionModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .tint(SoloColor.primary)
                .task { await session.restore() }
                .onOpenURL { url in Task { await session.handleAuthCallback(url) } }
        }
        .modelContainer(for: [ActivityDraftRecord.self, OutgoingMessageRecord.self])
    }
}

enum SoloColor {
    static let primary = Color(red: 239 / 255, green: 43 / 255, blue: 103 / 255)
    static let text = Color(red: 17 / 255, green: 17 / 255, blue: 17 / 255)
    static let secondary = Color(red: 107 / 255, green: 107 / 255, blue: 115 / 255)
    static let subtle = Color(red: 247 / 255, green: 247 / 255, blue: 248 / 255)
    static let border = Color(red: 231 / 255, green: 231 / 255, blue: 234 / 255)
    static let brandText = Color(red: 201 / 255, green: 29 / 255, blue: 80 / 255)
    static let google = Color(red: 22 / 255, green: 104 / 255, blue: 210 / 255)
}

struct RootView: View {
    @Environment(SessionModel.self) private var session

    var body: some View {
        Group {
            switch session.phase {
            case .intro:
                IntroView { session.phase = .welcome }
            case .welcome:
                WelcomeView()
            case .onboarding:
                OnboardingView()
            case .main:
                MainTabView()
            }
        }
        .background(Color.white)
    }
}
