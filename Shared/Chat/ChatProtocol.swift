import Foundation
import Darwin

enum ChatService: String, CaseIterable, Codable, Identifiable {
    case messenger = "Messenger", zalo = "Zalo", whatsapp = "WhatsApp"
    var id: String { rawValue }
    var url: URL {
        switch self {
        case .messenger: URL(string: "https://www.messenger.com/")!
        case .zalo: URL(string: "https://chat.zalo.me/")!
        case .whatsapp: URL(string: "https://web.whatsapp.com/")!
        }
    }
}

struct ChatThread: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var preview: String
    var avatar: String?
}

struct ChatMessage: Codable, Identifiable, Equatable {
    var id: String
    var text: String
    var outgoing: Bool
    var senderName: String? = nil
    var reply: ChatReply? = nil
    var runs: [ChatTextRun]? = nil
}

struct ChatReply: Codable, Equatable {
    var senderName: String? = nil
    var text: String
}

struct ChatTextRun: Codable, Equatable {
    var text: String
    var mention: Bool
}

struct ChatSnapshot: Codable, Equatable {
    var service: ChatService
    var state: String
    var title: String
    var threads: [ChatThread]
    var messages: [ChatMessage]
    var activeID: String?
    var canSend: Bool
    var detail: String?
    var diagnostics: [String: Int]?
    var loadingMessages: Bool? = nil

    static func empty(_ service: ChatService, _ state: String = "connecting") -> Self {
        Self(service: service, state: state, title: service.rawValue, threads: [], messages: [], canSend: false)
    }
}

struct ChatRPCRequest: Codable {
    var operation: String
    var service: ChatService
    var threadID: String?
    var text: String?
}

struct ChatRPCResponse: Codable {
    var ok: Bool
    var snapshot: ChatSnapshot?
    var error: String?
    var diagnostics: [String: String]?
}

struct ChatDaemonEndpoint: Codable {
    var port: UInt16
    var token: String
    var pid: Int32
}

enum ChatDaemonPaths {
    // A shared discovery directory avoids cross-app container protection. The
    // sandboxed client has a read-only exception for endpoint/ only, not profile/.
    static var directory: URL {
        let home = String(cString: getpwuid(getuid())!.pointee.pw_dir)
        return URL(fileURLWithPath: home).appendingPathComponent(
            ".local/share/notch-chat-daemon", isDirectory: true)
    }
    static var discoveryDirectory: URL { directory.appendingPathComponent("endpoint", isDirectory: true) }
    static var profileDirectory: URL { directory.appendingPathComponent("profile", isDirectory: true) }
    static var endpoint: URL { discoveryDirectory.appendingPathComponent("daemon.json") }
}
