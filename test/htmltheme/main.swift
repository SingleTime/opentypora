import Foundation

/* WebExport.inject 的断言程序（由 test/htmltheme.test.js 编译并运行）。
 * 只测纯字符串拼接：顺序、位置、转义、缺 </head> 的兜底。 */

var pass = 0
var fail = 0

func ok(_ name: String, _ cond: Bool, _ extra: String = "") {
    if cond { pass += 1; print("PASS \(name)") }
    else { fail += 1; print("FAIL \(name)\(extra.isEmpty ? "" : " | " + extra)") }
}

func count(_ hay: String, _ needle: String) -> Int {
    return hay.components(separatedBy: needle).count - 1
}

let HTML = "<!DOCTYPE html>\n<html data-theme=\"night\" class=\"opentypora-export\">\n<head>\n" +
           "<meta charset=\"utf-8\">\n<title>T</title>\n</head>\n<body class=\"opentypora-export\">\n" +
           "<div class=\"editor\">x</div>\n</body>\n</html>\n"

/* ---------- 基本注入 ---------- */
let a = WebExport.inject(into: HTML, css: "body{color:red}", themeCss: nil)
ok("css 注入到 head 里", a.contains("<style>\nbody{color:red}\n</style>"))
ok("样式在 </head> 之前", a.range(of: "<style>")!.lowerBound < a.range(of: "</head>")!.lowerBound)
ok("只有一个 </head>", count(a, "</head>") == 1)
ok("正文内容没被动", a.contains("<div class=\"editor\">x</div>"))
ok("原文档头尾保留", a.hasPrefix("<!DOCTYPE html>\n<html data-theme=\"night\""))
ok("只加了一个 style", count(a, "<style") == 1)

/* ---------- 自定义主题排在后面（顺序决定谁压住谁） ---------- */
let b = WebExport.inject(into: HTML, css: "html[data-theme]{--bg:#fff}", themeCss: ":root{--bg:#000}")
ok("自定义主题也注入了", b.contains("<style id=\"opentypora-theme\">"))
ok("自定义主题在 app.css 之后", b.range(of: "id=\"opentypora-theme\"")!.lowerBound >
    b.range(of: "--bg:#fff")!.lowerBound)
ok("两个 style 块", count(b, "<style") == 2)

/* ---------- 只有自定义主题 ---------- */
let c = WebExport.inject(into: HTML, css: nil, themeCss: ".x{color:blue}")
ok("没有 app.css 也照注入", c.contains(".x{color:blue}"))
ok("没有多余的空 app.css 块", count(c, "<style") == 1)

/* ---------- 空值不动原文 ---------- */
ok("两者都 nil → 原样返回", WebExport.inject(into: HTML, css: nil, themeCss: nil) == HTML)
ok("空串 → 原样返回", WebExport.inject(into: HTML, css: "", themeCss: "") == HTML)
ok("只有空白 → 原样返回", WebExport.inject(into: HTML, css: " \n\t ", themeCss: "\n\n") == HTML)

/* ---------- 转义 ---------- */
let d = WebExport.inject(into: HTML, css: nil, themeCss: "a{content:'</style><script>x</script>'}")
ok("主题里的 </style> 被转义", !d.contains("</style><script>"))
ok("转义后仍是合法 style 块", count(d, "</style>") == 1)
ok("其余 CSS 内容保留", d.contains("a{content:'"))

/* ---------- 缺 </head> 的兜底 ---------- */
let noHead = "<html><body><p>x</p></body></html>"
let e = WebExport.inject(into: noHead, css: "p{color:red}", themeCss: nil)
ok("没有 </head> 时插在 <body> 之前", e.range(of: "<style>")!.lowerBound < e.range(of: "<body")!.lowerBound)
ok("兜底也不丢正文", e.contains("<p>x</p>"))

let bare = "just text"
ok("连 body 都没有时追加到末尾", WebExport.inject(into: bare, css: "p{}", themeCss: nil)
    .hasPrefix("just text"))

/* ---------- 多个 </head>（正文里被转义过的不算，真出现时取最后一个） ---------- */
let tricky = "<html><head><title>a</title></head><body><pre>&lt;/head&gt;</pre></body></html>"
let f = WebExport.inject(into: tricky, css: "X{}", themeCss: nil)
ok("取真正的 </head>（最后一个）", f.contains("<style>\nX{}\n</style>\n</head>"))
ok("转义实体没被误伤", f.contains("&lt;/head&gt;"))

print("SUMMARY \(pass) \(fail)")
exit(fail == 0 ? 0 : 1)
