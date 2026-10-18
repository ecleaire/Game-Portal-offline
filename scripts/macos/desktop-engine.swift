import Foundation
import CommonCrypto
import Darwin

struct DesktopEngine { let framework: URL, helper: URL, bundle: URL }
func engineDigest(_ url: URL) throws -> String {
    let input = try FileHandle(forReadingFrom: url); defer { input.closeFile() }
    var context = CC_SHA256_CTX(); CC_SHA256_Init(&context)
    while true { let data = input.readData(ofLength: 1048576); if data.isEmpty { break }; data.withUnsafeBytes { _ = CC_SHA256_Update(&context, $0.baseAddress, CC_LONG(data.count)) } }
    var hash = [UInt8](repeating: 0, count: 32); CC_SHA256_Final(&hash, &context); return hash.map { String(format: "%02x", $0) }.joined()
}
func engineRun(_ executable: String, _ args: [String]) throws -> String {
    let process = Process(), output = Pipe(); process.executableURL = URL(fileURLWithPath: executable); process.arguments = args; process.standardOutput = output; process.standardError = output
    try process.run(); let bytes = output.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
    guard process.terminationStatus == 0 else { throw DesktopError("内蔵エンジンの準備に失敗しました。配布フォルダーを展開し直してください。\n" + String((String(data: bytes, encoding: .utf8) ?? "").prefix(500))) }
    return String(data: bytes, encoding: .utf8) ?? ""
}
func prepareDesktopEngine(bundle: URL, profile: URL) throws -> DesktopEngine {
    #if arch(arm64)
    let architecture = "arm64"
    #else
    let architecture = "x86_64"
    #endif
    let fm = FileManager.default, resources = bundle.appendingPathComponent("Contents/Resources")
    let checks = try DesktopFiles(profile: profile, application: bundle.deletingLastPathComponent(), player: false)
    let manifest = try desktopObject(checks.regularRead(resources.appendingPathComponent("engine.json"), limit: 16384))
    let buildDigest = try engineDigest(resources.appendingPathComponent("build.json"))
    guard desktopSchema(manifest["schema"]), manifest["kind"] as? String == "cef-offline-v1", let targets = manifest["targets"] as? [String: Any], let target = targets[architecture] as? [String: Any], let digest = target["sha256"] as? String, digest.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil, let size = target["size"] as? Int, size > 0, size < 300 * 1024 * 1024, let parts = target["parts"] as? [[String: Any]], !parts.isEmpty, parts.count <= 8 else { throw DesktopError("内蔵エンジンの設定を確認してください。") }
    let destination = profile.appendingPathComponent(architecture + "-" + digest + "-" + buildDigest)
    try checks.checkAncestors(profile); try fm.createDirectory(at: profile, withIntermediateDirectories: true)
    let lockURL = profile.appendingPathComponent(architecture + ".lock"), lock = Darwin.open(lockURL.path, O_RDWR | O_CREAT | O_NOFOLLOW | O_NONBLOCK, 0o600)
    guard lock >= 0 else { throw checks.posixError() }; defer { Darwin.close(lock) }
    var locked = false
    for _ in 0..<600 { if flock(lock, LOCK_EX | LOCK_NB) == 0 { locked = true; break }; Thread.sleep(forTimeInterval: 0.1) }
    guard locked else { throw DesktopError("別のGAME PORTALが起動の準備中です。少し待ってから開き直してください。") }
    let runtimeBundle = destination.appendingPathComponent("GAME PORTAL Runtime.app"), body = runtimeBundle.appendingPathComponent("Contents/Frameworks"), framework = body.appendingPathComponent("Chromium Embedded Framework.framework"), helper = body.appendingPathComponent("GAME PORTAL Helper.app/Contents/MacOS/GAME PORTAL Helper")
    func verifyInstalled() throws {
        try checks.checkAncestors(framework); try checks.checkAncestors(helper)
        _ = try engineRun("/usr/bin/codesign", ["--verify", "--deep", "--strict", framework.path])
        _ = try engineRun("/usr/bin/codesign", ["--verify", "--deep", "--strict", helper.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().path])
    }
    if fm.fileExists(atPath: destination.appendingPathComponent("ready.json").path) {
        let ready = try desktopObject(checks.regularRead(destination.appendingPathComponent("ready.json"), limit: 1024))
        guard ready["sha256"] as? String == digest, ready["build"] as? String == buildDigest else { throw DesktopError("内蔵エンジンの記録を確認してください。") }; try verifyInstalled(); return DesktopEngine(framework: framework, helper: helper, bundle: runtimeBundle)
    }
    // The engine is included in the downloaded Mac folder; never downloaded at runtime.
    let packRoot = bundle.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("_内部ファイル/engine/" + architecture)
    guard fm.fileExists(atPath: packRoot.path) else { throw DesktopError("内蔵エンジンが見つかりません。ダウンロードした「Mac」フォルダーを、内部ファイルも含めてまとめて保管してください。") }
    let staging = profile.appendingPathComponent(".install-" + desktopSecret()), archive = staging.appendingPathComponent("engine.zip")
    try fm.createDirectory(at: staging, withIntermediateDirectories: false); defer { try? fm.removeItem(at: staging) }
    guard fm.createFile(atPath: archive.path, contents: nil) else { throw DesktopError("内蔵エンジンを準備する保存場所を確認してください。") }
    let output = try FileHandle(forWritingTo: archive); var total = 0
    do {
        for (index, part) in parts.enumerated() {
            guard let name = part["name"] as? String, name == String(format: "engine.part%02d", index), let expected = part["sha256"] as? String, expected.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil, let count = part["size"] as? Int, count > 0, count <= 40 * 1024 * 1024 else { throw DesktopError("内蔵エンジンのファイル一覧を確認してください。") }
            let file = try checks.bound(packRoot, name), bytes = try checks.regularRead(file, limit: 40 * 1024 * 1024)
            guard bytes.count == count, try engineDigest(file) == expected else { throw DesktopError("内蔵エンジンのファイルが不足しているか壊れています。ZIPを展開し直してください。") }
            output.write(bytes); total += bytes.count
        }
        output.synchronizeFile(); output.closeFile()
    } catch { output.closeFile(); throw error }
    guard total == size, try engineDigest(archive) == digest else { throw DesktopError("内蔵エンジンの確認に失敗しました。") }
    let entries = try engineRun("/usr/bin/unzip", ["-Z1", archive.path]).split(separator: "\n")
    guard !entries.isEmpty, entries.count < 10000, entries.allSatisfy({ $0.hasPrefix("engine/") && !$0.split(separator: "/").contains("..") && !$0.contains("\\") }) else { throw DesktopError("内蔵エンジンの展開先を確認してください。") }
    _ = try engineRun("/usr/bin/ditto", ["-x", "-k", archive.path, staging.path])
    try fm.removeItem(at: archive)
    // The CEF sandbox expects framework and helper apps inside its main bundle.
    // Assemble a signed runtime bundle instead of weakening the subprocess sandbox.
    let stagedBundle = staging.appendingPathComponent("GAME PORTAL Runtime.app"), frameworks = stagedBundle.appendingPathComponent("Contents/Frameworks"), unpacked = staging.appendingPathComponent("engine")
    try fm.copyItem(at: bundle, to: stagedBundle); try fm.createDirectory(at: frameworks, withIntermediateDirectories: true)
    for item in try fm.contentsOfDirectory(at: unpacked, includingPropertiesForKeys: nil) {
        let parent = item.lastPathComponent == "CEF-LICENSE.txt" ? stagedBundle.appendingPathComponent("Contents/Resources") : frameworks
        try fm.moveItem(at: item, to: parent.appendingPathComponent(item.lastPathComponent))
    }
    try fm.removeItem(at: unpacked)
    _ = try engineRun("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", stagedBundle.path])
    guard !fm.fileExists(atPath: destination.path) else { throw DesktopError("前回の起動準備が完了していません。アプリを閉じてからもう一度開いてください。") }
    try fm.moveItem(at: staging, to: destination)
    do { try verifyInstalled(); try desktopJSON(["schema": 1, "sha256": digest, "build": buildDigest]).write(to: destination.appendingPathComponent("ready.json"), options: .atomic) }
    catch { try? fm.removeItem(at: destination); throw error }
    return DesktopEngine(framework: framework, helper: helper, bundle: runtimeBundle)
}
