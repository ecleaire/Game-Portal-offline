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
    let sharedFile = directory.appendingPathComponent("GAME-PORTAL-CONNECTION.json")
    try check(fm.fileExists(atPath: sharedFile.path), "shared default was published: " + files.connectionHint)
    let sharedBefore = try files.regularRead(sharedFile, limit: 8192)
    _ = try files.operate(["op": "forget"]); _ = try files.operate(["op": "forget"])
    try check(try DesktopFiles(profile: profile, application: directory, player: false).restore() == nil, "forgotten folder stays forgotten after restart")
    try check(try files.regularRead(sharedFile, limit: 8192) == sharedBefore, "forget preserves shared default")
    try check(try DesktopFiles(profile: directory.appendingPathComponent("unaffected"), application: directory, player: false).restore()?.id == id, "forget does not affect another profile")
    try files.remember(root)
    try check(try DesktopFiles(profile: profile, application: directory, player: false).restore()?.id == id, "explicit selection resumes remembering")
    let hintApp = directory.appendingPathComponent("hint-app"), hintProfile = directory.appendingPathComponent("hint-profile")
    try fm.createDirectory(at: hintApp, withIntermediateDirectories: true)
    try Data(disk.path.utf8).write(to: hintApp.appendingPathComponent("GAME-PORTAL-FOLDER.txt"))
    let hinted = try DesktopFiles(profile: hintProfile, application: hintApp, player: true)
    try check(try hinted.restore()?.id == id, "legacy folder hint works initially")
    _ = try hinted.operate(["op": "forget"])
    try check(try DesktopFiles(profile: hintProfile, application: hintApp, player: true).restore() == nil, "forget also suppresses legacy hint")
    try denied { _ = try request("file", "../escape", ["create": true]) }
    try fm.createSymbolicLink(atPath: disk.appendingPathComponent("outside").path, withDestinationPath: directory.path)
    try denied { _ = try request("file", "outside/escape", ["create": true]) }
    _ = try request("file", "game.html", ["create": true])
    func begin(_ path: String) throws -> String { guard let result = try request("beginWrite", path) as? [String: String], let writer = result["token"] else { throw DesktopError("Missing writer") }; return writer }
    func chunk(_ writer: String, _ path: String, _ text: String) throws { _ = try request("writeChunk", path, ["writer": writer, "data": Data(text.utf8).base64EncodedString()]) }
    let first = try begin("game.html"); try chunk(first, "game.html", "first"); _ = try request("commitWrite", "game.html", ["writer": first])
    let cancelled = try begin("game.html"); try chunk(cancelled, "game.html", "cancelled")
    let peer = try DesktopFiles(profile: directory.appendingPathComponent("peer"), application: directory, player: false), peerRoot = try peer.register(disk.path)
    try denied { _ = try peer.operate(["op": "beginWrite", "root": peerRoot.token, "path": "game.html"]) }
    try denied { _ = try begin("game.html") }; _ = try request("abortWrite", "", ["writer": cancelled])
    try check(try files.regularRead(disk.appendingPathComponent("game.html"), limit: 100) == Data("first".utf8), "cancel must retain old content")
    try fm.setAttributes([.posixPermissions: 0o640], ofItemAtPath: disk.appendingPathComponent("game.html").path)
    let second = try begin("game.html"); try chunk(second, "game.html", "second"); _ = try request("commitWrite", "game.html", ["writer": second])
    try check((try fm.attributesOfItem(atPath: disk.appendingPathComponent("game.html").path)[.posixPermissions] as? NSNumber)?.intValue == 0o640, "atomic replacement preserves permissions")
    let beginRead = try request("beginRead", "game.html") as! [String: Any]
    let reader = beginRead["reader"] as! String
    let read = try request("readChunk", "", ["offset": 0, "reader": reader]) as? [String: Any]
    _ = try request("endRead", "", ["reader": reader])
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
    let blank = directory.appendingPathComponent("初回フォルダー")
    try fm.createDirectory(at: blank.appendingPathComponent(".gameportal"), withIntermediateDirectories: true)
    let initial = try files.register(blank.path)
    _ = try files.operate(["op": "file", "root": initial.token, "path": ".gameportal/library-id.json", "create": true])
    let pending = try files.operate(["op": "beginWrite", "root": initial.token, "path": ".gameportal/library-id.json"]) as! [String: String]
    let empty = try files.operate(["op": "beginRead", "root": initial.token, "path": ".gameportal/library-id.json"]) as! [String: Any]
    try check(empty["size"] as? Int == 0, "initial ID is virtually empty")
    _ = try files.operate(["op": "endRead", "root": initial.token, "reader": empty["reader"]!])
    _ = try files.operate(["op": "abortWrite", "root": initial.token, "writer": pending["token"]!])
    try check(!fm.fileExists(atPath: blank.appendingPathComponent(".gameportal/library-id.json").path), "cancelled initial setup must not leave a corrupt ID")
    let spaced = directory.appendingPathComponent("末尾の空白 ")
    try fm.createDirectory(at: spaced, withIntermediateDirectories: true)
    let spacedRoot = try files.register(spaced.path)
    try check(spacedRoot.url.lastPathComponent == spaced.lastPathComponent, "folder names retain trailing spaces: " + spacedRoot.url.lastPathComponent)
    try Data("space-folder".utf8).write(to: spaced.appendingPathComponent("marker.txt"))
    try check(try files.regularRead(files.bound(spacedRoot.url, "marker.txt"), limit: 100) == Data("space-folder".utf8), "selected folder resolves to the correct contents")
    let stalled = DispatchSemaphore(value: 0), entered = DispatchSemaphore(value: 0), progressed = DispatchSemaphore(value: 0)
    root.work.async { entered.signal(); stalled.wait() }; defer { stalled.signal() }
    try check(entered.wait(timeout: .now() + 2) == .success, "first folder queue started")
    initial.work.async { progressed.signal() }
    try check(progressed.wait(timeout: .now() + 2) == .success, "a stalled folder must not block a different folder")
    try desktopJSON(["ok": true, "checks": ["identity", "remember/restore", "traversal", "symlink", "atomic replacement", "write lock", "abort retains bytes", "chunk read", "ID preservation", "player restrictions", "corrupt schema", "changed identity"]]).write(to: directory.appendingPathComponent("result.json"))
    print("Mac native filesystem self tests passed.")
}
