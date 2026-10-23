// recdemo.swift —— 开一个带标题栏的窗口跑 __recdemo.html，供 screencapture 录制
// 用法: recdemo <html绝对路径> <宽> <高> [标题] [秒数]
import Cocoa
import WebKit

let a = CommandLine.arguments
guard a.count >= 4 else { print("usage: recdemo <html> <w> <h> [title] [seconds]"); exit(2) }
let htmlPath = a[1]
let width = CGFloat(Double(a[2]) ?? 1120)
let height = CGFloat(Double(a[3]) ?? 760)
let title = a.count > 4 ? a[4] : "演示.md — OpenTypora"
let seconds = Double(a.count > 5 ? a[5] : "16") ?? 16
let originX = a.count > 6 ? (Double(a[6]) ?? 480) : 480
let originY = a.count > 7 ? (Double(a[7]) ?? 320) : 320

final class Host: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!

    func applicationDidFinishLaunching(_ n: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: height),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = title
        window.setFrameOrigin(NSPoint(x: originX, y: originY))
        window.backgroundColor = .white

        web = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height))
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        let occl = Selector("_setWindowOcclusionDetectionEnabled:")
        if web.responds(to: occl) { _ = web.perform(occl, with: false) }
        window.contentView = web
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
        web.loadFileURL(URL(fileURLWithPath: htmlPath),
                        allowingReadAccessTo: URL(fileURLWithPath: "/"))
        print("WID \(window.windowNumber) FRAME \(Int(window.frame.origin.x)),\(Int(window.frame.origin.y)),\(Int(window.frame.width)),\(Int(window.frame.height))")
        fflush(stdout)

        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { exit(0) }
    }

    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) {
        print("load failed: \(e.localizedDescription)"); exit(1)
    }
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) {
        print("provisional failed: \(e.localizedDescription)"); exit(1)
    }
}

let app = NSApplication.shared
let host = Host()
app.delegate = host
app.setActivationPolicy(.regular)
app.run()
