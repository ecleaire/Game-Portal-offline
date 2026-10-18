import Foundation
import CoreFoundation
import AppKit
import Network
import Darwin

@_silgen_name("portal_cef_application") func portal_cef_application()
@_silgen_name("portal_cef_initialize") func portal_cef_initialize(_ framework: UnsafePointer<CChar>, _ helper: UnsafePointer<CChar>, _ profile: UnsafePointer<CChar>, _ bundle: UnsafePointer<CChar>, _ callback: @convention(c) (UnsafePointer<CChar>?) -> Void) -> Bool
@_silgen_name("portal_cef_open") func portal_cef_open(_ parent: UnsafeMutableRawPointer, _ url: UnsafePointer<CChar>) -> Bool
@_silgen_name("portal_cef_evaluate") func portal_cef_evaluate(_ script: UnsafePointer<CChar>)
@_silgen_name("portal_cef_resize") func portal_cef_resize()
@_silgen_name("portal_cef_close") func portal_cef_close()
@_silgen_name("portal_cef_shutdown") func portal_cef_shutdown()
let desktopVersion = "__VERSION__"
let desktopEdition = Bundle.main.object(forInfoDictionaryKey: "GamePortalEdition") as? String ?? "creator"
var desktopInstance: PortalDesktop?
func desktopMainRunLoop(_ operation: @escaping () -> Void) {
    CFRunLoopPerformBlock(CFRunLoopGetMain(), CFRunLoopMode.commonModes.rawValue, operation)
    CFRunLoopWakeUp(CFRunLoopGetMain())
}
@_cdecl("portal_swift_callback") func portalSwiftCallback(_ pointer: UnsafePointer<CChar>?) {
    guard let pointer = pointer, let bytes = String(cString: pointer).data(using: .utf8), bytes.count <= 400000, let value = try? desktopObject(bytes) else { return }
    if Thread.isMainThread { desktopInstance?.message(value) } else { DispatchQueue.main.async { desktopInstance?.message(value) } }
}
final class PortalDesktop: NSObject, NSApplicationDelegate, NSWindowDelegate {
    let io = DispatchQueue(label: "gameportal.desktop.files"), network = DispatchQueue(label: "gameportal.desktop.http")
    let profile: URL, application: URL, files: DesktopFiles, testMode: Bool
    let testScript: URL?, resultFile: URL?, readyFile: URL?
    var view: NSView!, window: NSWindow!, listener: NWListener!, page: Data
    var appURL: URL!, closing = false, closePending = false, testStarted = false, engineReady = false, browserClosed = false
    var closeTimer: DispatchWorkItem?, connections = 0, droppedFolder: (String, Date)?
    var pendingWrites = 0
    var fullscreenFromGame = false
    var installedProcess: Process?
    init(profile: URL, application: URL, testMode: Bool, library: String?, testScript: URL?, resultFile: URL?, readyFile: URL?) throws {
        self.profile = profile; self.application = application; self.testMode = testMode; self.testScript = testScript; self.resultFile = resultFile; self.readyFile = readyFile
        files = try DesktopFiles(profile: profile, application: application, player: desktopEdition == "player")
        guard let resource = Bundle.main.url(forResource: "GAME-PORTAL-DESKTOP", withExtension: "html") else { throw DesktopError("アプリ内の画面がありません。ZIPを展開し直してください。") }
        page = try Data(contentsOf: resource); super.init(); desktopInstance = self
        if let library = library { let root = try files.register(library); try files.remember(root) }
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            let portFile = profile.appendingPathComponent("port.json"); var savedPort: UInt16?
            if FileManager.default.fileExists(atPath: portFile.path) {
                let data = try desktopObject(files.regularRead(portFile, limit: 1024))
                guard let port = data["port"] as? Int, port >= 1024, port <= 65535 else { throw DesktopError("アプリの接続設定を確認してください。") }; savedPort = UInt16(port)
            }
            let parameters = NWParameters.tcp
            parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: savedPort.flatMap { NWEndpoint.Port(rawValue: $0) } ?? .any)
            listener = try NWListener(using: parameters); listener.newConnectionHandler = { [weak self] in self?.receive($0) }
            listener.stateUpdateHandler = { [weak self] state in
                guard let self = self else { return }
                switch state {
                case .ready:
                    guard let port = self.listener.port?.rawValue else { return }; self.appURL = URL(string: "http://127.0.0.1:\(port)/index.html")!
                    do { if savedPort == nil { try self.files.atomic(desktopJSON(["port": Int(port)]), portFile) }; desktopMainRunLoop { self.show() } } catch { DispatchQueue.main.async { self.fail(error) } }
                case .failed(let error): DispatchQueue.main.async { self.fail(DesktopError("アプリの接続を開始できません。別のGAME PORTALを閉じてから開き直してください。\n" + error.localizedDescription)) }
                default: break
                }
            }; listener.start(queue: network)
        } catch { fail(error) }
    }
    func show() {
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1280, height: 800)
        view = NSView(frame: NSRect(x: 0, y: 0, width: min(1200, max(600, screen.width - 40)), height: min(820, max(400, screen.height - 64))))
        window = NSWindow(contentRect: view.bounds, styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "GAME PORTAL " + (desktopEdition == "player" ? "プレイ専用" : "クリエイター")
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 640, height: 480); window.contentView = view; window.delegate = self; window.center(); installMenu()
        NSApplication.shared.setActivationPolicy(.regular)
        let preparing = NSTextField(labelWithString: "起動の準備をしています…（初回のみ少し時間がかかります）")
        preparing.frame = NSRect(x: 40, y: view.bounds.height / 2 - 20, width: view.bounds.width - 80, height: 40); preparing.autoresizingMask = [.width, .minYMargin, .maxYMargin]; preparing.font = NSFont.systemFont(ofSize: 16); view.addSubview(preparing)
        window.makeKeyAndOrderFront(nil); NSApplication.shared.activate(ignoringOtherApps: true)
        let bundledFramework = Bundle.main.bundleURL.appendingPathComponent("Contents/Frameworks/Chromium Embedded Framework.framework")
        if FileManager.default.fileExists(atPath: bundledFramework.appendingPathComponent("Chromium Embedded Framework").path) {
            guard portal_cef_initialize(bundledFramework.path, Bundle.main.bundleURL.appendingPathComponent("Contents/Frameworks/GAME PORTAL Helper.app/Contents/MacOS/GAME PORTAL Helper").path, profile.appendingPathComponent("Chromium").path, Bundle.main.bundleURL.path, portalSwiftCallback) else { fail(DesktopError("内蔵の表示エンジンを開始できませんでした。")); return }
            engineReady = true; preparing.removeFromSuperview(); return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let engine = try prepareDesktopEngine(bundle: Bundle.main.bundleURL, profile: self.profile.deletingLastPathComponent().appendingPathComponent("runtime"), application: self.application)
                DispatchQueue.main.async {
                    if self.closing { return }
                    self.listener.cancel()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { do { try self.runInstalled(engine.bundle) } catch { self.fail(error) } }
                }
            } catch { DispatchQueue.main.async { self.fail(error) } }
        }
    }
    func runInstalled(_ bundle: URL) throws {
        guard let name = Bundle.main.object(forInfoDictionaryKey: "CFBundleExecutable") as? String else { throw DesktopError("アプリの起動ファイルを確認してください。") }
        let executable = bundle.appendingPathComponent("Contents/MacOS/" + name)
        // A running Cocoa application has registered Mach/LaunchServices state.
        // Start the signed runtime in a fresh process instead of exec'ing over
        // that state; keep the bootstrap alive until the native window closes.
        let process = Process(); process.executableURL = executable
        process.arguments = Array(CommandLine.arguments.dropFirst()) + ["--profile", profile.path, "--application-directory", application.path]
        process.standardOutput = FileHandle.standardOutput; process.standardError = FileHandle.standardError
        process.terminationHandler = { child in DispatchQueue.main.async {
            self.installedProcess = nil; self.closing = true
            let status = child.terminationReason == .uncaughtSignal ? 128 + child.terminationStatus : child.terminationStatus
            if self.testMode { exit(status) }
            if status != 0 { self.notice("アプリを終了しました", "画面の処理が停止しました。GAME PORTALをもう一度開いてください。保存済みのゲームや作品情報はそのまま残っています。") }
            NSApplication.shared.terminate(nil)
        } }
        installedProcess = process; try process.run(); window.orderOut(nil); NSApplication.shared.setActivationPolicy(.accessory)
    }
    func installMenu() {
        let main = NSMenu(), appItem = NSMenuItem(), appMenu = NSMenu()
        appMenu.addItem(withTitle: "GAME PORTALを終了", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"); appItem.submenu = appMenu; main.addItem(appItem)
        let editItem = NSMenuItem(), edit = NSMenu(title: "編集")
        for (title, action, key) in [("元に戻す", "undo:", "z"), ("切り取り", "cut:", "x"), ("コピー", "copy:", "c"), ("貼り付け", "paste:", "v"), ("すべて選択", "selectAll:", "a")] { edit.addItem(withTitle: title, action: Selector(action), keyEquivalent: key) }; editItem.submenu = edit; main.addItem(editItem)
        let windowItem = NSMenuItem(), windowMenu = NSMenu(title: "ウィンドウ"); windowMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"); windowItem.submenu = windowMenu; main.addItem(windowItem); NSApplication.shared.mainMenu = main
    }
    func respond(_ id: Int, _ result: Any?, _ error: Error? = nil) {
        var value: [String: Any] = ["id": id, "ok": error == nil, "value": result ?? NSNull()]
        if let error = error { value["error"] = ["message": (error as? DesktopError)?.message ?? error.localizedDescription, "name": (error as? DesktopError)?.name ?? "NotReadableError"] }
        guard let bytes = try? desktopJSON(value), let text = String(data: bytes, encoding: .utf8) else { return }
        DispatchQueue.main.async { portal_cef_evaluate("window.gamePortalReply(\(text))") }
    }
    func operate(_ request: [String: Any], id: Int) {
        let op = request["op"] as? String ?? ""
        let writing = ["remember", "forget", "beginWrite", "writeChunk", "commitWrite", "abortWrite", "remove"].contains(op) || ["file", "directory"].contains(op) && request["create"] as? Bool == true
        if writing { pendingWrites += 1 }
        let queue = (request["root"] as? String).flatMap { files.work(for: $0) } ?? (["restore", "selectPath"].contains(op) ? DispatchQueue.global(qos: .userInitiated) : io)
        queue.async {
            let result: Any?, failure: Error?
            do { result = try self.files.operate(request); failure = nil } catch { result = nil; failure = error }
            DispatchQueue.main.async { if writing { self.pendingWrites -= 1 }; self.respond(id, result, failure) }
        }
    }
    func message(_ data: [String: Any]) {
        // The CEF browser process validates sender process, main frame and exact URL.
        if let kind = data["kind"] as? String {
            if testMode { fputs("GAME PORTAL event: \(kind) \(data["text"] as? String ?? "")\n", stderr) }
            switch kind {
            case "initialized": if !portal_cef_open(Unmanaged.passUnretained(view).toOpaque(), appURL.absoluteString) { fail(DesktopError("ゲーム画面を開けませんでした。")) }
            case "ready": didLoad()
            case "closed": browserClosed = true; closing = true; DispatchQueue.main.async { NSApplication.shared.terminate(nil) }
            case "closeRequested": requestClose()
            case "folderDrag": droppedFolder = ((data["text"] as? String ?? ""), Date())
            case "fullscreen":
                let active = window.styleMask.contains(.fullScreen)
                if data["text"] as? String == "true" { if !active { fullscreenFromGame = true; window.toggleFullScreen(nil) } }
                else if fullscreenFromGame { fullscreenFromGame = false; if active { window.toggleFullScreen(nil) } }
            case "loadError": if testMode { fail(DesktopError(data["text"] as? String ?? "Load failed")) } else { notice("画面を読み込めませんでした", data["text"] as? String ?? "アプリを開き直してください。") }
            case "consoleError": fputs("GAME PORTAL renderer: \(data["text"] as? String ?? "")\n", stderr)
            default: break
            }; return
        }
        guard let id = data["id"] as? Int, id > 0 else { return }; let op = data["op"] as? String ?? ""
        if op == "testResult", testMode {
            do { if let result = resultFile { try files.atomic(desktopJSON(data["value"] ?? [:]), result) } } catch { fail(error); return }
            closing = true; portal_cef_close(); return
        }
        if op == "closeReady" {
            guard closePending else { return }; closeTimer?.cancel(); closePending = false
            if data["allowed"] as? Bool == true { finishClose() } else { notice("保存を完了してください", "処理中または未保存の内容があります。画面に戻って保存を完了してください。") }; return
        }
        if op == "select" {
            let panel = NSOpenPanel(); panel.title = "ゲームの保存先を選ぶ"; panel.prompt = "選ぶ"; panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.canCreateDirectories = desktopEdition == "creator"; panel.allowsMultipleSelection = false
            panel.beginSheetModal(for: window) { response in
                guard response == .OK, let url = panel.url else { self.respond(id, NSNull()); return }
                self.operate(["op": "selectPath", "path": url.path], id: id)
            }; return
        }
        var request = data
        if op == "dropFolder" {
            guard let (path, time) = droppedFolder, Date().timeIntervalSince(time) < 30, !path.isEmpty else { respond(id, nil, DesktopError("保存先フォルダーを1つドラッグしてください。")); return }; droppedFolder = nil
            request["op"] = "selectPath"; request["path"] = path
        }
        operate(request, id: id)
    }
    func didLoad() {
        if let ready = readyFile { try? desktopJSON(["url": appURL.absoluteString, "version": desktopVersion]).write(to: ready) }
        if testMode, !testStarted, let script = testScript {
            testStarted = true
            do { let text = try String(contentsOf: script, encoding: .utf8)
                portal_cef_evaluate("(async()=>{try{const value=await (async()=>{\(text)})();window.__portalSend(JSON.stringify({id:2147483646,op:'testResult',value:{ok:true,value}}));}catch(error){window.__portalSend(JSON.stringify({id:2147483646,op:'testResult',value:{ok:false,error:String(error),stack:error.stack}}));}})()")
            } catch { fail(error) }
        }
    }
    func windowDidResize(_ notification: Notification) { if engineReady { portal_cef_resize() } }
    func windowWillExitFullScreen(_ notification: Notification) { fullscreenFromGame = false; if engineReady { portal_cef_evaluate("if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});") } }
    func windowShouldClose(_ sender: NSWindow) -> Bool { if closing { return true }; requestClose(); return false }
    func windowWillClose(_ notification: Notification) {
        // CEF owns a child NSView. Tear down the host view hierarchy so that
        // OnBeforeClose can finish before shutting down the rendering engine.
        window?.contentView = nil; view = nil; window = nil
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply { if browserClosed || !engineReady && closing { listener?.cancel(); return .terminateNow }; requestClose(); return .terminateCancel }
    func applicationWillTerminate(_ notification: Notification) { if engineReady { portal_cef_shutdown() }; desktopInstance = nil }
    func finishClose() {
        if pendingWrites > 0 || files.hasWriters { notice("保存中です", "保存が完了してから閉じてください。"); return }
        closing = true; if engineReady { portal_cef_close() } else { NSApplication.shared.terminate(nil) }
    }
    func requestClose() {
        if let process = installedProcess, process.isRunning { NSRunningApplication(processIdentifier: process.processIdentifier)?.terminate(); return }
        if !engineReady { closing = true; NSApplication.shared.terminate(nil); return }
        guard !closePending else { return }; closePending = true
        if pendingWrites > 0 || files.hasWriters { closePending = false; notice("保存中です", "保存が完了してから閉じてください。"); return }
                portal_cef_evaluate("(async()=>{let allowed=false;try{if(typeof busy==='undefined')allowed=true;else if(!busy&&!syncPromise&&!hasEditChanges()&&await flushSave()){stopPlayer();allowed=true;}}finally{window.__portalSend(JSON.stringify({id:2147483647,op:'closeReady',allowed}));}})()")
                let timer = DispatchWorkItem { self.closePending = false; let alert = NSAlert(); alert.messageText = "画面から応答がありません"; alert.informativeText = "終了すると未保存の入力は失われます。終了しますか？"; alert.addButton(withTitle: "戻る"); alert.addButton(withTitle: "終了"); if alert.runModal() == .alertSecondButtonReturn { self.finishClose() } }; self.closeTimer = timer; DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: timer)
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if let process = installedProcess, process.isRunning { NSRunningApplication(processIdentifier: process.processIdentifier)?.activate(options: [.activateIgnoringOtherApps]); return true }
        window?.makeKeyAndOrderFront(nil); return true
    }
    func notice(_ title: String, _ message: String) { let alert = NSAlert(); alert.messageText = title; alert.informativeText = message; alert.runModal() }
    func fail(_ error: Error) {
        let message = (error as? DesktopError)?.message ?? error.localizedDescription
        if testMode { if let result = resultFile { try? desktopJSON(["ok": false, "error": message]).write(to: result) }; fputs(message + "\n", stderr); exit(1) }
        notice("GAME PORTALを開けませんでした", message); exit(1)
    }
    // Only the trusted document is served. There is no file-system HTTP API.
    func receive(_ connection: NWConnection) {
        if testMode { fputs("GAME PORTAL HTTP: connection\n", stderr) }
        guard connections < 8 else { connection.cancel(); return }; connections += 1
        let deadline = DispatchWorkItem { connection.cancel() }
        connection.stateUpdateHandler = { state in if case .cancelled = state { deadline.cancel(); self.connections -= 1 } }
        connection.start(queue: network); network.asyncAfter(deadline: .now() + 15, execute: deadline)
        var buffer = Data()
        func next() {
            connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { bytes, _, complete, error in
                if let bytes = bytes { buffer.append(bytes) }
                guard buffer.count <= 16384 else { connection.cancel(); return }
                if buffer.range(of: Data("\r\n\r\n".utf8)) != nil {
                    let text = String(data: buffer, encoding: .utf8) ?? "", lines = text.components(separatedBy: "\r\n")
                    let host = lines.filter { $0.lowercased().hasPrefix("host:") }
                    if self.testMode { fputs("GAME PORTAL HTTP: \(lines.first ?? "")\n", stderr) }
                    guard lines.first == "GET /index.html HTTP/1.1", host.count == 1, host[0].dropFirst(5).trimmingCharacters(in: .whitespaces) == "127.0.0.1:\(self.listener.port!.rawValue)" else { connection.cancel(); return }
                    deadline.cancel()
                    let header = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(self.page.count)\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nContent-Security-Policy: frame-ancestors 'none'\r\nConnection: close\r\n\r\n"
                    connection.send(content: Data(header.utf8), completion: .contentProcessed { error in
                        if error != nil { connection.cancel(); return }
                        connection.send(content: self.page, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { error in if error != nil { connection.cancel() } })
                    }); return
                }
                if complete || error != nil { connection.cancel() } else { next() }
            }
        }
        next()
    }
}

@main struct MacDesktopMain {
    static func main() {
        do {
            let args = CommandLine.arguments; var profile: URL? = nil, library: String? = nil, script: URL? = nil, result: URL? = nil, ready: URL? = nil, application: URL? = nil, test = false, index = 1
            while index < args.count {
                if args[index] == "--test-mode" { test = true; index += 1; continue }
                if args[index].range(of: "^-psn_[0-9]+_[0-9]+$", options: .regularExpression) != nil { index += 1; continue }
                guard ["--profile", "--library", "--test-script", "--result-file", "--ready-file", "--self-test", "--application-directory"].contains(args[index]), index + 1 < args.count else { throw DesktopError("起動オプションを確認してください。") }
                let option = args[index], value = args[index + 1]; index += 2
                switch option {
                case "--profile": profile = URL(fileURLWithPath: value).resolvingSymlinksInPath()
                case "--library": library = URL(fileURLWithPath: value).resolvingSymlinksInPath().path
                case "--test-script": script = URL(fileURLWithPath: value)
                case "--result-file": result = URL(fileURLWithPath: value)
                case "--ready-file": ready = URL(fileURLWithPath: value)
                case "--application-directory": application = URL(fileURLWithPath: value)
                case "--self-test": try desktopSelfTest(URL(fileURLWithPath: value).resolvingSymlinksInPath()); return
                default: break
                }
            }
            guard test || script == nil && result == nil else { throw DesktopError("検証オプションを確認してください。") }
            if test { setenv("PORTAL_CEF_TEST", "1", 1) }
            let bundle = Bundle.main.bundleURL, fm = FileManager.default
            let base = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            var directory = bundle.deletingLastPathComponent()
            if ["プレイ用", "クリエイター用"].contains(directory.lastPathComponent), directory.deletingLastPathComponent().lastPathComponent == "Mac" {
                let root = directory.deletingLastPathComponent().deletingLastPathComponent()
                if fm.fileExists(atPath: root.appendingPathComponent("_内部ファイル/GAME-PORTAL-DISTRIBUTION.json").path) { directory = root }
            }
            if let application = application { directory = application }
            else if fm.fileExists(atPath: bundle.appendingPathComponent("Contents/Frameworks/Chromium Embedded Framework.framework").path), let origin = try? Data(contentsOf: bundle.appendingPathComponent("Contents/Resources/origin.json")), origin.count <= 8192 {
                let value = try desktopObject(origin); if desktopSchema(value["schema"]), let path = value["application"] as? String, path.hasPrefix("/"), path.utf8.count <= 4000 { directory = URL(fileURLWithPath: path) }
            }
            let delegate = try PortalDesktop(profile: profile ?? base.appendingPathComponent("GAME-PORTAL/" + desktopEdition), application: directory.resolvingSymlinksInPath(), testMode: test, library: library, testScript: script, resultFile: result, readyFile: ready)
            portal_cef_application(); let app = NSApplication.shared; app.delegate = delegate; app.run(); withExtendedLifetime(delegate) {}
        } catch {
            let message = (error as? DesktopError)?.message ?? error.localizedDescription
            fputs("GAME PORTAL: \(message)\n", stderr)
            if !CommandLine.arguments.contains("--test-mode") && !CommandLine.arguments.contains("--self-test") {
                portal_cef_application(); NSApplication.shared.setActivationPolicy(.regular); NSApplication.shared.activate(ignoringOtherApps: true)
                let alert = NSAlert(); alert.messageText = "GAME PORTALを開けませんでした"; alert.informativeText = message; alert.runModal()
            }
            exit(1)
        }
    }
}
