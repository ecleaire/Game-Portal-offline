import Foundation
import Network
import Security
import CoreFoundation

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
    let file=try FileHandle(forReadingFrom:url); defer { try? file.close() }
    let data=try file.read(upToCount:limit+1) ?? Data()
    guard data.count<=limit else { throw PortalError("ファイルが大きすぎます。") }; return data
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
    let config=html.deletingLastPathComponent().appendingPathComponent("GAME-PORTAL-FOLDER.txt")
    var root: URL?=nil, libraryID: String?=nil
    if fm.fileExists(atPath:config.path) {
        guard let raw=String(data:try read(config,8192),encoding:.utf8) else {throw PortalError("保存先設定はUTF-8で保存してください。")}
        let path=(raw.hasPrefix("\u{FEFF}") ? String(raw.dropFirst()) : raw).trimmingCharacters(in:.whitespacesAndNewlines)
        guard !path.isEmpty && !path.contains(where:{$0.isNewline || $0 == "\0"}) else {throw PortalError("GAME-PORTAL-FOLDER.txtには保存先を1行で指定してください。")}
        let url=path.hasPrefix("/") ? URL(fileURLWithPath:path).standardizedFileURL : html.deletingLastPathComponent().appendingPathComponent(path).standardizedFileURL
        let values=try url.resourceValues(forKeys:[.isDirectoryKey,.isSymbolicLinkKey]);guard values.isDirectory == true && values.isSymbolicLink != true else{throw PortalError("自動接続の保存先にアクセスできません。")}
        libraryID=try checkLibrary(url);root=url
    }
    let configuredRoot=root, configuredID=libraryID
    var secret=[UInt8](repeating:0,count:32)
    guard SecRandomCopyBytes(kSecRandomDefault,secret.count,&secret)==errSecSuccess else {throw PortalError("起動補助を開始できません。")}
    let token=secret.map{String(format:"%02x",$0)}.joined()
    let parameters=NWParameters.tcp;parameters.requiredLocalEndpoint = .hostPort(host:"127.0.0.1",port:.any)
    let listener=try NWListener(using:parameters)
    let queue=DispatchQueue(label:"gameportal.listener"), slots=DispatchSemaphore(value:8)
    var port: UInt16=0
    func reply(_ connection: NWConnection,_ status: Int,_ body: Data,_ binary: Bool=false,_ cors: Bool=true) {
        var header="HTTP/1.1 \(status) Response\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Type: \(binary ? "application/octet-stream" : "application/json; charset=utf-8")\r\nContent-Length: \(body.count)\r\n"
        if cors { header += "Access-Control-Allow-Origin: null\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-Game-Portal-Token\r\nAccess-Control-Allow-Private-Network: true\r\nVary: Origin\r\n" }
        connection.send(content:Data((header+"\r\n").utf8)+body,completion:.contentProcessed{_ in connection.cancel()})
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
        let data=try object(bytes[split.upperBound...]);guard Set(data.keys)==Set(["version","action","path"]),data["version"] as? String == version, let action=data["action"] as? String,let path=data["path"] as? String,path.utf8.count<=4000 else{throw PortalError("HTMLとMac起動補助を同じ最新版にしてください。")}
        guard let root=configuredRoot else{reply(connection,200,try json(["configured":false]));return}
        _=try checkLibrary(root,configuredID)
        if action=="info" && path.isEmpty {reply(connection,200,try json(["configured":true,"name":root.lastPathComponent]));return}
        let url=path.isEmpty ? root : try bound(root,path)
        switch action {
        case "list":
            let urls=try fm.contentsOfDirectory(at:url,includingPropertiesForKeys:[.isDirectoryKey,.isSymbolicLinkKey]);guard urls.count<=10000 else{throw PortalError("フォルダー内の項目が多すぎます。")}
            var entries=[[String:String]]();for child in urls{let values=try child.resourceValues(forKeys:[.isDirectoryKey,.isSymbolicLinkKey]);if values.isSymbolicLink != true {entries.append(["name":child.lastPathComponent,"kind":values.isDirectory == true ? "directory":"file"])}}
            reply(connection,200,try json(["entries":entries]))
        case "stat":let values=try url.resourceValues(forKeys:[.isDirectoryKey]);reply(connection,200,try json(["kind":values.isDirectory == true ? "directory":"file"]))
        case "read":guard !path.isEmpty else{throw PortalError("ファイルを指定してください。")};reply(connection,200,try read(url,200*1024*1024),true)
        default:throw PortalError("この自動接続は読み取り専用です。")
        }
    }
    listener.newConnectionHandler={ connection in
        guard slots.wait(timeout:.now()) == .success else{connection.cancel();return}
        let worker=DispatchQueue(label:"gameportal.connection"),deadline=DispatchWorkItem{connection.cancel()}
        connection.stateUpdateHandler={state in if case .cancelled=state{deadline.cancel();slots.signal()} }
        connection.start(queue:worker);worker.asyncAfter(deadline:.now()+15,execute:deadline)
        var buffer=Data()
        func receive(){connection.receive(minimumIncompleteLength:1,maximumLength:32768){data,_,complete,error in
            if let data=data{buffer.append(data)}
            do{
                if let split=buffer.range(of:Data("\r\n\r\n".utf8)){
                    guard split.lowerBound<=16384, let header=String(data:buffer[..<split.lowerBound],encoding:.utf8) else{throw PortalError("リクエストが大きすぎます。")}
                    let lengths=header.components(separatedBy:"\r\n").filter{$0.lowercased().hasPrefix("content-length:")}
                    let length=lengths.first.flatMap{Int($0.split(separator:":",maxSplits:1)[1].trimmingCharacters(in:.whitespaces))} ?? 0
                    guard length>=0 && length<=16384 else{throw PortalError("リクエストが大きすぎます。")}
                    if buffer.count>=split.upperBound+length {try handle(connection,buffer);return}
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
                if !headless {let task=Process();task.executableURL=URL(fileURLWithPath:"/usr/bin/open");task.arguments=[html.absoluteString+"#native=\(port).\(token)"];try task.run();print("GAME PORTAL：このウィンドウを閉じると自動接続が終了します。")}
            }catch{fputs("\(error)\n",stderr);exit(1)}
        case .failed(let error):fputs("\(error)\n",stderr);exit(1)
        default:break
        }
    }
    listener.start(queue:queue);dispatchMain()
}catch{fputs("GAME PORTAL: \((error as? PortalError)?.message ?? error.localizedDescription)\n",stderr);exit(1)}
