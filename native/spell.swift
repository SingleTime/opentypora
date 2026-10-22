/* spell.swift —— 系统词典桥
 *
 * 渲染态的块是 <div>，不是可编辑控件；WebKit 的原生拼写检查（红波浪线）
 * 只对 textarea 生效。要让渲染态也有波浪线，得自己去问词典：
 * NSSpellChecker 就是 textarea 背后用的那个检查器，所以两边判定一致 ——
 * 包括「用户以前学过的词」也一致，不会出现「编辑态不报、渲染态乱报」。
 *
 * 两个入口：
 *   unknowns(_:ignore:)  批量判定，返回拼错词的下标
 *   guesses(for:limit:)  取建议词，右键菜单用
 *
 * 不依赖 main.swift，可以和 test/spell/main.swift 单独编译成命令行程序。
 */
import AppKit

enum SpellCheck {
    /// 单次请求的词数上限：再大就把 WKWebView 的消息体撑肥了，前端会分片
    static let maxWords = 20000
    static let maxGuesses = 8

    /* NSSpellChecker 没有被文档保证线程安全，但它在主线程上逐词跑 0.67ms/词，
     * 一千词就是 700ms —— 卡界面不能接受。实测同一实例被多线程并发调用
     * 结果稳定（4 线程 × 160 次无错判）；这里仍然用**单条串行队列**，
     * 既离开主线程，又不会并发碰同一个实例。 */
    private static let queue = DispatchQueue(label: "opentypora.spell", qos: .userInitiated)

    static func offload<T>(_ work: @escaping () -> T, done: @escaping (T) -> Void) {
        queue.async {
            let v = work()
            DispatchQueue.main.async { done(v) }
        }
    }

    /// 返回 words 里拼错的下标（升序）。
    /// ignore 是用户「加入词典」的词，统一按小写比对 —— 词表里存的是什么大小写都能忽略。
    static func unknowns(_ words: [String], ignore: Set<String> = []) -> [Int] {
        let list = words.count > maxWords ? Array(words.prefix(maxWords)) : words
        let checker = NSSpellChecker.shared
        var out: [Int] = []
        out.reserveCapacity(list.count / 6)
        for (i, w) in list.enumerated() {
            if w.isEmpty { continue }
            if ignore.contains(w.lowercased()) { continue }
            // 原样传、不 lowercased()：checkSpelling 对「句首大写」按专有名词放过，
            // 这正好合我们的需要（Typora / GitHub / JavaScript 这些不该标红）。
            // 单行内出现换行会让 ranges 变形，这里挡一道。
            if w.contains("\n") || w.contains("\r") { continue }
            if checker.checkSpelling(of: w, startingAt: 0).location != NSNotFound {
                out.append(i)
            }
        }
        return out
    }

    /// 建议词。拼写正确（或查不到）时返回空数组。
    static func guesses(for word: String, limit: Int = 6) -> [String] {
        let w = word.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !w.isEmpty else { return [] }
        let checker = NSSpellChecker.shared
        let r = checker.checkSpelling(of: w, startingAt: 0)
        guard r.location != NSNotFound else { return [] }
        let all = checker.guesses(forWordRange: r, in: w, language: nil, inSpellDocumentWithTag: 0) ?? []
        let n = max(1, min(limit, maxGuesses))
        return Array(all.prefix(n))
    }
}
