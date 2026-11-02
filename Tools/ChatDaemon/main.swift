import AppKit
import Network
import Security

@MainActor
final class DaemonDelegate: NSObject, NSApplicationDelegate {
    private var listener: NWListener?
    private var sessions: [ChatService: DaemonWebSession] = [:]
    private var token = ""

    func applicationDidFinishLaunching(_ notification: Notification) {
        start()
    }

    func start() {
        guard listener == nil else { return }
        NSApp.setActivationPolicy(.accessory)
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            NSApp.terminate(nil); return
        }
        token = bytes.map { String(format: "%02x", $0) }.joined()
        do {
            try FileManager.default.createDirectory(at: ChatDaemonPaths.directory,
                withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try FileManager.default.createDirectory(at: ChatDaemonPaths.discoveryDirectory,
                withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try FileManager.default.createDirectory(at: ChatDaemonPaths.profileDirectory,
                withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let params = NWParameters.tcp
            params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
            let server = try NWListener(using: params)
            server.stateUpdateHandler = { [weak self] state in
                Task { @MainActor in
                if case .ready = state, let self, let port = server.port {
                    let endpoint = ChatDaemonEndpoint(port: port.rawValue, token: self.token,
                                                       pid: ProcessInfo.processInfo.processIdentifier)
                    do {
                        let data = try JSONEncoder().encode(endpoint)
                        try data.write(to: ChatDaemonPaths.endpoint, options: .atomic)
                        try FileManager.default.setAttributes([.posixPermissions: 0o600],
                            ofItemAtPath: ChatDaemonPaths.endpoint.path)
                    } catch { NSApp.terminate(nil) }
                }
            }
            }
            server.newConnectionHandler = { [weak self] connection in
                Task { @MainActor in self?.accept(connection) }
            }
            listener = server
            server.start(queue: .main)
            let menu = NSMenu()
            let root = NSMenuItem()
            let app = NSMenu()
            app.addItem(withTitle: "Quit Chat Daemon", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
            root.submenu = app
            menu.addItem(root)
            let edit = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
            let editMenu = NSMenu(title: "Edit")
            for (title, action, key) in [("Cut", "cut:", "x"), ("Copy", "copy:", "c"),
                                          ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
                editMenu.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
            }
            edit.submenu = editMenu
            menu.addItem(edit)
            NSApp.mainMenu = menu
        } catch { NSApp.terminate(nil) }
    }

    private func accept(_ connection: NWConnection) {
        connection.start(queue: .main)
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { connection.cancel() }
        receive(connection, accumulated: Data())
    }

    private func receive(_ connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, complete, error in
            Task { @MainActor in
            guard let self, error == nil else { connection.cancel(); return }
            var buffer = accumulated
            buffer.append(data ?? Data())
            switch LocalRPCParser.parse(buffer, token: self.token) {
            case .incomplete:
                if complete { connection.cancel() }
                else { self.receive(connection, accumulated: buffer) }
            case .rejected:
                self.reply(connection, code: 401, response: .init(ok: false, error: "Unauthorized request"))
            case .request(let body):
                Task { @MainActor in
                    let response: ChatRPCResponse
                    do {
                        let request = try JSONDecoder().decode(ChatRPCRequest.self, from: body)
                        response = try await self.handle(request)
                    } catch { response = .init(ok: false, error: error.localizedDescription) }
                    self.reply(connection, code: 200, response: response)
                }
            }
            }
        }
    }

    private func reply(_ connection: NWConnection, code: Int, response: ChatRPCResponse) {
        guard let body = try? JSONEncoder().encode(response) else { connection.cancel(); return }
        let header = "HTTP/1.1 \(code) \(code == 200 ? "OK" : "Unauthorized")\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: \(body.count)\r\n\r\n"
        connection.send(content: Data(header.utf8) + body, completion: .contentProcessed { _ in connection.cancel() })
    }

    private func handle(_ request: ChatRPCRequest) async throws -> ChatRPCResponse {
        guard ["snapshot", "login", "select", "recent", "send", "diagnostics"].contains(request.operation) else {
            return .init(ok: false, error: "Unknown operation")
        }
        let session: DaemonWebSession
        if let existing = sessions[request.service] { session = existing }
        else {
            session = DaemonWebSession(service: request.service)
            sessions[request.service] = session
        }
        if request.operation == "login" { session.showWindow() }
        if request.operation == "diagnostics" {
            return .init(ok: true, diagnostics: try await session.diagnostics())
        }
        if request.operation == "select" || request.operation == "recent" || request.operation == "send" {
            try await session.perform(request)
        }
        return .init(ok: true, snapshot: await session.snapshot())
    }
}

@main
struct ChatDaemonMain {
    @MainActor static func main() {
        let application = NSApplication.shared
        let delegate = DaemonDelegate()
        application.delegate = delegate
        // LaunchServices may start this accessory app without an activation
        // event. Start IPC explicitly rather than waiting for first activation.
        delegate.start()
        withExtendedLifetime(delegate) { application.run() }
    }
}
