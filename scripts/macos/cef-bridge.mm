// Native Chromium host. Privileged messages exist only in the launcher frame.
#import <Cocoa/Cocoa.h>
#include <atomic>
#include <algorithm>
#include <string>
#include <map>
#include <memory>
#include <unistd.h>
#include <mach-o/dyld.h>
#include <crt_externs.h>
#include "include/cef_app.h"
#include "include/cef_browser.h"
#include "include/cef_client.h"
#include "include/cef_command_line.h"
#include "include/cef_parser.h"
#include "include/cef_v8.h"
#include "include/cef_application_mac.h"
#include "include/cef_sandbox_mac.h"
#include "include/wrapper/cef_helpers.h"
#include "include/wrapper/cef_library_loader.h"

using PortalCallback = void (*)(const char*);
static PortalCallback portal_callback = nullptr;
static CefRefPtr<CefBrowser> portal_browser;
static std::string portal_url;
static std::atomic<bool> portal_running(false);
static bool portal_pumping = false, portal_deferred_pump = false;
static bool portal_closing = false;
static std::unique_ptr<CefScopedLibraryLoader> portal_library;
static NSTimer* portal_timer = nil;
static void PortalPump() {
  if (!portal_running.load()) return;
  if (portal_pumping) { portal_deferred_pump = true; return; }
  portal_pumping = true; CefDoMessageLoopWork(); portal_pumping = false;
  if (portal_deferred_pump) { portal_deferred_pump = false; dispatch_async(dispatch_get_main_queue(), ^{ PortalPump(); }); }
}
static void PortalNotice(const std::string& kind, const std::string& text = "") {
  if (!portal_callback) return;
  CefRefPtr<CefDictionaryValue> data = CefDictionaryValue::Create();
  data->SetString("kind", kind); data->SetString("text", text);
  CefRefPtr<CefValue> object = CefValue::Create(); object->SetDictionary(data);
  portal_callback(CefWriteJSON(object, JSON_WRITER_DEFAULT).ToString().c_str());
}
static bool PortalTrusted(CefRefPtr<CefFrame> frame) {
  if (!frame || !frame->IsMain()) return false;
  std::string url = frame->GetURL(); return url.substr(0, url.find('#')) == portal_url;
}
@interface PortalApplication : NSApplication<CefAppProtocol> { BOOL handling_; }
@end
@implementation PortalApplication
- (BOOL)isHandlingSendEvent { return handling_; }
- (void)setHandlingSendEvent:(BOOL)value { handling_ = value; }
- (void)sendEvent:(NSEvent*)event { CefScopedSendingEvent scoped; [super sendEvent:event]; }
@end

class PortalV8 : public CefV8Handler {
 public:
  bool Execute(const CefString&, CefRefPtr<CefV8Value>, const CefV8ValueList& arguments,
               CefRefPtr<CefV8Value>& result, CefString& exception) override {
    auto frame = CefV8Context::GetCurrentContext()->GetFrame();
    if (!frame->IsMain() || arguments.size() != 1 || !arguments[0]->IsString()) {
      exception = "Privileged calls require the launcher frame."; return true;
    }
    const std::string text = arguments[0]->GetStringValue();
    if (text.size() > 400000) { exception = "Request too large."; return true; }
    auto message = CefProcessMessage::Create("gameportal.rpc");
    message->GetArgumentList()->SetString(0, text);
    frame->SendProcessMessage(PID_BROWSER, message); result = CefV8Value::CreateUndefined(); return true;
  }
 private: IMPLEMENT_REFCOUNTING(PortalV8);
};
class PortalApp : public CefApp, public CefBrowserProcessHandler, public CefRenderProcessHandler {
  std::map<int, std::string> allowed_;
 public:
  CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override { return this; }
  CefRefPtr<CefRenderProcessHandler> GetRenderProcessHandler() override { return this; }
  void OnBeforeCommandLineProcessing(const CefString& type, CefRefPtr<CefCommandLine> command) override {
    if (type.empty()) {
      command->AppendSwitch("site-per-process");
      command->AppendSwitch("disable-background-networking");
      command->AppendSwitch("disable-component-update");
      command->AppendSwitch("disable-sync");
      command->AppendSwitch("no-first-run");
      if (command->HasSwitch("test-mode")) { command->AppendSwitchWithValue("use-gl", "angle"); command->AppendSwitchWithValue("use-angle", "swiftshader"); }
    }
  }
  void OnContextInitialized() override {
    CFRunLoopPerformBlock(CFRunLoopGetMain(), kCFRunLoopCommonModes, ^{ PortalNotice("initialized"); });
    CFRunLoopWakeUp(CFRunLoopGetMain());
  }
  void OnBrowserCreated(CefRefPtr<CefBrowser> browser, CefRefPtr<CefDictionaryValue> extra) override {
    if (extra && extra->HasKey("portal-url")) allowed_[browser->GetIdentifier()] = extra->GetString("portal-url");
  }
  void OnBrowserDestroyed(CefRefPtr<CefBrowser> browser) override { allowed_.erase(browser->GetIdentifier()); }
  void OnContextCreated(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, CefRefPtr<CefV8Context> context) override {
    auto found = allowed_.find(browser->GetIdentifier()); const std::string url = frame->GetURL();
    if (!frame->IsMain() || found == allowed_.end() || url.substr(0, url.find('#')) != found->second) return;
    context->GetGlobal()->SetValue("__portalSend", CefV8Value::CreateFunction("__portalSend", new PortalV8()),
      static_cast<cef_v8_propertyattribute_t>(V8_PROPERTY_ATTRIBUTE_READONLY | V8_PROPERTY_ATTRIBUTE_DONTDELETE));
  }
 private: IMPLEMENT_REFCOUNTING(PortalApp);
};
class PortalClient : public CefClient, public CefLifeSpanHandler, public CefRequestHandler,
                     public CefLoadHandler, public CefDragHandler, public CefDownloadHandler, public CefDisplayHandler, public CefContextMenuHandler {
 public:
  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefRequestHandler> GetRequestHandler() override { return this; }
  CefRefPtr<CefLoadHandler> GetLoadHandler() override { return this; }
  CefRefPtr<CefDragHandler> GetDragHandler() override { return this; }
  CefRefPtr<CefDownloadHandler> GetDownloadHandler() override { return this; }
  CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }
  CefRefPtr<CefContextMenuHandler> GetContextMenuHandler() override { return this; }
  void OnBeforeContextMenu(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame>, CefRefPtr<CefContextMenuParams>, CefRefPtr<CefMenuModel> menu) override {
    for (int command : {MENU_ID_BACK, MENU_ID_FORWARD, MENU_ID_RELOAD, MENU_ID_RELOAD_NOCACHE, MENU_ID_STOPLOAD, MENU_ID_PRINT, MENU_ID_VIEW_SOURCE}) menu->Remove(command);
  }
  void OnFullscreenModeChange(CefRefPtr<CefBrowser>, bool fullscreen) override { PortalNotice("fullscreen", fullscreen ? "true" : "false"); }
  bool OnProcessMessageReceived(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame> frame, CefProcessId source, CefRefPtr<CefProcessMessage> message) override {
    if (source != PID_RENDERER || message->GetName() != "gameportal.rpc" || !PortalTrusted(frame)) return false;
    auto values = message->GetArgumentList(); if (values->GetSize() != 1 || values->GetType(0) != VTYPE_STRING) return true;
    std::string text = values->GetString(0); if (text.size() > 400000) return true;
    auto value = CefParseJSON(text, JSON_PARSER_RFC); if (!value || value->GetType() != VTYPE_DICTIONARY) return true;
    auto request = value->GetDictionary(); if (request->HasKey("kind") || request->GetType("id") != VTYPE_INT || request->GetInt("id") <= 0 || request->GetType("op") != VTYPE_STRING) return true;
    if (portal_callback) portal_callback(text.c_str()); return true;
  }
  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override { portal_browser = browser; PortalNotice("browserCreated"); if (portal_closing) browser->GetHost()->CloseBrowser(true); }
  void OnLoadingStateChange(CefRefPtr<CefBrowser>, bool loading, bool, bool) override { PortalNotice("loading", loading ? "true" : "false"); }
  void OnLoadStart(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame> frame, TransitionType) override { if (frame->IsMain()) PortalNotice("loadStart", frame->GetURL()); }
  void OnRenderProcessTerminated(CefRefPtr<CefBrowser>, TerminationStatus status) override { PortalNotice("loadError", "The display process stopped (" + std::to_string(status) + ")."); }
  bool DoClose(CefRefPtr<CefBrowser>) override { if (!portal_closing) { PortalNotice("closeRequested"); return true; } return false; }
  void OnBeforeClose(CefRefPtr<CefBrowser>) override { portal_browser = nullptr; PortalNotice("closed"); }
  bool OnBeforeBrowse(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame> frame, CefRefPtr<CefRequest> request, bool, bool) override {
    const std::string url = request->GetURL();
    if (frame->IsMain()) return url.substr(0, url.find('#')) != portal_url;
    return url.rfind("blob:", 0) != 0 && url.rfind("data:", 0) != 0 && url.rfind("about:", 0) != 0;
  }
  bool OnBeforePopup(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame> frame, const CefString& url, const CefString&,
      WindowOpenDisposition, bool gesture, const CefPopupFeatures&, CefWindowInfo&, CefRefPtr<CefClient>&,
      CefBrowserSettings&, CefRefPtr<CefDictionaryValue>&, bool*) override {
    const std::string address = url; if (PortalTrusted(frame) && gesture && address.rfind("https://", 0) == 0) [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:[NSString stringWithUTF8String:address.c_str()]]]; return true;
  }
  void OnLoadEnd(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame> frame, int) override { if (PortalTrusted(frame)) PortalNotice("ready"); }
  void OnLoadError(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame> frame, ErrorCode code, const CefString& text, const CefString&) override {
    if (frame->IsMain() && code != ERR_ABORTED) PortalNotice("loadError", text);
  }
  bool OnDragEnter(CefRefPtr<CefBrowser>, CefRefPtr<CefDragData> data, DragOperationsMask) override {
    std::vector<CefString> names; if (data->GetFileNames(names) && names.size() == 1) PortalNotice("folderDrag", names[0]); else PortalNotice("folderDrag"); return false;
  }
  bool OnConsoleMessage(CefRefPtr<CefBrowser>, cef_log_severity_t level, const CefString& text, const CefString&, int) override {
    if (level >= LOGSEVERITY_ERROR) PortalNotice("consoleError", text); return false;
  }
  void OnBeforeDownload(CefRefPtr<CefBrowser>, CefRefPtr<CefDownloadItem> item, const CefString& suggested, CefRefPtr<CefBeforeDownloadCallback> callback) override {
    const std::string url = item->GetURL(); const auto origin = portal_url.substr(0, portal_url.find("/index.html"));
    if (url.rfind("blob:" + origin + "/", 0) != 0) return;
    NSSavePanel* panel = [NSSavePanel savePanel]; [panel setNameFieldStringValue:[NSString stringWithUTF8String:suggested.ToString().c_str()]];
    if ([panel runModal] == NSModalResponseOK) callback->Continue([[panel URL] path].UTF8String, false);
  }
  void OnDownloadUpdated(CefRefPtr<CefBrowser>, CefRefPtr<CefDownloadItem> item, CefRefPtr<CefDownloadItemCallback>) override {
    if (item->IsCanceled()) PortalNotice("downloadCancelled");
  }
 private: IMPLEMENT_REFCOUNTING(PortalClient);
};

extern "C" void portal_cef_application() { [PortalApplication sharedApplication]; }
extern "C" bool portal_cef_initialize(const char* framework, const char* helper, const char* profile, const char* bundle, PortalCallback callback) {
  const bool diagnostic = getenv("PORTAL_CEF_TEST") != nullptr;
  if (diagnostic) fprintf(stderr, "CEF main before initialize: pid=%d parent=%d\n", getpid(), getppid());
  portal_callback = callback;
  portal_library = std::make_unique<CefScopedLibraryLoader>();
  if (!portal_library->LoadInMain()) return false;
  CefSettings settings;
  if (diagnostic) settings.log_severity = LOGSEVERITY_VERBOSE;
  CefString(&settings.browser_subprocess_path) = helper;
  CefString(&settings.cache_path) = profile;
  CefString(&settings.root_cache_path) = profile;
  CefString(&settings.log_file) = std::string(profile) + "/cef.log";
  CefMainArgs args(*_NSGetArgc(), *_NSGetArgv());
  portal_running.store(true);
  if (!CefInitialize(args, settings, new PortalApp(), nullptr)) { portal_running.store(false); return false; }
  if (diagnostic) fprintf(stderr, "CEF main initialized: pid=%d\n", getpid());
  // AppKit owns the main loop. A common-mode timer pumps CEF even while native
  // event tracking is active; dispatch-only callbacks can starve subprocess IPC.
  portal_timer = [NSTimer timerWithTimeInterval:0.033 repeats:YES block:^(NSTimer*) { PortalPump(); }];
  [[NSRunLoop mainRunLoop] addTimer:portal_timer forMode:NSRunLoopCommonModes];
  return true;
}
extern "C" bool portal_cef_open(void* parent, const char* address) {
  portal_url = address; CefWindowInfo window;
  NSView* view = (__bridge NSView*)parent;
  NSRect bounds = [view bounds]; window.SetAsChild(view, CefRect(0, 0, bounds.size.width, bounds.size.height));
  CefBrowserSettings settings; auto extra = CefDictionaryValue::Create(); extra->SetString("portal-url", portal_url);
  // Native window creation must run through CEF's UI task queue. Synchronous
  // creation inside an AppKit dispatch callback can stall subprocess startup.
  return CefBrowserHost::CreateBrowser(window, new PortalClient(), portal_url, settings, extra, nullptr);
}
extern "C" void portal_cef_evaluate(const char* text) { if (portal_browser && PortalTrusted(portal_browser->GetMainFrame())) portal_browser->GetMainFrame()->ExecuteJavaScript(text, portal_url, 0); }
extern "C" void portal_cef_resize() { if (portal_browser) { NSView* view = (__bridge NSView*)portal_browser->GetHost()->GetWindowHandle(); [view setFrame:[[view superview] bounds]]; } }
extern "C" void portal_cef_close() { portal_closing = true; if (portal_browser) portal_browser->GetHost()->CloseBrowser(true); else PortalNotice("closed"); }
extern "C" void portal_cef_shutdown() { portal_running.store(false); [portal_timer invalidate]; portal_timer = nil; portal_browser = nullptr; CefShutdown(); portal_library.reset(); }

#ifdef PORTAL_CEF_HELPER
int main(int argc, char* argv[]) {
  if (getenv("PORTAL_CEF_TEST")) { fprintf(stderr, "CEF helper: pid=%d parent=%d", getpid(), getppid()); for (int i = 1; i < argc; ++i) if (std::string(argv[i]).rfind("--type=", 0) == 0) fprintf(stderr, " %s", argv[i]); fprintf(stderr, "\n"); }
  CefScopedSandboxContext sandbox;
  if (!sandbox.Initialize(argc, argv)) return 1;
  CefScopedLibraryLoader library;
  if (!library.LoadInHelper()) return 1;
  CefMainArgs args(argc, argv); return CefExecuteProcess(args, new PortalApp(), nullptr);
}
#endif
