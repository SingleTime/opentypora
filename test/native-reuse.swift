// 原生链路验证：源语言显式传递 + 会话复用 + 同语言短路
// 编译：swiftc -O -parse-as-library -o /tmp/tr-reuse native/translate.swift test/native-reuse.swift \
//         -framework Cocoa -framework SwiftUI -framework Translation
import Cocoa
import SwiftUI
import Translation

/// 独立编译时替代 main.swift 里的真实 AppController（本测试不走 WebView 桥）
final class AppController {
    func respond(_ id: String, _ ok: Bool, _ payload: Any) {}
}

func log(_ s: String) {
    FileHandle.standardError.write((s + "\n").data(using: .utf8)!)
}

@main
struct ReuseSmoke {
    static func main() {
        MainActor.assumeIsolated {
            let app = NSApplication.shared
            app.setActivationPolicy(.regular)

            let window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 420, height: 260),
                                  styleMask: [.titled], backing: .buffered, defer: false)
            window.title = "ReuseSmoke"
            let container = NSView(frame: NSRect(x: 0, y: 0, width: 420, height: 260))
            window.contentView = container
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)

            let service = TranslationService.shared
            service.attach(to: container)

            var finished = false
            var failures: [String] = []
            func check(_ name: String, _ cond: Bool, _ info: String) {
                log((cond ? "PASS " : "FAIL ") + name + " | " + info)
                if !cond { failures.append(name) }
            }

            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                let t1 = Date()
                service.translate("Hello world. This is a session reuse test.", to: "zh-Hans", source: "en") { r in
                    let d1 = Date().timeIntervalSince(t1)
                    switch r {
                    case .success(let o):
                        check("首次翻译返回中文", !o.text.isEmpty && o.text != "Hello world. This is a session reuse test.",
                              "\(String(format: "%.2fs", d1)) \(o.text)")
                        check("首次翻译不超时（无系统弹窗）", d1 < 8, String(format: "%.2fs", d1))
                    case .failure(let f):
                        check("首次翻译返回中文", false, f.code + " " + f.message)
                    }

                    let t2 = Date()
                    service.translate("Good morning. Have a nice day.", to: "zh-Hans", source: "en") { r2 in
                        let d2 = Date().timeIntervalSince(t2)
                        switch r2 {
                        case .success(let o):
                            check("第二次翻译复用会话", d2 < 3, String(format: "%.2fs", d2) + " " + o.text)
                        case .failure(let f):
                            check("第二次翻译复用会话", false, f.code + " " + f.message)
                        }

                        let t3 = Date()
                        service.translate("你好，世界。", to: "zh-Hans", source: "zh-Hans") { r3 in
                            let d3 = Date().timeIntervalSince(t3)
                            switch r3 {
                            case .success(let o):
                                check("同语言短路返回原文", o.text == "你好，世界。" && d3 < 0.5,
                                      String(format: "%.3fs", d3) + " " + o.text)
                            case .failure(let f):
                                check("同语言短路返回原文", false, f.code + " " + f.message)
                            }
                            check("整个过程只创建一个会话", service.sessionStarts == 1,
                                  "sessionStarts=\(service.sessionStarts)")
                            finished = true
                            log(failures.isEmpty ? "== ALL PASS ==" : "== FAIL: \(failures.joined(separator: ", ")) ==")
                            exit(failures.isEmpty ? 0 : 1)
                        }
                    }
                }
            }

            DispatchQueue.main.asyncAfter(deadline: .now() + 45) {
                if !finished {
                    log("== TIMEOUT: 45 秒无结果（疑似系统弹窗阻塞）==")
                    exit(3)
                }
            }

            app.run()
        }
    }
}
