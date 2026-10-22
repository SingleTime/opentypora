// ============================================================
//  translate.swift — 调用 macOS 本地翻译（Translation.framework）
//
//  完全离线：文本交给系统 Translation 框架，在设备上跑神经网络模型，
//  不出网、不经过任何第三方服务。首次使用某种语言时需要系统下载
//  语言包（Apple 的官方弹窗，用户点「下载」后永久可用）。
//
//  TranslationSession 只能在 SwiftUI 的 translationTask 作用域内拿到，
//  所以这里挂了一个 1pt 的隐形宿主视图常驻窗口，任务队列在会话里消费。
// ============================================================
import Cocoa
import SwiftUI
import Translation

// MARK: - 结果与错误
struct TranslationOutcome {
    let text: String
    let sourceLanguage: String
    let targetLanguage: String
}

enum TranslationFailure: Error {
    case unsupportedPair(String, String)
    case notInstalled
    case nothingToTranslate
    case cancelled
    case message(String)

    var code: String {
        switch self {
        case .unsupportedPair: return "unsupported"
        case .notInstalled: return "notInstalled"
        case .nothingToTranslate: return "empty"
        case .cancelled: return "cancelled"
        case .message: return "failed"
        }
    }

    var message: String {
        switch self {
        case .unsupportedPair(let s, let t):
            return "系统不支持从 \(s) 翻译到 \(t)"
        case .notInstalled:
            return "目标语言的语言包尚未下载"
        case .nothingToTranslate:
            return "没有可翻译的内容"
        case .cancelled:
            return "翻译已取消"
        case .message(let m):
            return m
        }
    }
}

// MARK: - 翻译中心
@MainActor
final class TranslationService: ObservableObject {
    static let shared = TranslationService()

    /// 触发 SwiftUI translationTask 的配置；每次有新活就换一份让任务重跑
    @Published var config: TranslationSession.Configuration?

    private final class Job {
        let text: String
        let source: String
        let target: String
        let completion: (Result<TranslationOutcome, TranslationFailure>) -> Void
        init(text: String, source: String, target: String,
             completion: @escaping (Result<TranslationOutcome, TranslationFailure>) -> Void) {
            self.text = text; self.source = source; self.target = target; self.completion = completion
        }
    }

    private var jobs: [Job] = []
    private var host: NSView?
    /// 最近一次会话是否允许主动请求下载语言包
    private(set) var canRequestDownloads = true

    /// 常驻会话当前对应的语言对；相同语言对直接复用，不再重建会话
    /// （每次重建会话都可能让系统重新询问/重新准备语言，这是「每次都要选语言」的根因）
    private var sessionPair: String?
    private var sessionAlive = false
    /// 诊断用：本次进程内实际创建过多少个 translationTask 会话
    private(set) var sessionStarts = 0
    /// 队列空闲这么久之后释放会话（下次翻译再建，省电）
    private let idleLimit: TimeInterval = 120

    // ---------- 宿主视图 ----------
    func attach(to container: NSView) {
        guard host == nil else { return }
        let h = NSHostingView(rootView: TranslationHost(service: self))
        h.frame = NSRect(x: 0, y: 0, width: 2, height: 2)
        container.addSubview(h)
        host = h
    }

    // ---------- 对外接口 ----------
    /// - Parameters:
    ///   - source: 本地判断出的源语言（如 "en"）。传空表示交给系统识别——
    ///     系统识别不出来时会弹「选择语言」询问用户，所以能判断就一定要传。
    func translate(_ text: String, to target: String, source: String = "",
                   completion: @escaping (Result<TranslationOutcome, TranslationFailure>) -> Void) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { completion(.failure(.nothingToTranslate)); return }

        // 原文已经是目标语言：直接返回，不惊动系统（这是中文笔记里最常见的路径）
        if Self.sameLanguage(source, target) {
            completion(.success(TranslationOutcome(text: trimmed, sourceLanguage: source, targetLanguage: target)))
            return
        }

        jobs.append(Job(text: trimmed, source: source, target: target, completion: completion))
        pump()
    }

    /// 提前准备语言包：没有下载过时这里会弹出系统下载确认
    func prepare(_ target: String, source: String = "",
                 completion: @escaping (Result<Void, TranslationFailure>) -> Void) {
        jobs.append(Job(text: "", source: source, target: target, completion: { r in
            switch r {
            case .success: completion(.success(()))
            case .failure(let f): completion(.failure(f))
            }
        }))
        pump()
    }

    // ---------- 调度 ----------
    private func pump() {
        guard !jobs.isEmpty else { return }
        let pair = "\(jobs[0].source)|\(jobs[0].target)"
        // 队列里还有活、且常驻会话就是这个语言对 → 交给它继续消费
        if sessionAlive && sessionPair == pair { return }

        sessionAlive = true
        sessionPair = pair
        sessionStarts += 1
        var c = TranslationSession.Configuration(source: Self.lang(jobs[0].source),
                                                target: Self.lang(jobs[0].target))
        c.invalidate()                       // 版本号变化 → 强制重跑 translationTask
        config = c
    }

    /// 在 translationTask 的会话作用域内消费队列（会话只在闭包内有效）
    /// 会话常驻：队列空了就原地等待，避免每次翻译都重建会话、每次都让系统重新确认语言。
    func runSession(_ session: TranslationSession) async {
        canRequestDownloads = session.canRequestDownloads
        sessionAlive = true
        var idleSince = Date()

        while !Task.isCancelled {
            if jobs.isEmpty {
                if Date().timeIntervalSince(idleSince) > idleLimit { break }
                try? await Task.sleep(nanoseconds: 50_000_000)
                continue
            }
            idleSince = Date()
            let job = jobs.removeFirst()

            // 空文本任务 = 只请求准备语言包
            if job.text.isEmpty {
                if await isInstalled(from: job.source, to: job.target) {
                    job.completion(.success(TranslationOutcome(text: "", sourceLanguage: job.source, targetLanguage: job.target)))
                } else {
                    do {
                        try await session.prepareTranslation()
                        job.completion(.success(TranslationOutcome(text: "", sourceLanguage: job.source, targetLanguage: job.target)))
                    } catch {
                        job.completion(.failure(Self.map(error)))
                    }
                }
                continue
            }

            do {
                let chunks = Self.chunk(job.text)
                let requests = chunks.map { TranslationSession.Request(sourceText: $0) }
                let responses = try await session.translations(from: requests)
                let merged = responses.map { $0.targetText }.joined(separator: "\n")
                let src = responses.first?.sourceLanguage.minimalIdentifier ?? job.source
                let dst = responses.first?.targetLanguage.minimalIdentifier ?? job.target
                job.completion(.success(TranslationOutcome(
                    text: merged, sourceLanguage: src, targetLanguage: dst)))
            } catch {
                job.completion(.failure(Self.map(error)))
            }
        }

        sessionAlive = false
        sessionPair = nil
        // 会话提前结束时还有剩活，重新拉起
        if !jobs.isEmpty { pump() }
    }

    // ---------- 辅助 ----------
    static func lang(_ tag: String) -> Locale.Language? {
        let t = tag.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty || t == "auto" { return nil }
        return Locale.Language(identifier: t)
    }

    /// 是否同一种语言（中文按简繁区分）
    static func sameLanguage(_ a: String, _ b: String) -> Bool {
        guard let la = lang(a), let lb = lang(b),
              let ca = la.languageCode?.identifier,
              let cb = lb.languageCode?.identifier else { return false }
        if ca != cb { return false }
        if ca == "zh" {
            let sa = (la.script?.identifier ?? "Hans") == "Hant" ? "hant" : "hans"
            let sb = (lb.script?.identifier ?? "Hans") == "Hant" ? "hant" : "hans"
            return sa == sb
        }
        return true
    }

    private func isInstalled(from source: String, to target: String) async -> Bool {
        let availability = LanguageAvailability()
        let status = await availability.status(
            from: Self.lang(source) ?? Locale.Language(identifier: "en"),
            to: Self.lang(target))
        return status == .installed
    }

    /// 长文本按段落切块，避免单次请求过大
    static func chunk(_ text: String, limit: Int = 1200) -> [String] {
        if text.count <= limit { return [text] }
        var out: [String] = [], cur = ""
        for line in text.components(separatedBy: "\n") {
            if cur.count + line.count + 1 > limit, !cur.isEmpty {
                out.append(cur)
                cur = line
            } else {
                cur = cur.isEmpty ? line : cur + "\n" + line
            }
        }
        if !cur.isEmpty { out.append(cur) }
        return out
    }

    static func map(_ error: Error) -> TranslationFailure {
        if TranslationError.notInstalled ~= error { return .notInstalled }
        if TranslationError.unsupportedLanguagePairing ~= error { return .unsupportedPair("原文", "目标语言") }
        if TranslationError.unsupportedTargetLanguage ~= error { return .unsupportedPair("原文", "目标语言") }
        if TranslationError.unsupportedSourceLanguage ~= error { return .unsupportedPair("原文", "目标语言") }
        if TranslationError.unableToIdentifyLanguage ~= error { return .message("无法识别源语言") }
        if TranslationError.nothingToTranslate ~= error { return .nothingToTranslate }
        if TranslationError.alreadyCancelled ~= error { return .cancelled }
        let ns = error as NSError
        if ns.domain == NSCocoaErrorDomain && ns.code == NSUserCancelledError { return .cancelled }
        return .message(error.localizedDescription)
    }
}

// MARK: - 隐形宿主视图
private struct TranslationHost: View {
    @ObservedObject var service: TranslationService

    var body: some View {
        Color.clear
            .frame(width: 2, height: 2)
            .translationTask(service.config) { session in
                await service.runSession(session)
            }
    }
}

// MARK: - 桥接（由 main.swift 的 handle 调用）
extension TranslationService {
    /// 返回 true 表示这个方法由本模块接管
    func handle(id: String, method: String, params: [String: Any], controller: AppController) -> Bool {
        switch method {
        case "translate":
            let text = (params["text"] as? String) ?? ""
            let target = normalized((params["target"] as? String) ?? "zh-Hans")
            let source = normalized((params["source"] as? String) ?? "")
            translate(text, to: target, source: source) { result in
                switch result {
                case .success(let o):
                    controller.respond(id, true, [
                        "text": o.text,
                        "sourceLang": o.sourceLanguage,
                        "targetLang": o.targetLanguage,
                        "sameLang": Self.sameLanguage(source, target)
                    ])
                case .failure(let f):
                    controller.respond(id, true, [
                        "error": f.code,
                        "message": f.message,
                        "canDownload": self.canRequestDownloads
                    ])
                }
            }
            return true

        case "prepareTranslation":
            let target = normalized((params["target"] as? String) ?? "zh-Hans")
            let source = normalized((params["source"] as? String) ?? "")
            prepare(target, source: source) { result in
                switch result {
                case .success:
                    controller.respond(id, true, ["ok": true])
                case .failure(let f):
                    controller.respond(id, true, ["error": f.code, "message": f.message])
                }
            }
            return true

        case "translationStatus":
            let target = normalized((params["target"] as? String) ?? "zh-Hans")
            let source = normalized((params["source"] as? String) ?? "")
            Task { @MainActor in
                let availability = LanguageAvailability()
                let langs = await availability.supportedLanguages
                let status = await availability.status(
                    from: Self.lang(source) ?? Locale.Language(identifier: "en"),
                    to: Self.lang(target))
                let name: String
                switch status {
                case .installed: name = "installed"
                case .supported: name = "supported"
                default: name = "unsupported"
                }
                controller.respond(id, true, [
                    "status": name,
                    "target": target,
                    "languages": langs.map { $0.minimalIdentifier },
                    "canDownload": self.canRequestDownloads
                ])
            }
            return true

        case "openTranslationSettings":
            openSettings()
            controller.respond(id, true, NSNull())
            return true

        default:
            return false
        }
    }

    /// 与 JS 侧的语言代码对齐（zh-CN → zh-Hans 之类）
    private func normalized(_ tag: String) -> String {
        switch tag {
        case "zh", "zh-CN", "zh-Hans-CN", "zh_SG": return "zh-Hans"
        case "zh-TW", "zh-HK", "zh-Hant-TW": return "zh-Hant"
        default: return tag
        }
    }

    private func openSettings() {
        let candidates = [
            "x-apple.systempreferences:com.apple.Localization-Settings.extension",
            "x-apple.systempreferences:com.apple.preference.general"
        ]
        for c in candidates {
            if let url = URL(string: c), NSWorkspace.shared.open(url) { return }
        }
    }
}
