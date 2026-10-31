import Foundation

enum LocalRPCParser {
    enum Result {
        case incomplete
        case rejected
        case request(Data)
    }
    static func parse(_ data: Data, token: String) -> Result {
        guard data.count <= 65_536 else { return .rejected }
        guard let separator = data.range(of: Data("\r\n\r\n".utf8)) else { return .incomplete }
        guard separator.lowerBound < 8192,
              let header = String(data: data[..<separator.lowerBound], encoding: .utf8) else { return .rejected }
        let lines = header.components(separatedBy: "\r\n")
        guard lines.first == "POST /rpc HTTP/1.1" else { return .rejected }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            let parts = line.split(separator: ":", maxSplits: 1)
            guard parts.count == 2 else { return .rejected }
            let key = parts[0].lowercased()
            guard headers[key] == nil else { return .rejected }
            headers[key] = parts[1].trimmingCharacters(in: .whitespaces)
        }
        guard headers["authorization"] == "Bearer \(token)",
              headers["transfer-encoding"] == nil,
              headers["origin"] == nil,
              let rawLength = headers["content-length"],
              let length = Int(rawLength), length > 0, length <= 32_768 else { return .rejected }
        let body = Data(data[separator.upperBound...])
        guard body.count >= length else { return .incomplete }
        guard body.count == length else { return .rejected }
        return .request(body)
    }
}
