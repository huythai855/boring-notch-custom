import Foundation

@main
struct NowPlayingPolicyTests {
    static func update(_ json: String, _ policy: inout NowPlayingSourcePolicy) throws -> NowPlayingUpdate {
        let value = try JSONDecoder().decode(NowPlayingUpdate.self, from: Data(json.utf8))
        policy.observe(value.payload, isDiff: value.diff ?? false)
        return value
    }
    static func main() throws {
        var policy = NowPlayingSourcePolicy()
        _ = try update(#"{"payload":{"bundleIdentifier":"com.spotify.client","playing":true,"duration":3,"title":"Short song"}}"#, &policy)
        precondition(policy.allowsCommands && !policy.isSuppressed, "Short real music must not be filtered by duration")
        _ = try update(#"{"diff":true,"payload":{"elapsedTime":1}}"#, &policy)
        precondition(policy.sourceIdentifier == "com.spotify.client")

        // The actual observed notification source: WebKit GPU, owned by the
        // chat helper, with an approximately 2.23-second audio item.
        _ = try update(#"{"payload":{"bundleIdentifier":"com.apple.WebKit.GPU","parentApplicationBundleIdentifier":"local.notch.chatdaemon","duration":2.2291206530486645,"playing":true}}"#, &policy)
        precondition(policy.isSuppressed && !policy.allowsCommands)
        _ = try update(#"{"diff":true,"payload":{"playing":false,"title":"Alert"}}"#, &policy)
        precondition(policy.sourceIdentifier == "local.notch.chatdaemon" && policy.isSuppressed, "Diff-only alert updates must remain filtered")
        _ = try update(#"{"diff":true,"payload":{"bundleIdentifier":"com.apple.WebKit.GPU","elapsedTime":2}}"#, &policy)
        precondition(policy.isSuppressed, "GPU identity must retain its parent on same-source diffs")

        _ = try update(#"{"diff":true,"payload":{"bundleIdentifier":"com.spotify.client","parentApplicationBundleIdentifier":null,"playing":true}}"#, &policy)
        precondition(policy.sourceIdentifier == "com.spotify.client" && policy.allowsCommands)
        _ = try update(#"{"payload":{"bundleIdentifier":"com.apple.WebKit.GPU","parentApplicationBundleIdentifier":"local.notch.chatdaemon"}}"#, &policy)
        _ = try update(#"{"diff":true,"payload":{"bundleIdentifier":"com.apple.Music","playing":true}}"#, &policy)
        precondition(policy.sourceIdentifier == "com.apple.Music" && !policy.isSuppressed, "Changing bundle must drop a stale helper parent")

        _ = try update(#"{"payload":{"bundleIdentifier":"com.apple.WebKit.GPU","parentApplicationBundleIdentifier":"com.apple.Safari","playing":true}}"#, &policy)
        precondition(policy.sourceIdentifier == "com.apple.Safari" && policy.allowsCommands, "Browser music must remain supported")
        let value = try update(#"{"diff":true,"payload":{"parentApplicationBundleIdentifier":null}}"#, &policy)
        precondition(value.payload.parentWasProvided && value.payload.parentApplicationBundleIdentifier == nil)
        precondition(policy.sourceIdentifier == "com.apple.WebKit.GPU", "Explicit null is different from an omitted parent")
        _ = try update(#"{"payload":{}}"#, &policy)
        precondition(policy.sourceIdentifier.isEmpty && !policy.allowsCommands)
        for source in ["net.whatsapp.WhatsApp", "net.whatsapp.WhatsAppSMB", "com.apple.notificationcenterui", "com.apple.systemuiserver", "local.notch.chatdaemon.Worker"] {
            precondition(NowPlayingSourcePolicy.isNotificationSource(source), source)
        }
        for source in ["com.apple.Music", "com.spotify.client", "com.microsoft.edgemac", "com.google.Chrome", "local.notch.chatdaemon-other"] {
            precondition(!NowPlayingSourcePolicy.isNotificationSource(source), source)
        }
        print("Now Playing policy tests passed: actual helper alert, diff identity, explicit null, source changes, browser/short music, and command gating.")
    }
}
