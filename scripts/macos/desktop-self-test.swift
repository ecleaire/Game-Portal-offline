import Foundation
import Darwin

func desktopSelfTest(_ directory: URL) throws {
    let fm = FileManager.default
    try fm.createDirectory(at: directory, withIntermediateDirectories: true)
    let disk = directory.appendingPathComponent("ゲーム # +"), profile = directory.appendingPathComponent("profile")
    try fm.createDirectory(at: disk.appendingPathComponent(".gameportal"), withIntermediateDirectories: true)
    let id = String(repeating: "a", count: 32)
    try desktopJSON(["schema": 1, "id": id]).write(to: disk.appendingPathComponent(".gameportal/library-id.json"))
    let files = try DesktopFiles(profile: profile, application: directory, player: false), root = try files.register(disk.path)
    func check(_ value: Bool, _ message: String) throws { if !value { throw DesktopError("Self test failed: " + message) } }
    func request(_ op: String, _ path: String = "", _ extra: [String: Any] = [:]) throws -> Any {
        var record: [String: Any] = ["op": op, "root": root.token, "path": path]; for (key, value) in extra { record[key] = value }; return try files.operate(record)
    }
    func denied(_ block: () throws -> Void) throws { do { try block() } catch { return }; throw DesktopError("Self test expected rejection") }
    try check(root.id == id, "library identity")
    _ = try request("remember")
    let restored = try DesktopFiles(profile: profile, application: directory, player: false)
    try check(try restored.restore()?.id == id, "folder restoration")
    try denied { _ = try request("file", "../escape", ["create": true]) }
    try fm.createSymbolicLink(atPath: disk.appendingPathComponent("outside").path, withDestinationPath: directory.path)
    try denied { _ = try request("file", "outside/escape", ["create": true]) }
    _ = try request("file", "game.html", ["create": true])
    func begin(_ path: String) throws -> String { guard let result = try request("beginWrite", path) as? [String: String], let writer = result["token"] else { throw DesktopError("Missing writer") }; return writer }
    func chunk(_ writer: String, _ path: String, _ text: String) throws { _ = try request("writeChunk", path, ["writer": writer, "data": Data(text.utf8).base64EncodedString()]) }
    let first = try begin("game.html"); try chunk(first, "game.html", "first"); _ = try request("commitWrite", "game.html", ["writer": first])
    let cancelled = try begin("game.html"); try chunk(cancelled, "game.html", "cancelled")
    try denied { _ = try begin("game.html") }; _ = try request("abortWrite", "", ["writer": cancelled])
    try check(try files.regularRead(disk.appendingPathComponent("game.html"), limit: 100) == Data("first".utf8), "cancel must retain old content")
    let second = try begin("game.html"); try chunk(second, "game.html", "second"); _ = try request("commitWrite", "game.html", ["writer": second])
    let read = try request("readChunk", "game.html", ["offset": 0]) as? [String: Any]
    try check(read?["data"] as? String == Data("second".utf8).base64EncodedString(), "chunk reading")
    try denied { _ = try request("remove", ".gameportal", ["recursive": true]) }
    let identity = try begin(".gameportal/library-id.json"); try chunk(identity, ".gameportal/library-id.json", "{\"schema\":1,\"id\":\"" + String(repeating: "b", count: 32) + "\"}")
    try denied { _ = try request("commitWrite", ".gameportal/library-id.json", ["writer": identity]) }; try check(try files.libraryID(disk) == id, "ID replacement blocked")
    let player = try DesktopFiles(profile: directory.appendingPathComponent("player"), application: directory, player: true), playerRoot = try player.register(disk.path)
    try denied { _ = try player.operate(["op": "beginWrite", "root": playerRoot.token, "path": "game.html"]) }
    try player.checkWrite(".gameportal/shared-saves/" + id + "/" + id + ".json")
    try denied { try player.checkWrite(".gameportal/shared-saves/../library-id.json") }
    try desktopJSON(["schema": true, "id": id]).write(to: disk.appendingPathComponent(".gameportal/library-id.json"))
    try denied { _ = try files.get(root.token) }
    try desktopJSON(["schema": 1, "id": String(repeating: "b", count: 32)]).write(to: disk.appendingPathComponent(".gameportal/library-id.json"))
    try denied { _ = try files.get(root.token) }
    try desktopJSON(["schema": 1, "id": id]).write(to: disk.appendingPathComponent(".gameportal/library-id.json"))
    try desktopJSON(["ok": true, "checks": ["identity", "remember/restore", "traversal", "symlink", "atomic replacement", "write lock", "abort retains bytes", "chunk read", "ID preservation", "player restrictions", "corrupt schema", "changed identity"]]).write(to: directory.appendingPathComponent("result.json"))
    print("Mac native filesystem self tests passed.")
}
