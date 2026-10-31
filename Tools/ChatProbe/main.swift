import SwiftUI

/// Optional standalone adapter client. Production chat lives in the notch.
@main
struct ChatProbeApp: App {
    var body: some Scene {
        WindowGroup("Notch Chat — Daemon probe") {
            ChatWorkspace()
                .padding(.top, 12)
                .frame(minWidth: 460, minHeight: 380)
                .background(.black)
                .preferredColorScheme(.dark)
        }
        .defaultSize(width: 640, height: 380)
    }
}
