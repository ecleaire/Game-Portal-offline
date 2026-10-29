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
        var samePCPlayer=new DesktopFiles(Path.Combine(directory,"profile"));Assert(samePCPlayer.Restore().Id==id,"Player restores Creator selection using the common local profile");
        Assert(service.Restore().Id==id,"persistent identity");results.Add("initialize and reconnect");
        string leftover="index.html.gameportal.json~RFb5be5.TMP",leftoverPath=Path.Combine(disk,leftover);File.WriteAllText(leftoverPath,"do not read or delete");File.WriteAllText(Path.Combine(disk,"level.tmp"),"game resource");
        using(var locked=new FileStream(leftoverPath,FileMode.Open,FileAccess.ReadWrite,FileShare.None)){string listing=service.Serialize(service.List(root,""));Assert(!listing.Contains(leftover)&&listing.Contains("level.tmp"),"metadata leftovers excluded before game reads");}
        Assert(File.ReadAllText(leftoverPath)=="do not read or delete","leftover preserved");results.Add("locked metadata temporary file does not block listing and is preserved");
        service.Entry(root,"game.html",false,true);service.Write(root,"game.html",new MemoryStream(Encoding.UTF8.GetBytes("old")));service.Write(root,"game.html",new MemoryStream(Encoding.UTF8.GetBytes("new")));Assert(File.ReadAllText(Path.Combine(disk,"game.html"))=="new","atomic replacement");results.Add("atomic replacement");
        Fails(()=>DesktopFiles.Atomic(Path.Combine(disk,"game.html"),new MemoryStream(new byte[4]),3),"oversize preserves old file",results);Assert(File.ReadAllText(Path.Combine(disk,"game.html"))=="new","old file retained");
        var lease=service.Parse(service.Serialize(service.BeginWrite(root,"game.html")));string writer=DesktopFiles.Text(lease,"token");var peer=new DesktopFiles(Path.Combine(directory,"peer-profile"));var peerRoot=peer.Register(disk);Fails(()=>peer.BeginWrite(peerRoot,"game.html"),"independent writers excluded",results);service.AbortWrite(root,writer);var nextLease=peer.Parse(peer.Serialize(peer.BeginWrite(peerRoot,"game.html")));peer.AbortWrite(peerRoot,DesktopFiles.Text(nextLease,"token"));results.Add("released writer can be reopened");
        foreach(string path in new[]{"../outside","/absolute","a/../b","a\\b","a:stream","CON","a/","a//b","a. ",""})Fails(()=>service.Write(root,path,new MemoryStream(new byte[0])),"reject path "+path,results);
        Fails(()=>service.Get(new String('0',64)),"unknown root capability",results);Fails(()=>service.Remove(root,"",true),"no root deletion",results);Fails(()=>service.Remove(root,".gameportal",true),"identity directory protected",results);
        Fails(()=>service.Write(root,".gameportal/library-id.json",new MemoryStream(Encoding.UTF8.GetBytes("{\"schema\":1,\"id\":\""+new String('b',32)+"\"}"))),"identity overwrite rejected",results);
        service.Entry(root,"nested",true,true);service.Entry(root,"nested/test.txt",false,true);service.Remove(root,"nested",true);Assert(!Directory.Exists(Path.Combine(disk,"nested")),"recursive removal");results.Add("bounded recursive removal");
        string idFile=Path.Combine(disk,".gameportal","library-id.json"),original=File.ReadAllText(idFile);File.WriteAllText(idFile,"{\"schema\":1,\"id\":\""+new String('b',32)+"\"}");Fails(()=>service.Stat(root,"game.html"),"external identity replacement rejected",results);Fails(()=>service.Restore(),"saved identity pinned on restart",results);File.WriteAllText(idFile,original);
        results.Add("original game retained");
        Assert(DesktopSharedConnection.PortablePath(@"\\NAS\共有\Portal",@"\\NAS\共有\ゲーム")=="../ゲーム","NAS sibling relative path");results.Add("NAS sibling relative path");
        string app=Path.Combine(directory,"shared-app"),sharedGames=Path.Combine(app,"games");Directory.CreateDirectory(Path.Combine(sharedGames,".gameportal"));File.WriteAllText(Path.Combine(sharedGames,".gameportal/library-id.json"),original);File.WriteAllText(Path.Combine(sharedGames,"game.html"),"shared");
        var publisher=new DesktopFiles(Path.Combine(directory,"publisher"),app);publisher.Remember(publisher.Register(sharedGames));string sharedFile=Path.Combine(app,DesktopSharedConnection.FileName),sharedText=File.ReadAllText(sharedFile);Assert(!sharedText.Contains(directory)&&sharedText.Contains("games"),"portable connection contains no personal absolute path");results.Add("portable shared connection");
        var otherPC=new DesktopFiles(Path.Combine(directory,"other-pc"),app);Assert(otherPC.Restore().Id==id,"fresh profile restores shared folder");results.Add("fresh PC profile shared restore");
        otherPC.Forget();otherPC.Forget();Assert(otherPC.Restore()==null&&new DesktopFiles(Path.Combine(directory,"other-pc"),app).Restore()==null,"forget survives restart and suppresses shared default");results.Add("local forget survives restart");
        Assert(File.ReadAllText(sharedFile)==sharedText&&new DesktopFiles(Path.Combine(directory,"unaffected-pc"),app).Restore().Id==id,"forget leaves peer default unchanged");results.Add("forget preserves other PC connection");
        otherPC.Remember(otherPC.Register(sharedGames));Assert(new DesktopFiles(Path.Combine(directory,"other-pc"),app).Restore().Id==id,"explicit selection clears local forget");results.Add("explicit selection resumes remembering");
        string movedApp=Path.Combine(directory,"moved-app"),movedGames=Path.Combine(movedApp,"games");Directory.CreateDirectory(Path.Combine(movedGames,".gameportal"));File.WriteAllText(Path.Combine(movedGames,".gameportal/library-id.json"),original);File.WriteAllText(Path.Combine(movedApp,DesktopSharedConnection.FileName),sharedText);var moved=new DesktopFiles(Path.Combine(directory,"moved-profile"),movedApp);Assert(moved.Restore().Path==movedGames,"app and library relocation");results.Add("relocated portable folder");
        File.WriteAllText(Path.Combine(movedGames,".gameportal/library-id.json"),"{\"schema\":1,\"id\":\""+new String('b',32)+"\"}");Fails(()=>moved.Restore(),"shared ID mismatch never initializes folder",results);
        File.WriteAllText(Path.Combine(movedApp,DesktopSharedConnection.FileName),"{}");Fails(()=>moved.Restore(),"corrupt shared connection rejected",results);
        string second=Path.Combine(app,"second");Directory.CreateDirectory(Path.Combine(second,".gameportal"));File.WriteAllText(Path.Combine(second,".gameportal/library-id.json"),"{\"schema\":1,\"id\":\""+new String('b',32)+"\"}");publisher.Remember(publisher.Register(second));Assert(File.ReadAllText(sharedFile)==sharedText&&publisher.Restore().Path==second&&otherPC.Restore().Path==sharedGames,"private override preserves shared default");results.Add("shared default never silently replaced");
        File.WriteAllText(Path.Combine(app,"GAME-PORTAL-DISTRIBUTION.json"),"{\"schema\":1,\"project\":\"GAME-PORTAL\",\"layout\":\"platform-role\"}");
        string creator=Path.Combine(app,"Windows","クリエイター用"),player=Path.Combine(app,"Windows","プレイ用");Directory.CreateDirectory(creator);Directory.CreateDirectory(player);
        var creatorFiles=new DesktopFiles(Path.Combine(directory,"creator-grouped"),creator);Assert(creatorFiles.Restore().Path==sharedGames,"grouped creator uses bundle connection");results.Add("platform creator connection");
        var playerFiles=new DesktopFiles(Path.Combine(directory,"player-grouped"),player);Assert(playerFiles.Restore().Path==sharedGames,"grouped player uses bundle connection");results.Add("platform player connection");
        var shareInfo=publisher.Parse(publisher.Serialize(publisher.SharedInfo(publisher.Register(second))));string revision=DesktopFiles.Text(shareInfo,"revision");
        publisher.Share(publisher.Register(second),revision);
        var freshPC=new DesktopFiles(Path.Combine(directory,"fresh-after-shared-update"),player);Assert(freshPC.Restore().Path==second,"fresh player PC follows updated shared default");results.Add("explicit shared default update reaches fresh PC");
        Assert(otherPC.Restore().Path==sharedGames,"configured PC retains personal selection after shared update");results.Add("shared update preserves configured PC selection");
        Assert(creatorFiles.Restore().Path==second,"creator without personal setup follows shared update");results.Add("creator uses new shared default");
        Fails(()=>publisher.Share(publisher.Register(sharedGames),revision),"stale shared update rejected",results);
        shareInfo=publisher.Parse(publisher.Serialize(publisher.SharedInfo(publisher.Register(sharedGames))));revision=DesktopFiles.Text(shareInfo,"revision");
        string sharedLock=Path.Combine(app,DesktopSharedConnection.LockName);Assert(File.Exists(sharedLock),"stable shared lock remains a file");
        string readyFile=Path.Combine(directory,"lock-ready");
        var holder=System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(System.Diagnostics.Process.GetCurrentProcess().MainModule.FileName,"--self-test-shared-lock \""+app+"\" \""+readyFile+"\""){UseShellExecute=false,CreateNoWindow=true});
        try{
            var deadline=DateTime.UtcNow.AddSeconds(10);while(!File.Exists(readyFile)&&!holder.HasExited&&DateTime.UtcNow<deadline)System.Threading.Thread.Sleep(20);
            Assert(File.Exists(readyFile),"independent shared lock holder ready");
            Fails(()=>publisher.Share(publisher.Register(sharedGames),revision),"independent shared writer rejected",results);
            publisher.RecoverShared(publisher.Register(sharedGames),revision);Assert(File.Exists(sharedLock),"active file lock cannot be removed");results.Add("active file lock preserved by legacy recovery");
        }finally{if(!holder.HasExited)holder.Kill();holder.WaitForExit();holder.Dispose();}
        publisher.Share(publisher.Register(sharedGames),revision);results.Add("forced process exit releases shared writer lock");
        shareInfo=publisher.Parse(publisher.Serialize(publisher.SharedInfo(publisher.Register(sharedGames))));revision=DesktopFiles.Text(shareInfo,"revision");
        File.Delete(sharedLock);Directory.CreateDirectory(sharedLock);
        Fails(()=>publisher.Share(publisher.Register(sharedGames),revision),"legacy directory never automatically stolen",results);
        Fails(()=>publisher.RecoverShared(publisher.Register(sharedGames),"outdated"),"stale legacy recovery rejected",results);
        File.WriteAllText(Path.Combine(sharedLock,"unknown.txt"),"keep");Fails(()=>publisher.RecoverShared(publisher.Register(sharedGames),revision),"nonempty legacy lock preserved",results);File.Delete(Path.Combine(sharedLock,"unknown.txt"));
        publisher.RecoverShared(publisher.Register(sharedGames),revision);Assert(!Directory.Exists(sharedLock),"confirmed empty legacy recovery");results.Add("confirmed empty legacy lock recovery");
        publisher.Share(publisher.Register(sharedGames),revision);
        string movedProfile=Path.Combine(directory,"publisher");var relocatedOld=new DesktopFiles(movedProfile,creator);Assert(relocatedOld.Restore().Path==second,"root profile survives platform move");results.Add("legacy profile preserved after platform move");
        Assert(PortalNative.ConfigurationDirectory(Path.Combine(app,"other"))==Path.Combine(app,"other"),"no arbitrary parent search");results.Add("configuration discovery bounded");
        Directory.CreateDirectory(Path.Combine(app,"_内部ファイル"));File.Move(Path.Combine(app,"GAME-PORTAL-DISTRIBUTION.json"),Path.Combine(app,"_内部ファイル","GAME-PORTAL-DISTRIBUTION.json"));Assert(PortalNative.ConfigurationDirectory(player)==app,"internal marker retains shared connection");results.Add("internal distribution marker");
        File.WriteAllText(Path.Combine(app,"_内部ファイル","GAME-PORTAL-DISTRIBUTION.json"),"{}");Fails(()=>new DesktopFiles(Path.Combine(directory,"bad-marker"),player),"corrupt layout marker rejected",results);
        File.WriteAllText(Path.Combine(directory,"result.json"),service.Serialize(new {passed=true,checks=results}),new UTF8Encoding(false));
    }
}
