import SwiftUI

struct IntroView: View {
    var onContinue: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 20) {
            HStack {
                Spacer()
                Wordmark(size: 18)
                Spacer()
                Button("Close", systemImage: "xmark") { onContinue() }
                    .labelStyle(.iconOnly)
                    .frame(width: 44, height: 44)
                    .accessibilityLabel("Close introduction")
            }
            .padding(.horizontal, 20)
            ZStack {
                activityBubble("🍝", x: -110, y: -90, diameter: 76)
                activityBubble("🏖️", x: 100, y: -110, diameter: 92)
                activityBubble("☕", x: -110, y: 80, diameter: 66)
                activityBubble("🎨", x: 110, y: 70, diameter: 64)
                HStack(spacing: -18) {
                    portrait(Color.orange)
                    portrait(Color(red: 0.95, green: 0.75, blue: 0.55)).frame(width: 108, height: 108)
                    portrait(Color.brown)
                }
            }
            .frame(height: 280)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Travelers and activity ideas")
            Text("good plans.\ngreat people.")
                .font(.system(size: 32, weight: .bold))
                .multilineTextAlignment(.center)
                .foregroundStyle(SoloColor.text)
            Text("find your people wherever\nyour next adventure takes you.")
                .font(.system(size: 17))
                .multilineTextAlignment(.center)
                .foregroundStyle(SoloColor.secondary)
            cityStrip
            Spacer()
            Button("let’s go", action: onContinue)
                .buttonStyle(PrimaryButtonStyle())
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 16)
        .background(Color.white)
    }

    private var cityStrip: some View {
        HStack {
            cityTime("Lisbon")
            cityTime("Barcelona")
            cityTime("Seoul")
        }
        .padding(16)
        .background(SoloColor.subtle, in: RoundedRectangle(cornerRadius: 22))
    }

    private func cityTime(_ city: String) -> some View {
        VStack(spacing: 4) {
            Text(time(in: city)).font(.system(size: 17, weight: .semibold))
            Text(city).font(.system(size: 12)).foregroundStyle(SoloColor.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private func time(in city: String) -> String {
        let identifiers = ["Lisbon": "Europe/Lisbon", "Barcelona": "Europe/Madrid", "Seoul": "Asia/Seoul"]
        let formatter = DateFormatter()
        formatter.timeZone = TimeZone(identifier: identifiers[city] ?? "UTC")
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: Date())
    }

    private func activityBubble(_ emoji: String, x: CGFloat, y: CGFloat, diameter: CGFloat) -> some View {
        Text(emoji)
            .font(.system(size: diameter * 0.48))
            .frame(width: diameter, height: diameter)
            .background(SoloColor.subtle, in: Circle())
            .shadow(color: .black.opacity(0.06), radius: 9, y: 4)
            .offset(x: x, y: reduceMotion ? 0 : y)
    }

    private func portrait(_ color: Color) -> some View {
        Circle().fill(color.opacity(0.85)).frame(width: 96, height: 96).overlay(Image(systemName: "person.fill").foregroundStyle(.white).font(.title))
    }
}

struct Wordmark: View {
    var size: CGFloat = 29
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "person.2.fill")
                .font(.system(size: size * 0.7, weight: .bold))
            Text("solomad").font(.system(size: size, weight: .bold))
        }
        .foregroundStyle(.black)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("solomad")
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    var enabled: Bool = true
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 20, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(enabled ? SoloColor.primary : SoloColor.primary.opacity(0.4), in: Capsule())
            .opacity(configuration.isPressed ? 0.85 : 1)
    }
}
