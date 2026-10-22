// native-smoke.swift — 真机冒烟测试：验证 translate.swift 的完整原生链路
// （宿主视图 → translationTask 会话 → 队列消费 → 错误映射）
// 编译：swiftc native/translate.swift test/native-smoke.swift -o /tmp/tr-smoke ...
// 预期（本机当前无语言包）：translate 返回 notInstalled 结构化错误，而不是挂死。
import Cocoa
import Translation

// 测试桩：真实 AppController 在 main.swift，这里只需要 respond 签名
class AppController {
    func respond(_ id: String, _ ok: Bool, _ payload: Any) {
        if let d = try? JSONSerialization.data(withJSONObject: payload, options: [.fragmentsAllowed]),
           let s = String(data: d, encoding: .utf8) {
            print("RESPOND[\(id)] ok=\(ok) \(s)")
        } else {
            print("RESPOND[\(id)] ok=\(ok) (unserializable)")
        }
        if id == "s2" { exit(0) }   // 翻译响应到达后结束
    }
}

@main
struct Smoke {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)

        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 300, height: 200),
                              styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = NSView(frame: NSRect(x: 0, y: 0, width: 300, height: 200))
        window.orderBack(nil)

        TranslationService.shared.attach(to: window.contentView!)

        let controller = AppController()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            // 1. 状态查询
            TranslationService.shared.handle(id: "s1", method: "translationStatus",
                                             params: ["target": "zh-Hans"], controller: controller)
            // 2. 真实翻译请求（无语言包时应返回结构化错误）
            TranslationService.shared.handle(id: "s2", method: "translate",
                                             params: ["text": "Hello world. This is a native translation test.",
                                                      "target": "zh-Hans"], controller: controller)
        }

        // 兜底超时：45 秒内没有任何响应时，区分「等语言包确认框」和「真挂死」
        DispatchQueue.main.asyncAfter(deadline: .now() + 45) {
            if window.attachedSheet != nil {
                print("PENDING — 语言包下载确认框已由系统弹出，等待用户点击（锁屏环境下无人可点，属预期）")
                exit(2)
            }
            print("SMOKE TIMEOUT — 原生翻译链路 45 秒无响应且无系统弹窗")
            exit(3)
        }

        app.run()
    }
}
