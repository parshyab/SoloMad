import AuthenticationServices
import NomadTableAPIClient
import SwiftUI

struct WelcomeView: View {
    @Environment(SessionModel.self) private var session
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @State private var sheet: AuthSheet?
    @State private var appleNonce = Nonce.make()

    enum AuthSheet: String, Identifiable {
        case phone, unavailable
        #if DEBUG
        case localTest
        #endif
        var id: String { rawValue }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                Spacer().frame(height: 36)
                Wordmark(size: 29)
                VStack(spacing: 10) {
                    Text("welcome to solomad")
                        .font(.system(size: 24, weight: .bold))
                    Text("find friends while traveling")
                        .font(.system(size: 16))
                        .foregroundStyle(SoloColor.secondary)
                    Text("🇪🇸    🇵🇹    🇰🇷    🇫🇷")
                        .font(.system(size: 19))
                        .accessibilityLabel("Spain, Portugal, South Korea, France")
                }
                .multilineTextAlignment(.center)
                Text(countText)
                    .font(.system(size: 12))
                    .foregroundStyle(SoloColor.secondary)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(SoloColor.subtle, in: Capsule())
                VStack(spacing: 12) {
                    SignInWithAppleButton(.continue) { request in
                        appleNonce = Nonce.make()
                        request.requestedScopes = [.email]
                        request.nonce = appleNonce.hashed
                    } onCompletion: { result in
                        handleApple(result)
                    }
                    .signInWithAppleButtonStyle(.black)
                    .frame(height: 56)
                    .clipShape(Capsule())
                    .disabled(!session.authConfigured || session.isSigningIn)
                    HStack {
                        Rectangle().fill(SoloColor.border).frame(height: 1)
                        Text("or").font(.system(size: 12)).foregroundStyle(SoloColor.secondary)
                        Rectangle().fill(SoloColor.border).frame(height: 1)
                    }
                    providerButton("previously signed in with phone?", systemImage: "iphone", fill: .white, foreground: SoloColor.primary, stroke: SoloColor.primary) {
                        sheet = session.authConfigured ? .phone : .unavailable
                    }
                    providerButton("previously signed in with Google?", systemImage: "g.circle", fill: .white, foreground: SoloColor.google, stroke: SoloColor.google) {
                        Task { await signInWithGoogle() }
                    }
                    #if DEBUG
                    Button("use a local test account") { sheet = .localTest }
                        .font(.system(size: 12))
                        .foregroundStyle(SoloColor.secondary)
                        .accessibilityHint("Debug builds only. Signs in to the local Supabase stack.")
                    #endif
                    Link(destination: URL(string: "https://solomad.app/partners")!) {
                        Text("solomad for Partners")
                            .font(.system(size: 12))
                            .foregroundStyle(SoloColor.secondary)
                    }
                }
                if session.isSigningIn {
                    ProgressView("signing in")
                }
                if !session.statusMessage.isEmpty {
                    Text(session.statusMessage)
                        .font(.footnote)
                        .foregroundStyle(SoloColor.secondary)
                        .multilineTextAlignment(.center)
                }
                Text("by continuing, you agree to our")
                    .font(.system(size: 11))
                    .foregroundStyle(SoloColor.secondary)
                HStack(spacing: 4) {
                    Link("privacy policy", destination: URL(string: "http://127.0.0.1:3020/privacy")!)
                    Text("&").foregroundStyle(SoloColor.secondary)
                    Link("terms of service", destination: URL(string: "http://127.0.0.1:3020/terms")!)
                }
                .font(.system(size: 11))
                .foregroundStyle(SoloColor.brandText)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .task { await session.loadTravelerCount() }
        .sheet(item: $sheet) { item in
            NavigationStack {
                switch item {
                case .phone: PhoneSignInView { sheet = nil }
                case .unavailable: UnavailableSignInView()
                #if DEBUG
                case .localTest: LocalTestSignInView { sheet = nil }
                #endif
                }
            }
            .presentationDetents([.medium, .large])
        }
    }

    private var countText: String {
        if let travelerCount = session.travelerCount {
            return "\(travelerCount) travelers finding friends"
        }
        return "travelers finding friends"
    }

    private func handleApple(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let data = credential.identityToken, let idToken = String(data: data, encoding: .utf8) else {
                session.statusMessage = "Apple did not return an identity token."
                return
            }
            let raw = appleNonce.raw
            Task { await session.signInWithApple(idToken: idToken, rawNonce: raw) }
        case .failure(let error):
            if (error as? ASAuthorizationError)?.code == .canceled { return }
            session.statusMessage = "Sign in with Apple is unavailable in this build (\((error as NSError).code)). It needs a signed build with the Sign in with Apple capability."
        }
    }

    private func signInWithGoogle() async {
        guard let url = await session.googleAuthorizeURL() else {
            sheet = .unavailable
            return
        }
        do {
            let callback = try await webAuthenticationSession.authenticate(using: url, callbackURLScheme: "app.solomad.ios")
            await session.handleAuthCallback(callback)
        } catch {
            if (error as? ASWebAuthenticationSessionError)?.code != .canceledLogin {
                session.statusMessage = "Google sign-in did not complete."
            }
        }
    }

    private func providerButton(_ title: String, systemImage: String, fill: Color, foreground: Color, stroke: Color? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.system(size: 14))
                .frame(maxWidth: .infinity, minHeight: 48)
        }
        .buttonStyle(.plain)
        .foregroundStyle(foreground)
        .background(fill, in: Capsule())
        .overlay {
            if let stroke { Capsule().stroke(stroke, lineWidth: 1) }
        }
        .disabled(session.isSigningIn)
    }
}

private struct UnavailableSignInView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Sign-in is not configured for this build. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the build configuration.")
                .foregroundStyle(SoloColor.secondary)
            Spacer()
        }
        .padding(24)
        .navigationTitle("Sign in")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct PhoneSignInView: View {
    @Environment(SessionModel.self) private var session
    @State private var phone = ""
    @State private var code = ""
    @State private var codeSent = false
    let done: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            TextField("phone number, e.g. +351…", text: $phone)
                .keyboardType(.phonePad)
                .textContentType(.telephoneNumber)
                .padding()
                .background(SoloColor.subtle, in: RoundedRectangle(cornerRadius: 16))
            if codeSent {
                TextField("6-digit code", text: $code)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .padding()
                    .background(SoloColor.subtle, in: RoundedRectangle(cornerRadius: 16))
                Button("verify") {
                    Task {
                        await session.verifyPhoneCode(phone, code: code)
                        if session.account != nil { done() }
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
            } else {
                Button("send code") { Task { codeSent = await session.sendPhoneCode(phone) } }
                    .buttonStyle(PrimaryButtonStyle())
            }
            if !session.statusMessage.isEmpty {
                Text(session.statusMessage).font(.footnote).foregroundStyle(SoloColor.secondary)
            }
            Spacer()
        }
        .padding(24)
        .navigationTitle("Phone sign-in")
        .navigationBarTitleDisplayMode(.inline)
    }
}

#if DEBUG
private struct LocalTestSignInView: View {
    @Environment(SessionModel.self) private var session
    @State private var email = "mina@solomad.test"
    @State private var password = ""
    let done: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Debug only. Signs in to the local Supabase stack with a seeded test account. The password is SOLOMAD_LOCAL_PASSWORD in .env.supabase.local.")
                .font(.footnote)
                .foregroundStyle(SoloColor.secondary)
            Picker("account", selection: $email) {
                ForEach(["mina@solomad.test", "jonah@solomad.test", "leila@solomad.test"], id: \.self) { Text($0) }
            }
            .pickerStyle(.menu)
            SecureField("local test password", text: $password)
                .textContentType(.password)
                .padding()
                .background(SoloColor.subtle, in: RoundedRectangle(cornerRadius: 16))
            Button("sign in") {
                Task {
                    await session.signInLocalTestAccount(email: email, password: password)
                    if session.account != nil { done() }
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(password.isEmpty || session.isSigningIn)
            if !session.statusMessage.isEmpty {
                Text(session.statusMessage).font(.footnote).foregroundStyle(SoloColor.secondary)
            }
            Spacer()
        }
        .padding(24)
        .navigationTitle("Local test account")
        .navigationBarTitleDisplayMode(.inline)
    }
}
#endif
