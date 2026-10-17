using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;

internal sealed class DesktopSharedConnection {
    internal const string FileName="GAME-PORTAL-CONNECTION.json";
    readonly DesktopFiles files;readonly string directory,file;
    internal string Message="";
    internal DesktopSharedConnection(DesktopFiles files,string directory){this.files=files;this.directory=DesktopFiles.NormalizeRoot(directory);file=Path.Combine(this.directory,FileName);}
    [DllImport("mpr.dll",CharSet=CharSet.Unicode)]static extern int WNetGetUniversalName(string path,int level,IntPtr buffer,ref int size);
    internal static string NetworkPath(string path){
        path=DesktopFiles.NormalizeRoot(path);if(path.StartsWith(@"\\"))return path;
        int size=0;if(WNetGetUniversalName(path,1,IntPtr.Zero,ref size)!=234||size<=0||size>32768)return null;
        IntPtr buffer=Marshal.AllocHGlobal(size);try{if(WNetGetUniversalName(path,1,buffer,ref size)!=0)return null;return DesktopFiles.NormalizeRoot(Marshal.PtrToStringUni(Marshal.ReadIntPtr(buffer)));}finally{Marshal.FreeHGlobal(buffer);}
    }
    static string Share(string path){if(path==null||!path.StartsWith(@"\\"))return null;string[] parts=path.Substring(2).Split('\\');return parts.Length>=2?parts[0]+"/"+parts[1]:null;}
    internal static string PortablePath(string application,string library){
        application=DesktopFiles.NormalizeRoot(application);library=DesktopFiles.NormalizeRoot(library);
        string networkApp=NetworkPath(application),networkLibrary=NetworkPath(library);
        if(networkApp!=null&&networkLibrary!=null&&String.Equals(Share(networkApp),Share(networkLibrary),StringComparison.OrdinalIgnoreCase)){application=networkApp;library=networkLibrary;}
        else if(!String.Equals(application,library,StringComparison.OrdinalIgnoreCase)&&!library.StartsWith(application.TrimEnd('\\')+"\\",StringComparison.OrdinalIgnoreCase))return null;
        var start=new Uri(application.TrimEnd('\\')+"\\");var target=new Uri(library.TrimEnd('\\')+"\\");string relative=Uri.UnescapeDataString(start.MakeRelativeUri(target).ToString()).TrimEnd('/');return relative.Length==0?".":relative;
    }
    internal static bool Relative(string path){return !String.IsNullOrEmpty(path)&&path.Length<=1000&&!Path.IsPathRooted(path)&&!path.Contains("\\")&&!path.Contains(":")&&!path.Contains("\0")&&!path.Contains("\n")&&!path.Contains("\r")&&path.Split('/').Length<=32;}
    internal DesktopFiles.Root Restore(){
        if(!File.Exists(file))return null;
        if((File.GetAttributes(file)&FileAttributes.ReparsePoint)!=0||new FileInfo(file).Length>8192)throw new IOException("アプリと同じ場所にある共有接続設定を確認してください。");
        var data=files.Parse(File.ReadAllText(file,Encoding.UTF8));object schema;string path=DesktopFiles.Text(data,"path"),id=DesktopFiles.Text(data,"libraryId");
        if(!data.TryGetValue("schema",out schema)||!(schema is int)||(int)schema!=1||DesktopFiles.Text(data,"kind")!="relative"||!Relative(path)||!DesktopFiles.ValidId(id))throw new IOException("共有接続設定が壊れているか、対応していません。保存先を選び直してください。");
        var root=files.Register(Path.GetFullPath(Path.Combine(directory,path.Replace('/','\\'))),id);Message="同じアプリを開くPCで、共有の保存先を使います。";return root;
    }
    internal void Remember(DesktopFiles.Root root){
        Message="";if(!DesktopFiles.ValidId(root.Id))return;string path=PortablePath(directory,root.Path);
        if(path==null)return;
        try{
            if(File.Exists(file)){var shared=Restore();if(shared.Id!=root.Id||!String.Equals(shared.Path,root.Path,StringComparison.OrdinalIgnoreCase))Message="このPCの保存先を記憶しました。共有の保存先は変更していません。";return;}
            byte[] bytes=Encoding.UTF8.GetBytes(files.Serialize(new {schema=1,kind="relative",path=path,libraryId=root.Id}));
            // Publish only a complete new record. Never replace another PC's chosen default.
            string temporary=file+"."+DesktopFiles.Secret()+".tmp";try{using(var output=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None)){output.Write(bytes,0,bytes.Length);output.Flush(true);}File.Move(temporary,file);}finally{if(File.Exists(temporary))File.Delete(temporary);}
            Message="保存先を共有しました。同じ場所のアプリを開くPCは、初回から接続できます。";
        }catch(Exception error){Message="このPCには記憶しました。接続先をほかのPCへ共有できませんでした："+error.Message;}
    }
}
