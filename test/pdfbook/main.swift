// ============================================================
//  pdfbook.swift 的单元测试（配合 native/pdfbook.swift 一起编译）
//
//  自己造 PDF（CoreGraphics + NSAttributedString），挂书签，再用 PDFDocument
//  读回来验层级 / 落页 / 目录页不被误命中 / 折行标题。
//  由 test/pdfbook.test.js 调起，输出 PASS/FAIL 行给它统计。
// ============================================================
import Foundation
import AppKit
import PDFKit

var passed = 0, failed = 0
func ok(_ name: String, _ cond: Bool, _ extra: String = "") {
    if cond { passed += 1; print("PASS " + name) }
    else { failed += 1; print("FAIL " + name + (extra.isEmpty ? "" : " | " + extra)) }
}

let tmp = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("pdfbook-test-\(getpid())")
try? FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)

/// 造一个 PDF：pages[i] 是第 i 页上的几行文字（从页面顶部往下排）
func makePDF(_ pages: [[String]], name: String) -> URL {
    let url = tmp.appendingPathComponent(name)
    var box = CGRect(x: 0, y: 0, width: 595, height: 842)
    guard let ctx = CGContext(url as CFURL, mediaBox: &box, nil) else { return url }
    let font = NSFont.systemFont(ofSize: 18)
    for lines in pages {
        ctx.beginPDFPage(nil)
        ctx.saveGState()
        // PDF 坐标系原点在左下，从顶部往下排就自己算 y
        var y = box.height - 80
        for t in lines {
            let s = NSAttributedString(string: t, attributes: [.font: font])
            let line = CTLineCreateWithAttributedString(s)
            ctx.textPosition = CGPoint(x: 60, y: y)
            CTLineDraw(line, ctx)
            y -= 32
        }
        ctx.restoreGState()
        ctx.endPDFPage()
    }
    ctx.closePDF()
    return url
}

func childLabels(_ node: PDFOutline?) -> [String] {
    guard let n = node else { return [] }
    return (0..<n.numberOfChildren).compactMap { n.child(at: $0)?.label }
}

func pageIndex(_ doc: PDFDocument, _ item: PDFOutline) -> Int? {
    guard let p = item.destination?.page else { return nil }
    return doc.index(for: p)
}

// ---------------------------------------------------------------- 用例 1：层级
print("== 基本层级 ==")
let doc1 = makePDF([
    ["封面标题"],
    ["第一章 网关限流改造", "1.1 令牌桶", "正文正文正文"],
    ["第二章 上线检查", "正文正文"]
], name: "basic.pdf")

let heads1: [[String: Any]] = [
    ["level": 1, "text": "封面标题"],
    ["level": 1, "text": "第一章 网关限流改造"],
    ["level": 2, "text": "1.1 令牌桶"],
    ["level": 1, "text": "第二章 上线检查"]
]
let n1 = PDFBookmarks.attach(to: doc1, headings: heads1)
ok("四个标题都挂上", n1 == 4, "实际 \(n1)")

if let d = PDFDocument(url: doc1) {
    let root = d.outlineRoot
    ok("有 outlineRoot", root != nil)
    ok("顶层三项", childLabels(root) == ["封面标题", "第一章 网关限流改造", "第二章 上线检查"],
       childLabels(root).joined(separator: "/"))
    let h1 = root?.child(at: 1)
    ok("H2 挂在第一章下面", childLabels(h1) == ["1.1 令牌桶"], childLabels(h1).joined(separator: "/"))
    ok("第一章落到第 2 页", pageIndex(d, h1!) == 1, String(describing: pageIndex(d, h1!)))
    ok("第二章落到第 3 页", pageIndex(d, root!.child(at: 2)!) == 2,
       String(describing: pageIndex(d, root!.child(at: 2)!)))

    // 书签必须真的能跳：destination 的页与目标页一致
    let dest = h1?.child(at: 0)?.destination
    ok("H2 有自己的 destination", dest != nil)
    ok("destination 在页内顶部", (dest?.point.y ?? 0) > 700, String(describing: dest?.point))
} else {
    ok("PDF 能重新打开", false)
}

// ---------------------------------------------------------------- 用例 2：目录页
print("== 目录页不抢书签 ==")
let doc2 = makePDF([
    ["目录", "第一章 网关限流改造", "第二章 上线检查"],   // 目录页把标题都列了一遍
    ["第一章 网关限流改造", "正文"],
    ["第二章 上线检查", "正文"]
], name: "toc.pdf")
let heads2: [[String: Any]] = [
    ["level": 1, "text": "第一章 网关限流改造"],
    ["level": 1, "text": "第二章 上线检查"]
]
let n2 = PDFBookmarks.attach(to: doc2, headings: heads2)
ok("两个标题都挂上", n2 == 2, "实际 \(n2)")
if let d = PDFDocument(url: doc2), let root = d.outlineRoot {
    ok("第一章不落在目录页", pageIndex(d, root.child(at: 0)!) == 1,
       String(describing: pageIndex(d, root.child(at: 0)!)))
    ok("第二章不落在目录页", pageIndex(d, root.child(at: 1)!) == 2,
       String(describing: pageIndex(d, root.child(at: 1)!)))
} else { ok("目录页 PDF 能打开", false) }

// ---------------------------------------------------------------- 用例 3：折行标题
print("== 折行标题 ==")
let doc3 = makePDF([
    ["第一章 网关", "限流改造", "正文"]   // 标题被拆成两行
], name: "wrap.pdf")
let n3 = PDFBookmarks.attach(to: doc3, headings: [["level": 1, "text": "第一章 网关限流改造"]])
ok("折行标题仍能定位", n3 == 1, "实际 \(n3)")

// ---------------------------------------------------------------- 用例 4：边角
print("== 边角 ==")
let doc4 = makePDF([["正文"]], name: "none.pdf")
ok("找得到的没有就不写 outline",
   PDFBookmarks.attach(to: doc4, headings: [["level": 1, "text": "不存在的标题"]]) == 0)
ok("空列表直接返回 0", PDFBookmarks.attach(to: doc4, headings: []) == 0)
ok("空标题被跳过",
   PDFBookmarks.attach(to: doc4, headings: [["level": 1, "text": "   "]]) == 0)
if let d = PDFDocument(url: doc4) {
    ok("没挂书签时不留空 outline", d.outlineRoot == nil)
}

// H4 以下压到第 3 级，不应出现第 4 层
let doc5 = makePDF([["H1", "H2", "H3", "H4"]], name: "deep.pdf")
let n5 = PDFBookmarks.attach(to: doc5, headings: [
    ["level": 1, "text": "H1"], ["level": 2, "text": "H2"],
    ["level": 3, "text": "H3"], ["level": 4, "text": "H4"]
])
ok("四级标题都挂上", n5 == 4, "实际 \(n5)")
if let d = PDFDocument(url: doc5), let root = d.outlineRoot {
    let h3 = root.child(at: 0)?.child(at: 0)?.child(at: 0)
    ok("H4 挂在 H3 下面", childLabels(h3) == ["H4"], childLabels(h3).joined(separator: "/"))
}

// ---------------------------------------------------------------- 用例 5：幂等
print("== 重复挂不叠层 ==")
let doc6 = makePDF([["章节 A"], ["章节 B"]], name: "idem.pdf")
_ = PDFBookmarks.attach(to: doc6, headings: [["level": 1, "text": "章节 A"], ["level": 1, "text": "章节 B"]])
_ = PDFBookmarks.attach(to: doc6, headings: [["level": 1, "text": "章节 A"], ["level": 1, "text": "章节 B"]])
if let d = PDFDocument(url: doc6) {
    ok("再来一次还是两项", childLabels(d.outlineRoot) == ["章节 A", "章节 B"],
       childLabels(d.outlineRoot).joined(separator: "/"))
}

try? FileManager.default.removeItem(at: tmp)
print("SUMMARY \(passed) \(failed)")
exit(failed == 0 ? 0 : 1)
