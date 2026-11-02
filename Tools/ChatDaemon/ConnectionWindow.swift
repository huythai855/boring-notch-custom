import AppKit

/// Keep WebKit rendered without leaving an interactive window on the desktop
/// or in Mission Control. Normal NSWindow frame constraints can pull an
/// offscreen login window back onto a display when it is ordered again.
@MainActor
final class ChatConnectionWindow: NSWindow {
    private(set) var isParked = false
    var onHide: (() -> Void)?

    override var canBecomeKey: Bool { !isParked && super.canBecomeKey }
    override var canBecomeMain: Bool { !isParked && super.canBecomeMain }

    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        isParked ? frameRect : super.constrainFrameRect(frameRect, to: screen)
    }

    override func cancelOperation(_ sender: Any?) { onHide?() }

    func park() {
        isParked = true
        ignoresMouseEvents = true
        isExcludedFromWindowsMenu = true
        collectionBehavior.remove([.managed, .stationary])
        collectionBehavior.insert([.ignoresCycle, .transient])
        level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)) - 1)
        if isKeyWindow { resignKey() }
        if isMainWindow { resignMain() }
        let left = NSScreen.screens.map { $0.frame.minX }.min() ?? 0
        let bottom = NSScreen.screens.map { $0.frame.minY }.min() ?? 0
        setFrameOrigin(NSPoint(x: left - frame.width - 1000, y: bottom - frame.height - 1000))
        orderBack(nil)
    }

    func present(savedFrame: NSRect?) {
        isParked = false
        level = .normal
        ignoresMouseEvents = false
        isExcludedFromWindowsMenu = false
        collectionBehavior.remove([.ignoresCycle, .transient])
        if let savedFrame, NSScreen.screens.contains(where: { $0.visibleFrame.intersects(savedFrame) }) {
            setFrame(savedFrame, display: false)
        } else { center() }
        if isMiniaturized { deminiaturize(nil) }
        makeKeyAndOrderFront(nil)
    }
}
