using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
internal static class DesktopSelfTest {
    static void Assert(bool condition,string message){if(!condition)throw new Exception(message);}
    static void Fails(Action action,string name,List<string> results){bool failed=false;try{action();}catch{failed=true;}Assert(failed,name);results.Add(name);}
    internal static void Run(string directory){
        Directory.CreateDirectory(directory);var results=new List<string>();string disk=Path.Combine(directory,"ゲーム保管 # +");Directory.CreateDirectory(disk);var service=new DesktopFiles(Path.Combine(directory,"profile"));var root=service.Register(disk);
        Assert(DesktopFiles.NormalizeRoot(@"\\NAS\共有\ゲーム\")==@"\\NAS\共有\ゲーム","UNC path normalization");results.Add("UNC path normalization");
        Assert(DesktopFiles.NormalizeRoot("\""+disk+"\"")==disk,"quoted local path");results.Add("quoted local path");
        Assert(DesktopFiles.NormalizeRoot(@"C:\")==@"C:\","drive root preserved");results.Add("drive root preserved");
        foreach(string invalid in new[]{"relative","",@"\\NAS",@"\\?\C:\folder",@"\\.\C:\folder"})Fails(()=>DesktopFiles.NormalizeRoot(invalid),"reject root "+invalid,results);
        service.Entry(root,".gameportal",true,true);service.Entry(root,".gameportal/library-id.json",false,true);
        string id=new String('a',32);service.Write(root,".gameportal/library-id.json",new MemoryStream(Encoding.UTF8.GetBytes("{\"schema\":1,\"id\":\""+id+"\"}")));service.Remember(root);
        Assert(service.Restore().Id==id,"persistent identity");results.Add("initialize and reconnect");
        service.Entry(root,"game.html",false,true);service.Write(root,"game.html",new MemoryStream(Encoding.UTF8.GetBytes("old")));service.Write(root,"game.html",new MemoryStream(Encoding.UTF8.GetBytes("new")));Assert(File.ReadAllText(Path.Combine(disk,"game.html"))=="new","atomic replacement");results.Add("atomic replacement");
        Fails(()=>DesktopFiles.Atomic(Path.Combine(disk,"game.html"),new MemoryStream(new byte[4]),3),"oversize preserves old file",results);Assert(File.ReadAllText(Path.Combine(disk,"game.html"))=="new","old file retained");
        var lease=service.Parse(service.Serialize(service.BeginWrite(root,"game.html")));string writer=DesktopFiles.Text(lease,"token");var peer=new DesktopFiles(Path.Combine(directory,"peer-profile"));var peerRoot=peer.Register(disk);Fails(()=>peer.BeginWrite(peerRoot,"game.html"),"independent writers excluded",results);service.AbortWrite(root,writer);var nextLease=peer.Parse(peer.Serialize(peer.BeginWrite(peerRoot,"game.html")));peer.AbortWrite(peerRoot,DesktopFiles.Text(nextLease,"token"));results.Add("released writer can be reopened");
        foreach(string path in new[]{"../outside","/absolute","a/../b","a\\b","a:stream","CON","a/","a//b","a. ",""})Fails(()=>service.Write(root,path,new MemoryStream(new byte[0])),"reject path "+path,results);
        Fails(()=>service.Get(new String('0',64)),"unknown root capability",results);Fails(()=>service.Remove(root,"",true),"no root deletion",results);Fails(()=>service.Remove(root,".gameportal",true),"identity directory protected",results);
        Fails(()=>service.Write(root,".gameportal/library-id.json",new MemoryStream(Encoding.UTF8.GetBytes("{\"schema\":1,\"id\":\""+new String('b',32)+"\"}"))),"identity overwrite rejected",results);
        service.Entry(root,"nested",true,true);service.Entry(root,"nested/test.txt",false,true);service.Remove(root,"nested",true);Assert(!Directory.Exists(Path.Combine(disk,"nested")),"recursive removal");results.Add("bounded recursive removal");
        string idFile=Path.Combine(disk,".gameportal","library-id.json"),original=File.ReadAllText(idFile);File.WriteAllText(idFile,"{\"schema\":1,\"id\":\""+new String('b',32)+"\"}");Fails(()=>service.Stat(root,"game.html"),"external identity replacement rejected",results);Fails(()=>service.Restore(),"saved identity pinned on restart",results);File.WriteAllText(idFile,original);
        results.Add("original game retained");File.WriteAllText(Path.Combine(directory,"result.json"),service.Serialize(new {passed=true,checks=results}),new UTF8Encoding(false));
    }
}
