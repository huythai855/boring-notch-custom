import Foundation

@main
struct RPCTests {
    static func main() {
        let token = String(repeating: "a", count: 64)
        let body = Data("{\"operation\":\"snapshot\",\"service\":\"Messenger\"}".utf8)
        let header = "POST /rpc HTTP/1.1\r\nAuthorization: Bearer \(token)\r\nContent-Length: \(body.count)\r\n\r\n"
        let valid = Data(header.utf8) + body
        if case .request(let decoded) = LocalRPCParser.parse(valid, token: token) { precondition(decoded == body) }
        else { fatalError("Valid authenticated request rejected") }
        if case .incomplete = LocalRPCParser.parse(Data(valid.dropLast(5)), token: token) {} else { fatalError("Partial body accepted") }
        reject(valid, token: "wrong")
        reject(valid + Data("trailing".utf8), token: token)
        reject(Data(header.replacingOccurrences(of: "POST", with: "GET").utf8) + body, token: token)
        reject(Data(header.replacingOccurrences(of: "Content-Length:", with: "Origin: https://evil.example\r\nContent-Length:").utf8) + body, token: token)
        reject(Data(header.replacingOccurrences(of: "Content-Length:", with: "Transfer-Encoding: chunked\r\nContent-Length:").utf8) + body, token: token)
        reject(Data(header.replacingOccurrences(of: "Content-Length:", with: "Content-Length: 0\r\nContent-Length:").utf8) + body, token: token)
        reject(Data(repeating: 65, count: 65_537), token: token)
        print("RPC tests passed (authentication, framing, origin, duplicates, size limits).")
    }
    static func reject(_ data: Data, token: String) {
        if case .rejected = LocalRPCParser.parse(data, token: token) {} else { fatalError("Unsafe request accepted") }
    }
}
