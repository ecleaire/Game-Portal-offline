import Foundation
import Security
import CommonCrypto
import CoreFoundation
import Darwin

struct DesktopError: Error {
    let message: String
    let name: String
    init(_ message: String, _ name: String = "NotReadableError") { self.message = message; self.name = name }
}
let desktopLimit = 200 * 1024 * 1024
func desktopJSON(_ value: Any) throws -> Data { return try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) }
func desktopSchema(_ value: Any?) -> Bool { guard let number = value as? NSNumber else { return false }; return CFGetTypeID(number) != CFBooleanGetTypeID() && number.doubleValue == 1 }
func desktopObject(_ bytes: Data) throws -> [String: Any] {
    guard let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { throw DesktopError("設定を確認してください。") }; return object
}
func desktopID(_ value: String) -> Bool { return value.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil }
func desktopSecret() -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    precondition(SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess)
    return bytes.map { String(format: "%02x", $0) }.joined()
}
func desktopHash(_ value: String) -> String {
    let bytes = Data(value.utf8); var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
    bytes.withUnsafeBytes { _ = CC_SHA256($0.baseAddress, CC_LONG(bytes.count), &hash) }
    return hash.map { String(format: "%02x", $0) }.joined()
}

// All operations run on one I/O queue. Opaque capabilities never enter game frames.
final class DesktopFiles {
    final class Root {
        let url: URL, token = desktopSecret(), secret = desktopSecret()
        var id: String?, initializing = false
        init(_ url: URL, _ id: String?) { self.url = url; self.id = id }
    }
    final class Writer {
        let root: Root, path: String, temporary: URL, descriptor: Int32, lock: Int32
        var length = 0
        init(_ root: Root, _ path: String, _ temporary: URL, _ descriptor: Int32, _ lock: Int32) {
            self.root = root; self.path = path; self.temporary = temporary; self.descriptor = descriptor; self.lock = lock
        }
        deinit { Darwin.close(descriptor); Darwin.close(lock); try? FileManager.default.removeItem(at: temporary) }
    }
    let fm = FileManager.default, profile: URL, application: URL, player: Bool
    var roots = [String: Root](), writers = [String: Writer]()
    init(profile: URL, application: URL, player: Bool) throws {
        self.profile = profile; self.application = application; self.player = player
        try fm.createDirectory(at: profile, withIntermediateDirectories: true)
    }
    func regularRead(_ url: URL, limit: Int) throws -> Data {
        let fd = Darwin.open(url.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
        guard fd >= 0 else { throw posixError() }; defer { Darwin.close(fd) }
        var before = stat(); guard fstat(fd, &before) == 0, before.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), before.st_size >= 0, before.st_size <= Int64(limit) else { throw DesktopError("通常のファイルではないか、大きすぎます。") }
        var result = Data(), buffer = [UInt8](repeating: 0, count: 65536)
        while result.count < Int(before.st_size) {
            let count = Darwin.read(fd, &buffer, min(buffer.count, Int(before.st_size) - result.count))
            if count < 0 { if errno == EINTR { continue }; throw posixError() }
            guard count > 0 else { throw DesktopError("読み込み中にファイルが変わりました。") }; result.append(contentsOf: buffer.prefix(count))
        }
        var after = stat(); guard fstat(fd, &after) == 0, before.st_size == after.st_size else { throw DesktopError("読み込み中にファイルが変わりました。") }; return result
    }
    func posixError() -> DesktopError {
        if errno == ENOENT { return DesktopError("項目が見つかりません。", "NotFoundError") }
        if errno == EACCES || errno == EPERM { return DesktopError("フォルダーへのアクセスを確認してください。", "NotAllowedError") }
        return DesktopError(String(cString: strerror(errno)))
    }
    func checkAncestors(_ url: URL) throws {
        var current = URL(fileURLWithPath: "/", isDirectory: true)
        for part in url.standardizedFileURL.pathComponents.dropFirst() {
            current.appendPathComponent(part)
            var info = stat()
            if lstat(current.path, &info) == 0 {
                guard info.st_mode & mode_t(S_IFMT) != mode_t(S_IFLNK) else { throw DesktopError("リンクを経由した保存先は操作できません。") }
            } else if errno != ENOENT { throw posixError() }
        }
    }
    func bound(_ root: URL, _ path: String, allowRoot: Bool = false) throws -> URL {
        if path.isEmpty && allowRoot { try checkAncestors(root); return root }
        guard !path.isEmpty, path.utf8.count <= 4000 else { throw DesktopError("保存先のパスを確認してください。") }
        var url = root
        for part in path.split(separator: "/", omittingEmptySubsequences: false) {
            guard !part.isEmpty, part != ".", part != "..", part.utf8.count <= 255, !part.contains("\\"), !part.contains(where: { $0.asciiValue.map { $0 < 32 } == true }) else { throw DesktopError("保存先の外は操作できません。") }
            url.appendPathComponent(String(part))
        }
        try checkAncestors(url); return url
    }
    func libraryID(_ url: URL, initializing: Bool = false) throws -> String? {
        let file = try bound(url, ".gameportal/library-id.json")
        guard fm.fileExists(atPath: file.path) else { return nil }
        let bytes = try regularRead(file, limit: 1024)
        if initializing && bytes.isEmpty { return nil }
        let record = try desktopObject(bytes)
        guard desktopSchema(record["schema"]), let id = record["id"] as? String, desktopID(id) else { throw DesktopError("保存先のID設定が壊れています。") }; return id
    }
    func register(_ path: String, expected: String? = nil) throws -> Root {
        var path = path.trimmingCharacters(in: .whitespacesAndNewlines)
        if path.hasPrefix("\""), path.hasSuffix("\""), path.count > 1 { path = String(path.dropFirst().dropLast()) }
        guard path.hasPrefix("/"), path.utf8.count <= 4000, !path.contains("\0") else { throw DesktopError("Finderからコピーしたフォルダーのフルパスを入力してください。") }
        let url = URL(fileURLWithPath: path).standardizedFileURL; try checkAncestors(url)
        let values = try url.resourceValues(forKeys: [.isDirectoryKey]); guard values.isDirectory == true else { throw DesktopError("保存先フォルダーを選んでください。", "TypeMismatchError") }
        let id = try libraryID(url)
        if let expected = expected, expected != id { throw DesktopError("保存先のIDが変わりました。元の保存先を確認してください。") }
        if let known = roots.values.first(where: { $0.url == url && $0.id == id }) { return known }
        let root = Root(url, id); roots[root.token] = root; return root
    }
    func get(_ token: String) throws -> Root {
        guard let root = roots[token] else { throw DesktopError("保存先に接続し直してください。") }
        try checkAncestors(root.url)
        let values = try root.url.resourceValues(forKeys: [.isDirectoryKey]); guard values.isDirectory == true else { throw DesktopError("保存先への接続を確認してください。") }
        let id = try libraryID(root.url, initializing: root.initializing)
        if let expected = root.id, id != expected { throw DesktopError("保存先のIDが変わりました。") }
        if root.id == nil { root.id = id }; return root
    }
    func record(_ root: Root?) -> Any {
        guard let root = root else { return NSNull() }
        return ["token": root.token, "secret": root.secret, "revision": root.token, "name": root.url.lastPathComponent]
    }
    func restore() throws -> Root? {
        let file = profile.appendingPathComponent("folder.json")
        if fm.fileExists(atPath: file.path) {
            let value = try desktopObject(regularRead(file, limit: 8192))
            guard desktopSchema(value["schema"]), let path = value["path"] as? String else { throw DesktopError("保存先の記憶を確認してください。") }
            return try register(path, expected: value["id"] as? String)
        }
        let shared = application.appendingPathComponent("GAME-PORTAL-CONNECTION.json")
        if fm.fileExists(atPath: shared.path) {
            let value = try desktopObject(regularRead(shared, limit: 8192))
            guard desktopSchema(value["schema"]), value["kind"] as? String == "relative", let path = value["path"] as? String, !path.isEmpty, !path.hasPrefix("/"), !path.contains("\\"), !path.contains(":"), !path.contains("\0"), path.split(separator: "/", omittingEmptySubsequences: false).count <= 32, let id = value["libraryId"] as? String, desktopID(id) else { throw DesktopError("共有接続設定を確認してください。") }
            return try register(application.appendingPathComponent(path).standardizedFileURL.path, expected: id)
        }
        let hint = application.appendingPathComponent("GAME-PORTAL-FOLDER.txt")
        if fm.fileExists(atPath: hint.path) {
            guard let path = String(data: try regularRead(hint, limit: 8192), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines), !path.isEmpty, !path.contains("\n"), !path.contains("\r") else { throw DesktopError("保存先設定を確認してください。") }
            return try register(path.hasPrefix("/") ? path : application.appendingPathComponent(path).standardizedFileURL.path)
        }
        return nil
    }
    func atomic(_ data: Data, _ destination: URL) throws {
        try checkAncestors(destination)
        let temp = destination.deletingLastPathComponent().appendingPathComponent(".gameportal-" + desktopSecret() + ".tmp")
        let fd = Darwin.open(temp.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw posixError() }; defer { Darwin.close(fd); try? fm.removeItem(at: temp) }
        try writeBytes(data, fd)
        guard fsync(fd) == 0 else { throw posixError() }; try checkAncestors(destination)
        guard Darwin.rename(temp.path, destination.path) == 0 else { throw posixError() }
    }
    func writeBytes(_ data: Data, _ fd: Int32) throws {
        try data.withUnsafeBytes { raw in
            var offset = 0
            while offset < raw.count { let n = Darwin.write(fd, raw.baseAddress!.advanced(by: offset), raw.count - offset); if n < 0 && errno == EINTR { continue }; guard n > 0 else { throw posixError() }; offset += n }
        }
    }
    func remember(_ root: Root) throws {
        var value: [String: Any] = ["schema": 1, "path": root.url.path]
        if let id = root.id { value["id"] = id }
        try atomic(desktopJSON(value), profile.appendingPathComponent("folder.json"))
    }
    func checkWrite(_ path: String, directory: Bool = false) throws {
        if !player { return }
        let allowed = directory ? path == ".gameportal" || path == ".gameportal/shared-saves" || path.range(of: "^\\.gameportal/shared-saves/[a-f0-9]{32}$", options: .regularExpression) != nil : path.range(of: "^\\.gameportal/shared-saves/[a-f0-9]{32}/[a-f0-9]{32}\\.json$", options: .regularExpression) != nil
        guard allowed else { throw DesktopError("ゲームの追加・変更はクリエイター版で行ってください。", "NotAllowedError") }
    }
    func operate(_ data: [String: Any]) throws -> Any {
        let op = data["op"] as? String ?? "", path = data["path"] as? String ?? ""
        if op == "restore" { return record(try restore()) }
        if op == "selectPath" { return record(try register(path)) }
        if op == "forget" { let file = profile.appendingPathComponent("folder.json"); if fm.fileExists(atPath: file.path) { try fm.removeItem(at: file) }; return true }
        guard let token = data["root"] as? String else { throw DesktopError("保存先を選んでください。") }
        if op == "abortWrite" { if let writer = data["writer"] as? String, writers[writer]?.root.token == token { writers.removeValue(forKey: writer) }; return true }
        let root = try get(token), url = try bound(root.url, path, allowRoot: op == "list" || op == "stat" || op == "remember")
        switch op {
        case "remember": try remember(root); return true
        case "stat":
            let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey, .fileSizeKey])
            guard values.isDirectory == true || values.isRegularFile == true else { throw DesktopError("通常のファイルではありません。") }
            return ["kind": values.isDirectory == true ? "directory" : "file", "size": values.isDirectory == true ? 0 : values.fileSize ?? 0] as [String: Any]
        case "list":
            let children = try fm.contentsOfDirectory(at: url, includingPropertiesForKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey]); guard children.count <= 10000 else { throw DesktopError("項目が多すぎます。") }
            return ["entries": try children.compactMap { child -> [String: String]? in let v = try child.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey]); if v.isSymbolicLink == true || !(v.isDirectory == true || v.isRegularFile == true) { return nil }; return ["name": child.lastPathComponent, "kind": v.isDirectory == true ? "directory" : "file"] }]
        case "file", "directory":
            let create = data["create"] as? Bool == true, directory = op == "directory"
            var isDirectory: ObjCBool = false
            if fm.fileExists(atPath: url.path, isDirectory: &isDirectory) { guard isDirectory.boolValue == directory else { throw DesktopError("ファイルとフォルダーの種類が違います。", "TypeMismatchError") }; return true }
            guard create else { throw DesktopError("項目が見つかりません。", "NotFoundError") }; try checkWrite(path, directory: directory)
            if directory { try fm.createDirectory(at: url, withIntermediateDirectories: false) }
            else { let fd = Darwin.open(url.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600); guard fd >= 0 else { throw posixError() }; Darwin.close(fd); if path == ".gameportal/library-id.json" && root.id == nil { root.initializing = true } }; return true
        case "readChunk":
            guard let offset = data["offset"] as? Int, offset >= 0, offset <= desktopLimit else { throw DesktopError("読み込み位置を確認してください。") }
            let fd = Darwin.open(url.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK); guard fd >= 0 else { throw posixError() }; defer { Darwin.close(fd) }
            var info = stat(); guard fstat(fd, &info) == 0, info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), info.st_size <= desktopLimit, offset <= info.st_size else { throw DesktopError("ファイルの大きさを確認してください。") }
            var bytes = [UInt8](repeating: 0, count: min(262144, Int(info.st_size) - offset)); let count = pread(fd, &bytes, bytes.count, off_t(offset)); guard count >= 0 else { throw posixError() }
            return ["data": Data(bytes.prefix(count)).base64EncodedString(), "size": info.st_size] as [String: Any]
        case "beginWrite":
            try checkWrite(path)
            guard !writers.values.contains(where: { $0.root.url == root.url && $0.path == path }) else { throw DesktopError("ほかの画面で保存中です。", "NoModificationAllowedError") }
            let locks = try bound(root.url, ".gameportal/desktop-locks"); try fm.createDirectory(at: locks, withIntermediateDirectories: true)
            let lockPath = locks.appendingPathComponent(desktopHash(path.uppercased()) + ".lock")
            let lock = Darwin.open(lockPath.path, O_RDWR | O_CREAT | O_NOFOLLOW | O_NONBLOCK, 0o600); guard lock >= 0 else { throw posixError() }
            guard flock(lock, LOCK_EX | LOCK_NB) == 0 else { Darwin.close(lock); throw DesktopError("ほかの画面で保存中です。", "NoModificationAllowedError") }
            let temp = url.deletingLastPathComponent().appendingPathComponent(".gameportal-" + desktopSecret() + ".tmp"), fd = Darwin.open(temp.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
            guard fd >= 0 else { Darwin.close(lock); throw posixError() }; let writer = desktopSecret(); writers[writer] = Writer(root, path, temp, fd, lock); return ["token": writer]
        case "writeChunk", "commitWrite":
            guard let key = data["writer"] as? String, let writer = writers[key], writer.root === root, writer.path == path else { throw DesktopError("保存処理が一致しません。") }; try checkWrite(path)
            if op == "writeChunk" {
                guard let text = data["data"] as? String, text.utf8.count <= 349528, let bytes = Data(base64Encoded: text), bytes.count <= 262144, writer.length + bytes.count <= desktopLimit else { throw DesktopError("保存する内容が大きすぎます。") }
                try writeBytes(bytes, writer.descriptor); writer.length += bytes.count; return true
            }
            defer { writers.removeValue(forKey: key) }
            guard fsync(writer.descriptor) == 0 else { throw posixError() }
            if path == ".gameportal/library-id.json" {
                let value = try desktopObject(regularRead(writer.temporary, limit: 1024)); guard desktopSchema(value["schema"]), let id = value["id"] as? String, desktopID(id), root.id == nil || root.id == id else { throw DesktopError("保存先のIDを変更できません。") }
                guard Darwin.rename(writer.temporary.path, url.path) == 0 else { throw posixError() }; root.id = id; root.initializing = false
            } else { guard Darwin.rename(writer.temporary.path, url.path) == 0 else { throw posixError() } }; return true
        case "remove":
            try checkWrite(path); guard path != ".gameportal", path != ".gameportal/library-id.json" else { throw DesktopError("保存先のIDは削除できません。") }
            var directory: ObjCBool = false; guard fm.fileExists(atPath: url.path, isDirectory: &directory) else { throw DesktopError("項目が見つかりません。", "NotFoundError") }
            let recursive = data["recursive"] as? Bool == true
            if directory.boolValue { guard !player else { throw DesktopError("フォルダーは削除できません。", "NotAllowedError") }; if !recursive { let entries = try fm.contentsOfDirectory(atPath: url.path); if !entries.isEmpty { throw DesktopError("フォルダーが空ではありません。") } }; try checkTree(url) }
            try fm.removeItem(at: url); return true
        default: throw DesktopError("この操作は許可していません。", "NotAllowedError")
        }
    }
    func checkTree(_ url: URL) throws {
        try checkAncestors(url)
        for child in try fm.contentsOfDirectory(at: url, includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey]) { let values = try child.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey]); guard values.isSymbolicLink != true else { throw DesktopError("リンクを含むフォルダーは削除できません。") }; if values.isDirectory == true { try checkTree(child) } }
    }
}
