import Foundation

/* SpellCheck 的断言程序（由 test/spell.test.js 编译并运行）。
 *
 * 这里跑的是**真词典**，不是桩：NSSpellChecker 就是 App 里给波浪线做判定的
 * 那个实例，命令行进程里同样可用（已实测）。所以这些用例断言的是
 * 「打开 App 之后渲染态会怎么判」。
 *
 * 只断言稳定的词：recieve / occured / seperate 一类明确错拼，receive /
 * because / hello 一类明确正确。不拿 GitHub、JavaScript 这种「靠大小写放过」
 * 的词做断言 —— 那取决于系统词典版本，换台机器就该红。 */

var pass = 0
var fail = 0

func ok(_ name: String, _ cond: Bool, _ extra: String = "") {
    if cond { pass += 1; print("PASS \(name)") }
    else { fail += 1; print("FAIL \(name)\(extra.isEmpty ? "" : " | " + extra)") }
}

/* ---------- 基本判定 ---------- */
let good = SpellCheck.unknowns(["receive", "because", "hello", "document"])
ok("正确词一个都不报", good.isEmpty, "\(good)")

let bad = SpellCheck.unknowns(["recieve", "occured", "seperate"])
ok("错拼词全部上报", bad == [0, 1, 2], "\(bad)")

let mixed = SpellCheck.unknowns(["the", "recieve", "a", "separate"])
ok("混在正确词里的错词只报自己", mixed == [1], "\(mixed)")

let dup = SpellCheck.unknowns(["recieve", "recieve"])
ok("重复的错词两个都报", dup == [0, 1], "\(dup)")

ok("空数组不炸", SpellCheck.unknowns([]).isEmpty)
ok("空串跳过", SpellCheck.unknowns(["", "recieve"]) == [1])

/* ---------- 大小写 ----------
 * 系统词典的两条既定规则（实测，别当 bug 去"修"）：
 *   · 首字母大写的词按专有名词放过一部分，但明确错拼的仍会报（Recieve→报）；
 *   · 全大写的词一律当缩写放过（RECIEVE→不报，API/HTTP/JSON 也不报）。
 * 这两条决定了波浪线的"脾气"：正文里很少全大写，误报主要在首字母大写上，
 * 所以右键菜单必须有「忽略此词」。 */
let lower = SpellCheck.unknowns(["recieve"])
let upperFirst = SpellCheck.unknowns(["Recieve"])
let upperAll = SpellCheck.unknowns(["RECIEVE"])
ok("小写错拼被报", lower == [0], "\(lower)")
ok("首字母大写错拼也被报", upperFirst == [0], "\(upperFirst)")
ok("全大写按缩写放过（系统行为）", upperAll.isEmpty, "\(upperAll)")
ok("常见缩写不报", SpellCheck.unknowns(["API", "URL", "HTTP", "JSON"]).isEmpty)

/* ---------- ignore：用户「加入词典」的词不再报 ---------- */
ok("ignore 生效", SpellCheck.unknowns(["recieve"], ignore: ["recieve"]).isEmpty)
ok("ignore 不区分大小写", SpellCheck.unknowns(["Recieve", "RECIEVE"], ignore: ["recieve"]).isEmpty)
ok("ignore 不影响别的词", SpellCheck.unknowns(["recieve", "occured"], ignore: ["recieve"]) == [1])
ok("ignore 里没有的词照报", SpellCheck.unknowns(["occured"], ignore: ["recieve"]) == [0])

/* ---------- 建议词 ---------- */
let g1 = SpellCheck.guesses(for: "recieve")
ok("recieve 的建议里有 receive", g1.contains("receive"), "\(g1)")
let g2 = SpellCheck.guesses(for: "seperate")
ok("seperate 的建议里有 separate", g2.contains("separate"), "\(g2)")
ok("正确词没有建议", SpellCheck.guesses(for: "receive").isEmpty)
ok("空词没有建议", SpellCheck.guesses(for: "").isEmpty)
ok("建议条数受限", SpellCheck.guesses(for: "coloumn", limit: 1).count <= 1,
   "\(SpellCheck.guesses(for: "coloumn", limit: 1))")
ok("建议里不含原词", !g1.contains("recieve"))

/* ---------- 串行队列：offload 在后台算完再回主线程 ----------
 * 回调走 DispatchQueue.main，纯命令行进程里没有 run loop 就不会被抽干，
 * 所以这里用 RunLoop 转圈等 —— 用信号量会主线程自己等自己，永远等不到。 */
var got: [Int] = []
SpellCheck.offload({ SpellCheck.unknowns(["recieve", "receive"]) }) { r in got = r }
let deadline = Date().addingTimeInterval(10)
while got.isEmpty && Date() < deadline {
    RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
}
ok("offload 算完并回到主线程", got == [0], "\(got)")

print("SUMMARY \(pass) \(fail)")
exit(fail == 0 ? 0 : 1)
