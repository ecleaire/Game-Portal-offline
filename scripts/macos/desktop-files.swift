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
func desktopID(_ value: String) -> Bool { return value.utf8.count == 32 && value.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil }
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

// A blocked NAS must not block a different selected folder. Registry locks are
// short-lived; filesystem calls run on each root's own queue, never under a lock.
final class DesktopFiles {
    final class Reader {
        let root: Root, descriptor: Int32, before: stat
        var offset = 0
        init(_ root: Root, _ descriptor: Int32, _ before: stat) { self.root = root; self.descriptor = descriptor; self.before = before }
        deinit { if descriptor >= 0 { Darwin.close(descriptor) } }
    }
    final class Root {
        let url: URL, token = desktopSecret(), secret = desktopSecret()
        let work: DispatchQueue
        private let gate = NSLock()
        private var storedID: String?
        var id: String? { get { gate.lock(); defer { gate.unlock() }; return storedID } set { gate.lock(); storedID = newValue; gate.unlock() } }
        init(_ url: URL, _ id: String?) { self.url = url; storedID = id; work = DispatchQueue(label: "gameportal.folder." + UUID().uuidString) }
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
    private var roots = [String: Root](), writers = [String: Writer](), readers = [String: Reader]()
    private let stateGate = NSRecursiveLock()
    private var hint = ""
    var connectionHint: String { get { return state { hint } } set { state { hint = newValue } } }
    func state<T>(_ operation: () -> T) -> T { stateGate.lock(); defer { stateGate.unlock() }; return operation() }
    var hasWriters: Bool { return state { !writers.isEmpty } }
    func work(for token: String) -> DispatchQueue? { return state { roots[token]?.work } }
    func removeReader(_ token: String) { let removed = state { readers.removeValue(forKey: token) }; withExtendedLifetime(removed) {} }
    func removeWriter(_ token: String) { let removed = state { writers.removeValue(forKey: token) }; withExtendedLifetime(removed) {} }
    init(profile: URL, application: URL, player: Bool) throws {
        self.profile = profile; self.application = application.standardizedFileURL; self.player = player
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
        // Foundation may standardize /private/var back to the macOS /var alias.
        // Resolve only Apple's fixed system aliases; user-created links stay denied.
        let path = url.path
        let systemAlias = ["/var", "/tmp", "/etc"].contains(where: { path == $0 || path.hasPrefix($0 + "/") })
        let checked = URL(fileURLWithPath: systemAlias ? "/private" + path : path)
        var current = URL(fileURLWithPath: "/", isDirectory: true)
        for part in checked.pathComponents.dropFirst() {
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
            guard !part.isEmpty, part != ".", part != "..", part.utf16.count <= 255, !part.contains("\\"), !part.contains(where: { $0.asciiValue.map { $0 < 32 } == true }) else { throw DesktopError("保存先の外は操作できません。") }
            url.appendPathComponent(String(part))
        }
        try checkAncestors(url); return url
    }
    func libraryID(_ url: URL) throws -> String? {
        let file = try bound(url, ".gameportal/library-id.json")
        guard fm.fileExists(atPath: file.path) else { return nil }
        let bytes = try regularRead(file, limit: 1024)
        let record = try desktopObject(bytes)
        guard desktopSchema(record["schema"]), let id = record["id"] as? String, desktopID(id) else { throw DesktopError("保存先のID設定が壊れています。") }; return id
    }
    func register(_ path: String, expected: String? = nil) throws -> Root {
        var path = path
        if !path.hasPrefix("/") { path = path.trimmingCharacters(in: .whitespacesAndNewlines) }
        if path.hasPrefix("\""), path.hasSuffix("\""), path.count > 1 { path = String(path.dropFirst().dropLast()) }
        guard path.hasPrefix("/"), path.utf8.count <= 4000, !path.contains("\0") else { throw DesktopError("Finderからコピーしたフォルダーのフルパスを入力してください。") }
        let url = URL(fileURLWithPath: path).standardizedFileURL; try checkAncestors(url)
        let values = try url.resourceValues(forKeys: [.isDirectoryKey]); guard values.isDirectory == true else { throw DesktopError("保存先フォルダーを選んでください。", "TypeMismatchError") }
        let id = try libraryID(url)
        if let expected = expected, expected != id { throw DesktopError("保存先のIDが変わりました。元の保存先を確認してください。") }
        return state {
            if let known = roots.values.first(where: { $0.url == url && $0.id == id }) { return known }
            let root = Root(url, id); roots[root.token] = root; return root
        }
    }
    func get(_ token: String) throws -> Root {
        guard let root = state({ roots[token] }) else { throw DesktopError("保存先に接続し直してください。") }
        try checkAncestors(root.url)
        let values = try root.url.resourceValues(forKeys: [.isDirectoryKey]); guard values.isDirectory == true else { throw DesktopError("保存先への接続を確認してください。") }
        let id = try libraryID(root.url)
        if let expected = root.id, id != expected { throw DesktopError("保存先のIDが変わりました。") }
        if root.id == nil { root.id = id }; return root
    }
    func record(_ root: Root?) -> Any {
        guard let root = root else { return NSNull() }
        return ["token": root.token, "secret": root.secret, "revision": root.token, "name": root.url.lastPathComponent, "connectionHint": connectionHint]
    }
    func restore() throws -> Root? {
        let file = profile.appendingPathComponent("folder.json")
        if fm.fileExists(atPath: file.path) {
            let value = try desktopObject(regularRead(file, limit: 8192))
            guard desktopSchema(value["schema"]) else { throw DesktopError("保存先の記憶を確認してください。") }
            // Forget only on this profile; preserve shared settings for peers.
            if let forgotten = value["forgotten"] as? NSNumber, CFGetTypeID(forgotten) == CFBooleanGetTypeID(), forgotten.boolValue, value["path"] == nil, value["id"] == nil { return nil }
            guard let path = value["path"] as? String else { throw DesktopError("保存先の記憶を確認してください。") }
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
    func atomic(_ data: Data, _ destination: URL, mode: mode_t = 0o600) throws {
        try checkAncestors(destination)
        let temp = destination.deletingLastPathComponent().appendingPathComponent(".gameportal-" + desktopSecret() + ".tmp")
        let fd = Darwin.open(temp.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, mode)
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
        try rememberShared(root)
    }
    func rememberShared(_ root: Root) throws {
        connectionHint = ""
        guard let id = root.id else { return }
        do {
            let shared = application.appendingPathComponent("GAME-PORTAL-CONNECTION.json")
            if fm.fileExists(atPath: shared.path) {
                try checkAncestors(shared)
                let value = try desktopObject(regularRead(shared, limit: 8192))
                guard desktopSchema(value["schema"]), value["kind"] as? String == "relative", let path = value["path"] as? String, !path.isEmpty, !path.hasPrefix("/"), !path.contains("\\"), !path.contains(":"), !path.contains("\0"), !path.contains("\n"), !path.contains("\r"), path.split(separator: "/", omittingEmptySubsequences: false).count <= 32, let expected = value["libraryId"] as? String, desktopID(expected) else { throw DesktopError("共有接続設定を確認してください。") }
                let registered = try register(application.appendingPathComponent(path).standardizedFileURL.path, expected: expected)
                if registered.id != root.id || registered.url != root.url { connectionHint = "このMacの保存先を記憶しました。共有の保存先は変更していません。" }; return
            }
            let descendant = root.url.path == application.path || root.url.path.hasPrefix(application.path + "/")
            var first = stat(), second = stat()
            let local = try application.resourceValues(forKeys: [.volumeIsLocalKey]).volumeIsLocal ?? true
            guard descendant || !local && lstat(application.path, &first) == 0 && lstat(root.url.path, &second) == 0 && first.st_dev == second.st_dev else { return }
            let from = application.pathComponents, to = root.url.pathComponents
            var common = 0; while common < min(from.count, to.count) && from[common] == to[common] { common += 1 }
            let components = Array(repeating: "..", count: from.count - common) + Array(to.dropFirst(common)), path = components.isEmpty ? "." : components.joined(separator: "/")
            guard path.utf8.count <= 1000, components.count <= 32, !path.contains(":"), !path.contains("\\"), !path.contains("\n"), !path.contains("\r") else { return }
            let temporary = application.appendingPathComponent("GAME-PORTAL-CONNECTION.json." + desktopSecret() + ".tmp")
            defer { try? fm.removeItem(at: temporary) }
            try atomic(desktopJSON(["schema": 1, "kind": "relative", "path": path, "libraryId": id]), temporary, mode: 0o666)
            // Hard-link publication is exclusive: never replace another PC's choice.
            guard Darwin.link(temporary.path, shared.path) == 0 else { if errno == EEXIST { return }; throw posixError() }
            connectionHint = "保存先を共有しました。同じ場所のアプリを開くPCで使えます。"
        } catch { connectionHint = "このMacには記憶しました。接続先をほかのPCへ共有できませんでした：" + ((error as? DesktopError)?.message ?? error.localizedDescription) }
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
        if op == "forget" { try atomic(desktopJSON(["schema": 1, "forgotten": true]), profile.appendingPathComponent("folder.json")); return true }
        if op == "cancelReads" { let removed = state { let values = Array(readers.values); readers.removeAll(); return values }; withExtendedLifetime(removed) {}; return true }
        guard let token = data["root"] as? String else { throw DesktopError("保存先を選んでください。") }
        if ["readChunk", "endRead", "abortRead"].contains(op) {
            guard let key = data["reader"] as? String, let reader = state({ readers[key] }), reader.root.token == token else { throw DesktopError("読み込みが終了したため、もう一度開いてください。") }
            if op == "abortRead" { removeReader(key); return true }
            if op == "endRead" {
                defer { removeReader(key) }; _ = try get(token)
                if reader.descriptor < 0 { guard !fm.fileExists(atPath: reader.root.url.appendingPathComponent(".gameportal/library-id.json").path) else { throw DesktopError("初期設定中に別の更新がありました。") }; return true }
                var after = stat(); guard fstat(reader.descriptor, &after) == 0, after.st_size == reader.before.st_size, after.st_mtimespec.tv_sec == reader.before.st_mtimespec.tv_sec, after.st_mtimespec.tv_nsec == reader.before.st_mtimespec.tv_nsec, reader.offset == Int(after.st_size) else { throw DesktopError("読み込み中にファイルが変わりました。もう一度開いてください。") }; return true
            }
            guard let offset = data["offset"] as? Int, offset == reader.offset else { throw DesktopError("読み込み位置を確認してください。") }
            if reader.descriptor < 0 { return ["data": "", "size": 0] as [String: Any] }
            var bytes = [UInt8](repeating: 0, count: min(1048576, Int(reader.before.st_size) - offset))
            let count = Darwin.read(reader.descriptor, &bytes, bytes.count); guard count >= 0 else { throw posixError() }; reader.offset += count
            return ["data": Data(bytes.prefix(count)).base64EncodedString(), "size": reader.before.st_size] as [String: Any]
        }
        if op == "abortWrite" { if let writer = data["writer"] as? String, state({ writers[writer]?.root.token }) == token { removeWriter(writer) }; return true }
        let root = try get(token), url = try bound(root.url, path, allowRoot: op == "list" || op == "stat" || op == "remember")
        switch op {
        case "remember": try remember(root); return true
        case "stat":
            let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey, .fileSizeKey])
            guard values.isDirectory == true || values.isRegularFile == true else { throw DesktopError("通常のファイルではありません。") }
            return ["kind": values.isDirectory == true ? "directory" : "file", "size": values.isDirectory == true ? 0 : values.fileSize ?? 0] as [String: Any]
        case "list":
            let children = try fm.contentsOfDirectory(at: url, includingPropertiesForKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey]); guard children.count <= 10000 else { throw DesktopError("項目が多すぎます。") }
            return ["entries": try children.compactMap { child -> [String: String]? in
                if child.lastPathComponent.range(of: "\\.gameportal\\.json(?:~RF[0-9a-f]{1,32}\\.tmp|\\.desktop-[0-9a-f]{64}\\.tmp|\\.crswap)$", options: [.regularExpression, .caseInsensitive]) != nil { return nil }
                let v = try child.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey]); if v.isSymbolicLink == true || !(v.isDirectory == true || v.isRegularFile == true) { return nil }; return ["name": child.lastPathComponent, "kind": v.isDirectory == true ? "directory" : "file"] }]
        case "file", "directory":
            let create = data["create"] as? Bool == true, directory = op == "directory"
            var isDirectory: ObjCBool = false
            if fm.fileExists(atPath: url.path, isDirectory: &isDirectory) { guard isDirectory.boolValue == directory else { throw DesktopError("ファイルとフォルダーの種類が違います。", "TypeMismatchError") }; return true }
            guard create else { throw DesktopError("項目が見つかりません。", "NotFoundError") }; try checkWrite(path, directory: directory)
            if directory { try fm.createDirectory(at: url, withIntermediateDirectories: false) }
            else {
                // Do not leave an empty, corrupt library ID when setup is cancelled.
                // The exclusive writer can read its own virtual empty ID before commit.
                if path == ".gameportal/library-id.json" && root.id == nil { return true }
                let fd = Darwin.open(url.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o666); guard fd >= 0 else { throw posixError() }; Darwin.close(fd)
            }; return true
        case "beginRead":
            guard state({ readers.count }) < 8 else { throw DesktopError("読み込み中のゲームを中止してから、もう一度開いてください。") }
            if path == ".gameportal/library-id.json" && root.id == nil && !fm.fileExists(atPath: url.path) && state({ writers.values.contains(where: { $0.root === root && $0.path == path }) }) {
                let key = desktopSecret(); state { readers[key] = Reader(root, -1, stat()) }; return ["reader": key, "size": 0] as [String: Any]
            }
            let fd = Darwin.open(url.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK); guard fd >= 0 else { throw posixError() }
            var info = stat(); guard fstat(fd, &info) == 0, info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), info.st_size >= 0, info.st_size <= desktopLimit else { Darwin.close(fd); throw DesktopError("ファイルの大きさを確認してください。") }
            let key = desktopSecret(); state { readers[key] = Reader(root, fd, info) }; return ["reader": key, "size": info.st_size] as [String: Any]
        case "beginWrite":
            try checkWrite(path)
            guard !state({ writers.values.contains(where: { $0.root.url == root.url && $0.path == path }) }) else { throw DesktopError("ほかの画面で保存中です。", "NoModificationAllowedError") }
            let locks = try bound(root.url, ".gameportal/desktop-locks"); try fm.createDirectory(at: locks, withIntermediateDirectories: true)
            let lockPath = locks.appendingPathComponent(desktopHash(path.uppercased()) + ".lock")
            let lock = Darwin.open(lockPath.path, O_RDWR | O_CREAT | O_NOFOLLOW | O_NONBLOCK, 0o666); guard lock >= 0 else { throw posixError() }
            var lockInfo = stat(); guard fstat(lock, &lockInfo) == 0, lockInfo.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG) else { Darwin.close(lock); throw DesktopError("保存用のロックファイルを確認してください。") }
            guard flock(lock, LOCK_EX | LOCK_NB) == 0 else { Darwin.close(lock); throw DesktopError("ほかの画面で保存中です。", "NoModificationAllowedError") }
            var existing = stat(); let exists = lstat(url.path, &existing) == 0
            guard !exists || existing.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG) else { Darwin.close(lock); throw DesktopError("通常のファイルではありません。") }
            let temp = url.deletingLastPathComponent().appendingPathComponent(".gameportal-" + desktopSecret() + ".tmp"), fd = Darwin.open(temp.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o666)
            guard fd >= 0 else { Darwin.close(lock); throw posixError() }
            if exists && fchmod(fd, existing.st_mode & mode_t(0o777)) != 0 { Darwin.close(fd); Darwin.close(lock); try? fm.removeItem(at: temp); throw posixError() }
            let writer = desktopSecret(); state { writers[writer] = Writer(root, path, temp, fd, lock) }; return ["token": writer]
        case "writeChunk", "commitWrite":
            guard let key = data["writer"] as? String, let writer = state({ writers[key] }), writer.root === root, writer.path == path else { throw DesktopError("保存処理が一致しません。") }; try checkWrite(path)
            if op == "writeChunk" {
                guard let text = data["data"] as? String, text.utf8.count <= 349528, let bytes = Data(base64Encoded: text), bytes.count <= 262144, writer.length + bytes.count <= desktopLimit else { throw DesktopError("保存する内容が大きすぎます。") }
                try writeBytes(bytes, writer.descriptor); writer.length += bytes.count; return true
            }
            defer { removeWriter(key) }
            guard fsync(writer.descriptor) == 0 else { throw posixError() }
            if path == ".gameportal/library-id.json" {
                let value = try desktopObject(regularRead(writer.temporary, limit: 1024)); guard desktopSchema(value["schema"]), let id = value["id"] as? String, desktopID(id), root.id == nil || root.id == id else { throw DesktopError("保存先のIDを変更できません。") }
                guard Darwin.rename(writer.temporary.path, url.path) == 0 else { throw posixError() }; root.id = id
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
