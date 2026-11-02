import AppKit
import Combine

@MainActor
final class ChatDaemonClient: ObservableObject {
    static let shared = ChatDaemonClient()
    @Published var snapshot = ChatSnapshot.empty(.messenger)
    @Published var error: String?
    @Published var drafts: [String: String] = [:]
    @Published var sending = false
    @Published var selecting = false
    @Published var scrollRequest = 0
    @Published var service: ChatService = .messenger
    private var polling: Task<Void, Never>?
    private var generation = 0
    private var launchTime = Date.distantPast
    private var hasActionError = false
    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 6
        config.connectionProxyDictionary = [:]
        return URLSession(configuration: config)
    }()

    func start() {
        guard polling == nil else { return }
        polling = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    func choose(_ service: ChatService) {
        guard !sending, !selecting else { return }
        self.service = service
        generation += 1
        snapshot = .empty(service)
        error = nil
        hasActionError = false
        Task { await refresh() }
    }

    private func launchIfNeeded() {
        guard Date().timeIntervalSince(launchTime) > 10 else { return }
        launchTime = Date()
        guard let helper = Bundle.main.url(forResource: "Notch Chat Daemon", withExtension: "app") else {
            error = "Thiếu Chat Daemon trong app. Hãy build lại bản tích hợp."
            return
        }
        let config = NSWorkspace.OpenConfiguration()
        config.activates = false
        NSWorkspace.shared.openApplication(at: helper, configuration: config) { _, _ in }
    }

    private func call(_ request: ChatRPCRequest) async throws -> ChatRPCResponse {
        let endpoint = try JSONDecoder().decode(ChatDaemonEndpoint.self,
                                                from: Data(contentsOf: ChatDaemonPaths.endpoint))
        guard endpoint.port > 0, endpoint.token.count >= 32 else { throw URLError(.badServerResponse) }
        var rpc = URLRequest(url: URL(string: "http://127.0.0.1:\(endpoint.port)/rpc")!)
        rpc.httpMethod = "POST"
        rpc.setValue("Bearer \(endpoint.token)", forHTTPHeaderField: "Authorization")
        rpc.setValue("application/json", forHTTPHeaderField: "Content-Type")
        rpc.httpBody = try JSONEncoder().encode(request)
        let (data, response) = try await session.data(for: rpc)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        let result = try JSONDecoder().decode(ChatRPCResponse.self, from: data)
        if !result.ok { throw NSError(domain: "NotchChat", code: 1,
                                      userInfo: [NSLocalizedDescriptionKey: result.error ?? "Daemon error"]) }
        return result
    }

    func refresh() async {
        let version = generation
        let requestedService = service
        do {
            let result = try await call(.init(operation: "snapshot", service: requestedService))
            guard generation == version, !selecting, !sending else { return }
            if let value = result.snapshot, snapshot != value { snapshot = value }
            if !hasActionError, error != nil { error = nil }
        } catch {
            guard generation == version else { return }
            let failure = error as NSError
            if !hasActionError {
                self.error = failure.domain == NSCocoaErrorDomain
                    ? "Không đọc được cấu hình kết nối daemon (\(failure.code))."
                    : "Đang kết nối Chat Daemon…"
            }
            launchIfNeeded()
        }
    }

    func select(_ thread: ChatThread) async {
        guard !sending, !selecting else { return }
        selecting = true
        hasActionError = false
        error = nil
        generation += 1
        snapshot = ChatSnapshot(service: service, state: "ready", title: thread.name,
            threads: snapshot.threads, messages: [], activeID: thread.id, canSend: false, loadingMessages: true)
        defer { selecting = false }
        do {
            let result = try await call(.init(operation: "select", service: service, threadID: thread.id))
            if let value = result.snapshot, value.activeID == thread.id {
                snapshot = value
                scrollRequest += 1
            }
            else { throw NSError(domain: "NotchChat", code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Hội thoại đã thay đổi trong lúc tải. Hãy chọn lại."]) }
            error = nil
        } catch { hasActionError = true; self.error = error.localizedDescription }
    }

    func refreshRecent() async {
        guard !sending, !selecting, let id = snapshot.activeID else { return }
        selecting = true
        generation += 1
        hasActionError = false
        defer { selecting = false }
        do {
            let result = try await call(.init(operation: "recent", service: service, threadID: id))
            if let value = result.snapshot, value.activeID == id {
                snapshot = value
                scrollRequest += 1
            }
            error = nil
        } catch { hasActionError = true; self.error = error.localizedDescription }
    }

    func send(_ text: String, expectedID: String) async -> Bool {
        guard !sending, !selecting, snapshot.activeID == expectedID, snapshot.canSend else { return false }
        sending = true
        hasActionError = false
        error = nil
        generation += 1
        defer { sending = false }
        do {
            _ = try await call(.init(operation: "send", service: service, threadID: expectedID, text: text))
            error = nil
            return true
        } catch {
            hasActionError = true
            // No retry: an interrupted response may follow a successful send.
            self.error = error.localizedDescription + " Không tự gửi lại; hãy kiểm tra hội thoại."
            return false
        }
    }

    func openConnection() {
        Task {
            do { _ = try await call(.init(operation: "login", service: service)) }
            catch { self.error = "Đang mở Chat Daemon…"; launchIfNeeded() }
        }
    }
}
