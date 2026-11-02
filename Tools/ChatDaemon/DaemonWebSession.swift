import AppKit
import WebKit

@MainActor
final class DaemonWebSession: NSObject, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
    let service: ChatService
    let webView: WKWebView
    private let window: ChatConnectionWindow
    private var busy = false
    private var failure: String?
    private var needsReload = false
    private var recoveryAttempt = 0
    private var nextRecovery = Date.distantPast
    private var recoveryInFlight = false
    private var reloadStarted = Date.distantPast
    private var connectionPresented = false
    private var connectionFrame: NSRect?
    private var selectedThread: String?
    private var restoreSelection = false
    private var restoreAttempts = 0
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
        window = ChatConnectionWindow(contentRect: webView.frame,
            styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        super.init()
        window.title = "Kết nối \(service.rawValue) — Chat Daemon"
        window.isReleasedWhenClosed = false
        window.contentView = webView
        window.delegate = self
        window.onHide = { [weak self] in self?.hideWindow() }
        window.center()
        connectionFrame = window.frame
        webView.navigationDelegate = self
        webView.uiDelegate = self
        keepRendererAlive()
        Task { @MainActor [weak self] in
            guard let self else { return }
            await SessionCookies.shared.prepare(self.webView.configuration.websiteDataStore.httpCookieStore)
            self.webView.load(URLRequest(url: self.service.url))
        }
    }

    func showWindow() {
        recoverIfNeeded(force: true)
        connectionPresented = true
        window.present(savedFrame: connectionFrame)
        NSApp.activate(ignoringOtherApps: true)
    }

    func hideWindow() {
        if connectionPresented { connectionFrame = window.frame }
        connectionPresented = false
        keepRendererAlive()
        if NSApp.keyWindow == nil { NSApp.deactivate() }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        hideWindow()
        return false
    }

    private func keepRendererAlive() { window.park() }

    func snapshot() async -> ChatSnapshot {
        guard !busy else { return .empty(service, "busy") }
        if needsReload {
            recoverIfNeeded()
            var result = ChatSnapshot.empty(service, "connecting")
            result.detail = "Đang khôi phục phiên web để tải tin mới…"
            return result
        }
        do {
            let value = try await webView.callAsyncJavaScript(Self.bridge + "\nreturn JSON.stringify(bridge.snapshot(service, followRecent));",
                arguments: ["service": service.rawValue, "followRecent": !connectionPresented], in: nil, contentWorld: Self.world)
            guard let json = value as? String else { return .empty(service) }
            var snapshot = try JSONDecoder().decode(ChatSnapshot.self, from: Data(json.utf8))
            if restoreSelection, snapshot.state == "ready", snapshot.activeID == nil,
               restoreAttempts < 3, let thread = selectedThread {
                restoreAttempts += 1
                Task { @MainActor [weak self] in
                    guard let self, !self.busy, self.restoreSelection else { return }
                    try? await self.perform(.init(operation: "select", service: self.service, threadID: thread))
                }
            } else if snapshot.activeID != nil {
                restoreSelection = false
            }
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
        var result = try JSONDecoder().decode([String: String].self, from: Data(json.utf8))
        result["connectionWindow"] = "parked=\(window.isParked);presented=\(connectionPresented);onscreen=\(NSScreen.screens.contains { $0.frame.intersects(window.frame) });key=\(window.isKeyWindow);ignoresMouse=\(window.ignoresMouseEvents);transient=\(window.collectionBehavior.contains(.transient))"
        return result
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
            selectedThread = thread
            restoreSelection = false
            try await readRecent(thread)
        case "recent":
            try await readRecent(thread)
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

    private func readRecent(_ thread: String) async throws {
        _ = try await webView.callAsyncJavaScript(Self.bridge + "\nreturn bridge.beginRecent(thread);",
            arguments: ["thread": thread], in: nil, contentWorld: Self.world)
        let deadline = Date().addingTimeInterval(1.8)
        while Date() < deadline {
            try await Task.sleep(for: .milliseconds(100))
            let ready = try await webView.callAsyncJavaScript(Self.bridge + "\nreturn bridge.recentStep(thread);",
                arguments: ["thread": thread], in: nil, contentWorld: Self.world)
            if ready as? Bool == true { break }
        }
    }

    private func problem(_ message: String) -> NSError {
        NSError(domain: "ChatDaemon", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    private func recoverIfNeeded(force: Bool = false) {
        guard needsReload, !busy, force || Date() >= nextRecovery else { return }
        guard !recoveryInFlight || Date().timeIntervalSince(reloadStarted) > 30 else { return }
        recoveryAttempt += 1
        recoveryInFlight = true
        reloadStarted = Date()
        nextRecovery = Date().addingTimeInterval(min(30, pow(2, Double(min(recoveryAttempt, 5)))))
        // Keep the existing website store and cookies. Reloading restores a
        // terminated WebContent process; it never retries a chat send.
        if webView.url != nil { webView.reload() }
        else { webView.load(URLRequest(url: service.url)) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        failure = nil
        needsReload = false
        recoveryInFlight = false
        recoveryAttempt = 0
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled {
            failure = error.localizedDescription
            needsReload = true
            recoveryInFlight = false
        }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        failure = "Phiên web bị dừng; đang khôi phục."
        needsReload = true
        recoveryInFlight = false
        restoreSelection = selectedThread != nil
        restoreAttempts = 0
        recoverIfNeeded()
    }
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
