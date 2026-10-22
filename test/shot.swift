// shot.swift — 用 WKWebView 离屏渲染 app/index.html 并截图，用于自检
// 用法: shot <html路径> <输出png> <宽> <高> [主题]
import Cocoa
import WebKit

let args = CommandLine.arguments
guard args.count >= 3 else { print("usage: shot <html> <out.png> <w> <h> [theme]"); exit(2) }
let htmlPath = args[1]
let outPath = args[2]
let width = CGFloat(Double(args.count > 3 ? args[3] : "1160") ?? 1160)
let height = CGFloat(Double(args.count > 4 ? args[4] : "820") ?? 820)
let theme = args.count > 5 ? args[5] : ""
let wait = Double(args.count > 6 ? args[6] : "") ?? 1.7

final class Shot: NSObject, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!

    func start() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: height),
                          styleMask: [.borderless], backing: .buffered, defer: false)
        window.setFrameOrigin(NSPoint(x: 60, y: 60))
        window.backgroundColor = .white
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height))
        web.navigationDelegate = self
        // 锁屏 / 窗口被遮挡时 WebKit 会把 DOM 定时器降频到 ~1 次/秒，
        // 集成测试里大量 100~300ms 的 await 就会集体超时（表现为「卡住」）。
        // 实测：关掉遮挡检测后 50ms 定时器 2 秒内从 7 次回到 37 次（期望 40）。
        let occl = Selector("_setWindowOcclusionDetectionEnabled:")
        if web.responds(to: occl) { _ = web.perform(occl, with: false) }
        window.contentView = web
        // 必须真正「在屏且可见」：orderBack 会让 WebKit 把定时器降频到 ~1 次/秒，
        // 集成测试里大量 100~300ms 的 await 就会集体超时（表现为测试「卡住」）
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
        web.loadFileURL(URL(fileURLWithPath: htmlPath), allowingReadAccessTo: URL(fileURLWithPath: "/"))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let js = theme.isEmpty ? "1" : "Editor.setTheme('\(theme)'), Editor.render(), 1"
        webView.evaluateJavaScript(js, completionHandler: nil)

        DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
            let debugJS = "document.title = JSON.stringify({" +
                "theme: document.documentElement.getAttribute('data-theme')," +
                " bodyBg: getComputedStyle(document.body).backgroundColor," +
                " bodyColor: getComputedStyle(document.body).color}); 'ok'"
            webView.evaluateJavaScript(debugJS, completionHandler: nil)

            webView.evaluateJavaScript(
                "(window.__report || document.documentElement.getAttribute('data-report') || '')") { res, _ in
                if let s = res as? String, !s.isEmpty { print(s) }
            }

            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                print("debug \(webView.title)")
                let cfg = WKSnapshotConfiguration()
                cfg.rect = CGRect(x: 0, y: 0, width: width, height: height)
                webView.takeSnapshot(with: cfg) { image, err in
                    guard let image = image,
                          let tiff = image.tiffRepresentation,
                          let rep = NSBitmapImageRep(data: tiff),
                          let png = rep.representation(using: .png, properties: [:]) else {
                        print("snapshot failed: \(err?.localizedDescription ?? "nil")")
                        exit(1)
                    }
                    try? png.write(to: URL(fileURLWithPath: outPath))
                    print("ok \(outPath) \(Int(width))x\(Int(height))")
                    exit(0)
                }
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        print("load failed: \(error.localizedDescription)"); exit(1)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
// 防止 App Nap 在后台/锁屏时把整个进程挂起
_ = ProcessInfo.processInfo.beginActivity(
    options: [.userInitiated, .latencyCritical, .idleSystemSleepDisabled],
    reason: "opentypora offline test harness")
let shot = Shot()
shot.start()
DispatchQueue.main.asyncAfter(deadline: .now() + wait + 15) { print("timeout"); exit(3) }
app.run()
