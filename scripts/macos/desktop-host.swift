import Foundation
import AppKit
import WebKit
import Network
import Darwin

let desktopVersion = "__VERSION__"
let desktopEdition = Bundle.main.object(forInfoDictionaryKey: "GamePortalEdition") as? String ?? "creator"

// Native drop URLs are supplied by AppKit, never by a game's JavaScript.
final class PortalWebView: WKWebView {
    var folderDrop: ((URL, NSPoint) -> Void)?
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        if sender.draggingPasteboard.canReadObject(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) { return .copy }
        return super.draggingEntered(sender)
    }
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        if let urls = sender.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], urls.count == 1 {
            var directory: ObjCBool = false
            if FileManager.default.fileExists(atPath: urls[0].path, isDirectory: &directory), directory.boolValue {
                folderDrop?(urls[0], convert(sender.draggingLocation, from: nil)); return true
            }
        }
        return super.performDragOperation(sender)
    }
}

final class PortalDesktop: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    let io = DispatchQueue(label: "gameportal.desktop.files"), network = DispatchQueue(label: "gameportal.desktop.http")
    let profile: URL, application: URL, files: DesktopFiles, testMode: Bool
    let testScript: URL?, resultFile: URL?, readyFile: URL?
    var view: PortalWebView!, window: NSWindow!, listener: NWListener!, page: Data
    var appURL: URL!, closing = false, closePending = false, testStarted = false
    var closeTimer: DispatchWorkItem?, connections = 0

    init(profile: URL, application: URL, testMode: Bool, library: String?, testScript: URL?, resultFile: URL?, readyFile: URL?) throws {
        self.profile = profile; self.application = application; self.testMode = testMode; self.testScript = testScript; self.resultFile = resultFile; self.readyFile = readyFile
        files = try DesktopFiles(profile: profile, application: application, player: desktopEdition == "player")
        guard let resource = Bundle.main.url(forResource: "GAME-PORTAL-DESKTOP", withExtension: "html") else { throw DesktopError("アプリ内の画面がありません。ZIPを展開し直してください。") }
        page = try Data(contentsOf: resource)
        super.init()
        if let library = library { let root = try files.register(library); try files.remember(root) }
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            let portFile = profile.appendingPathComponent("port.json")
            var savedPort: UInt16? = nil
            if FileManager.default.fileExists(atPath: portFile.path) {
                let data = try desktopObject(files.regularRead(portFile, limit: 1024))
                guard let value = data["port"] as? Int, value >= 1024, value <= 65535 else { throw DesktopError("アプリの接続設定を確認してください。") }; savedPort = UInt16(value)
            }
            let parameters = NWParameters.tcp
            parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: savedPort.flatMap { NWEndpoint.Port(rawValue: $0) } ?? .any)
            listener = try NWListener(using: parameters)
            listener.newConnectionHandler = { [weak self] in self?.receive($0) }
            listener.stateUpdateHandler = { [weak self] state in
                guard let self = self else { return }
                switch state {
                case .ready:
                    guard let port = self.listener.port?.rawValue else { return }
                    self.appURL = URL(string: "http://127.0.0.1:\(port)/index.html")!
                    do { if savedPort == nil { try self.files.atomic(desktopJSON(["port": Int(port)]), portFile) }; DispatchQueue.main.async { self.show() } }
                    catch { DispatchQueue.main.async { self.fail(error) } }
                case .failed(let error): DispatchQueue.main.async { self.fail(DesktopError("アプリの接続を開始できません。別のGAME PORTALを閉じてから開き直してください。\n" + error.localizedDescription)) }
                default: break
                }
            }
            listener.start(queue: network)
        } catch { fail(error) }
    }
    func show() {
        let controller = WKUserContentController(); controller.add(self, name: "gamePortal")
        let config = WKWebViewConfiguration(); config.userContentController = controller; config.websiteDataStore = .default()
        view = PortalWebView(frame: .zero, configuration: config); view.navigationDelegate = self; view.uiDelegate = self
        view.folderDrop = { [weak self] url, point in
            guard let self = self else { return }
            // DOM coordinates run from the top; AppKit view coordinates run from the bottom.
            let x = point.x, y = self.view.bounds.height - point.y
            self.view.evaluateJavaScript("(function(){var node=document.elementFromPoint(\(x),\(y));return !!(node&&node.closest('#emptyState,#folderDrop'));})()") { value, error in
                guard error == nil, value as? Bool == true else { return }
                if let argument = self.jsString(url.path) { self.view.evaluateJavaScript("window.gamePortalFolderDrop(\(argument))", completionHandler: nil) }
            }
        }
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 820), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "GAME PORTAL " + (desktopEdition == "player" ? "プレイ専用" : "クリエイター")
        window.minSize = NSSize(width: 640, height: 480); window.contentView = view; window.delegate = self; window.center(); installMenu()
        NSApplication.shared.setActivationPolicy(.regular)
        if !testMode { window.makeKeyAndOrderFront(nil); NSApplication.shared.activate(ignoringOtherApps: true) }
        view.load(URLRequest(url: appURL))
    }
    func installMenu() {
        let main = NSMenu(), appItem = NSMenuItem(), appMenu = NSMenu()
        appMenu.addItem(withTitle: "GAME PORTALを終了", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"); appItem.submenu = appMenu; main.addItem(appItem)
        let editItem = NSMenuItem(), edit = NSMenu(title: "編集")
        for (title, action, key) in [("元に戻す", "undo:", "z"), ("切り取り", "cut:", "x"), ("コピー", "copy:", "c"), ("貼り付け", "paste:", "v"), ("すべて選択", "selectAll:", "a")] { edit.addItem(withTitle: title, action: Selector(action), keyEquivalent: key) }; editItem.submenu = edit; main.addItem(editItem)
        let windowItem = NSMenuItem(), windowMenu = NSMenu(title: "ウィンドウ"); windowMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"); windowItem.submenu = windowMenu; main.addItem(windowItem); NSApplication.shared.mainMenu = main
    }
    func jsString(_ value: String) -> String? { return (try? desktopJSON([value])).flatMap { String(data: $0, encoding: .utf8) }.map { String($0.dropFirst().dropLast()) } }
    func respond(_ id: Int, _ result: Any?, _ error: Error? = nil) {
        var value: [String: Any] = ["id": id, "ok": error == nil, "value": result ?? NSNull()]
        if let error = error { value["error"] = ["message": (error as? DesktopError)?.message ?? error.localizedDescription, "name": (error as? DesktopError)?.name ?? "NotReadableError"] }
        guard let bytes = try? desktopJSON(value), let text = String(data: bytes, encoding: .utf8) else { return }
        DispatchQueue.main.async { self.view.evaluateJavaScript("window.gamePortalReply(\(text))", completionHandler: nil) }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.absoluteString.components(separatedBy: "#")[0] == appURL.absoluteString, let data = message.body as? [String: Any], let id = data["id"] as? Int, id > 0, let bytes = try? desktopJSON(data), bytes.count <= 400000 else { return }
        let op = data["op"] as? String ?? ""
        if op == "testResult", testMode {
            do { if let resultFile = resultFile { try files.atomic(desktopJSON(data["value"] ?? NSNull()), resultFile) } } catch { fail(error); return }
            closing = true; NSApplication.shared.terminate(nil); return
        }
        if op == "closeReady" {
            guard closePending else { return }; closeTimer?.cancel(); closePending = false
            if data["allowed"] as? Bool == true { closing = true; NSApplication.shared.terminate(nil) }
            else { notice("保存を完了してください", "処理中または未保存の内容があります。画面に戻って保存を完了してください。") }; return
        }
        if op == "select" {
            let panel = NSOpenPanel(); panel.title = "ゲームの保存先を選ぶ"; panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
            panel.beginSheetModal(for: window) { response in
                guard response == .OK, let url = panel.url else { self.respond(id, NSNull()); return }
                self.io.async { do { self.respond(id, self.files.record(try self.files.register(url.path))) } catch { self.respond(id, nil, error) } }
            }; return
        }
        io.async { do { self.respond(id, try self.files.operate(data)) } catch { self.respond(id, nil, error) } }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if navigationAction.targetFrame?.isMainFrame == true { decisionHandler(url.absoluteString.components(separatedBy: "#")[0] == appURL.absoluteString ? .allow : .cancel); return }
        if navigationAction.targetFrame == nil {
            if navigationAction.navigationType == .linkActivated, url.scheme == "https" { NSWorkspace.shared.open(url) }; decisionHandler(.cancel); return
        }
        decisionHandler(["about", "blob", "data"].contains(url.scheme ?? "") ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView.url?.absoluteString.components(separatedBy: "#")[0] == appURL.absoluteString else { return }
        if let ready = readyFile { try? desktopJSON(["url": appURL.absoluteString, "version": desktopVersion]).write(to: ready) }
        if testMode, !testStarted, let script = testScript {
            testStarted = true
            do {
                let text = try String(contentsOf: script, encoding: .utf8)
                webView.evaluateJavaScript("(async()=>{try{const value=await (async()=>{\(text)})();window.webkit.messageHandlers.gamePortal.postMessage({id:2147483646,op:'testResult',value:{ok:true,value}});}catch(error){window.webkit.messageHandlers.gamePortal.postMessage({id:2147483646,op:'testResult',value:{ok:false,error:String(error),stack:error.stack}});}})()", completionHandler: { _, error in if let error = error { self.fail(error) } })
            } catch { fail(error) }
        }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { notice("画面が停止しました", "アプリを閉じて開き直してください。保存先のゲームは保持されています。") }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) { notice("GAME PORTAL", String(message.prefix(2000))); completionHandler() }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = String(message.prefix(2000)); alert.addButton(withTitle: "OK"); alert.addButton(withTitle: "キャンセル"); completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard frame.isMainFrame else { completionHandler(nil); return }
        let panel = NSOpenPanel(); panel.canChooseFiles = true; panel.canChooseDirectories = parameters.allowsDirectories; panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { response in completionHandler(response == .OK ? panel.urls : nil) }
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { requestClose(); return false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply { if closing { listener?.cancel(); return .terminateNow }; requestClose(); return .terminateCancel }
    func requestClose() {
        guard !closePending else { return }; closePending = true
        io.async {
            let writing = !self.files.writers.isEmpty
            DispatchQueue.main.async {
                if writing { self.closePending = false; self.notice("保存中です", "保存が完了してから閉じてください。"); return }
                self.view.evaluateJavaScript("(async()=>{let allowed=false;try{if(typeof busy==='undefined')allowed=true;else if(!busy&&!syncPromise&&!hasEditChanges()&&await flushSave()){stopPlayer();allowed=true;}}finally{window.webkit.messageHandlers.gamePortal.postMessage({id:2147483647,op:'closeReady',allowed});}})()", completionHandler: nil)
                let timer = DispatchWorkItem { self.closePending = false; let alert = NSAlert(); alert.messageText = "画面から応答がありません"; alert.informativeText = "終了すると未保存の入力は失われます。終了しますか？"; alert.addButton(withTitle: "戻る"); alert.addButton(withTitle: "終了"); if alert.runModal() == .alertSecondButtonReturn { self.io.async { if self.files.writers.isEmpty { DispatchQueue.main.async { self.closing = true; NSApplication.shared.terminate(nil) } } } } }; self.closeTimer = timer; DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: timer)
            }
        }
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { window?.makeKeyAndOrderFront(nil); return true }
    func notice(_ title: String, _ message: String) { let alert = NSAlert(); alert.messageText = title; alert.informativeText = message; alert.runModal() }
    func fail(_ error: Error) {
        let message = (error as? DesktopError)?.message ?? error.localizedDescription
        if testMode { if let result = resultFile { try? desktopJSON(["ok": false, "error": message]).write(to: result) }; fputs(message + "\n", stderr); exit(1) }
        notice("GAME PORTALを開けませんでした", message); exit(1)
    }
    // Only the trusted document is served. There is no file-system HTTP API.
    func receive(_ connection: NWConnection) {
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
                    guard lines.first == "GET /index.html HTTP/1.1", host.count == 1, host[0].dropFirst(5).trimmingCharacters(in: .whitespaces) == "127.0.0.1:\(self.listener.port!.rawValue)" else { connection.cancel(); return }
                    deadline.cancel()
                    let header = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(self.page.count)\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nContent-Security-Policy: frame-ancestors 'none'\r\nConnection: close\r\n\r\n"
                    connection.send(content: Data(header.utf8), completion: .contentProcessed { error in
                        if error != nil { connection.cancel(); return }
                        connection.send(content: self.page, completion: .contentProcessed { _ in connection.cancel() })
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
            let args = CommandLine.arguments; var profile: URL? = nil, library: String? = nil, script: URL? = nil, result: URL? = nil, ready: URL? = nil, test = false, index = 1
            while index < args.count {
                if args[index] == "--test-mode" { test = true; index += 1; continue }
                guard ["--profile", "--library", "--test-script", "--result-file", "--ready-file", "--self-test"].contains(args[index]), index + 1 < args.count else { throw DesktopError("起動オプションを確認してください。") }
                let option = args[index], value = args[index + 1]; index += 2
                switch option {
                case "--profile": profile = URL(fileURLWithPath: value).resolvingSymlinksInPath()
                case "--library": library = URL(fileURLWithPath: value).resolvingSymlinksInPath().path
                case "--test-script": script = URL(fileURLWithPath: value)
                case "--result-file": result = URL(fileURLWithPath: value)
                case "--ready-file": ready = URL(fileURLWithPath: value)
                case "--self-test": try desktopSelfTest(URL(fileURLWithPath: value).resolvingSymlinksInPath()); return
                default: break
                }
            }
            guard test || script == nil && result == nil else { throw DesktopError("検証オプションを確認してください。") }
            let bundle = Bundle.main.bundleURL, fm = FileManager.default
            let base = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            var directory = bundle.deletingLastPathComponent()
            if ["プレイ用", "クリエイター用"].contains(directory.lastPathComponent), directory.deletingLastPathComponent().lastPathComponent == "Mac" {
                let root = directory.deletingLastPathComponent().deletingLastPathComponent()
                if fm.fileExists(atPath: root.appendingPathComponent("_内部ファイル/GAME-PORTAL-DISTRIBUTION.json").path) { directory = root }
            }
            let delegate = try PortalDesktop(profile: profile ?? base.appendingPathComponent("GAME-PORTAL/" + desktopEdition), application: directory.resolvingSymlinksInPath(), testMode: test, library: library, testScript: script, resultFile: result, readyFile: ready)
            let app = NSApplication.shared; app.delegate = delegate; app.run(); withExtendedLifetime(delegate) {}
        } catch { fputs("GAME PORTAL: \((error as? DesktopError)?.message ?? error.localizedDescription)\n", stderr); exit(1) }
    }
}
