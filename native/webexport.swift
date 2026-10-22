import Foundation

/* 单页 HTML 导出的样式内联。
 *
 * 顺序是硬要求：app.css 里放的是六套内置主题的变量块（html[data-theme="…"]），
 * 自定义主题要靠「后出现」压过它，所以必须排在 app.css 之后。
 * 这里只做字符串拼接，不碰文件系统，方便单测。
 */
enum WebExport {
    /// 把 CSS 塞进 `</head>` 之前。css 为 nil/空、themeCss 为 nil/空白时原样返回。
    static func inject(into html: String, css: String?, themeCss: String?) -> String {
        var style = ""
        if let base = css, !base.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            style += "<style>\n\(base)\n</style>\n"
        }
        if let theme = themeCss, !theme.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            style += "<style id=\"opentypora-theme\">\n\(closingTagSafe(theme))\n</style>\n"
        }
        guard !style.isEmpty else { return html }
        return insertBeforeHeadEnd(html, style)
    }

    /// 自定义主题里若出现 `</style`，浏览器会当场闭合样式块，后面的 CSS 变成正文。
    /// CSS 里这个序列只可能出现在字符串/注释里，转义成 `<\/style` 不影响解析。
    static func closingTagSafe(_ css: String) -> String {
        css.replacingOccurrences(of: "</style", with: "<\\/style", options: .caseInsensitive)
    }

    private static func insertBeforeHeadEnd(_ html: String, _ style: String) -> String {
        if let r = html.range(of: "</head>", options: .backwards) {
            var out = html
            out.replaceSubrange(r, with: style + "</head>")
            return out
        }
        // 没有 </head>（不该发生，但别把样式丢掉）
        if let r = html.range(of: "<body", options: .backwards) {
            var out = html
            out.insert(contentsOf: style, at: r.lowerBound)
            return out
        }
        return html + "\n" + style
    }
}
