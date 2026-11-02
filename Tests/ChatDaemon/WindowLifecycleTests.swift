import AppKit

@MainActor
final class WindowTestDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var window: ChatConnectionWindow!
    func windowShouldClose(_ sender: NSWindow) -> Bool { window.park(); return false }
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = ChatConnectionWindow(contentRect: NSRect(x: 80, y: 80, width: 480, height: 320),
            styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.onHide = { [weak self] in self?.window.park() }
        var checks = 0
        func checkParked() {
            precondition(window.isParked && window.isVisible, "WebKit's retained window must remain ordered")
            precondition(!NSScreen.screens.contains { $0.frame.intersects(window.frame) }, "Parked window must not be on any display")
            precondition(!window.canBecomeKey && !window.canBecomeMain && !window.isKeyWindow)
            precondition(window.ignoresMouseEvents && window.isExcludedFromWindowsMenu)
            precondition(window.collectionBehavior.contains(.transient))
            precondition(window.level.rawValue < Int(CGWindowLevelForKey(.desktopWindow)))
            let proposed = window.frame
            precondition(window.constrainFrameRect(proposed, to: NSScreen.main) == proposed, "AppKit must not pull the window onscreen")
            checks += 1
        }
        window.park()
        checkParked()
        window.present(savedFrame: nil)
        precondition(!window.isParked && !window.ignoresMouseEvents && window.level == .normal)
        precondition(NSScreen.screens.contains { $0.visibleFrame.intersects(window.frame) })
        let visibleFrame = window.frame
        window.performClose(nil)
        checkParked()
        window.present(savedFrame: visibleFrame)
        precondition(window.frame == visibleFrame, "Explicit reconnect must restore the user's window")
        window.cancelOperation(nil)
        checkParked()
        window.park()
        checkParked()
        let result: [String: Any] = ["passed":true,"parkChecks":checks,"reopen":true,"close":true,"escape":true]
        let output = Bundle.main.bundleURL.deletingLastPathComponent().appendingPathComponent("window-lifecycle-result.json")
        try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]).write(to: output)
        window.orderOut(nil)
        NSApp.terminate(nil)
    }
}

@main
struct WindowLifecycleTests {
    @MainActor static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let delegate = WindowTestDelegate()
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
