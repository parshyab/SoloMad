import XCTest

@MainActor
final class ChatSendUITests: XCTestCase {
    private let dinner = "chat-dddddddd-dddd-4ddd-8ddd-ddddddddddd1"

    func testMinaSendsInTheAppAndJonahReadsIt() throws {
        let password = Self.passwordFromEnvironment()
        try XCTSkipUnless(!password.isEmpty, "SOLOMAD_TEST_PASSWORD is not set, so the simulator Send test was not run.")

        let body = "ui-send-\(UUID().uuidString.prefix(8))"
        let mina = launch(email: "mina@solomad.test", password: password)
        openDinner(mina)
        let draft = mina.textFields["chat-draft"]
        XCTAssertTrue(draft.waitForExistence(timeout: 20), "the message field was not on screen")
        draft.tap()
        draft.typeText(body)
        mina.buttons["chat-send"].tap()
        reveal(body, in: mina)
        XCTAssertTrue(mina.staticTexts[body].exists, "the sent message did not appear for Mina")
        mina.terminate()

        let jonah = launch(email: "jonah@solomad.test", password: password)
        openDinner(jonah)
        reveal(body, in: jonah)
        XCTAssertTrue(jonah.staticTexts[body].exists, "Jonah did not see Mina's message after opening the chat")
        jonah.terminate()

        let restored = launch(email: "mina@solomad.test", password: password)
        openDinner(restored)
        reveal(body, in: restored)
        XCTAssertEqual(restored.staticTexts.matching(NSPredicate(format: "label == %@", body)).count, 1, "relaunch showed the sent message more than once")
    }

    private static func passwordFromEnvironment() -> String {
        let environment = ProcessInfo.processInfo.environment
        for key in ["SOLOMAD_TEST_PASSWORD", "TEST_RUNNER_SOLOMAD_TEST_PASSWORD"] {
            guard let value = environment[key], !value.isEmpty, !value.hasPrefix("$(") else { continue }
            return value
        }
        return ""
    }

    private func launch(email: String, password: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["SOLOMAD_TEST_RESET"] = "1"
        app.launchEnvironment["SOLOMAD_TEST_EMAIL"] = email
        app.launchEnvironment["SOLOMAD_TEST_PASSWORD"] = password
        app.launch()
        return app
    }

    private func reveal(_ body: String, in app: XCUIApplication) {
        let message = app.staticTexts[body]
        if message.waitForExistence(timeout: 8) { return }
        let scroll = app.scrollViews.firstMatch
        for _ in 0..<8 where !message.exists {
            scroll.swipeUp()
        }
    }

    private func openDinner(_ app: XCUIApplication) {
        let chats = app.tabBars.buttons["Chats"]
        XCTAssertTrue(chats.waitForExistence(timeout: 30), "sign-in did not reach the tabs")
        chats.tap()
        let row = app.buttons[dinner]
        XCTAssertTrue(row.waitForExistence(timeout: 20), "the dinner chat was not in the inbox")
        row.tap()
    }
}
