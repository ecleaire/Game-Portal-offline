using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Diagnostics;
using System.Threading;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Drawing;

internal static class PortalNative {
    const string Version = "__VERSION__";
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 2100000 };
    static readonly object JsonLock = new object(), RootLock = new object();
    static readonly Dictionary<string,string> Roots = new Dictionary<string,string>();
    static readonly SemaphoreSlim Slots = new SemaphoreSlim(8);
    static TcpListener Listener;
    static Control Dispatcher;
    static string Token, Origin, Html, FixedRoot, AutoRoot, AutoId, AutoRootError;
    static bool Headless;
    static string Serialize(object value) { lock(JsonLock) return Json.Serialize(value); }
    static Dictionary<string,object> Parse(string value) { lock(JsonLock) return Json.Deserialize<Dictionary<string,object>>(value); }
    static string Text(Dictionary<string,object> value,string name) { object result; return value.TryGetValue(name,out result) && result is string ? (string)result : ""; }
    static bool Schema(Dictionary<string,object> value) { return value.ContainsKey("schema") && value["schema"] is int && (int)value["schema"] == 1; }
    static string Id(string value) { if(!Regex.IsMatch(value ?? "", "^[a-f0-9]{32}$")) throw new Exception("作品と保管フォルダーのIDを確認してください。"); return value; }
    static string Read(string path,int limit) { var info=new FileInfo(path);if(info.Length>limit)throw new Exception("設定ファイルが大きすぎます。"); return File.ReadAllText(path,Encoding.UTF8); }
    internal static string ConfigurationDirectory(string directory) {
        directory=Path.GetFullPath(directory);if(directory.Length>Path.GetPathRoot(directory).Length)directory=directory.TrimEnd(Path.DirectorySeparatorChar);
        var role=new DirectoryInfo(directory);var platform=role.Parent;
        if(platform==null||!(role.Name=="プレイ用"||role.Name=="クリエイター用")||!new[]{"Windows","Mac","HTML"}.Contains(platform.Name)||platform.Parent==null)return directory;
        string root=platform.Parent.FullName,internalDirectory=Path.Combine(root,"_内部ファイル"),marker=Path.Combine(internalDirectory,"GAME-PORTAL-DISTRIBUTION.json");
        if(Directory.Exists(internalDirectory)&&(File.GetAttributes(internalDirectory)&FileAttributes.ReparsePoint)!=0)throw new IOException("配布フォルダーのリンクを確認してください。");
        if(!File.Exists(marker))marker=Path.Combine(root,"GAME-PORTAL-DISTRIBUTION.json");
        if(!File.Exists(marker))return directory;
        foreach(string path in new[]{directory,platform.FullName,root,marker})if((File.GetAttributes(path)&FileAttributes.ReparsePoint)!=0)throw new IOException("配布フォルダーのリンクを確認してください。");
        var record=Parse(Read(marker,1024));if(!Schema(record)||Text(record,"project")!="GAME-PORTAL"||Text(record,"layout")!="platform-role")throw new IOException("配布フォルダーの設定を確認してください。");
        return root;
    }
    static string Bound(string root,string relative,bool publicPath) {
        if(String.IsNullOrEmpty(relative) || relative.Length>1000)throw new Exception("保存先のパスが不正です。");
        foreach(string part in relative.Split('/')) {
            if(part.Length==0 || part=="." || part==".." || part.EndsWith(".") || part.EndsWith(" ") || (publicPath && part.StartsWith(".")) ||
               part.Any(c=>Char.IsControl(c)||"\\:<>\"|?*".Contains(c)) || Regex.IsMatch(part,"^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\\.|$)",RegexOptions.IgnoreCase))throw new Exception("保存先のパスが不正です。");
        }
        root=Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
        string full=Path.GetFullPath(Path.Combine(root,relative.Replace('/',Path.DirectorySeparatorChar)));
        if(!full.StartsWith(root,StringComparison.OrdinalIgnoreCase))throw new Exception("保管フォルダーの外は起動できません。");
        string current=root.TrimEnd(Path.DirectorySeparatorChar);
        if(current.EndsWith(":"))current+=Path.DirectorySeparatorChar;
        if((File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)throw new Exception("リンクを経由した保存先は起動できません。");
        foreach(string part in relative.Split('/')) { current=Path.Combine(current,part);if((File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)throw new Exception("リンクを経由した保存先は起動できません。"); }
        return full;
    }
    static void CheckLibrary(string root,string id) {
        var data=Parse(Read(Bound(root,".gameportal/library-id.json",false),1024));
        if(!Schema(data)||Text(data,"id")!=id)throw new Exception("HTMLと同じゲーム保管フォルダーを選んでください。");
        string compatibility=Path.Combine(root,".gameportal","compatibility.json");
        if(File.Exists(compatibility)) {
            var info=Parse(Read(Bound(root,".gameportal/compatibility.json",false),8192));
            string minimum=Text(info,"minLauncherVersion");
            if(!Schema(info)||!Regex.IsMatch(minimum,"^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$") || new System.Version(minimum)>new System.Version(Version))throw new Exception("Windows起動補助を最新に更新してください。");
            object features; if(!info.TryGetValue("requiredFeatures",out features)||!(features is System.Collections.IList))throw new Exception("互換性の設定を確認してください。");
            foreach(object feature in (System.Collections.IList)features)if(!(feature is string)||!new[]{"per-game-settings-v1","content-selector-v1","extended-tags-v1"}.Contains((string)feature))throw new Exception("このWindows起動補助では対応できないライブラリです。");
        }
    }
    static string Root(string id) {
        lock(RootLock) {
            string root;
            if(Roots.TryGetValue(id,out root)){CheckLibrary(root,id);return root;}
            root=FixedRoot;
            if(String.IsNullOrEmpty(root)) {
                if(Headless)throw new Exception("ゲーム保管フォルダーが未設定です。");
                root=(string)Dispatcher.Invoke(new Func<string>(()=>{
                    using(var dialog=new FolderBrowserDialog()) { dialog.Description="HTMLで選んだゲーム保管フォルダーを選んでください";dialog.ShowNewFolderButton=false;return dialog.ShowDialog()==DialogResult.OK?dialog.SelectedPath:null; }
                }));
            }
            if(String.IsNullOrEmpty(root))throw new Exception("フォルダーを選ばなかったため、EXEは起動していません。");
            root=Path.GetFullPath(root);CheckLibrary(root,id);Roots[id]=root;return root;
        }
    }
    static string Executable(string root,string path,string gameId) {
        if(!path.EndsWith(".exe",StringComparison.OrdinalIgnoreCase))throw new Exception("EXE以外は起動できません。");
        string full=Bound(root,path,true),sidecar=full+".gameportal.json";
        if(File.Exists(sidecar)) {var info=Parse(Read(Bound(root,path+".gameportal.json",false),2100000));if(!Schema(info)||Text(info,"id")!=gameId)throw new Exception("作品IDが変わっています。HTMLの一覧を更新してください。");}
        else { using(var sha=SHA256.Create()) {string expected=BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(path))).Replace("-","").ToLowerInvariant().Substring(0,32);if(expected!=gameId)throw new Exception("作品IDが一致しません。");} }
        string dir=Path.GetDirectoryName(full),stop=Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
        while(dir.Length>=stop.Length) {
            if(File.Exists(Path.Combine(dir,".gameportal-uploading")))throw new Exception("追加途中の作品は起動できません。");
            if(File.Exists(Path.Combine(dir,".gameportal-content.json"))||File.Exists(Path.Combine(dir,".gameportal-content-pending.json")))throw new Exception("EXE本体の設定を確認してください。Windowsゲームは保管フォルダーで入れ替えてください。");
            if(String.Equals(dir.TrimEnd(Path.DirectorySeparatorChar),stop,StringComparison.OrdinalIgnoreCase))break;dir=Path.GetDirectoryName(dir);if(dir==null)break;
        }
        using(var stream=new FileStream(full,FileMode.Open,FileAccess.Read,FileShare.Read))using(var reader=new BinaryReader(stream)) {
            if(stream.Length<88||stream.Length>200L*1024*1024||reader.ReadUInt16()!=0x5a4d)throw new Exception("WindowsのEXEファイルではありません。");
            stream.Position=60;long offset=reader.ReadUInt32();if(offset<64||offset>stream.Length-24)throw new Exception("EXEの起動情報が壊れています。");
            stream.Position=offset;if(reader.ReadUInt32()!=0x4550)throw new Exception("EXEの起動情報が壊れています。");stream.Position=offset+22;ushort flags=reader.ReadUInt16();if((flags&2)==0||(flags&0x2000)!=0)throw new Exception("DLLではなくEXEを選んでください。");
        }
        return full;
    }
    static void Reply(NetworkStream stream,int status,object value,bool cors) {
        byte[] bytes=Encoding.UTF8.GetBytes(Serialize(value));
        string headers="HTTP/1.1 "+status+" Response\r\nConnection: close\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: "+bytes.Length+"\r\n";
        if(cors)headers+="Access-Control-Allow-Origin: null\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-Game-Portal-Token\r\nAccess-Control-Allow-Private-Network: true\r\nVary: Origin\r\n";
        byte[] prefix=Encoding.ASCII.GetBytes(headers+"\r\n");stream.Write(prefix,0,prefix.Length);stream.Write(bytes,0,bytes.Length);
    }
    static void Folder(NetworkStream stream,Dictionary<string,object> data) {
        if(data==null||!(data.Count==3&&!data.ContainsKey("limit")||data.Count==4&&data.ContainsKey("limit")&&Text(data,"action")=="read")||data.Keys.Any(k=>!new[]{"version","action","path","limit"}.Contains(k))||Text(data,"version")!=Version)throw new Exception("HTMLと起動補助を同じ最新版にしてください。");
        lock(RootLock){if(String.IsNullOrEmpty(AutoRoot))ConfigureAutoRoot();}
        if(AutoRootError!=null)throw new Exception(AutoRootError);
        if(String.IsNullOrEmpty(AutoRoot)){Reply(stream,200,new{configured=false},true);return;}
        CheckLibrary(AutoRoot,AutoId);
        string action=Text(data,"action"),path=Text(data,"path");
        if(action=="info"&&path==""){Reply(stream,200,new{configured=true,name=new DirectoryInfo(AutoRoot).Name},true);return;}
        string full=path==""?AutoRoot:Bound(AutoRoot,path,false);
        if(action=="list") {
            if(!Directory.Exists(full))throw new DirectoryNotFoundException();
            var entries=new List<object>();
            foreach(string entry in Directory.EnumerateFileSystemEntries(full)){
                if(entries.Count>=10000)throw new Exception("フォルダー内の項目が多すぎます。");
                var attributes=File.GetAttributes(entry);if((attributes&FileAttributes.ReparsePoint)!=0)continue;
                entries.Add(new{name=Path.GetFileName(entry),kind=(attributes&FileAttributes.Directory)!=0?"directory":"file"});
            }
            Reply(stream,200,new{entries=entries},true);return;
        }
        if(path=="")throw new Exception("ファイルを指定してください。");
        if(action=="stat"){var attributes=File.GetAttributes(full);bool directory=(attributes&FileAttributes.Directory)!=0;Reply(stream,200,new{kind=directory?"directory":"file",size=directory?0:new FileInfo(full).Length},true);return;}
        if(action=="read"){
            int limit=200*1024*1024;object value;if(data.TryGetValue("limit",out value)){if(!(value is int)||(int)value<0||(int)value>limit)throw new Exception("読み込み上限が不正です。");limit=(int)value;}
            using(var input=new FileStream(full,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)){
                long length=input.Length;if(length>limit)throw new Exception("ファイルのサイズが上限を超えたか、読み込み前に変わりました。一覧を更新してもう一度試してください。");
                byte[] prefix=Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: application/octet-stream\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: null\r\nVary: Origin\r\nContent-Length: "+length+"\r\n\r\n");stream.Write(prefix,0,prefix.Length);
                byte[] buffer=new byte[65536];while(length>0){int n=input.Read(buffer,0,(int)Math.Min(buffer.Length,length));if(n==0)throw new IOException("読み込み中にファイルが変わりました。");stream.Write(buffer,0,n);length-=n;}
            }return;
        }
        throw new Exception("この自動接続は読み取り専用です。");
    }
    static void Handle(TcpClient client) {
        NetworkStream stream=null;Mutex lease=null;bool owned=false,cors=false;Process process=null;
        try {
            stream=client.GetStream();stream.ReadTimeout=5000;stream.WriteTimeout=5000;
            var head=new List<byte>();int next;
            while((next=stream.ReadByte())>=0) { head.Add((byte)next);int n=head.Count;if(n>=4&&head[n-4]==13&&head[n-3]==10&&head[n-2]==13&&head[n-1]==10)break;if(n>16384)throw new Exception("リクエストが大きすぎます。"); }
            string[] lines=Encoding.ASCII.GetString(head.ToArray()).Split(new[]{"\r\n"},StringSplitOptions.None),request=lines[0].Split(' ');
            if(request.Length!=3)throw new Exception("リクエストが不正です。");
            var headers=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
            foreach(string line in lines.Skip(1)) {int colon=line.IndexOf(':');if(line.Length==0)continue;if(colon<1)throw new Exception("ヘッダーが不正です。");headers.Add(line.Substring(0,colon),line.Substring(colon+1).Trim());}
            string lengthText;int length=0;
            if(headers.ContainsKey("Transfer-Encoding"))throw new Exception("リクエストが不正です。");
            if(headers.TryGetValue("Content-Length",out lengthText)&&(!Int32.TryParse(lengthText,out length)||length<0||length>16384))throw new Exception("リクエストが大きすぎます。");
            byte[] body=new byte[length];int count=0;while(count<length){int read=stream.Read(body,count,length-count);if(read==0)throw new Exception("リクエストが中断されました。");count+=read;}
            string host,origin;headers.TryGetValue("Origin",out origin);cors=origin=="null";
            if(!headers.TryGetValue("Host",out host)||host!="127.0.0.1:"+((IPEndPoint)Listener.LocalEndpoint).Port){Reply(stream,403,new{error="接続先が一致しません。"},false);return;}
            if(request[0]=="GET"&&request[1]=="/health"){Reply(stream,200,new{product="GAME PORTAL",version=Version},false);return;}
            if(!cors||(request[1]!="/native/launch"&&request[1]!="/native/folder")){Reply(stream,403,new{error="HTMLから接続してください。"},false);return;}
            if(request[0]=="OPTIONS"){Reply(stream,200,new{ok=true},true);return;}
            string token,type;
            if(request[0]!="POST"||!headers.TryGetValue("X-Game-Portal-Token",out token)||token!=Token){Reply(stream,403,new{error="Windows起動補助からHTMLを開き直してください。"},true);return;}
            if(length<2||!headers.TryGetValue("Content-Type",out type)||type.Split(';')[0].Trim()!="application/json")throw new Exception("起動リクエストが不正です。");
            var data=Parse(new UTF8Encoding(false,true).GetString(body));
            if(request[1]=="/native/folder"){Folder(stream,data);return;}
            if(data==null||data.Count!=4||data.Keys.Any(k=>!new[]{"libraryId","gameId","gamePath","version"}.Contains(k)))throw new Exception("起動リクエストが不正です。");
            if(Text(data,"version")!=Version)throw new Exception("HTMLとWindows起動補助を同じ最新版にしてください。");
            string libraryId=Id(Text(data,"libraryId")),gameId=Id(Text(data,"gameId")),root=Root(libraryId),full=Executable(root,Text(data,"gamePath"),gameId);
            lease=new Mutex(false,"Local\\GamePortalNative-"+libraryId+"-"+gameId);
            try { owned=lease.WaitOne(0); } catch(AbandonedMutexException) {owned=true;}
            if(!owned){Reply(stream,409,new{error="このEXEゲームは起動中です。ゲームを終了してから開いてください。"},true);return;}
            process=Process.Start(new ProcessStartInfo { FileName=full,WorkingDirectory=Path.GetDirectoryName(full),UseShellExecute=false,WindowStyle=ProcessWindowStyle.Normal });
            if(process==null)throw new Exception("Windowsがゲームを起動できませんでした。");
            Reply(stream,200,new{launched=true},true);
        } catch(Exception error) {try{if(stream!=null)Reply(stream,400,new{error=error.Message,name=error is FileNotFoundException||error is DirectoryNotFoundException?"NotFoundError":"NotReadableError"},cors);}catch{}} finally {client.Close();Slots.Release();if(!owned&&lease!=null)lease.Dispose();}
        try { if(process!=null)process.WaitForExit(); } catch(InvalidOperationException) {} finally {if(process!=null)process.Dispose();if(owned)lease.ReleaseMutex();if(lease!=null)lease.Dispose();}
    }
    static void Accept() {
        try {while(true){var client=Listener.AcceptTcpClient();if(!Slots.Wait(0)){client.Close();continue;}ThreadPool.QueueUserWorkItem(_=>Handle(client));}}catch(SocketException){}catch(ObjectDisposedException){}
    }
    static void OpenPortal() { Process.Start(new Uri(Html).AbsoluteUri+"#native="+((IPEndPoint)Listener.LocalEndpoint).Port+"."+Token); }
    // Resolve failed configuration again, but pin a successful root/ID for this process.
    static void ConfigureAutoRoot() {
        AutoRootError=null;
        string directory=ConfigurationDirectory(Path.GetDirectoryName(Html)),config=Path.Combine(directory,"GAME-PORTAL-FOLDER.txt"),shared=Path.Combine(directory,"GAME-PORTAL-CONNECTION.json");
        if(File.Exists(shared)){try{if((File.GetAttributes(shared)&FileAttributes.ReparsePoint)!=0)throw new IOException("共有接続設定のリンクを確認してください。");var record=Parse(Read(shared,8192));string relative=Text(record,"path"),id=Id(Text(record,"libraryId"));if(!Schema(record)||Text(record,"kind")!="relative"||String.IsNullOrEmpty(relative)||relative.Length>1000||Path.IsPathRooted(relative)||relative.Contains("\\")||relative.Contains(":")||relative.Any(Char.IsControl)||relative.Split('/').Length>32)throw new IOException("共有接続設定を確認してください。");string candidate=Path.GetFullPath(Path.Combine(directory,relative.Replace('/',Path.DirectorySeparatorChar)));CheckLibrary(candidate,id);AutoId=id;AutoRoot=candidate;if(String.IsNullOrEmpty(FixedRoot))FixedRoot=candidate;}catch(Exception error){AutoRootError="共有の保存先へ接続できません："+error.Message;}return;}
        if(!File.Exists(config))return;
        try {
            string path=Read(config,8192).Trim();if(path.Length==0||path.IndexOfAny(new[]{'\r','\n','\0'})>=0)throw new Exception("GAME-PORTAL-FOLDER.txtには保存先を1行で指定してください。");
            string candidate=Path.GetFullPath(Path.IsPathRooted(path)?path:Path.Combine(directory,path));
            if(!Directory.Exists(candidate)||(File.GetAttributes(candidate)&FileAttributes.ReparsePoint)!=0)throw new Exception("保存先が見つかりません。NASやドライブの接続を確認して再試行してください。");
            var library=Parse(Read(Bound(candidate,".gameportal/library-id.json",false),1024));string id=Id(Text(library,"id"));CheckLibrary(candidate,id);
            AutoId=id;AutoRoot=candidate;if(String.IsNullOrEmpty(FixedRoot))FixedRoot=AutoRoot;
        } catch(Exception error){AutoRootError="自動接続の設定を確認してください。GAME-PORTAL-FOLDER.txtを修正して再試行できます："+error.Message;}
    }
    [STAThread] static void Main(string[] args) {
        try {
            Html=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"GAME-PORTAL.html");if(!File.Exists(Html))Html=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"GAME-PORTAL-PLAY.html");string ready=null;
            for(int i=0;i<args.Length;i++){if(args[i]=="--headless")Headless=true;else if(args[i]=="--root")FixedRoot=args[++i];else if(args[i]=="--html")Html=Path.GetFullPath(args[++i]);else if(args[i]=="--ready-file")ready=args[++i];else throw new Exception("起動オプションが不正です。");}
            if(!File.Exists(Html))throw new Exception("同じフォルダーにGAME-PORTAL.htmlを置いてください。");
            byte[] secret=new byte[32];using(var rng=RandomNumberGenerator.Create())rng.GetBytes(secret);Token=BitConverter.ToString(secret).Replace("-","").ToLowerInvariant();
            Listener=new TcpListener(IPAddress.Loopback,0);Listener.Start();Origin="http://127.0.0.1:"+((IPEndPoint)Listener.LocalEndpoint).Port;
            if(ready!=null)File.WriteAllText(ready,Serialize(new{origin=Origin,token=Token}),new UTF8Encoding(false));
            if(Headless){Accept();return;}
            Application.EnableVisualStyles();Dispatcher=new Control();var handle=Dispatcher.Handle;
            using(var tray=new NotifyIcon()){tray.Icon=SystemIcons.Application;tray.Text="GAME PORTAL Windows起動補助（ベータ版）";tray.Visible=true;var menu=new ContextMenuStrip();menu.Items.Add("HTMLを開く",null,(s,e)=>OpenPortal());menu.Items.Add("終了",null,(s,e)=>Application.ExitThread());tray.ContextMenuStrip=menu;tray.DoubleClick+=(s,e)=>OpenPortal();
                var thread=new Thread(Accept);thread.IsBackground=true;thread.Start();OpenPortal();Application.Run();Listener.Stop();tray.Visible=false;}
        }catch(Exception error){if(!Headless)MessageBox.Show(error.Message,"GAME PORTAL",MessageBoxButtons.OK,MessageBoxIcon.Error);Environment.ExitCode=1;}
    }
}
