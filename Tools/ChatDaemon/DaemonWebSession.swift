import AppKit
import WebKit

@MainActor
final class DaemonWebSession: NSObject, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
    let service: ChatService
    let webView: WKWebView
    private let window: NSWindow
    private var busy = false
    private var failure: String?
    private static let world = WKContentWorld.world(name: "NotchChatBridge")
    private static let bridge: String = {
        guard let url = Bundle.main.url(forResource: "ChatBridge", withExtension: "js"),
              let source = try? String(contentsOf: url, encoding: .utf8) else { return "throw Error('Missing bridge');" }
        return source
    }()

    init(service: ChatService) {
        self.service = service
        let config = WKWebViewConfiguration()
        // The daemon's windows are normally hidden, but their chat sessions
        // must continue processing events and bounded asynchronous commands.
        config.preferences.inactiveSchedulingPolicy = .none
        config.websiteDataStore = .default()
        if service == .whatsapp {
            // WKWebView's default UA omits Safari's Version token. WhatsApp
            // rejects it as an obsolete Safari even with a current WebKit.
            let osMajor = ProcessInfo.processInfo.operatingSystemVersion.majorVersion
            let safariMajor = osMajor >= 26 ? osMajor : osMajor + 3
            config.applicationNameForUserAgent = "Version/\(safariMajor).0 Safari/605.1.15"
        }
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1100, height: 760), configuration: config)
        window = NSWindow(contentRect: webView.frame,
            styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        super.init()
        window.title = "Kết nối \(service.rawValue) — Chat Daemon"
        window.isReleasedWhenClosed = false
        window.contentView = webView
        window.delegate = self
        window.center()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        Task { @MainActor [weak self] in
            guard let self else { return }
            await SessionCookies.shared.prepare(self.webView.configuration.websiteDataStore.httpCookieStore)
            self.webView.load(URLRequest(url: self.service.url))
        }
    }

    func showWindow() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
        return false
    }

    func snapshot() async -> ChatSnapshot {
        guard !busy else { return .empty(service, "busy") }
        do {
            let value = try await webView.callAsyncJavaScript(Self.bridge + "\nreturn JSON.stringify(bridge.snapshot(service));",
                arguments: ["service": service.rawValue], in: nil, contentWorld: Self.world)
            guard let json = value as? String else { return .empty(service) }
            var snapshot = try JSONDecoder().decode(ChatSnapshot.self, from: Data(json.utf8))
            if let failure { snapshot.detail = failure }
            return snapshot
        } catch {
            var result = ChatSnapshot.empty(service, "connecting")
            result.detail = failure ?? "Đang tải phiên web…"
            return result
        }
    }

    func diagnostics() async throws -> [String: String] {
        let value = try await webView.callAsyncJavaScript(Self.bridge + "\nreturn JSON.stringify(bridge.diagnostics());",
            arguments: [:], in: nil, contentWorld: Self.world)
        guard let json = value as? String else { return [:] }
        return try JSONDecoder().decode([String: String].self, from: Data(json.utf8))
    }

    func perform(_ request: ChatRPCRequest) async throws {
        guard !busy, let thread = request.threadID, !thread.isEmpty else { throw problem("Kết nối đang bận hoặc thiếu hội thoại.") }
        busy = true
        defer { busy = false }
        do {
        switch request.operation {
        case "select":
            _ = try await webView.callAsyncJavaScript(Self.bridge + "\nreturn bridge.select(thread);",
                arguments: ["thread": thread], in: nil, contentWorld: Self.world)
            let deadline = Date().addingTimeInterval(2.5)
            var selected = false
            while Date() < deadline {
                let ready = try await webView.callAsyncJavaScript(Self.bridge + "\nreturn bridge.selectionReady(thread);",
                    arguments: ["thread": thread], in: nil, contentWorld: Self.world)
                if ready as? Bool == true { selected = true; break }
                try await Task.sleep(for: .milliseconds(80))
            }
            guard selected else { throw problem("Chưa xác nhận được hội thoại mới. Không gửi tin.") }
        case "send":
            guard let text = request.text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  text.count <= 16_000 else { throw problem("Tin nhắn rỗng hoặc quá dài.") }
            let value = try await webView.callAsyncJavaScript(Self.bridge + "\nreturn bridge.beginSend(thread, text);",
                arguments: ["thread": thread, "text": text], in: nil, contentWorld: Self.world)
            guard let ticket = value as? String else { throw problem("Không khởi tạo được thao tác gửi.") }
            let deadline = Date().addingTimeInterval(4)
            var submitted = false
            while Date() < deadline {
                try await Task.sleep(for: .milliseconds(70))
                let state = try await webView.callAsyncJavaScript(Self.bridge + "\nreturn bridge.sendStep(ticket);",
                    arguments: ["ticket": ticket], in: nil, contentWorld: Self.world)
                if state as? String == "submitted" { submitted = true; break }
            }
            if !submitted {
                _ = try await webView.callAsyncJavaScript(Self.bridge + "\nreturn bridge.expireSend(ticket);",
                    arguments: ["ticket": ticket], in: nil, contentWorld: Self.world)
                throw problem("Chưa xác nhận được kết quả gửi. Không tự gửi lại.")
            }
        default: throw problem("Unknown operation")
        }
        } catch {
            if let message = (error as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String {
                throw problem(message)
            }
            throw error
        }
    }

    private func problem(_ message: String) -> NSError {
        NSError(domain: "ChatDaemon", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { failure = nil }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { failure = error.localizedDescription }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { failure = "Phiên web bị dừng. Mở Kết nối để tải lại." }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(["https", "http", "about", "blob"].contains(action.request.url?.scheme ?? "") ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil { webView.load(action.request) }
        return nil
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert(); alert.messageText = service.rawValue; alert.informativeText = message
        alert.runModal(); completionHandler()
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = service.rawValue; alert.informativeText = message
        alert.addButton(withTitle: "OK"); alert.addButton(withTitle: "Cancel")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }
}
