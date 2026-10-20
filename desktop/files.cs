using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Web.Script.Serialization;

internal sealed class DesktopFiles {
    internal sealed class Root { public string Path,Token,Secret,Id; public bool InitializingId; }
    sealed class Lease { public Root Root;public string Path;public FileStream Stream;public bool Committing; }
    readonly Dictionary<string,Lease> leases=new Dictionary<string,Lease>();
    readonly Dictionary<string,Root> roots=new Dictionary<string,Root>();
    readonly object gate=new object();
    readonly string config,applicationDirectory;readonly DesktopSharedConnection shared;
    internal readonly JavaScriptSerializer Json=new JavaScriptSerializer {MaxJsonLength=2100000};
    internal DesktopFiles(string profile,string applicationDirectory=null){Directory.CreateDirectory(profile);config=System.IO.Path.Combine(profile,"folder.json");this.applicationDirectory=applicationDirectory==null?null:NormalizeRoot(PortalNative.ConfigurationDirectory(applicationDirectory));if(this.applicationDirectory!=null)shared=new DesktopSharedConnection(this,this.applicationDirectory);}
    internal static string Secret(){using(var random=RandomNumberGenerator.Create()){byte[] bytes=new byte[32];random.GetBytes(bytes);return BitConverter.ToString(bytes).Replace("-","").ToLowerInvariant();}}
    internal string Serialize(object value){lock(Json)return Json.Serialize(value);}
    internal Dictionary<string,object> Parse(string text){lock(Json)return Json.Deserialize<Dictionary<string,object>>(text);}
    internal static string Text(Dictionary<string,object> data,string key){object value;return data.TryGetValue(key,out value)&&value is string?(string)value:"";}
    internal static bool Flag(Dictionary<string,object> data,string key){object value;return data.TryGetValue(key,out value)&&value is bool&&(bool)value;}
    internal static bool ValidId(string id){return System.Text.RegularExpressions.Regex.IsMatch(id??"","^[a-f0-9]{32}$");}
    internal string LibraryId(string path){
        string file=System.IO.Path.Combine(path,".gameportal","library-id.json");if(!File.Exists(file))return null;
        if(new FileInfo(file).Length>1024)throw new IOException("保存先のID設定を確認してください。");
        string checkedPath=BoundPath(path,".gameportal/library-id.json",false);
        var data=Parse(File.ReadAllText(checkedPath,Encoding.UTF8));object schema;
        if(!data.TryGetValue("schema",out schema)||!(schema is int)||(int)schema!=1||!ValidId(Text(data,"id")))throw new IOException("保存先のID設定が壊れています。");return Text(data,"id");
    }
    internal static string BoundPath(string root,string relative,bool allowRoot){
        if(relative==""&&allowRoot)return root;
        if(String.IsNullOrEmpty(relative)||relative.Length>1000)throw new IOException("保存先のパスを確認してください。");
        foreach(string part in relative.Split('/'))if(part.Length==0||part=="."||part==".."||part.EndsWith(".")||part.EndsWith(" ")||part.Any(c=>Char.IsControl(c)||"\\:<>\"|?*".Contains(c))||System.Text.RegularExpressions.Regex.IsMatch(part,"^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\\.|$)",System.Text.RegularExpressions.RegexOptions.IgnoreCase))throw new IOException("保存先の外は操作できません。");
        string prefix=System.IO.Path.GetFullPath(root).TrimEnd('\\')+"\\",full=System.IO.Path.GetFullPath(System.IO.Path.Combine(root,relative.Replace('/','\\')));
        if(!full.StartsWith(prefix,StringComparison.OrdinalIgnoreCase))throw new IOException("保存先の外は操作できません。");
        string current=root;
        if((File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)throw new IOException("リンクを経由した保存先は選べません。");
        foreach(string part in relative.Split('/')){current=System.IO.Path.Combine(current,part);if((Directory.Exists(current)||File.Exists(current))&&(File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)throw new IOException("リンクを経由したファイルは操作できません。");}
        return full;
    }
    internal static string NormalizeRoot(string path){
        path=(path??"").Trim();if(path.StartsWith("\"")&&path.EndsWith("\"")&&path.Length>=2)path=path.Substring(1,path.Length-2);
        path=path.Replace('/','\\');
        if(path.Length>1000||path.StartsWith("\\\\?\\")||path.StartsWith("\\\\.\\")||!System.Text.RegularExpressions.Regex.IsMatch(path,@"^(?:[a-zA-Z]:\\|\\\\[^\\]+\\[^\\]+(?:\\|$))"))throw new IOException("フォルダーのフルパスを入力してください。NASは \\\\サーバー名\\共有名 の形で指定します。");
        string full=System.IO.Path.GetFullPath(path),root=System.IO.Path.GetPathRoot(full);return full.Length==root.Length?full:full.TrimEnd('\\');
    }
    internal Root Register(string path,string expected=null){
        path=NormalizeRoot(path);if(File.Exists(path))throw new InvalidDataException("ファイルではなく、保存先フォルダーを選んでください。");if(!Directory.Exists(path))throw new DirectoryNotFoundException("保存先が見つかりません。NASの場合はエクスプローラーで共有フォルダーを開き、接続・サインインを確認してください。");
        if((File.GetAttributes(path)&FileAttributes.ReparsePoint)!=0)throw new IOException("リンクを経由した保存先は選べません。");
        string id=LibraryId(path);if(expected!=null&&expected!=id)throw new IOException("保存先のIDが変わりました。元の保存先と設定を確認してください。");
        lock(gate){foreach(var item in roots.Values)if(String.Equals(item.Path,path,StringComparison.OrdinalIgnoreCase)&&item.Id==id)return item;var root=new Root {Path=path,Token=Secret(),Secret=Secret(),Id=id};roots[root.Token]=root;return root;}
    }
    internal Root Known(string token){Root root;lock(gate){if(!roots.TryGetValue(token,out root))throw new IOException("保存先に接続し直してください。");}return root;}
    internal Root Get(string token){Root root=Known(token);if(!Directory.Exists(root.Path))throw new IOException("保存先に接続できません。NASやドライブの接続を確認してください。");string id;
        string idFile=System.IO.Path.Combine(root.Path,".gameportal","library-id.json");
        if(root.Id==null&&root.InitializingId&&File.Exists(idFile)&&new FileInfo(idFile).Length==0)id=null;else id=LibraryId(root.Path);
        if(root.Id!=null&&id!=root.Id)throw new IOException("保存先のIDが変わりました。元の保存先を確認してください。");if(root.Id==null&&id!=null)root.Id=id;return root;}
    internal object Record(Root root){return root==null?null:new {name=new DirectoryInfo(root.Path).Name,token=root.Token,secret=root.Secret,revision=root.Token,connectionHint=shared==null?"":shared.Message};}
    internal Root Restore(){
        if(!File.Exists(config))return shared==null?null:shared.Restore();
        if(new FileInfo(config).Length>8192)throw new IOException("このPCの保存先の記憶を確認してください。");
        var saved=Parse(File.ReadAllText(config,Encoding.UTF8));object schema;string path=Text(saved,"path"),id=Text(saved,"id");
        if(!saved.TryGetValue("schema",out schema)||!(schema is int)||(int)schema!=1)throw new IOException("このPCの保存先の記憶を確認してください。");
        if(applicationDirectory!=null&&Text(saved,"application").Length>0&&!String.Equals(Text(saved,"application"),applicationDirectory,StringComparison.OrdinalIgnoreCase))return shared.Restore();
        // An explicit local choice must also suppress the shared default. Keep
        // the shared file intact so other PCs can continue to use it.
        if(Flag(saved,"forgotten")&&path.Length==0&&id.Length==0)return null;
        if(path.Length==0||id.Length>0&&!ValidId(id))throw new IOException("このPCの保存先の記憶を確認してください。");return Register(path,id.Length==0?null:id);
    }
    internal void Remember(Root root,bool shareDefault=true){root=Get(root.Token);string text=Serialize(new {schema=1,path=root.Path,id=root.Id??"",application=applicationDirectory??""});Atomic(config,new MemoryStream(Encoding.UTF8.GetBytes(text)),8192);if(shareDefault&&shared!=null)shared.Remember(root);}
    internal void Forget(){Atomic(config,new MemoryStream(Encoding.UTF8.GetBytes(Serialize(new {schema=1,forgotten=true,application=applicationDirectory??""}))),8192);}
    internal object SharedInfo(Root root){if(shared==null)throw new IOException("ランチャーの共有設定を確認してください。");return shared.Info(Get(root.Token));}
    internal object Share(Root root,string revision){if(shared==null)throw new IOException("ランチャーの共有設定を確認してください。");shared.Publish(Get(root.Token),revision);return Record(root);}
    internal bool HasWriters {get{lock(gate)return leases.Count>0;}}
    internal object BeginWrite(Root root,string path){
        Full(root,path);string lockDirectory=Full(root,".gameportal/desktop-locks");Directory.CreateDirectory(lockDirectory);
        string key;using(var hash=SHA256.Create())key=BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(path.ToUpperInvariant()))).Replace("-","").ToLowerInvariant();
        string lockFile=Full(root,".gameportal/desktop-locks/"+key+".lock");FileStream stream;
        try{stream=new FileStream(lockFile,FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);}catch(IOException error){if((error.HResult&65535)==32||(error.HResult&65535)==33)throw new DesktopWriteBusyException();throw;}
        string token=Secret();lock(gate)leases[token]=new Lease {Root=root,Path=path,Stream=stream};return new {token=token};
    }
    internal void AbortWrite(Root root,string token){Lease lease;lock(gate){if(!leases.TryGetValue(token,out lease))return;if(lease.Root!=root)throw new IOException("保存の起動元が違います。");if(lease.Committing)return;leases.Remove(token);}lease.Stream.Dispose();}
    internal void ReleaseUncommitted(){KeyValuePair<string,Lease>[] pending;lock(gate)pending=leases.Where(item=>!item.Value.Committing).ToArray();foreach(var item in pending)AbortWrite(item.Value.Root,item.Key);}
    internal void CommitWrite(Root root,string path,string token,Stream input){
        Lease lease;lock(gate){if(!leases.TryGetValue(token,out lease)||lease.Root!=root||!String.Equals(path,lease.Path,StringComparison.OrdinalIgnoreCase)||lease.Committing)throw new IOException("保存処理が一致しません。");lease.Committing=true;}
        try{Write(root,path,input);}finally{lock(gate)leases.Remove(token);lease.Stream.Dispose();}
    }
    internal string Full(Root root,string path,bool allowRoot=false){Get(root.Token);return BoundPath(root.Path,path,allowRoot);}
    internal object Stat(Root root,string path){string full=Full(root,path,true);if(Directory.Exists(full))return new {kind="directory",size=0L};var file=new FileInfo(full);if(!file.Exists)throw new FileNotFoundException("ファイルが見つかりません。");return new {kind="file",size=file.Length};}
    internal static bool IsMetadataTemporary(string name){return System.Text.RegularExpressions.Regex.IsMatch(name,@"\.gameportal\.json(?:~RF[0-9a-f]{1,32}\.tmp|\.desktop-[0-9a-f]{64}\.tmp|\.crswap)$",System.Text.RegularExpressions.RegexOptions.IgnoreCase);}
    internal object List(Root root,string path){string full=Full(root,path,true);var entries=new List<object>();int visited=0;foreach(string item in Directory.EnumerateFileSystemEntries(full)){if(++visited>10000)throw new IOException("フォルダー内の項目が多すぎます。");string name=System.IO.Path.GetFileName(item);if(IsMetadataTemporary(name))continue;var attributes=File.GetAttributes(item);if((attributes&FileAttributes.ReparsePoint)!=0)continue;entries.Add(new {name=name,kind=(attributes&FileAttributes.Directory)!=0?"directory":"file"});}return new {entries=entries};}
    internal void Entry(Root root,string path,bool directory,bool create){string full=Full(root,path);if(directory){if(File.Exists(full))throw new InvalidDataException("ファイルとフォルダーの種類が違います。");if(!Directory.Exists(full)){if(!create)throw new DirectoryNotFoundException("フォルダーが見つかりません。");Directory.CreateDirectory(full);}}else{if(Directory.Exists(full))throw new InvalidDataException("ファイルとフォルダーの種類が違います。");if(!File.Exists(full)){if(!create)throw new FileNotFoundException("ファイルが見つかりません。");using(new FileStream(full,FileMode.CreateNew,FileAccess.Write,FileShare.Read)){} if(path==".gameportal/library-id.json"&&root.Id==null)root.InitializingId=true;}}}
    internal Stream Read(Root root,string path){string full=Full(root,path);var stream=new FileStream(full,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete);if(stream.Length>200L*1024*1024){stream.Dispose();throw new IOException("ファイルは200MB以内にしてください。");}return stream;}
    internal static void Atomic(string destination,Stream input,long limit){
        string temp=destination+".desktop-"+Secret()+".tmp";bool moved=false;
        try{
            using(var output=new FileStream(temp,FileMode.CreateNew,FileAccess.Write,FileShare.None)){
                byte[] buffer=new byte[65536];long length=0;int count;
                while((count=input.Read(buffer,0,buffer.Length))!=0){length+=count;if(length>limit)throw new IOException("ファイルは200MB以内にしてください。");output.Write(buffer,0,count);}output.Flush(true);
            }
            if(File.Exists(destination))File.Replace(temp,destination,null);else File.Move(temp,destination);moved=true;
        }finally{if(!moved&&File.Exists(temp))try{File.Delete(temp);}catch(IOException){}}
    }
    internal void Write(Root root,string path,Stream input){
        string full=Full(root,path);if(path==".gameportal/library-id.json"){
            using(var memory=new MemoryStream()){byte[] bytes=new byte[1025];int count,total=0;while((count=input.Read(bytes,total,bytes.Length-total))>0){total+=count;if(total>=bytes.Length)throw new IOException("ID設定が大きすぎます。");}memory.Write(bytes,0,total);memory.Position=0;var data=Parse(Encoding.UTF8.GetString(bytes,0,total));object schema;if(!data.TryGetValue("schema",out schema)||!(schema is int)||(int)schema!=1||!ValidId(Text(data,"id"))||root.Id!=null&&root.Id!=Text(data,"id"))throw new IOException("保存先のIDを変更できません。");Atomic(full,memory,1024);root.Id=Text(data,"id");root.InitializingId=false;}return;
        }
        Atomic(full,input,200L*1024*1024);
    }
    internal void Remove(Root root,string path,bool recursive){
        if(path==".gameportal"||path==".gameportal/library-id.json")throw new IOException("保存先のID設定は削除できません。");
        string full=Full(root,path);if(File.Exists(full)){File.Delete(full);return;}if(!Directory.Exists(full))throw new FileNotFoundException("項目が見つかりません。");
        if(recursive)CheckTree(full);Directory.Delete(full,recursive);
    }
    static void CheckTree(string path){foreach(string item in Directory.EnumerateFileSystemEntries(path)){var attributes=File.GetAttributes(item);if((attributes&FileAttributes.ReparsePoint)!=0)throw new IOException("リンクを含むフォルダーは削除できません。");if((attributes&FileAttributes.Directory)!=0)CheckTree(item);}}
    internal static string ErrorName(Exception error){if(error is DesktopWriteBusyException)return "NoModificationAllowedError";if(error is FileNotFoundException||error is DirectoryNotFoundException)return "NotFoundError";if(error is UnauthorizedAccessException)return "NotAllowedError";if(error is InvalidDataException)return "TypeMismatchError";return "NotReadableError";}
}
internal sealed class DesktopWriteBusyException:IOException {internal DesktopWriteBusyException():base("ほかの画面で保存中です。完了してからもう一度保存してください。"){} }
