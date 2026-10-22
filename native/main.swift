// ============================================================
//  main.swift — OpenTypora 原生壳（AppKit + WKWebView）
//
//  职责：窗口、菜单、原生文件对话框、图片落盘、导出 HTML/PDF。
//  前端通过 window.webkit.messageHandlers.bridge 调用，回调走
//  window.__bridgeResolve(id, ok, payload)。
// ============================================================
import Cocoa
import WebKit

let APP_NAME = "OpenTypora"

// MARK: - 可拖拽的标题栏条（内容铺满窗口，靠它拖动窗口）
final class DragStripView: NSView {
    override var mouseDownCanMoveWindow: Bool { true }
    override func mouseDown(with event: NSEvent) {
        window?.performDrag(with: event)
    }
    override func hitTest(_ point: NSPoint) -> NSView? {
        // 双击标题栏时按系统偏好放大/最小化
        return super.hitTest(point)
    }
}

// MARK: - 文件树节点
final class Node {
    let name: String
    let path: String
    let isDir: Bool
    var children: [Node] = []
    var mtime: Double = 0
    var size: Int = 0
    init(name: String, path: String, isDir: Bool) {
        self.name = name; self.path = path; self.isDir = isDir
    }
    func json() -> [String: Any] {
        var d: [String: Any] = [
            "name": name,
            "path": path,
            "type": isDir ? "dir" : "file",
            "mtime": mtime,
            "size": size
        ]
        if isDir { d["children"] = children.map { $0.json() } }
        return d
    }
}

// MARK: - 应用控制器
final class AppController: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var isDirty = false
    var currentFile: String?
    var pendingOpen: String?
    var lastDir: URL?

    // ---------- 启动 ----------
    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        buildWindow()
        loadFrontend()
        installKeyMonitor()
        NSApp.activate(ignoringOtherApps: true)
    }

    // WKWebView 自己吞掉了 ⌘F（WebKit 的 find 处理），页面里根本收不到 keydown，
    // 所以查找/替换必须在原生层抢在它前面接。
    func installKeyMonitor() {
        NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] ev in
            guard let self = self else { return ev }
            let flags = ev.modifierFlags.intersection(.deviceIndependentFlagsMask)
            let key = (ev.charactersIgnoringModifiers ?? "").lowercased()
            if flags.contains(.command) && !flags.contains(.control) && key == "f" {
                if flags.contains(.option) { self.menuFindReplace() } else { self.menuFind() }
                return nil
            }
            return ev
        }
    }

    func buildWindow() {
        let rect = NSRect(x: 0, y: 0, width: 1100, height: 780)
        window = NSWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = APP_NAME
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.titlebarSeparatorStyle = .none
        window.minSize = NSSize(width: 720, height: 460)
        window.backgroundColor = NSColor.textBackgroundColor
        window.setFrameAutosaveName("OpenTyporaMainWindow")
        window.center()

        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        config.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
        let ucc = WKUserContentController()
        ucc.add(self, name: "bridge")
        config.userContentController = ucc

        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        webView.autoresizingMask = [.width, .height]

        let container = NSView(frame: window.contentView!.bounds)
        container.autoresizingMask = [.width, .height]
        container.addSubview(webView)

        // 顶部 28pt 空白条用于拖动窗口
        let strip = DragStripView(frame: NSRect(x: 0, y: container.bounds.height - 28, width: container.bounds.width, height: 28))
        strip.autoresizingMask = [.width, .minYMargin]
        container.addSubview(strip, positioned: .above, relativeTo: webView)

        window.contentView = container
        window.makeKeyAndOrderFront(nil)

        // 翻译会话需要挂在视图树里才有效（1pt 隐形视图）
        TranslationService.shared.attach(to: container)
    }

    func loadFrontend() {
        guard let res = Bundle.main.resourceURL else { return }
        let appDir = res.appendingPathComponent("app")
        let index = appDir.appendingPathComponent("index.html")
        webView.loadFileURL(index, allowingReadAccessTo: URL(fileURLWithPath: "/"))
    }

    // ---------- 菜单 ----------
    func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu(title: APP_NAME)
        appMenu.addItem(withTitle: "关于 \(APP_NAME)", action: #selector(showAbout), keyEquivalent: "")
            .target = self
        appMenu.addItem(.separator())
        addItem(appMenu, "偏好设置…", #selector(menuPreferences), ",")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏 \(APP_NAME)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出 \(APP_NAME)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let fileItem = NSMenuItem()
        main.addItem(fileItem)
        let fileMenu = NSMenu(title: "文件")
        addItem(fileMenu, "新建", #selector(menuNew), "n")
        addItem(fileMenu, "新建标签页", #selector(menuNewTab), "t")
        addItem(fileMenu, "打开…", #selector(menuOpen), "o")
        addItem(fileMenu, "打开文件夹…", #selector(menuOpenFolder), "o", shift: true)
        addItem(fileMenu, "导入（Word / ODT / ePub / HTML / RST / LaTeX）…", #selector(menuImport), "i", shift: true)
        addItem(fileMenu, "重新打开已关闭的文件", #selector(menuReopenClosed), "t", shift: true)
        addItem(fileMenu, "撤销文件操作", #selector(menuUndoFileOp), "")
        fileMenu.addItem(.separator())
        addItem(fileMenu, "保存", #selector(menuSave), "s")
        addItem(fileMenu, "另存为…", #selector(menuSaveAs), "s", shift: true)
        fileMenu.addItem(.separator())
        let exportMenu = NSMenu(title: "导出")
        addItem(exportMenu, "HTML…", #selector(menuExportHTML), "e", shift: true)
        addItem(exportMenu, "HTML 选项…", #selector(menuExportHTMLOptions), "")
        addItem(exportMenu, "HTML（无样式）…", #selector(menuExportHTMLPlain), "")
        exportMenu.addItem(.separator())
        addItem(exportMenu, "PDF…", #selector(menuExportPDF), "p")
        addItem(exportMenu, "PDF 选项…", #selector(menuExportPDFOptions), "")
        exportMenu.addItem(.separator())
        addItem(exportMenu, "图片（PNG）…", #selector(menuExportPNG), "")
        addItem(exportMenu, "图片（JPEG）…", #selector(menuExportJPEG), "")
        exportMenu.addItem(.separator())
        addItem(exportMenu, "Word 文档（.docx）…", #selector(menuExportDocx), "w", alt: true)
        addItem(exportMenu, "OpenDocument（.odt）…", #selector(menuExportOdt), "d", alt: true)
        addItem(exportMenu, "ePub 电子书…", #selector(menuExportEpub), "b", alt: true)
        addItem(exportMenu, "LaTeX 源码（.tex）…", #selector(menuExportLatex), "x", alt: true)
        exportMenu.addItem(.separator())
        addItem(exportMenu, "RTF 富文本…", #selector(menuExportRtf), "")
        addItem(exportMenu, "reStructuredText（.rst）…", #selector(menuExportRst), "")
        addItem(exportMenu, "MediaWiki 源码…", #selector(menuExportWiki), "")
        addItem(exportMenu, "Textile 源码…", #selector(menuExportTextile), "")
        addItem(exportMenu, "OPML 大纲…", #selector(menuExportOpml), "")
        exportMenu.addItem(.separator())
        addItem(exportMenu, "RevealJS 幻灯片…", #selector(menuExportReveal), "")
        let exportItem = NSMenuItem(title: "导出", action: nil, keyEquivalent: "")
        exportItem.submenu = exportMenu
        fileMenu.addItem(exportItem)
        fileMenu.addItem(.separator())
        // ⌘W 关标签页（和 Safari 一致），关窗口退到 ⇧⌘W
        addItem(fileMenu, "关闭标签页", #selector(menuCloseTab), "w")
        addItem(fileMenu, "关闭窗口", #selector(NSWindow.performClose(_:)), "w", shift: true)
        fileItem.submenu = fileMenu

        let editItem = NSMenuItem()
        main.addItem(editItem)
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenu.addItem(.separator())
        addItem(editMenu, "查找…", #selector(menuFind), "f")
        addItem(editMenu, "查找并替换…", #selector(menuFindReplace), "f", alt: true)
        editMenu.addItem(.separator())
        let insImg = NSMenuItem(title: "插入图片…", action: #selector(menuInsertImage), keyEquivalent: "i")
        insImg.keyEquivalentModifierMask = [.command, .control]
        insImg.target = self
        editMenu.addItem(insImg)
        addItem(editMenu, "整理全部图片到 assets…", #selector(menuMoveImages), "")
        addItem(editMenu, "下载全部远程图片…", #selector(menuDownloadImages), "")
        editMenu.addItem(.separator())
        // ⌘⇧Y 而不是 ⌘⇧T：后者已经给「重新打开已关闭的文件」了，同一个键位挂两份菜单，
        // AppKit 只派发给菜单栏里靠前的那个（文件在前），编辑菜单这条等于按不出来。
        addItem(editMenu, "翻译选中内容", #selector(menuTranslate), "y", shift: true)
        editItem.submenu = editMenu

        let viewItem = NSMenuItem()
        main.addItem(viewItem)
        let viewMenu = NSMenu(title: "视图")
        addItem(viewMenu, "切换侧边栏", #selector(menuToggleSidebar), "\\")
        addItem(viewMenu, "分栏：源码 + 预览", #selector(menuToggleSplit), "l", shift: true)
        addItem(viewMenu, "源码模式", #selector(menuToggleSource), "/")
        addItem(viewMenu, "专注模式", #selector(menuToggleFocus), "")
        addItem(viewMenu, "打字机模式", #selector(menuToggleTypewriter), "")
        viewMenu.addItem(.separator())
        // 与「专注模式 / 打字机模式」一致：纯动作项，当前状态看偏好面板里的勾
        addItem(viewMenu, "严格模式", #selector(menuToggleStrict), "")
        viewItem.submenu = viewMenu

        let winItem = NSMenuItem()
        main.addItem(winItem)
        let winMenu = NSMenu(title: "窗口")
        winMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")
        winMenu.addItem(withTitle: "缩放", action: #selector(NSWindow.zoom(_:)), keyEquivalent: "")
        winItem.submenu = winMenu

        NSApp.mainMenu = main
    }

    @discardableResult
    func addItem(_ menu: NSMenu, _ title: String, _ action: Selector, _ key: String,
                 shift: Bool = false, alt: Bool = false) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        var mask: NSEvent.ModifierFlags = [.command]
        if shift { mask.insert(.shift) }
        if alt { mask.insert(.option) }
        item.keyEquivalentModifierMask = mask
        item.target = self
        menu.addItem(item)
        return item
    }

    @objc func showAbout() {
        let alert = NSAlert()
        alert.messageText = "\(APP_NAME) 1.0"
        alert.informativeText = "一个从零实现的 Markdown 编辑器：块级所见即所得、无损序列化、原生文件读写。\n\nAppKit + WKWebView 原生外壳，前端为纯 HTML/CSS/JS。"
        alert.addButton(withTitle: "好")
        alert.runModal()
    }

    /* 用户主题目录：~/Library/Application Support/OpenTypora/themes。
     * 只认自己的目录 —— 不读、也不写别的软件（包括其它 Markdown 编辑器）的应用支持目录。 */
    func themesDir() -> URL {
        let fm = FileManager.default
        let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let own = base.appendingPathComponent("OpenTypora/themes", isDirectory: true)
        if !fm.fileExists(atPath: own.path) {
            try? fm.createDirectory(at: own, withIntermediateDirectories: true)
        }
        return own
    }

    // ---------- 菜单动作 → 前端 ----------
    func js(_ code: String) {        DispatchQueue.main.async {
            self.webView.evaluateJavaScript(code) { _, err in
                if let err = err { NSLog("JS error: \(err.localizedDescription)") }
            }
        }
    }
    @objc func menuNew() { js("OpenTyporaCmd.newDoc()") }
    @objc func menuNewTab() { js("OpenTyporaCmd.newTab()") }
    @objc func menuCloseTab() { js("OpenTyporaCmd.closeTab()") }
    @objc func menuOpen() { js("OpenTyporaCmd.open()") }
    @objc func menuOpenFolder() { js("OpenTyporaCmd.openFolder()") }
    @objc func menuImport() { js("OpenTyporaCmd.importFile()") }
    @objc func menuReopenClosed() { js("OpenTyporaCmd.reopenClosed()") }
    @objc func menuUndoFileOp() { js("OpenTyporaCmd.undoFileOp()") }
    @objc func menuInsertImage() { js("OpenTyporaCmd.insertImage()") }
    @objc func menuMoveImages() { js("OpenTyporaCmd.moveImages()") }
    @objc func menuDownloadImages() { js("OpenTyporaCmd.downloadImages()") }
    @objc func menuSave() { js("OpenTyporaCmd.save()") }
    @objc func menuSaveAs() { js("OpenTyporaCmd.saveAs()") }
    @objc func menuExportHTML() { js("OpenTyporaCmd.exportHTML()") }
    @objc func menuExportHTMLOptions() { js("OpenTyporaCmd.htmlOptions()") }
    @objc func menuExportHTMLPlain() { js("OpenTyporaCmd.exportHTMLPlain()") }
    @objc func menuExportPDF() { js("OpenTyporaCmd.exportPDF()") }
    @objc func menuExportPDFOptions() { js("OpenTyporaCmd.pdfOptions()") }
    @objc func menuExportPNG() { js("OpenTyporaCmd.exportImage('png')") }
    @objc func menuExportJPEG() { js("OpenTyporaCmd.exportImage('jpeg')") }
    @objc func menuExportDocx() { js("OpenTyporaCmd.exportDocx()") }
    @objc func menuExportOdt() { js("OpenTyporaCmd.exportDoc('odt')") }
    @objc func menuExportEpub() { js("OpenTyporaCmd.exportEpub()") }
    @objc func menuExportLatex() { js("OpenTyporaCmd.exportLatex()") }
    @objc func menuExportRtf() { js("OpenTyporaCmd.exportDoc('rtf')") }
    @objc func menuExportRst() { js("OpenTyporaCmd.exportDoc('rst')") }
    @objc func menuExportWiki() { js("OpenTyporaCmd.exportDoc('mediawiki')") }
    @objc func menuExportTextile() { js("OpenTyporaCmd.exportDoc('textile')") }
    @objc func menuExportOpml() { js("OpenTyporaCmd.exportDoc('opml')") }
    @objc func menuExportReveal() { js("OpenTyporaCmd.exportDoc('revealjs')") }
    @objc func menuToggleSidebar() { js("OpenTyporaCmd.toggleSidebar()") }
    @objc func menuToggleSplit() { js("OpenTyporaCmd.toggleSplit()") }
    @objc func menuToggleSource() { js("OpenTyporaCmd.toggleSource()") }
    @objc func menuToggleFocus() { js("OpenTyporaCmd.toggleFocus()") }
    @objc func menuToggleTypewriter() { js("OpenTyporaCmd.toggleTypewriter()") }
    @objc func menuToggleStrict() { js("OpenTyporaCmd.toggleStrict()") }
    @objc func menuTranslate() { js("OpenTyporaCmd.translateSelection()") }
    @objc func menuFind() { js("OpenTyporaCmd.find()") }
    @objc func menuFindReplace() { js("OpenTyporaCmd.findReplace()") }
    @objc func menuPreferences() { js("OpenTyporaCmd.preferences()") }

    // ---------- 结束 ----------
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if !isDirty { return .terminateNow }
        let alert = NSAlert()
        alert.messageText = "有未保存的修改"
        alert.informativeText = "退出会丢失这些修改。"
        alert.addButton(withTitle: "取消")
        alert.addButton(withTitle: "直接退出")
        return alert.runModal() == .alertSecondButtonReturn ? .terminateNow : .terminateCancel
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        guard let url = urls.first, url.isFileURL else { return }
        pendingOpen = url.path
        js("OpenTyporaCmd.handleExternalOpen(\(jsString(url.path)))")
    }

    // ---------- 桥接 ----------
    func respond(_ id: String, _ ok: Bool, _ payload: Any) {
        let data = (try? JSONSerialization.data(withJSONObject: payload, options: [.fragmentsAllowed]))
            ?? Data("null".utf8)
        let json = String(data: data, encoding: .utf8) ?? "null"
        let code = "window.__bridgeResolve(\(jsString(id)), \(ok ? "true" : "false"), \(json));"
        DispatchQueue.main.async {
            self.webView.evaluateJavaScript(code, completionHandler: nil)
        }
    }

    func jsString(_ s: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: s, options: [.fragmentsAllowed])) ?? Data("\"\"".utf8)
        return String(data: data, encoding: .utf8) ?? "\"\""
    }

    func handle(id: String, method: String, params: [String: Any]) {
        // 本地翻译相关方法由 translate.swift 接管
        if TranslationService.shared.handle(id: id, method: method, params: params, controller: self) {
            return
        }
        switch method {
        case "ready":
            if let p = pendingOpen, let content = try? String(contentsOfFile: p, encoding: .utf8) {
                currentFile = p
                respond(id, true, ["file": p, "content": content])
            } else {
                respond(id, true, ["file": NSNull(), "content": ""])
            }

        case "status":
            isDirty = (params["dirty"] as? Bool) ?? false
            if let p = params["path"] as? String, !p.isEmpty { currentFile = p }
            respond(id, true, NSNull())

        case "setTitle":
            if let t = params["title"] as? String { window.title = t }
            respond(id, true, NSNull())

        case "setFile":
            if let p = params["path"] as? String, !p.isEmpty {
                window.representedURL = URL(fileURLWithPath: p)
                window.title = (p as NSString).lastPathComponent
                currentFile = p
                lastDir = URL(fileURLWithPath: p).deletingLastPathComponent()
            }
            respond(id, true, NSNull())

        case "openFile":
            let panel = NSOpenPanel()
            panel.allowedFileTypes = ["md", "markdown", "mdown", "txt", "text"]
            panel.allowsMultipleSelection = false
            panel.directoryURL = lastDir
            panel.beginSheetModal(for: window) { resp in
                guard resp == .OK, let url = panel.url,
                      let content = try? String(contentsOf: url, encoding: .utf8) else {
                    self.respond(id, true, NSNull()); return
                }
                self.lastDir = url.deletingLastPathComponent()
                self.currentFile = url.path
                self.respond(id, true, [
                    "path": url.path,
                    "name": url.lastPathComponent,
                    "content": content
                ])
            }

        case "readFile":
            guard let p = params["path"] as? String else { respond(id, false, "缺少路径"); return }
            do {
                let content = try String(contentsOfFile: p, encoding: .utf8)
                currentFile = p
                respond(id, true, ["path": p, "name": (p as NSString).lastPathComponent, "content": content])
            } catch {
                respond(id, false, "读取失败：\(error.localizedDescription)")
            }

        case "readText":
            // 只读，不改变「当前文件」（全局搜索用）
            guard let p = params["path"] as? String else { respond(id, false, "缺少路径"); return }
            do {
                let content = try String(contentsOfFile: p, encoding: .utf8)
                respond(id, true, ["path": p, "content": content])
            } catch {
                respond(id, false, error.localizedDescription)
            }

        case "openFolder":
            let panel = NSOpenPanel()
            panel.canChooseFiles = false
            panel.canChooseDirectories = true
            panel.allowsMultipleSelection = false
            panel.directoryURL = lastDir
            panel.beginSheetModal(for: window) { resp in
                guard resp == .OK, let url = panel.url else { self.respond(id, true, NSNull()); return }
                self.lastDir = url
                let nodes = self.scan(url, depth: 0)
                self.respond(id, true, ["root": url.path, "tree": nodes.map { $0.json() }])
            }

        case "openFolderAt":
            // CLI / 拖文件夹进来时用：不开面板，直接把指定目录摊成文件树
            guard let p = params["path"] as? String else { respond(id, false, "缺少路径"); return }
            let dir = URL(fileURLWithPath: (p as NSString).expandingTildeInPath)
            var isDir: ObjCBool = false
            guard FileManager.default.fileExists(atPath: dir.path, isDirectory: &isDir), isDir.boolValue else {
                respond(id, false, "不是文件夹：\(p)"); return
            }
            lastDir = dir
            let nodes = scan(dir, depth: 0)
            respond(id, true, ["root": dir.path, "tree": nodes.map { $0.json() }])

        case "save":
            guard let p = params["path"] as? String,
                  let content = params["content"] as? String else {
                respond(id, false, "缺少参数"); return
            }
            do {
                try content.write(toFile: p, atomically: true, encoding: .utf8)
                currentFile = p
                respond(id, true, ["path": p])
            } catch {
                respond(id, false, "保存失败：\(error.localizedDescription)")
            }

        case "saveAs":
            let panel = NSSavePanel()
            panel.nameFieldStringValue = (params["name"] as? String) ?? "未命名.md"
            panel.allowedFileTypes = ["md", "markdown", "txt"]
            panel.directoryURL = lastDir
            panel.beginSheetModal(for: window) { resp in
                guard resp == .OK, let url = panel.url else { self.respond(id, true, NSNull()); return }
                let content = (params["content"] as? String) ?? ""
                do {
                    try content.write(to: url, atomically: true, encoding: .utf8)
                    self.currentFile = url.path
                    self.lastDir = url.deletingLastPathComponent()
                    self.isDirty = false
                    self.respond(id, true, ["path": url.path])
                } catch {
                    self.respond(id, false, "保存失败：\(error.localizedDescription)")
                }
            }

        case "saveImage":
            guard let dataUrl = params["data"] as? String else { respond(id, false, "缺少图片数据"); return }
            guard let parsed = decodeDataURL(dataUrl) else { respond(id, false, "图片解码失败"); return }
            let docPath = (params["docPath"] as? String) ?? ""
            let dest = ((params["dest"] as? String) ?? "").trimmingCharacters(in: .whitespaces)
            // 落盘目录：dest 优先（typora-copy-images-to 由 JS 算好），相对值仍按
            // 文档目录解析 —— 与 imgImport / imgFetch 同一套规则
            var dir: URL
            if !docPath.isEmpty {
                let docDir = URL(fileURLWithPath: docPath).deletingLastPathComponent()
                if dest.isEmpty { dir = docDir.appendingPathComponent("assets") }
                else if dest.hasPrefix("/") { dir = URL(fileURLWithPath: dest) }
                else { dir = docDir.appendingPathComponent(dest) }
            } else {
                dir = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("opentypora-assets")
            }
            do {
                let fm = FileManager.default
                try fm.createDirectory(at: dir, withIntermediateDirectories: true)
                let stamp = Int(Date().timeIntervalSince1970)
                var url = dir.appendingPathComponent("image-\(stamp).\(parsed.ext)")
                var n = 2
                // 同一秒里连贴/连拖几张图不能互相覆盖（原名只到秒级）
                while fm.fileExists(atPath: url.path) {
                    url = dir.appendingPathComponent("image-\(stamp)-\(n).\(parsed.ext)")
                    n += 1
                }
                try parsed.data.write(to: url)
                // 一律回绝对路径，写进正文的相对引用由 JS 按文档目录换算
                respond(id, true, ["path": url.path, "name": url.lastPathComponent])
            } catch {
                respond(id, false, "写入图片失败：\(error.localizedDescription)")
            }

        case "exportHTML":
            let panel = NSSavePanel()
            panel.nameFieldStringValue = (params["name"] as? String) ?? "export.html"
            panel.allowedFileTypes = ["html"]
            panel.directoryURL = lastDir
            panel.beginSheetModal(for: window) { resp in
                guard resp == .OK, let url = panel.url else { self.respond(id, true, NSNull()); return }
                var html = (params["html"] as? String) ?? ""
                let withStyles = (params["styles"] as? Bool) ?? true
                if withStyles {
                    html = WebExport.inject(into: html,
                                            css: self.readCSS(),
                                            themeCss: params["themeCss"] as? String)
                }
                do {
                    try html.write(to: url, atomically: true, encoding: .utf8)
                    self.respond(id, true, ["path": url.path])
                } catch {
                    self.respond(id, false, "导出失败：\(error.localizedDescription)")
                }
            }

        case "exportPDF":
            let panel = NSSavePanel()
            let base = ((currentFile as NSString?)?.lastPathComponent as NSString?)?.deletingPathExtension ?? "export"
            panel.nameFieldStringValue = "\(base).pdf"
            panel.allowedFileTypes = ["pdf"]
            panel.directoryURL = lastDir
            let pdfOpts = params
            panel.beginSheetModal(for: window) { resp in
                guard resp == .OK, let url = panel.url else { self.respond(id, true, NSNull()); return }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                    self.renderPDF(to: url, id: id, opts: pdfOpts)
                }
            }

        case "exportImage":
            let fmt = ((params["format"] as? String) ?? "png").lowercased()
            let panel = NSSavePanel()
            let base = ((currentFile as NSString?)?.lastPathComponent as NSString?)?.deletingPathExtension ?? "export"
            panel.nameFieldStringValue = "\(base).\(fmt == "jpeg" ? "jpg" : "png")"
            panel.allowedFileTypes = [fmt == "jpeg" ? "jpg" : "png"]
            panel.directoryURL = lastDir
            panel.beginSheetModal(for: window) { resp in
                guard resp == .OK, let url = panel.url else { self.respond(id, true, NSNull()); return }
                self.lastDir = url.deletingLastPathComponent()
                self.snapshotPage(format: fmt, to: url, id: id)
            }

        case "readBinary":
            // 导出时读图片等二进制资源。相对路径按当前文档所在目录解析。
            guard let raw = params["path"] as? String else { respond(id, false, "缺少路径"); return }
            var url = URL(fileURLWithPath: raw)
            if !raw.hasPrefix("/"), let cur = currentFile {
                url = URL(fileURLWithPath: cur).deletingLastPathComponent()
                    .appendingPathComponent(raw)
            }
            if let data = try? Data(contentsOf: url) {
                respond(id, true, ["base64": data.base64EncodedString(),
                                   "path": url.path,
                                   "size": data.count])
            } else {
                respond(id, true, NSNull())
            }

        case "importFile":
            // 导入：选源文件（.docx / .html），把字节交给前端转换
            let panel = NSOpenPanel()
            panel.allowedFileTypes = ["docx", "odt", "epub", "html", "htm", "md", "markdown",
                                      "txt", "text", "rst", "rest", "tex", "latex", "ltx"]
            panel.allowsMultipleSelection = false
            panel.directoryURL = lastDir
            panel.beginSheetModal(for: window) { resp in
                guard resp == .OK, let url = panel.url,
                      let data = try? Data(contentsOf: url) else {
                    self.respond(id, true, NSNull()); return
                }
                self.lastDir = url.deletingLastPathComponent()
                self.respond(id, true, [
                    "path": url.path,
                    "name": url.lastPathComponent,
                    "ext": url.pathExtension.lowercased(),
                    "base64": data.base64EncodedString()
                ])
            }

        case "saveImport":
            // 转换结果落盘：先选 .md 位置，再把内嵌图片写到旁边（相对路径）
            let content = (params["content"] as? String) ?? ""
            let assets = (params["assets"] as? [[String: Any]]) ?? []
            let panel = NSSavePanel()
            panel.nameFieldStringValue = (params["name"] as? String) ?? "导入.md"
            panel.allowedFileTypes = ["md", "markdown"]
            panel.directoryURL = lastDir
            panel.beginSheetModal(for: window) { resp in
                guard resp == .OK, let url = panel.url else {
                    self.respond(id, true, NSNull()); return
                }
                let base = url.deletingLastPathComponent()
                do {
                    try content.write(to: url, atomically: true, encoding: .utf8)
                    for a in assets {
                        guard let rel = a["path"] as? String,
                              let b64 = a["base64"] as? String,
                              let data = Data(base64Encoded: b64),
                              !rel.contains(".."), !rel.hasPrefix("/") else { continue }
                        let dest = base.appendingPathComponent(rel)
                        try FileManager.default.createDirectory(
                            at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
                        try data.write(to: dest)
                    }
                    self.currentFile = url.path
                    self.lastDir = base
                    self.isDirty = false
                    self.respond(id, true, ["path": url.path])
                } catch {
                    self.respond(id, false, "导入写入失败：\(error.localizedDescription)")
                }
            }

        case "exportFile":
            guard let b64 = params["base64"] as? String,
                  let data = Data(base64Encoded: b64) else {
                respond(id, false, "导出数据无效"); return
            }
            let ext = (params["ext"] as? String) ?? "bin"
            let panel = NSSavePanel()
            panel.nameFieldStringValue = (params["name"] as? String) ?? "export.\(ext)"
            panel.allowedFileTypes = [ext]
            panel.directoryURL = lastDir
            panel.beginSheetModal(for: window) { resp in
                guard resp == .OK, let url = panel.url else { self.respond(id, true, NSNull()); return }
                do {
                    try data.write(to: url, options: .atomic)
                    self.lastDir = url.deletingLastPathComponent()
                    self.respond(id, true, ["path": url.path])
                } catch {
                    self.respond(id, false, "写入失败：\(error.localizedDescription)")
                }
            }

        case "openUrl":
            if let s = params["url"] as? String, let u = URL(string: s), ["http", "https", "mailto"].contains(u.scheme ?? "") {
                NSWorkspace.shared.open(u)
            } else if let s = params["url"] as? String, FileManager.default.fileExists(atPath: s) {
                NSWorkspace.shared.open(URL(fileURLWithPath: s))
            }
            respond(id, true, NSNull())

        case "reveal":
            if let p = params["path"] as? String {
                NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: p)])
            }
            respond(id, true, NSNull())

        case "confirm":
            let alert = NSAlert()
            alert.messageText = (params["message"] as? String) ?? "确认"
            alert.informativeText = (params["info"] as? String) ?? ""
            alert.addButton(withTitle: "继续")
            alert.addButton(withTitle: "取消")
            alert.beginSheetModal(for: window) { resp in
                self.respond(id, true, resp == .alertFirstButtonReturn)
            }

        case "copy":
            if let s = params["text"] as? String {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(s, forType: .string)
            }
            respond(id, true, NSNull())

        // 渲染态拼写：前端切好词，这里只做词典判定。判定跑在后台串行队列
        // （0.67ms/词，一千词就是半秒多，压主线程会卡界面），算完回主线程。
        case "spellCheck":
            let words = (params["words"] as? [String]) ?? []
            let ignore = Set(((params["ignore"] as? [String]) ?? []).map { $0.lowercased() })
            SpellCheck.offload({ SpellCheck.unknowns(words, ignore: ignore) }) { bad in
                self.respond(id, true, ["bad": bad])
            }

        case "spellGuesses":
            let word = (params["word"] as? String) ?? ""
            SpellCheck.offload({ SpellCheck.guesses(for: word) }) { gs in
                self.respond(id, true, ["guesses": gs])
            }

        case "listThemes":
            let dir = themesDir()
            let files = (try? FileManager.default.contentsOfDirectory(
                at: dir, includingPropertiesForKeys: nil)) ?? []
            let list: [[String: Any]] = files
                .filter { $0.pathExtension.lowercased() == "css" }
                .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
                .map { ["id": $0.lastPathComponent,
                        "name": $0.deletingPathExtension().lastPathComponent] }
            respond(id, true, ["dir": dir.path, "themes": list])

        case "readTheme":
            let name = (params["id"] as? String) ?? ""
            // 只允许读主题目录里的 .css，挡住 ../ 之类的路径穿越
            let url = themesDir().appendingPathComponent((name as NSString).lastPathComponent)
            let css = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
            respond(id, true, ["css": css])

        case "openThemeFolder":
            NSWorkspace.shared.open(themesDir())
            respond(id, true, NSNull())

        case "fsList":
            guard let p = params["path"] as? String else { respond(id, false, "缺少路径"); return }
            let url = URL(fileURLWithPath: p)
            let nodes = self.scan(url, depth: 0)
            respond(id, true, ["root": p, "tree": nodes.map { $0.json() }])

        case "fsOp":
            guard let op = params["op"] as? String else { respond(id, false, "缺少操作"); return }
            let fm = FileManager.default
            do {
                switch op {
                case "newFile", "newFolder":
                    guard let dir = params["dir"] as? String, let name = params["name"] as? String else {
                        respond(id, false, "缺少参数"); return
                    }
                    let target = URL(fileURLWithPath: dir).appendingPathComponent(name)
                    if fm.fileExists(atPath: target.path) { respond(id, false, "同名文件已存在"); return }
                    if op == "newFile" {
                        let body = params["content"] as? String ?? "# " + (name as NSString).deletingPathExtension + "\n"
                        try body.write(to: target, atomically: true, encoding: .utf8)
                    } else {
                        try fm.createDirectory(at: target, withIntermediateDirectories: false)
                    }
                    respond(id, true, ["path": target.path])
                case "rename":
                    guard let from = params["path"] as? String, let name = params["name"] as? String else {
                        respond(id, false, "缺少参数"); return
                    }
                    let src = URL(fileURLWithPath: from)
                    let dst = src.deletingLastPathComponent().appendingPathComponent(name)
                    if fm.fileExists(atPath: dst.path) { respond(id, false, "同名文件已存在"); return }
                    try fm.moveItem(at: src, to: dst)
                    respond(id, true, ["path": dst.path])
                case "duplicate":
                    guard let from = params["path"] as? String else { respond(id, false, "缺少参数"); return }
                    let src = URL(fileURLWithPath: from)
                    let base = src.deletingPathExtension().lastPathComponent + "-副本"
                    let ext = src.pathExtension
                    var dst = src.deletingLastPathComponent().appendingPathComponent(base + (ext.isEmpty ? "" : "." + ext))
                    var n = 2
                    while fm.fileExists(atPath: dst.path) {
                        dst = src.deletingLastPathComponent().appendingPathComponent(base + "-" + String(n) + (ext.isEmpty ? "" : "." + ext))
                        n += 1
                    }
                    try fm.copyItem(at: src, to: dst)
                    respond(id, true, ["path": dst.path])
                case "trash":
                    guard let p = params["path"] as? String else { respond(id, false, "缺少参数"); return }
                    var trashURL: NSURL?
                    do {
                        try fm.trashItem(at: URL(fileURLWithPath: p), resultingItemURL: &trashURL)
                    } catch {
                        respond(id, false, "移到废纸篓失败：\(error.localizedDescription)"); return
                    }
                    // resultingItemURL 是真实落点（重名时系统会改名），撤销要靠它搬回来
                    respond(id, true, ["path": p, "trashPath": trashURL?.path ?? ""])
                case "restore":
                    // 撤销「移到废纸篓」：从 trash 路径搬回原位置
                    guard let t = params["trash"] as? String, let p = params["path"] as? String,
                          !t.isEmpty, fm.fileExists(atPath: t) else {
                        respond(id, false, "废纸篓里已经找不到这个文件"); return
                    }
                    let dst = URL(fileURLWithPath: p)
                    if fm.fileExists(atPath: p) { respond(id, false, "原位置已有同名文件"); return }
                    do {
                        try fm.createDirectory(at: dst.deletingLastPathComponent(), withIntermediateDirectories: true)
                        try fm.moveItem(at: URL(fileURLWithPath: t), to: dst)
                        respond(id, true, ["path": p])
                    } catch {
                        respond(id, false, "恢复失败：\(error.localizedDescription)")
                    }
                case "copyTo", "moveTo":
                    guard let from = params["path"] as? String, let dir = params["dir"] as? String else {
                        respond(id, false, "缺少参数"); return
                    }
                    let src = URL(fileURLWithPath: from)
                    let folder = URL(fileURLWithPath: dir)
                    try fm.createDirectory(at: folder, withIntermediateDirectories: true)
                    var dst = folder.appendingPathComponent(src.lastPathComponent)
                    let stem = src.deletingPathExtension().lastPathComponent
                    let ext = src.pathExtension
                    var n = 2
                    while fm.fileExists(atPath: dst.path) {
                        let name = stem + "-" + String(n) + (ext.isEmpty ? "" : "." + ext)
                        dst = folder.appendingPathComponent(name)
                        n += 1
                    }
                    if op == "copyTo" { try fm.copyItem(at: src, to: dst) }
                    else { try fm.moveItem(at: src, to: dst) }
                    respond(id, true, ["path": dst.path])
                case "stat":
                    guard let p = params["path"] as? String else { respond(id, false, "缺少参数"); return }
                    let u = URL(fileURLWithPath: p)
                    let vals = try u.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey, .isDirectoryKey])
                    respond(id, true, ["mtime": vals.contentModificationDate?.timeIntervalSince1970 ?? 0,
                                       "size": vals.fileSize ?? 0,
                                       "isDir": vals.isDirectory ?? false])
                default:
                    respond(id, false, "未知操作：\(op)")
                }
            } catch {
                respond(id, false, error.localizedDescription)
            }

        case "pickImages":
            let panel = NSOpenPanel()
            panel.allowsMultipleSelection = true
            panel.canChooseFiles = true
            panel.canChooseDirectories = false
            panel.allowedFileTypes = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tif", "tiff", "heic"]
            panel.prompt = "插入"
            panel.message = "选择要插入的图片"
            panel.directoryURL = lastDir
            panel.beginSheetModal(for: window) { resp in
                guard resp == .OK else { self.respond(id, true, NSNull()); return }
                let arr = panel.urls.map { ["path": $0.path, "name": $0.lastPathComponent] }
                self.respond(id, true, arr)
            }

        case "chooseFolder":
            let panel = NSOpenPanel()
            panel.allowsMultipleSelection = false
            panel.canChooseFiles = false
            panel.canChooseDirectories = true
            panel.canCreateDirectories = true
            panel.prompt = "选择"
            panel.message = "选择目标文件夹"
            panel.directoryURL = lastDir
            panel.beginSheetModal(for: window) { resp in
                guard resp == .OK, let url = panel.url else { self.respond(id, true, NSNull()); return }
                self.respond(id, true, url.path)
            }

        case "imgImport":
            guard let srcPath = params["src"] as? String else { respond(id, false, "缺少图片路径"); return }
            let src = URL(fileURLWithPath: srcPath)
            let docPath = (params["docPath"] as? String) ?? ""
            let dest = ((params["dest"] as? String) ?? "").trimmingCharacters(in: .whitespaces)
            var folder: URL
            if !docPath.isEmpty {
                let docDir = URL(fileURLWithPath: docPath).deletingLastPathComponent()
                if dest.isEmpty { folder = docDir.appendingPathComponent("assets") }
                else if dest.hasPrefix("/") { folder = URL(fileURLWithPath: dest) }
                else { folder = docDir.appendingPathComponent(dest) }
            } else {
                folder = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("opentypora-assets")
            }
            do {
                let fm = FileManager.default
                try fm.createDirectory(at: folder, withIntermediateDirectories: true)
                var dst = folder.appendingPathComponent(src.lastPathComponent)
                let stem = src.deletingPathExtension().lastPathComponent
                let ext = src.pathExtension
                var n = 2
                while fm.fileExists(atPath: dst.path) {
                    dst = folder.appendingPathComponent(stem + "-" + String(n) + (ext.isEmpty ? "" : "." + ext))
                    n += 1
                }
                try fm.copyItem(at: src, to: dst)
                self.respond(id, true, ["path": dst.path, "name": dst.lastPathComponent])
            } catch {
                self.respond(id, false, "复制图片失败：\(error.localizedDescription)")
            }

        case "imgFetch":
            guard let urlStr = params["url"] as? String,
                  let url = URL(string: urlStr),
                  let scheme = url.scheme?.lowercased(),
                  scheme == "http" || scheme == "https" else {
                respond(id, false, "只支持 http/https 图片地址")
                return
            }
            let docPath = (params["docPath"] as? String) ?? ""
            let dest = ((params["dest"] as? String) ?? "").trimmingCharacters(in: .whitespaces)
            let want = ((params["name"] as? String) ?? "").trimmingCharacters(in: .whitespaces)

            var folder: URL
            if !docPath.isEmpty {
                let docDir = URL(fileURLWithPath: docPath).deletingLastPathComponent()
                if dest.isEmpty { folder = docDir.appendingPathComponent("assets") }
                else if dest.hasPrefix("/") { folder = URL(fileURLWithPath: dest) }
                else { folder = docDir.appendingPathComponent(dest) }
            } else {
                folder = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("opentypora-assets")
            }

            var req = URLRequest(url: url)
            req.timeoutInterval = 30
            // 有些图床拦默认 UA，伪装成普通浏览器
            req.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", forHTTPHeaderField: "User-Agent")
            URLSession.shared.dataTask(with: req) { data, resp, err in
                if let err = err {
                    self.respond(id, false, "下载失败：\(err.localizedDescription)")
                    return
                }
                if let http = resp as? HTTPURLResponse, http.statusCode >= 400 {
                    self.respond(id, false, "下载失败：HTTP \(http.statusCode)")
                    return
                }
                guard let data = data, !data.isEmpty else {
                    self.respond(id, false, "下载失败：内容为空")
                    return
                }
                let fm = FileManager.default
                do { try fm.createDirectory(at: folder, withIntermediateDirectories: true) }
                catch {
                    self.respond(id, false, "建目录失败：\(error.localizedDescription)")
                    return
                }
                var name = want
                if name.isEmpty {
                    name = url.lastPathComponent.isEmpty ? "image" : url.lastPathComponent
                }
                if (name as NSString).pathExtension.isEmpty {
                    let ct = ((resp as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased()
                    let ext: String
                    if ct.contains("jpeg") { ext = "jpg" }
                    else if ct.contains("gif") { ext = "gif" }
                    else if ct.contains("webp") { ext = "webp" }
                    else if ct.contains("svg") { ext = "svg" }
                    else { ext = "png" }
                    name += "." + ext
                }
                var target = folder.appendingPathComponent(name)
                let stem = (name as NSString).deletingPathExtension
                let ext2 = (name as NSString).pathExtension
                var n = 2
                while fm.fileExists(atPath: target.path) {
                    target = folder.appendingPathComponent(stem + "-" + String(n) + (ext2.isEmpty ? "" : "." + ext2))
                    n += 1
                }
                do { try data.write(to: target) }
                catch {
                    self.respond(id, false, "写入失败：\(error.localizedDescription)")
                    return
                }
                self.respond(id, true, ["path": target.path, "name": target.lastPathComponent, "size": data.count])
            }.resume()

        case "runExport":
            // 自定义导出命令：把当前文档写成临时 .md，弹保存面板定输出路径，
            // 展开占位符后交给 /bin/sh -c 执行（cmd/ext/name/dir/content）。
            guard let cmd = params["cmd"] as? String, !cmd.trimmingCharacters(in: .whitespaces).isEmpty else {
                respond(id, false, "缺少命令"); return
            }
            guard let content = params["content"] as? String else {
                respond(id, false, "缺少文档内容"); return
            }
            let ext = ((params["ext"] as? String) ?? "out").replacingOccurrences(of: ".", with: "")
            let stem = ((params["name"] as? String) ?? "Untitled")
            let dir = ((params["dir"] as? String) ?? "")

            let panel = NSSavePanel()
            panel.nameFieldStringValue = stem + "." + ext
            panel.allowedFileTypes = [ext]
            panel.directoryURL = dir.isEmpty ? lastDir : URL(fileURLWithPath: dir)
            panel.beginSheetModal(for: window) { resp in
                guard resp == .OK, let outUrl = panel.url else { self.respond(id, true, NSNull()); return }
                self.lastDir = outUrl.deletingLastPathComponent()

                let tmpDir = URL(fileURLWithPath: NSTemporaryDirectory())
                    .appendingPathComponent("opentypora-export-" + UUID().uuidString)
                do {
                    try FileManager.default.createDirectory(at: tmpDir, withIntermediateDirectories: true)
                } catch {
                    self.respond(id, false, "建临时目录失败：\(error.localizedDescription)"); return
                }
                let srcUrl = tmpDir.appendingPathComponent(stem + ".md")
                do { try content.write(to: srcUrl, atomically: true, encoding: .utf8) }
                catch { self.respond(id, false, "写临时文件失败：\(error.localizedDescription)"); return }

                let vars: [String: String] = [
                    "src": srcUrl.path, "currentFilePath": srcUrl.path,
                    "out": outUrl.path, "outputPath": outUrl.path,
                    "name": stem, "ext": ext,
                    "dir": dir.isEmpty ? outUrl.deletingLastPathComponent().path : dir
                ]
                var real = cmd
                for (k, v) in vars { real = real.replacingOccurrences(of: "{\(k)}", with: v) }

                // 输出重定向到文件而不是 Pipe：程序打印很多时 Pipe 缓冲满了会卡死
                let outLog = tmpDir.appendingPathComponent("stdout.log")
                let errLog = tmpDir.appendingPathComponent("stderr.log")
                FileManager.default.createFile(atPath: outLog.path, contents: nil)
                FileManager.default.createFile(atPath: errLog.path, contents: nil)

                DispatchQueue.global(qos: .userInitiated).async {
                    let task = Process()
                    task.executableURL = URL(fileURLWithPath: "/bin/sh")
                    task.arguments = ["-c", real]
                    task.currentDirectoryURL = dir.isEmpty ? URL(fileURLWithPath: NSTemporaryDirectory())
                                                           : URL(fileURLWithPath: dir)
                    // 拿不到日志句柄就丢到 /dev/null，别让它继承终端管道
                    let oh = FileHandle(forWritingAtPath: outLog.path) ?? FileHandle.nullDevice
                    let eh = FileHandle(forWritingAtPath: errLog.path) ?? FileHandle.nullDevice
                    task.standardOutput = oh
                    task.standardError = eh
                    var launchErr: String? = nil
                    do { try task.run() } catch { launchErr = error.localizedDescription }
                    if let le = launchErr {
                        try? oh.close(); try? eh.close()
                        DispatchQueue.main.async {
                            try? FileManager.default.removeItem(at: tmpDir)
                            self.respond(id, false, "启动失败：" + le)
                        }
                        return
                    }
                    task.waitUntilExit()
                    let code = task.terminationStatus
                    try? oh.close(); try? eh.close()
                    let so = (try? String(contentsOf: outLog, encoding: .utf8)) ?? ""
                    let se = (try? String(contentsOf: errLog, encoding: .utf8)) ?? ""
                    try? FileManager.default.removeItem(at: tmpDir)
                    DispatchQueue.main.async {
                        if code == 0 {
                            self.respond(id, true, ["path": outUrl.path, "log": so])
                        } else {
                            var msg = "命令退出码 \(code)"
                            let tail = se.trimmingCharacters(in: .whitespacesAndNewlines)
                            if !tail.isEmpty { msg += "\n" + String(tail.suffix(600)) }
                            // 最常见的两种失败：程序没装、输出目录写不进去
                            if code == 127 {
                                let bin = real.split(separator: " ").first.map(String.init) ?? ""
                                msg = "找不到程序「\(bin)」\n" + (bin == "pandoc"
                                    ? "先装一下：brew install pandoc" : "请确认已安装且已加入 PATH")
                            }
                            self.respond(id, false, msg)
                        }
                    }
                }
            }

        case "newWindow":
            if let bundle = Bundle.main.bundlePath as String? {
                let task = Process()
                task.executableURL = URL(fileURLWithPath: "/usr/bin/open")
                task.arguments = ["-n", "-a", bundle]
                if let p = params["path"] as? String { task.arguments = ["-n", "-a", bundle, p] }
                try? task.run()
            }
            respond(id, true, NSNull())

        case "print":
            let info = NSPrintInfo.shared
            info.orientation = .portrait
            info.topMargin = 36; info.bottomMargin = 36
            info.leftMargin = 36; info.rightMargin = 36
            let op = webView.printOperation(with: info)
            op.showsPrintPanel = true
            op.showsProgressPanel = true
            op.runModal(for: self.window, delegate: nil, didRun: nil, contextInfo: nil)
            respond(id, true, NSNull())

        case "quit":
            NSApp.terminate(nil)

        default:
            respond(id, false, "未知方法 \(method)")
        }
    }

    // ---------- 辅助 ----------
    func readCSS() -> String? {
        guard let res = Bundle.main.resourceURL else { return nil }
        var parts: [String] = []
        if let s = try? String(contentsOf: res.appendingPathComponent("app/css/app.css"), encoding: .utf8) {
            parts.append(s)
        }
        // 单文件 HTML 导出时公式字体必须跟着走，否则 ∑ / ∫ 会掉字形。
        // katex 的 css 按 url(fonts/x.woff2) 引用字体，这里逐个内联成 data URI。
        let katexDir = res.appendingPathComponent("app/vendor/katex")
        if var kcss = try? String(contentsOf: katexDir.appendingPathComponent("katex.min.css"), encoding: .utf8) {
            let fontDir = katexDir.appendingPathComponent("fonts")
            if let names = try? FileManager.default.contentsOfDirectory(atPath: fontDir.path) {
                for n in names where n.hasSuffix(".woff2") {
                    guard let data = try? Data(contentsOf: fontDir.appendingPathComponent(n)) else { continue }
                    kcss = kcss.replacingOccurrences(
                        of: "url(fonts/\(n))",
                        with: "url(data:font/woff2;base64,\(data.base64EncodedString()))")
                }
            }
            parts.append(kcss)
        }
        return parts.isEmpty ? nil : parts.joined(separator: "\n")
    }

    func renderPDF(to url: URL, id: String, opts: [String: Any]) {
        let info = NSPrintInfo(dictionary: [:])
        let paper = (opts["paper"] as? String) ?? "a4"
        switch paper {
        case "letter": info.paperSize = NSSize(width: 612, height: 792)
        case "a3": info.paperSize = NSSize(width: 841.89, height: 1190.55)
        case "a5": info.paperSize = NSSize(width: 419.53, height: 595.28)
        default: info.paperSize = NSSize(width: 595.28, height: 841.89)   // A4
        }
        let margin = CGFloat((opts["margin"] as? Double) ?? 42)
        info.topMargin = margin; info.bottomMargin = margin
        info.leftMargin = max(24, margin + 6); info.rightMargin = max(24, margin + 6)
        if (opts["headerFooter"] as? Bool) == true {
            info.dictionary()[NSPrintInfo.AttributeKey(rawValue: "NSPrintHeaderAndFooter")] = true
        }
        // h1 分页：前端已在 body 上加了 pdf-h1page，打印样式里 break-before: page
        if (opts["h1page"] as? Bool) == true {
            webView.evaluateJavaScript("document.body.classList.add('pdf-h1page')", completionHandler: nil)
        }
        info.horizontalPagination = .fit
        info.verticalPagination = .automatic
        info.jobDisposition = .save
        info.dictionary()[NSPrintInfo.AttributeKey(rawValue: "NSJobSavingURL")] = url

        let op = webView.printOperation(with: info)
        op.showsPrintPanel = false
        op.showsProgressPanel = false
        let ok = op.run()
        _ = webView.evaluateJavaScript("document.body.classList.remove('pdf-h1page')", completionHandler: nil)
        if ok, FileManager.default.fileExists(atPath: url.path) {
            // 书签：前端给的标题层级，PrintOperation 落盘之后再用 PDFKit 补 outline
            let heads = (opts["outline"] as? [[String: Any]]) ?? []
            let marks = heads.isEmpty ? 0 : PDFBookmarks.attach(to: url, headings: heads)
            respond(id, true, ["path": url.path, "bookmarks": marks])
        } else {
            respond(id, false, "PDF 生成失败")
        }
    }

    // 整页快照（导出图片）：临时把 WebView 撑到全文高度，截完再还原
    func snapshotPage(format: String, to url: URL, id: String) {
        webView.evaluateJavaScript("document.body.classList.add('printing'); document.body.scrollHeight") { res, _ in
            let height = max(400, ((res as? NSNumber)?.doubleValue ?? 800) + 40)
            let width = self.webView.bounds.width
            let saved = self.webView.frame
            self.webView.setFrameSize(NSSize(width: width, height: CGFloat(height)))
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                let cfg = WKSnapshotConfiguration()
                cfg.rect = CGRect(x: 0, y: 0, width: width, height: CGFloat(height))
                cfg.snapshotWidth = NSNumber(value: Double(width))
                self.webView.takeSnapshot(with: cfg) { image, err in
                    self.webView.frame = saved
                    _ = self.webView.evaluateJavaScript("document.body.classList.remove('printing')", completionHandler: nil)
                    guard err == nil, let image = image,
                          let tiff = image.tiffRepresentation,
                          let rep = NSBitmapImageRep(data: tiff) else {
                        self.respond(id, false, "截图失败")
                        return
                    }
                    let data = format == "jpeg"
                        ? rep.representation(using: .jpeg, properties: [.compressionFactor: 0.92])
                        : rep.representation(using: .png, properties: [:])
                    guard let out = data else { self.respond(id, false, "编码失败"); return }
                    do {
                        try out.write(to: url)
                        self.respond(id, true, ["path": url.path])
                    } catch {
                        self.respond(id, false, error.localizedDescription)
                    }
                }
            }
        }
    }

    func decodeDataURL(_ s: String) -> (data: Data, ext: String)? {
        guard let comma = s.firstIndex(of: ",") else { return nil }
        let head = String(s[s.startIndex..<comma])
        let b64 = String(s[s.index(after: comma)...])
        let ext: String
        if head.contains("jpeg") || head.contains("jpg") { ext = "jpg" }
        else if head.contains("gif") { ext = "gif" }
        else if head.contains("webp") { ext = "webp" }
        else { ext = "png" }
        guard let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters) else { return nil }
        return (data, ext)
    }

    func scan(_ url: URL, depth: Int) -> [Node] {
        guard depth < 6 else { return [] }
        var dirs: [Node] = [], files: [Node] = []
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(at: url, includingPropertiesForKeys: [.isDirectoryKey, .contentModificationDateKey, .fileSizeKey], options: [.skipsHiddenFiles]) else { return [] }
        for e in entries.sorted(by: { $0.lastPathComponent.lowercased() < $1.lastPathComponent.lowercased() }) {
            let name = e.lastPathComponent
            if name.hasPrefix(".") || name == "node_modules" { continue }
            var isDir: ObjCBool = false
            fm.fileExists(atPath: e.path, isDirectory: &isDir)
            let vals = try? e.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
            if isDir.boolValue {
                let kids = scan(e, depth: depth + 1)
                if kids.contains(where: { !$0.isDir }) {
                    let n = Node(name: name, path: e.path, isDir: true)
                    n.children = kids
                    n.mtime = vals?.contentModificationDate?.timeIntervalSince1970 ?? 0
                    dirs.append(n)
                }
            } else if ["md", "markdown", "mdown", "txt"].contains(e.pathExtension.lowercased()) {
                let n = Node(name: name, path: e.path, isDir: false)
                n.mtime = vals?.contentModificationDate?.timeIntervalSince1970 ?? 0
                n.size = vals?.fileSize ?? 0
                files.append(n)
            }
        }
        return dirs + files
    }

    // ---------- WKUIDelegate（支持 alert/confirm） ----------
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "好")
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { resp in
            completionHandler(resp == .alertFirstButtonReturn)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        js("window.__native = true;")
    }
}

// MARK: - 脚本消息
extension AppController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let id = body["id"] as? String,
              let method = body["method"] as? String else { return }
        let params = (body["params"] as? [String: Any]) ?? [:]
        handle(id: id, method: method, params: params)
    }
}

// MARK: - 入口
let app = NSApplication.shared
let controller = AppController()
app.delegate = controller
app.setActivationPolicy(.regular)
app.run()
