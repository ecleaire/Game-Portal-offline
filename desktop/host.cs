using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Reflection;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class DesktopProgram {
    internal const string AppUrl="https://gameportal.desktop.invalid/index.html";
    internal static byte[] Resource(string name){using(var input=Assembly.GetExecutingAssembly().GetManifestResourceStream(name)){if(input==null)throw new IOException("内蔵ファイルがありません："+name);using(var output=new MemoryStream()){input.CopyTo(output);return output.ToArray();}}}
    [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr LoadLibrary(string path);
    [STAThread]static void Main(string[] args){
        try{
            string profile=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"GamePortalDesktop"),library=null,ready=null,selfTest=null;int port=0;bool testing=false;
            for(int i=0;i<args.Length;i++){
                if(args[i]=="--profile")profile=Path.GetFullPath(args[++i]);else if(args[i]=="--library")library=Path.GetFullPath(args[++i]);else if(args[i]=="--debug-port")port=Int32.Parse(args[++i]);else if(args[i]=="--ready-file")ready=Path.GetFullPath(args[++i]);else if(args[i]=="--self-test")selfTest=Path.GetFullPath(args[++i]);else if(args[i]=="--test-mode")testing=true;else throw new Exception("起動オプションを確認してください。");
            }
            if(selfTest!=null){DesktopSelfTest.Run(selfTest);return;}
            if(port!=0&&(port<1024||port>65535))throw new Exception("検証用ポートを確認してください。");
            Directory.CreateDirectory(profile);string libraries=Path.Combine(profile,"runtime-__DESKTOP_VERSION__");Directory.CreateDirectory(libraries);
            AppDomain.CurrentDomain.AssemblyResolve+=(sender,eventArgs)=>{string name=new AssemblyName(eventArgs.Name).Name;if(name=="Microsoft.Web.WebView2.Core"||name=="Microsoft.Web.WebView2.WinForms")return Assembly.Load(Resource(name+".dll"));return null;};
            string loader=Path.Combine(libraries,"WebView2Loader.dll");byte[] loaderBytes=Resource("WebView2Loader.dll");if(!File.Exists(loader)||!File.ReadAllBytes(loader).SequenceEqual(loaderBytes))File.WriteAllBytes(loader,loaderBytes);
            if(LoadLibrary(loader)==IntPtr.Zero)throw new Exception("WebView2の起動部品を読み込めませんでした。");
            Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);Start(profile,library,port,ready,testing);
        }catch(Exception error){if(args.Contains("--self-test")){int index=Array.IndexOf(args,"--self-test");if(index+1<args.Length)File.WriteAllText(Path.Combine(args[index+1],"failure.txt"),error.ToString());}else MessageBox.Show(error.Message,"GAME PORTAL デスクトップ試作版",MessageBoxButtons.OK,MessageBoxIcon.Error);Environment.ExitCode=1;}
    }
    [MethodImpl(MethodImplOptions.NoInlining)]static void Start(string profile,string library,int port,string ready,bool testing){Application.Run(new DesktopForm(profile,library,port,ready,testing));}
}

internal sealed class DesktopForm : Form {
    readonly WebView2 view=new WebView2();readonly DesktopFiles files;readonly string profile,initialLibrary,ready;readonly int port;readonly bool testing;
    readonly byte[] page=DesktopProgram.Resource("GAME-PORTAL-DESKTOP.html");int nativeGames;
    internal DesktopForm(string profile,string library,int port,string ready,bool testing){
        this.profile=profile;this.initialLibrary=library;this.port=port;this.ready=ready;this.testing=testing;files=new DesktopFiles(profile);
        Text="GAME PORTAL デスクトップ試作版 __DESKTOP_VERSION__";Width=1280;Height=900;MinimumSize=new System.Drawing.Size(640,480);StartPosition=FormStartPosition.CenterScreen;
        if(testing){Opacity=0;ShowInTaskbar=false;}view.Dock=DockStyle.Fill;Controls.Add(view);Shown+=async(sender,eventArgs)=>await Initialize();
        FormClosing+=OnClosing;
    }
    async Task Initialize(){
        try{
            var options=new CoreWebView2EnvironmentOptions();if(port!=0)options.AdditionalBrowserArguments="--remote-debugging-port="+port;
            var environment=await CoreWebView2Environment.CreateAsync(null,Path.Combine(profile,"WebView"),options);await view.EnsureCoreWebView2Async(environment);
            var core=view.CoreWebView2;core.Settings.AreHostObjectsAllowed=false;core.Settings.IsWebMessageEnabled=true;core.Settings.AreDevToolsEnabled=testing;core.Settings.IsStatusBarEnabled=false;
            core.AddWebResourceRequestedFilter("*",CoreWebView2WebResourceContext.All);core.WebResourceRequested+=Resources;core.WebMessageReceived+=Message;
            core.NavigationStarting+=(sender,e)=>{if(e.Uri.Split('#')[0]!=DesktopProgram.AppUrl||files.HasWriters)e.Cancel=true;};
            core.NewWindowRequested+=(sender,e)=>{e.Handled=true;Uri url;if(e.IsUserInitiated&&Uri.TryCreate(e.Uri,UriKind.Absolute,out url)&&(url.Scheme=="https"||url.Scheme=="http"))try{Process.Start(url.AbsoluteUri);}catch(Exception){}};
            core.PermissionRequested+=(sender,e)=>{e.State=CoreWebView2PermissionState.Deny;};
            core.ProcessFailed+=async(sender,e)=>{if(e.ProcessFailedKind==CoreWebView2ProcessFailedKind.RenderProcessExited||e.ProcessFailedKind==CoreWebView2ProcessFailedKind.BrowserProcessExited)await Task.Run(()=>files.ReleaseUncommitted());};
            core.DownloadStarting+=(sender,e)=>{if(!e.DownloadOperation.Uri.StartsWith("blob:")){e.Cancel=true;return;}using(var dialog=new SaveFileDialog()){dialog.FileName=Path.GetFileName(e.ResultFilePath);if(dialog.ShowDialog(this)!=DialogResult.OK)e.Cancel=true;else e.ResultFilePath=dialog.FileName;}};
            if(initialLibrary!=null){var root=await Task.Run(()=>files.Register(initialLibrary));await Task.Run(()=>files.Remember(root));}
            core.Navigate(DesktopProgram.AppUrl);if(ready!=null)File.WriteAllText(ready,files.Serialize(new {ready=true,port=port}),new UTF8Encoding(false));
        }catch(Exception error){MessageBox.Show(this,"起動できませんでした。Microsoft Edge WebView2 Runtimeを確認してください。\n"+error.Message,"GAME PORTAL",MessageBoxButtons.OK,MessageBoxIcon.Error);Close();}
    }
    async void Resources(object sender,CoreWebView2WebResourceRequestedEventArgs e){
        var deferral=e.GetDeferral();
        try{
            var uri=new Uri(e.Request.Uri);
            if(uri.GetLeftPart(UriPartial.Path)==DesktopProgram.AppUrl&&e.Request.Method=="GET") {e.Response=view.CoreWebView2.Environment.CreateWebResourceResponse(new MemoryStream(page,false),200,"OK","Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store");return;}
            if(uri.Host!="gameportal.desktop.invalid"||uri.Scheme!="https"||!uri.AbsolutePath.StartsWith("/io/"))throw new UnauthorizedAccessException("外部への接続は許可していません。");
            var query=System.Web.HttpUtility.ParseQueryString(uri.Query);var root=files.Get(query["root"]??"");string path=query["path"]??"",secret;
            try{secret=e.Request.Headers.GetHeader("X-Game-Portal-Desktop");}catch{secret="";}if(secret!=root.Secret)throw new UnauthorizedAccessException("起動元を確認してください。");
            if(uri.AbsolutePath=="/io/read"&&e.Request.Method=="GET"){
                Stream stream=await Task.Run(()=>files.Read(root,path));e.Response=view.CoreWebView2.Environment.CreateWebResourceResponse(stream,200,"OK","Content-Type: application/octet-stream\r\nCache-Control: no-store\r\nContent-Length: "+stream.Length);return;
            }
            if(uri.AbsolutePath=="/io/write"&&e.Request.Method=="POST"){
                // No timeout or cancellation: a committed write must be verified, never retried blindly.
                string spool=Path.Combine(profile,"write-"+DesktopFiles.Secret()+".tmp");
                try{
                    using(var output=new FileStream(spool,FileMode.CreateNew,FileAccess.Write,FileShare.None)){byte[] buffer=new byte[65536];int count;long total=0;var input=e.Request.Content;if(input!=null)while((count=await input.ReadAsync(buffer,0,buffer.Length))!=0){total+=count;if(total>200L*1024*1024)throw new IOException("ファイルは200MB以内にしてください。");await output.WriteAsync(buffer,0,count);}}
                    await Task.Run(()=>{using(var input=File.OpenRead(spool))files.CommitWrite(root,path,query["writer"]??"",input);});
                }finally{if(File.Exists(spool))File.Delete(spool);}
                e.Response=JsonResponse(new {written=true},200);return;
            }
            throw new UnauthorizedAccessException("この操作は許可していません。");
        }catch(Exception error){if(!IsDisposed&&!view.IsDisposed&&view.CoreWebView2!=null)try{e.Response=JsonResponse(new {message=error.Message,name=DesktopFiles.ErrorName(error)},400);}catch{}}
        finally{try{deferral.Complete();}catch{}}
    }
    CoreWebView2WebResourceResponse JsonResponse(object data,int status){return view.CoreWebView2.Environment.CreateWebResourceResponse(new MemoryStream(Encoding.UTF8.GetBytes(files.Serialize(data))),status,"Response","Content-Type: application/json; charset=utf-8\r\nCache-Control: no-store");}
    async void Message(object sender,CoreWebView2WebMessageReceivedEventArgs e){
        if(String.IsNullOrEmpty(e.Source)||e.Source.Split('#')[0]!=DesktopProgram.AppUrl)return;
        int id=0;
        try{
            if(e.WebMessageAsJson.Length>16384)throw new IOException("操作の内容が大きすぎます。");var data=files.Parse(e.WebMessageAsJson);object number;if(!data.TryGetValue("id",out number)||!(number is int)||(int)number<=0)throw new IOException("操作の番号を確認してください。");id=(int)number;
            string op=DesktopFiles.Text(data,"op");object value=null;
            if(op=="closeReady"&&closePending){closePending=false;if(DesktopFiles.Flag(data,"allowed")){closing=true;Close();}else MessageBox.Show(this,"処理中または未保存の内容があります。保存を完了してから閉じてください。","GAME PORTAL");return;}
            if(op=="closeWindow"){BeginInvoke(new Action(()=>Close()));return;}
            if(op=="select"){
                using(var dialog=new FolderBrowserDialog()){dialog.Description="ゲームの保存先フォルダーを選んでください";dialog.ShowNewFolderButton=true;if(dialog.ShowDialog(this)==DialogResult.OK){string chosen=dialog.SelectedPath;value=files.Record(await Task.Run(()=>files.Register(chosen)));}}
            }else if(op=="launch"){
                var root=files.Get(DesktopFiles.Text(data,"root"));value=await Launch(root,data);
            }else value=await Task.Run(()=>Operate(op,data));
            if(!IsDisposed&&!view.IsDisposed&&view.CoreWebView2!=null)view.CoreWebView2.PostWebMessageAsJson(files.Serialize(new {id=id,ok=true,value=value}));
        }catch(Exception error){if(id>0&&!IsDisposed&&!view.IsDisposed&&view.CoreWebView2!=null)try{view.CoreWebView2.PostWebMessageAsJson(files.Serialize(new {id=id,ok=false,error=new {message=error.Message,name=DesktopFiles.ErrorName(error)}}));}catch{}}
    }
    object Operate(string op,Dictionary<string,object> data){
        if(op=="restore")return files.Record(files.Restore());if(op=="forget"){files.Forget();return true;}
        if(op=="abortWrite"){var known=files.Known(DesktopFiles.Text(data,"root"));files.AbortWrite(known,DesktopFiles.Text(data,"writer"));return true;}
        var root=files.Get(DesktopFiles.Text(data,"root"));string path=DesktopFiles.Text(data,"path");
        switch(op){
            case "remember":files.Remember(root);return true;
            case "stat":return files.Stat(root,path);
            case "list":return files.List(root,path);
            case "directory":files.Entry(root,path,true,DesktopFiles.Flag(data,"create"));return true;
            case "file":files.Entry(root,path,false,DesktopFiles.Flag(data,"create"));return true;
            case "beginWrite":return files.BeginWrite(root,path);
            case "remove":files.Remove(root,path,DesktopFiles.Flag(data,"recursive"));return true;
            default:throw new UnauthorizedAccessException("この操作は許可していません。");
        }
    }
    Task<object> Launch(DesktopFiles.Root root,Dictionary<string,object> data){
        var result=new TaskCompletionSource<object>();var thread=new Thread(()=>{
            Mutex lease=null;bool held=false;Process game=null;
            try{
                string libraryId=PortalNative.Id(DesktopFiles.Text(data,"libraryId")),gameId=PortalNative.Id(DesktopFiles.Text(data,"gameId"));PortalNative.CheckLibrary(root.Path,libraryId);string executable=PortalNative.Executable(root.Path,DesktopFiles.Text(data,"path"),gameId);
                lease=new Mutex(false,"Local\\GamePortalNative-"+libraryId+"-"+gameId);try{held=lease.WaitOne(0);}catch(AbandonedMutexException){held=true;}if(!held)throw new IOException("このEXEゲームは起動中です。");
                game=Process.Start(new ProcessStartInfo {FileName=executable,WorkingDirectory=Path.GetDirectoryName(executable),UseShellExecute=false});if(game==null)throw new IOException("ゲームを起動できませんでした。");Interlocked.Increment(ref nativeGames);result.SetResult(new {launched=true});game.WaitForExit();
            }catch(Exception error){result.TrySetException(error);}finally{if(game!=null){game.Dispose();Interlocked.Decrement(ref nativeGames);}if(held)lease.ReleaseMutex();if(lease!=null)lease.Dispose();}
        });thread.IsBackground=true;thread.Start();return result.Task;
    }
    bool closing,closePending;
    async void OnClosing(object sender,FormClosingEventArgs e){
        if(closing||view.CoreWebView2==null)return;e.Cancel=true;if(files.HasWriters){MessageBox.Show(this,"保存処理中です。完了してから閉じてください。","GAME PORTAL");return;}if(nativeGames>0){MessageBox.Show(this,"起動中のEXEゲームを終了してから閉じてください。","GAME PORTAL");return;}if(closePending)return;closePending=true;
        try{
            await view.CoreWebView2.ExecuteScriptAsync("(async()=>{let allowed=false;try{if(typeof busy==='undefined')allowed=true;else if(!busy&&!syncPromise&&!hasEditChanges()&&await flushSave()){stopPlayer();allowed=true;}}finally{chrome.webview.postMessage({id:2147483647,op:'closeReady',allowed});}})()");
        }catch{closePending=false;if(!files.HasWriters&&MessageBox.Show(this,"画面の保存状態を確認できません。未保存の入力は失われます。終了しますか？","GAME PORTAL",MessageBoxButtons.YesNo,MessageBoxIcon.Warning,MessageBoxDefaultButton.Button2)==DialogResult.Yes){closing=true;Close();}}
    }
}
