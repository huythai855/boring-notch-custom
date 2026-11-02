import Foundation
import WebKit

/// WebKit may discard session-only cookies on process exit. Preserve their
/// original properties locally; never extend expiry or export them over RPC.
@MainActor
final class SessionCookies: NSObject, WKHTTPCookieStoreObserver {
    static let shared = SessionCookies()
    private var preparation: Task<Void, Never>?
    private var saveTask: Task<Void, Never>?
    private let file = ChatDaemonPaths.profileDirectory.appendingPathComponent("session-cookies.plist")

    func prepare(_ store: WKHTTPCookieStore) async {
        if let preparation { await preparation.value; return }
        let task = Task { @MainActor in
            if let data = try? Data(contentsOf: file),
               let rows = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [[String: Any]] {
                for row in rows {
                    let properties = Dictionary(uniqueKeysWithValues: row.map { (HTTPCookiePropertyKey($0.key), $0.value) })
                    if let cookie = HTTPCookie(properties: properties), allowed(cookie),
                       cookie.expiresDate.map({ $0 > Date() }) ?? true {
                        await store.setCookie(cookie)
                    }
                }
            }
            store.add(self)
        }
        preparation = task
        await task.value
    }

    func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
        saveTask?.cancel()
        saveTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            let cookies = await cookieStore.allCookies()
            let rows = cookies.filter(allowed).compactMap { cookie -> [String: Any]? in
                guard let properties = cookie.properties else { return nil }
                return Dictionary(uniqueKeysWithValues: properties.map { key, value in
                    (key.rawValue, (value as? URL)?.absoluteString ?? value)
                })
            }
            do {
                let data = try PropertyListSerialization.data(fromPropertyList: rows, format: .binary, options: 0)
                try data.write(to: file, options: .atomic)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
            } catch {
                // Credential contents and raw errors are deliberately never logged.
            }
        }
    }

    private func allowed(_ cookie: HTTPCookie) -> Bool {
        let domain = cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))
        return ["messenger.com", "facebook.com", "zalo.me", "zaloapp.com", "zdn.vn", "whatsapp.com"].contains {
            domain == $0 || domain.hasSuffix("." + $0)
        }
    }
}
