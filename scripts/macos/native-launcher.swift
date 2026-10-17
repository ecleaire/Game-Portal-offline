import Foundation
import Network
import Security
import CoreFoundation
import Darwin
#if MOJAVE
import AppKit
let creatorApp = Bundle.main.object(forInfoDictionaryKey:"GamePortalEdition") as? String == "creator"
let mojaveApp = Bundle.main.bundleURL.pathExtension == "app" && !CommandLine.arguments.contains("--headless")
final class MojaveMenu: NSObject, NSApplicationDelegate {
    var item: NSStatusItem?;var open: ((String?) -> Void)?;var choose: (() -> Void)?
    func install(){item=NSStatusBar.system.statusItem(withLength:NSStatusItem.variableLength);item?.button?.title="GAME PORTAL";let menu=NSMenu();for (title,selector) in [("ゲーム一覧を開く",#selector(openPortal)),("Google Chromeで開く",#selector(openChrome)),("Firefoxで開く",#selector(openFirefox)),("次回の保存先を選ぶ",#selector(chooseFolder)),("終了",#selector(quit))]{let entry=NSMenuItem(title:title,action:selector,keyEquivalent:"");entry.target=self;menu.addItem(entry)};item?.menu=menu}
    @objc func openPortal(){open?(nil)};@objc func openChrome(){open?("com.google.Chrome")};@objc func openFirefox(){open?("org.mozilla.firefox")};@objc func chooseFolder(){choose?()};@objc func quit(){NSApplication.shared.terminate(nil)}
    func applicationShouldHandleReopen(_ sender:NSApplication,hasVisibleWindows flag:Bool)->Bool{open?(nil);return false}
}
func reportMojaveError(_ message:String){
    if mojaveApp{let show:()->Void={NSApplication.shared.setActivationPolicy(.accessory);NSApplication.shared.activate(ignoringOtherApps:true);let alert=NSAlert();alert.messageText="GAME PORTALを開けませんでした";alert.informativeText=message;alert.runModal();exit(1)};if Thread.isMainThread{show()}else{DispatchQueue.main.async(execute:show)}}else{fputs("GAME PORTAL: \(message)\n",stderr);exit(1)}
}
#endif

// macOS 12+, universal Intel / Apple silicon. No external runtime installation.
let version = "__VERSION__"
let fm = FileManager.default
struct PortalError: Error { let message: String; let name: String
    init(_ message: String, _ name: String = "NotReadableError") { self.message=message; self.name=name }
}
func json(_ value: Any) throws -> Data { try JSONSerialization.data(withJSONObject:value, options:[.sortedKeys]) }
func object(_ data: Data) throws -> [String:Any] {
    guard let value=try JSONSerialization.jsonObject(with:data) as? [String:Any] else { throw PortalError("設定を確認してください。") }; return value
}
func read(_ url: URL, _ limit: Int) throws -> Data {
    // A FIFO can block in open() before size checks or cancellation can run.
    let descriptor=Darwin.open(url.path,O_RDONLY|O_NOFOLLOW|O_NONBLOCK);guard descriptor>=0 else{throw NSError(domain:NSPOSIXErrorDomain,code:Int(errno))};defer{Darwin.close(descriptor)}
    var before=stat();guard fstat(descriptor,&before)==0,(before.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG),before.st_size>=0,before.st_size<=Int64(limit) else{throw PortalError("通常のファイルではないか、大きすぎるため読み取れません。")}
    var data=Data(),buffer=[UInt8](repeating:0,count:65536)
    while data.count<Int(before.st_size){let count=Darwin.read(descriptor,&buffer,min(buffer.count,Int(before.st_size)-data.count));if count<0{if errno==EINTR{continue};throw NSError(domain:NSPOSIXErrorDomain,code:Int(errno))};guard count>0 else{throw PortalError("読み込み中にファイルが変わりました。")};data.append(contentsOf:buffer.prefix(count))}
    var after=stat();guard fstat(descriptor,&after)==0,after.st_size==before.st_size else{throw PortalError("読み込み中にファイルが変わりました。もう一度試してください。")};return data
}
func bound(_ root: URL, _ path: String) throws -> URL {
    var current=root
    for part in path.split(separator:"/",omittingEmptySubsequences:false) {
        guard !part.isEmpty && part != "." && part != ".." && part.count<=255 && !part.contains("\\") && !part.contains(":") && !part.contains(where:{$0.isNewline || $0.asciiValue.map{$0<32} == true}) else { throw PortalError("保存先のパスが不正です。") }
        current.appendPathComponent(String(part))
        let values=try current.resourceValues(forKeys:[.isSymbolicLinkKey])
        guard values.isSymbolicLink != true else { throw PortalError("リンクを経由した保存先は開けません。") }
    }
    return current
}
func validID(_ value: Any?) -> String? { guard let id=value as? String, id.range(of:"^[a-f0-9]{32}$",options:.regularExpression) != nil else{return nil};return id }
func schema(_ value: Any?) -> Bool { guard let number=value as? NSNumber else{return false};return CFGetTypeID(number) != CFBooleanGetTypeID() && number.doubleValue==1 }
func checkLibrary(_ root: URL, _ expected: String? = nil) throws -> String {
    let rootValues=try root.resourceValues(forKeys:[.isDirectoryKey,.isSymbolicLinkKey]);guard rootValues.isDirectory == true && rootValues.isSymbolicLink != true else{throw PortalError("保存先フォルダーへの接続を確認してください。")}
    let value=try object(read(bound(root,".gameportal/library-id.json"),1024))
    guard schema(value["schema"]), let id=validID(value["id"]), expected == nil || expected == id else { throw PortalError("保存先のIDを確認してください。HTMLから初回設定を済ませた保存先を指定します。") }
    let compatibility=root.appendingPathComponent(".gameportal/compatibility.json")
    if fm.fileExists(atPath:compatibility.path) {
        let info=try object(read(bound(root,".gameportal/compatibility.json"),8192))
        guard schema(info["schema"]), let minimum=info["minLauncherVersion"] as? String, minimum.range(of:"^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$",options:.regularExpression) != nil, minimum.compare(version,options:.numeric) != .orderedDescending, let features=info["requiredFeatures"] as? [String], features.allSatisfy({["per-game-settings-v1","content-selector-v1"].contains($0)}) else { throw PortalError("HTMLとMac起動補助を対応する最新版にしてください。") }
    }
    return id
}

do {
    let args=CommandLine.arguments
    var html=URL(fileURLWithPath:args[0]).standardizedFileURL.deletingLastPathComponent().appendingPathComponent("GAME-PORTAL.html")
    if Bundle.main.bundleURL.pathExtension == "app"{html=Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/GAME-PORTAL.html")}
    var headless=false, ready: URL?=nil, index=1
    while index<args.count {
        switch args[index] {
        case "--headless":headless=true
        case "--html","--ready-file":
            let option=args[index];index+=1;guard index<args.count else {throw PortalError("起動オプションを確認してください。")}
            let url=URL(fileURLWithPath:args[index]).standardizedFileURL;if option=="--html" {html=url}else{ready=url}
        default:throw PortalError("起動オプションを確認してください。")
        };index+=1
    }
    guard fm.fileExists(atPath:html.path) else {throw PortalError("同じフォルダーにGAME-PORTAL.htmlを置いてください。")}
    var configurationDirectory=html.deletingLastPathComponent()
    if Bundle.main.bundleURL.pathExtension == "app" && !args.contains("--html"){configurationDirectory=Bundle.main.bundleURL.deletingLastPathComponent()}
    let config=configurationDirectory.appendingPathComponent("GAME-PORTAL-FOLDER.txt")
    let sharedConfig=configurationDirectory.appendingPathComponent("GAME-PORTAL-CONNECTION.json")
    var root: URL?=nil, libraryID: String?=nil, configurationError: String?=nil
    let configurationLock=NSLock()
    func configureRoot() {
      configurationError=nil
    if fm.fileExists(atPath:sharedConfig.path) {
      do {
        let info=try object(read(sharedConfig,8192));guard schema(info["schema"]),info["kind"] as? String == "relative",let path=info["path"] as? String,!path.isEmpty,path.count<=1000,!path.hasPrefix("/"),!path.contains("\\"),!path.contains(":"),!path.contains("\0"),!path.contains("\n"),!path.contains("\r"),path.split(separator:"/",omittingEmptySubsequences:false).count<=32,let expected=validID(info["libraryId"]) else{throw PortalError("共有接続設定を確認してください。")}
        let url=configurationDirectory.appendingPathComponent(path).standardizedFileURL
        let values=try url.resourceValues(forKeys:[.isDirectoryKey,.isSymbolicLinkKey]);guard values.isDirectory == true && values.isSymbolicLink != true else{throw PortalError("共有の保存先にアクセスできません。FinderでNASの接続を確認してください。")}
        libraryID=try checkLibrary(url,expected);root=url
      } catch {configurationError="共有の保存先へ接続できません："+((error as? PortalError)?.message ?? error.localizedDescription)}
      return
    }
    if fm.fileExists(atPath:config.path) {
      do {
        guard let raw=String(data:try read(config,8192),encoding:.utf8) else {throw PortalError("保存先設定はUTF-8で保存してください。")}
        let path=(raw.hasPrefix("\u{FEFF}") ? String(raw.dropFirst()) : raw).trimmingCharacters(in:.whitespacesAndNewlines)
        guard !path.isEmpty && !path.contains(where:{$0.isNewline || $0 == "\0"}) else {throw PortalError("GAME-PORTAL-FOLDER.txtには保存先を1行で指定してください。")}
        let url=path.hasPrefix("/") ? URL(fileURLWithPath:path).standardizedFileURL : configurationDirectory.appendingPathComponent(path).standardizedFileURL
        let values=try url.resourceValues(forKeys:[.isDirectoryKey,.isSymbolicLinkKey]);guard values.isDirectory == true && values.isSymbolicLink != true else{throw PortalError("自動接続の保存先にアクセスできません。")}
        libraryID=try checkLibrary(url);root=url
      } catch { configurationError="自動接続の設定を確認してください。GAME-PORTAL-FOLDER.txtを修正して再試行できます："+((error as? PortalError)?.message ?? error.localizedDescription) }
    }
    }
    #if MOJAVE
    if !headless {
      let preference="GamePortalMojaveFolder:"+html.deletingLastPathComponent().path
      if let saved=UserDefaults.standard.dictionary(forKey:preference),let path=saved["path"] as? String,let expected=validID(saved["libraryId"]),let id=try? checkLibrary(URL(fileURLWithPath:path),expected){root=URL(fileURLWithPath:path);libraryID=id}
      else {configureRoot()}
      if root == nil {
        NSApplication.shared.setActivationPolicy(.accessory);NSApplication.shared.activate(ignoringOtherApps:true)
        let dialog=NSOpenPanel();dialog.title="ゲームの保存先フォルダーを選んでください";dialog.message=configurationError ?? "Windows版で初期設定したゲームの保管フォルダーを選んでください。";dialog.canChooseFiles=false;dialog.canChooseDirectories=true;dialog.allowsMultipleSelection=false
        guard dialog.runModal() == .OK,let selected=dialog.url else{exit(0)}
        let id=try checkLibrary(selected);root=selected;libraryID=id;configurationError=nil;UserDefaults.standard.set(["path":selected.path,"libraryId":id],forKey:preference)
      }
    }
    #endif
    func configuredFolder() -> (URL?,String?,String?) {
      configurationLock.lock();defer {configurationLock.unlock()}
      if root == nil {configureRoot()}
      return (root,libraryID,configurationError)
    }
    var secret=[UInt8](repeating:0,count:32)
    guard SecRandomCopyBytes(kSecRandomDefault,secret.count,&secret)==errSecSuccess else {throw PortalError("起動補助を開始できません。")}
    let token=secret.map{String(format:"%02x",$0)}.joined()
    let parameters=NWParameters.tcp;parameters.requiredLocalEndpoint = .hostPort(host:"127.0.0.1",port:.any)
    let listener=try NWListener(using:parameters)
    let queue=DispatchQueue(label:"gameportal.listener"), slots=DispatchSemaphore(value:8)
    var port: UInt16=0
    func openPortal(_ browserID: String? = nil) throws {
        let task=Process();task.executableURL=URL(fileURLWithPath:"/usr/bin/open")
        #if MOJAVE
        let key="GamePortalMojaveBrowser:"+html.deletingLastPathComponent().path
        let preferred=browserID ?? UserDefaults.standard.string(forKey:key)
        let candidates=browserID.map{[$0]} ?? [preferred,"com.google.Chrome","org.mozilla.firefox"].compactMap{$0}
        guard let selected=candidates.first(where:{["org.mozilla.firefox","com.google.Chrome"].contains($0) && NSWorkspace.shared.urlForApplication(withBundleIdentifier:$0) != nil}),let browser=NSWorkspace.shared.urlForApplication(withBundleIdentifier:selected) else{throw PortalError("選んだブラウザーが見つかりません。Google ChromeまたはFirefox ESR 115をインストールしてください。")}
        task.arguments=["-a",browser.path,html.absoluteString+"#native=\(port).\(token)"]
        #else
        task.arguments=["-a","Google Chrome",html.absoluteString+"#native=\(port).\(token)"]
        #endif
        try task.run()
        #if MOJAVE
        if browserID != nil{UserDefaults.standard.set(selected,forKey:key)}
        #endif
    }
    func reply(_ connection: NWConnection,_ status: Int,_ body: Data,_ binary: Bool=false,_ cors: Bool=true) {
        var header="HTTP/1.1 \(status) Response\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Type: \(binary ? "application/octet-stream" : "application/json; charset=utf-8")\r\nContent-Length: \(body.count)\r\n"
        if cors { header += "Access-Control-Allow-Origin: null\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-Game-Portal-Token\r\nAccess-Control-Allow-Private-Network: true\r\nVary: Origin\r\n" }
        // Keep large assets out of a second header+body allocation.
        connection.send(content:Data((header+"\r\n").utf8),completion:.contentProcessed{error in
            if error != nil {connection.cancel();return}
            connection.send(content:body,completion:.contentProcessed{_ in connection.cancel()})
        })
    }
    func handle(_ connection: NWConnection,_ bytes: Data) throws {
        guard let split=bytes.range(of:Data("\r\n\r\n".utf8)), let head=String(data:bytes[..<split.lowerBound],encoding:.utf8) else{throw PortalError("リクエストが不正です。")}
        let lines=head.components(separatedBy:"\r\n"), request=lines[0].components(separatedBy:" ")
        guard request.count==3 else{throw PortalError("リクエストが不正です。")}
        var headers=[String:String]()
        for line in lines.dropFirst(){guard let colon=line.firstIndex(of:":") else{throw PortalError("ヘッダーが不正です。")};let key=line[..<colon].lowercased();guard headers[key]==nil else{throw PortalError("ヘッダーが重複しています。")};headers[key]=line[line.index(after:colon)...].trimmingCharacters(in:.whitespaces)}
        guard headers["host"] == "127.0.0.1:\(port)" && headers["origin"] == "null" && request[1]=="/native/folder" && headers["transfer-encoding"]==nil else{reply(connection,403,try json(["error":"HTMLから接続してください。"]),false,false);return}
        if request[0]=="OPTIONS"{reply(connection,200,try json(["ok":true]));return}
        guard request[0]=="POST" && headers["x-game-portal-token"]==token else{reply(connection,403,try json(["error":"Mac起動補助からHTMLを開き直してください。"]));return}
        guard headers["content-type"]?.components(separatedBy:";")[0]=="application/json", let length=Int(headers["content-length"] ?? ""),length>1,length<=16384,bytes.count-split.upperBound==length else{throw PortalError("リクエストが不正です。")}
        let data=try object(bytes[split.upperBound...]);guard data["version"] as? String == version, let action=data["action"] as? String,let path=data["path"] as? String,path.utf8.count<=4000,Set(data.keys)==Set(["version","action","path"]) || action=="read" && Set(data.keys)==Set(["version","action","path","limit"]) else{throw PortalError("HTMLとMac起動補助を同じ最新版にしてください。")}
        let (configuredRoot,configuredID,configuredError)=configuredFolder()
        if let error=configuredError{throw PortalError(error)}
        guard let root=configuredRoot else{reply(connection,200,try json(["configured":false]));return}
        _=try checkLibrary(root,configuredID)
        if action=="info" && path.isEmpty {reply(connection,200,try json(["configured":true,"name":root.lastPathComponent]));return}
        let url=path.isEmpty ? root : try bound(root,path)
        switch action {
        case "list":
            let urls=try fm.contentsOfDirectory(at:url,includingPropertiesForKeys:[.isDirectoryKey,.isRegularFileKey,.isSymbolicLinkKey]);guard urls.count<=10000 else{throw PortalError("フォルダー内の項目が多すぎます。")}
            var entries=[[String:String]]();for child in urls{let values=try child.resourceValues(forKeys:[.isDirectoryKey,.isRegularFileKey,.isSymbolicLinkKey]);if values.isSymbolicLink != true && (values.isDirectory == true || values.isRegularFile == true) {entries.append(["name":child.lastPathComponent,"kind":values.isDirectory == true ? "directory":"file"])}}
            reply(connection,200,try json(["entries":entries]))
        case "stat":let values=try url.resourceValues(forKeys:[.isDirectoryKey,.isRegularFileKey,.fileSizeKey]);guard values.isDirectory == true || values.isRegularFile == true else{throw PortalError("通常のファイルではないため読み取れません。")};reply(connection,200,try json(["kind":values.isDirectory == true ? "directory":"file","size":values.isDirectory == true ? 0:values.fileSize ?? 0]))
        case "read":
            guard !path.isEmpty else{throw PortalError("ファイルを指定してください。")}
            var limit=200*1024*1024
            if let value=data["limit"]{guard let number=value as? NSNumber,CFGetTypeID(number) != CFBooleanGetTypeID(),number.doubleValue>=0,number.doubleValue<=Double(limit),number.doubleValue.rounded(.down)==number.doubleValue else{throw PortalError("読み込み上限が不正です。")};limit=number.intValue}
            reply(connection,200,try read(url,limit),true)
        default:throw PortalError("この自動接続は読み取り専用です。")
        }
    }
    listener.newConnectionHandler={ connection in
        guard slots.wait(timeout:.now()) == .success else{connection.cancel();return}
        let worker=DispatchQueue(label:"gameportal.connection")
        var deadline=DispatchWorkItem{connection.cancel()}
        connection.stateUpdateHandler={state in if case .cancelled=state{deadline.cancel();slots.signal()} }
        connection.start(queue:worker);worker.asyncAfter(deadline:.now()+15,execute:deadline)
        var buffer=Data()
        func receive(){connection.receive(minimumIncompleteLength:1,maximumLength:32768){data,_,complete,error in
            if let data=data{buffer.append(data)}
            do{
                if let split=buffer.range(of:Data("\r\n\r\n".utf8)){
                    guard split.lowerBound<=16384, let header=String(data:buffer[..<split.lowerBound],encoding:.utf8) else{throw PortalError("リクエストが大きすぎます。")}
                    let lengths=header.components(separatedBy:"\r\n").filter{$0.lowercased().hasPrefix("content-length:")}
                    var length=0
                    if let first=lengths.first {
                        let fields=first.split(separator:":",maxSplits:1,omittingEmptySubsequences:false)
                        guard fields.count==2,let parsed=Int(fields[1].trimmingCharacters(in:.whitespaces)),parsed>=0,parsed<=16384 else{throw PortalError("リクエストの長さが不正です。")}
                        length=parsed
                    }
                    if buffer.count>=split.upperBound+length {deadline.cancel();deadline=DispatchWorkItem{connection.cancel()};worker.asyncAfter(deadline:.now()+125,execute:deadline);try handle(connection,buffer);return}
                }else if buffer.count>16384{throw PortalError("リクエストが大きすぎます。")}
                if complete || error != nil{connection.cancel()}else{receive()}
            }catch{
                let ns=error as NSError, name=(ns.domain==NSCocoaErrorDomain && [NSFileNoSuchFileError,NSFileReadNoSuchFileError].contains(ns.code)) ? "NotFoundError" : (error as? PortalError)?.name ?? "NotReadableError"
                reply(connection,400,(try? json(["error":(error as? PortalError)?.message ?? error.localizedDescription,"name":name])) ?? Data())
            }
        }}
        receive()
    }
    listener.stateUpdateHandler={state in
        switch state{
        case .ready:
            port=listener.port!.rawValue
            do{
                if let ready=ready {try json(["origin":"http://127.0.0.1:\(port)","token":token]).write(to:ready)}
                if !headless {try openPortal();print("GAME PORTAL：このウィンドウを閉じると自動接続が終了します。")}
            }catch{
                #if MOJAVE
                reportMojaveError((error as? PortalError)?.message ?? error.localizedDescription)
                #else
                fputs("\(error)\n",stderr);exit(1)
                #endif
            }
        case .failed(let error):fputs("\(error)\n",stderr);exit(1)
        default:break
        }
    }
    listener.start(queue:queue)
    #if MOJAVE
    if mojaveApp {
        NSApplication.shared.setActivationPolicy(.accessory);let menu=MojaveMenu();menu.open={browser in do{try openPortal(browser)}catch{let notice=NSAlert();notice.messageText="ブラウザーを開けません";notice.informativeText=(error as? PortalError)?.message ?? error.localizedDescription;notice.runModal()}}
        menu.choose={let dialog=NSOpenPanel();dialog.title="次回の保存先を選んでください";dialog.canChooseFiles=false;dialog.canChooseDirectories=true;dialog.allowsMultipleSelection=false;if dialog.runModal() == .OK,let selected=dialog.url{do{let id=try checkLibrary(selected);UserDefaults.standard.set(["path":selected.path,"libraryId":id],forKey:"GamePortalMojaveFolder:"+html.deletingLastPathComponent().path);let notice=NSAlert();notice.messageText="次回の起動から切り替わります";notice.informativeText="今開いているゲームの保存先は変わりません。";notice.runModal()}catch{let notice=NSAlert();notice.messageText="この保存先を開けません";notice.informativeText=(error as? PortalError)?.message ?? error.localizedDescription;notice.runModal()}}}
        NSApplication.shared.delegate=menu;menu.install();NSApplication.shared.run();withExtendedLifetime(menu){}
    }else{dispatchMain()}
    #else
    dispatchMain()
    #endif
}catch{
    #if MOJAVE
    reportMojaveError((error as? PortalError)?.message ?? error.localizedDescription)
    #else
    fputs("GAME PORTAL: \((error as? PortalError)?.message ?? error.localizedDescription)\n",stderr);exit(1)
    #endif
}
