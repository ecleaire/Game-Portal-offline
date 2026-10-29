import Foundation
import Darwin

struct DesktopHTTPError: LocalizedError {
    let operation: String, code: Int32
    var errorDescription: String? {
        let guidance = code == EADDRINUSE
            ? "同じ用途のGAME PORTALが開いている場合は閉じて、少し待ってから開き直してください。"
            : "Mac内の接続（127.0.0.1）を開始できません。Macを再起動してから開き直してください。"
        return guidance + "\nゲームやセーブは削除せず、そのままにしてください。\n接続エラー: \(operation) / POSIX \(code): \(String(cString: strerror(code)))"
    }
}

// A local-only static page server using APIs available before Mojave. Avoid
// Network.framework path evaluation/DNS entirely, including when offline.
// No filesystem, native bridge or arbitrary paths are exposed over HTTP.
final class DesktopHTTPServer {
    let page: Data
    private let queue = DispatchQueue(label: "gameportal.http.accept")
    private let workers = DispatchQueue(label: "gameportal.http.clients", attributes: .concurrent)
    private var source: DispatchSourceRead?
    private var clients = Set<Int32>()
    private var stopped = false
    private(set) var port: UInt16 = 0
    init(page: Data) { self.page = page }
    deinit { source?.cancel() }
    func start(port requestedPort: UInt16?) throws -> UInt16 {
        // Called once before the accept source is activated.
        guard source == nil, !stopped else { throw DesktopHTTPError(operation: "start", code: EINVAL) }
        let fd = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { throw DesktopHTTPError(operation: "socket", code: errno) }
        var handedOff = false
        defer { if !handedOff { Darwin.close(fd) } }
        // SO_REUSEADDR permits restart after TIME_WAIT, without SO_REUSEPORT:
        // a second live listener must still fail on this exact local address.
        var yes: Int32 = 1
        guard setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size)) == 0 else { throw DesktopHTTPError(operation: "reuse-address", code: errno) }
        guard fcntl(fd, F_SETFD, FD_CLOEXEC) == 0, fcntl(fd, F_SETFL, O_NONBLOCK) == 0 else { throw DesktopHTTPError(operation: "socket-flags", code: errno) }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size); address.sin_family = sa_family_t(AF_INET)
        address.sin_port = (requestedPort ?? 0).bigEndian
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        let bound = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }
        guard bound == 0 else { throw DesktopHTTPError(operation: "bind", code: errno) }
        guard Darwin.listen(fd, 8) == 0 else { throw DesktopHTTPError(operation: "listen", code: errno) }
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        let named = withUnsafeMutablePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &length) }
        }
        guard named == 0 else { throw DesktopHTTPError(operation: "local-address", code: errno) }
        port = UInt16(bigEndian: address.sin_port)
        let reader = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
        reader.setEventHandler { [weak self] in self?.acceptClients(fd) }
        reader.setCancelHandler { Darwin.close(fd) }
        source = reader; handedOff = true; reader.resume()
        return port
    }
    func cancel() {
        queue.async { [self] in
            guard !stopped else { return }; stopped = true
            source?.cancel(); source = nil
            // Wake blocked reads/writes. Only each owning worker closes its fd,
            // preventing descriptor reuse from cancelling an unrelated client.
            for fd in clients { _ = Darwin.shutdown(fd, SHUT_RDWR) }
        }
    }
    private func acceptClients(_ listener: Int32) {
        guard !stopped else { return }
        // Bound work per event, including rejected clients, to keep cancellation
        // and cleanup responsive during bursts of local requests.
        for _ in 0..<32 {
            let fd = Darwin.accept(listener, nil, nil)
            if fd < 0 { if errno == EINTR { continue }; return }
            guard clients.count < 8 else { Darwin.close(fd); continue }
            var yes: Int32 = 1
            guard fcntl(fd, F_SETFD, FD_CLOEXEC) == 0, fcntl(fd, F_SETFL, 0) == 0,
                  setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &yes, socklen_t(MemoryLayout<Int32>.size)) == 0 else { Darwin.close(fd); continue }
            clients.insert(fd)
            workers.async { [self] in
                serve(fd)
                queue.async { [self] in clients.remove(fd); Darwin.close(fd) }
            }
        }
    }
    private func timeout(_ fd: Int32, option: Int32, until deadline: UInt64) -> Bool {
        let now = DispatchTime.now().uptimeNanoseconds
        guard now < deadline else { return false }
        let micros = max(UInt64(1), (deadline - now) / 1000)
        var value = timeval(tv_sec: Int(micros / 1000000), tv_usec: Int32(micros % 1000000))
        return setsockopt(fd, SOL_SOCKET, option, &value, socklen_t(MemoryLayout<timeval>.size)) == 0
    }
    private func serve(_ fd: Int32) {
        let deadline = DispatchTime.now().uptimeNanoseconds + 15_000_000_000
        var bytes = Data(), chunk = [UInt8](repeating: 0, count: 4096)
        while bytes.range(of: Data("\r\n\r\n".utf8)) == nil {
            guard timeout(fd, option: SO_RCVTIMEO, until: deadline) else { return }
            let count = Darwin.recv(fd, &chunk, chunk.count, 0)
            if count < 0 && errno == EINTR { continue }
            guard count > 0, bytes.count + count <= 16384 else { return }
            bytes.append(contentsOf: chunk.prefix(count))
        }
        guard let end = bytes.range(of: Data("\r\n\r\n".utf8)), end.upperBound == bytes.count,
              let text = String(data: bytes, encoding: .utf8) else { return }
        let lines = text.components(separatedBy: "\r\n"), hosts = lines.filter { $0.lowercased().hasPrefix("host:") }
        guard lines.first == "GET /index.html HTTP/1.1", hosts.count == 1,
              hosts[0].dropFirst(5).trimmingCharacters(in: .whitespaces) == "127.0.0.1:\(port)",
              !lines.contains(where: { $0.lowercased().hasPrefix("transfer-encoding:") || $0.lowercased().hasPrefix("content-length:") }) else { return }
        let header = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(page.count)\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nContent-Security-Policy: frame-ancestors 'none'\r\nConnection: close\r\n\r\n"
        // Older Macs may consume the large bundled page slowly. Bound sends
        // separately without relaxing the short header/slow-client deadline.
        let sendDeadline = DispatchTime.now().uptimeNanoseconds + 60_000_000_000
        guard send(fd, bytes: Data(header.utf8), until: sendDeadline) else { return }
        _ = send(fd, bytes: page, until: sendDeadline)
    }
    private func send(_ fd: Int32, bytes: Data, until deadline: UInt64) -> Bool {
        return bytes.withUnsafeBytes { buffer in
            guard let base = buffer.baseAddress else { return bytes.isEmpty }
            var offset = 0
            while offset < bytes.count {
                guard timeout(fd, option: SO_SNDTIMEO, until: deadline) else { return false }
                let count = Darwin.send(fd, base.advanced(by: offset), min(65536, bytes.count - offset), 0)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { return false }; offset += count
            }
            return true
        }
    }
}
