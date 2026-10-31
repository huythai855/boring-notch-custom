// Standalone UI regression fixture. Never included in the production target.
// Reuses the actual panel and composer; all networking/sending is stubbed out.
import AppKit
import Combine
import SwiftUI

@MainActor
final class ChatDaemonClient: ObservableObject {
    static let shared = ChatDaemonClient()
    @Published var snapshot = ChatSnapshot(service: .messenger, state: "ready", title: "Kiểm tra bàn phím cục bộ",
        threads: [], messages: [.init(id: "fixture", text: "Cửa sổ kiểm tra nhập liệu. Không kết nối tài khoản hoặc gửi tin.", outgoing: false)],
        activeID: "local-test", canSend: true)
    @Published var service = ChatService.messenger
    @Published var error: String?
    @Published var selecting = false
    @Published var drafts: [String: String] = [:]
    @Published var sending = false
    private var timer: Timer?
    func start() {
        guard timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.objectWillChange.send() }
        }
    }
    func choose(_ service: ChatService) { self.service = service }
    func select(_ thread: ChatThread) async {}
    private var sendCount = 0
    func send(_ text: String, expectedID: String) async -> Bool {
        guard !sending else { return false }
        sending = true
        defer { sending = false }
        try? await Task.sleep(for: .milliseconds(80))
        sendCount += 1
        snapshot.title = "Gửi cục bộ: \(sendCount)"
        snapshot.messages.append(.init(id: "test-\(sendCount)", text: text, outgoing: true))
        return true
    }
    func openConnection() {}
}

@main
struct FocusHarness {
    @MainActor static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let menu = NSMenu()
        let root = NSMenuItem()
        let own = NSMenu()
        own.addItem(withTitle: "Quit Focus Test", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        root.submenu = own; menu.addItem(root)
        let edit = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "Edit")
        for (title, action, key) in [("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            editMenu.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        edit.submenu = editMenu; menu.addItem(edit); app.mainMenu = menu
        let panel = FixturePanel(contentRect: NSRect(x: 300, y: 150, width: 600, height: 500),
            styleMask: [.borderless], backing: .buffered, defer: false)
        panel.contentView = NSHostingView(rootView: ChatWorkspace().preferredColorScheme(.dark))
        panel.backgroundColor = .black
        panel.level = .floating
        app.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
        app.run()
    }
}

private final class FixturePanel: NSPanel { override var canBecomeKey: Bool { true } }
