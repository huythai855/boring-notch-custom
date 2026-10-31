import AppKit
import SwiftUI

extension Notification.Name {
    static let chatComposerFocusRequested = Notification.Name("notch.chat.composerFocusRequested")
    static let openIntegratedChat = Notification.Name("notch.chat.openIntegrated")
}

/// Menu compatibility entry point. Chat is hosted by ContentView inside the
/// existing notch window; this controller never creates a separate panel.
@MainActor
final class ChatPanelController: ObservableObject {
    static let shared = ChatPanelController()
    @Published var pinned = false
    func show(on screen: NSScreen? = nil) {
        NotificationCenter.default.post(name: .openIntegratedChat, object: nil)
    }
    func dismiss() {}
}
