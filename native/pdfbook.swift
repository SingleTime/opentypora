// ============================================================
//  pdfbook.swift — 给导出的 PDF 加书签（outline）
//
//  标题层级由前端解析 Markdown 得到（[{level, text}]），这里在 PDF 里按文字
//  定位页，再用 PDFKit 的 PDFOutline 挂成一棵树。
//
//  两个坑（都是实测出来的，别改回去）：
//  1) PDFKit 不会把 outline 写进「它自己加载的、别家生成的 PDF」——直接
//     doc.outlineRoot = root; doc.write(to:) 返回 true，但文件里没有 /Outlines。
//     可行做法是把页搬进一个新建的 PDFDocument（页内容/文本原样保留），在
//     新文档上挂 outline 再写盘。
//  2) 带 [TOC] 的文档，目录页把所有标题都列了一遍，全文搜会让每个书签都落在
//     目录页 —— 必须「从上一处命中页往后找」；长标题在 PDF 里会折行，还要再比
//     一次「去掉所有空白」的归一形式。
// ============================================================
import Foundation
import PDFKit

enum PDFBookmarks {
    /// 返回实际挂上的书签数；0 = 没挂（没有标题 / PDF 打不开 / 一个都没定位到）
    @discardableResult
    static func attach(to url: URL, headings: [[String: Any]]) -> Int {
        guard !headings.isEmpty,
              let src = PDFDocument(url: url),
              src.pageCount > 0 else { return 0 }

        // 目录页：一页里同时出现三个以上标题，基本就是 [TOC] 生成的目录。
        // 不排掉它，所有书签都会落在这一页（实测见 test/pdfbook/main.swift）。
        let toc = tocPages(doc: src, headings: headings)

        // 先定位：页码基于 src，稍后 1:1 映射到新文档
        var marks: [(level: Int, text: String, page: Int)] = []
        var from = 0
        for h in headings {
            let level = max(1, min(6, (h["level"] as? NSNumber)?.intValue ?? 1))
            let text = ((h["text"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty { continue }
            // 跳目录页后找不到就退回不跳：万一把「两个标题正好同页」误判成目录，
            // 也不能因此丢掉书签
            guard let idx = findPage(doc: src, text: text, from: from, skip: toc)
                    ?? findPage(doc: src, text: text, from: from, skip: []) else { continue }
            from = idx
            marks.append((level, text, idx))
        }
        guard !marks.isEmpty else { return 0 }

        // 搬页：PDFKit 只在「自己造的」文档上写 outline
        let out = PDFDocument()
        for i in 0..<src.pageCount {
            guard let p = src.page(at: i) else { continue }
            out.insert(p, at: i)
        }
        out.documentAttributes = src.documentAttributes

        let root = PDFOutline()
        var stack: [(level: Int, node: PDFOutline)] = []
        for m in marks {
            guard let page = out.page(at: m.page) else { continue }
            let item = PDFOutline()
            item.label = m.text
            let box = page.bounds(for: .mediaBox)
            item.destination = PDFDestination(page: page, at: NSPoint(x: 0, y: box.maxY))

            while let last = stack.last, last.level >= m.level { stack.removeLast() }
            let parent = stack.last?.node ?? root
            parent.insertChild(item, at: parent.numberOfChildren)
            stack.append((m.level, item))
        }
        out.outlineRoot = root

        // 先写临时文件再原子替换，中途失败不会毁掉刚导出的 PDF
        let tmp = url.deletingLastPathComponent()
            .appendingPathComponent(".\(url.lastPathComponent).bm-\(getpid())")
        guard out.write(to: tmp) else { return 0 }
        do {
            _ = try FileManager.default.replaceItemAt(url, withItemAt: tmp)
        } catch {
            try? FileManager.default.removeItem(at: tmp)
            return 0
        }
        return marks.count
    }

    private static func tocPages(doc: PDFDocument, headings: [[String: Any]]) -> Set<Int> {
        var out = Set<Int>()
        let texts = headings.compactMap { h -> String? in
            let t = ((h["text"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? nil : squeeze(t)
        }
        guard texts.count >= 2 else { return out }
        for i in 0..<doc.pageCount {
            let s = squeeze(doc.page(at: i)?.string ?? "")
            var hits = 0
            for t in texts where s.contains(t) {
                hits += 1
                // 一页里三个以上标题肯定是目录；只有两个时，要求它就是全部标题
                // （短文档的目录页只列了两条），否则「H1+H2 同页」的正常正文会被误杀
                if hits >= 3 || (hits >= 2 && hits == texts.count) { out.insert(i); break }
            }
        }
        return out
    }

    private static func findPage(doc: PDFDocument, text: String, from: Int, skip: Set<Int>) -> Int? {
        let n = doc.pageCount
        if from < n {
            for p in from..<n where !skip.contains(p) && pageContains(doc, p, text) { return p }
        }
        // 顺序错乱时回退到前面再找一遍（不越过上一次命中，避免书签倒退）
        for p in 0..<min(from, n) where !skip.contains(p) && pageContains(doc, p, text) { return p }
        return nil
    }

    private static func pageContains(_ doc: PDFDocument, _ i: Int, _ text: String) -> Bool {
        guard let s = doc.page(at: i)?.string else { return false }
        if s.range(of: text, options: [.caseInsensitive, .diacriticInsensitive]) != nil { return true }
        return squeeze(s).contains(squeeze(text))
    }

    /// 去掉所有空白并小写：折行与两端对齐插的空格都不再影响比对
    private static func squeeze(_ s: String) -> String {
        return s.components(separatedBy: .whitespacesAndNewlines).joined().lowercased()
    }
}
