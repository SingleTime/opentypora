# OpenTypora × Typora V1 功能对齐核对

> 应用原名「Typora（自研克隆版）」，2026-10-22 为避开与商业软件重名改成 **OpenTypora**
> （本文件里不带引号的 Typora 一律指被对齐的那个商业软件）。
> 核对时间：2026-10-22（第十九轮：粘贴 / 拖入图片跟随 `typora-copy-images-to`）
> 核对基准：Typora 1.14（macOS）官方支持文档 <https://support.typora.io/> 的功能页
> 核对对象：本仓库（`opentypora/`）
> 回归基线：`node test/runall.js` → **3318/3318 全绿**（57 个套件）

## 结论

**基本全对齐。** 第一轮核对后按 P0–P3 补做，语法扩展、编辑手感、文件与搜索、
导出选项四大块落地；第三轮补完**图片管理**（插入对话框 / 重命名 / 移动 / root-url /
删除 / 居中）与**大纲筛选折叠**；第四轮补完 ODT/RTF/RST/MediaWiki/OPML 导出与
ODT/RST 导入；第五轮补完 **Textile / RevealJS 导出**、**ePub / LaTeX 导入**与
**下载远程图片**；第六轮补完 **Emoji 补全下拉**、**Text Snippet**、**严格模式（渲染侧）**、
**表格行列拖动排序**与 **HTML 导出选项**；第七轮补完 **严格模式解析侧**与
**flowchart.js**；第八轮补完 **文件操作撤销**、**YAML front matter 覆盖导出设置**与
**自定义 pandoc 导出命令**；第九轮补完 **代码块 Code Tools**（右键八项 / `⌘/`
行注释 / `⌥↑↓` 移行 / 块内 Tab 缩进 / 自动缩进整理）、**最近文件固定**、
**拖文件插入链接** 与 **HTML 导出的自定义 head/body 片段**；第十轮把
**语法高亮从 11 种语言扩到 32 套词法**；第十一轮补完 **源码模式的行号与高亮**
（双层渲染：textarea 只留光标，`<pre>` 画颜色与行号）与 **PDF 书签**（标题生成
outline，自动跳过目录页）；第十二轮补完 **HTML 导出的「导出主题」选择器**
（`<html data-theme>` + 样式内联，内置六套与自定义主题都能选，顺手修掉导出单页
继承外壳 `overflow: hidden` 导致长文档滚不动的问题）；第十四轮补完 **渲染态拼写波浪线**
（切词 → 批量问 `NSSpellChecker` → 包 `.spell-bad` 画波浪线，右键给建议词与「忽略此词」，
判过的词进缓存并落 localStorage）；第十五轮补完 **字体 / 行距 / 背景的可视化设置**
（`typography.js` 纯函数层翻译偏好 → `--font-body` / `--leading` / `--lh-scale` / `--bg`，
偏好面板三个控件实时生效，导出的单页 HTML 带同一组变量）；第十六轮补完 **多标签页**
（`tabs.js` 纯函数状态机 + `Editor.snapshotDoc/restoreDoc` 存现场：正文、撤销栈、
滚动位置、光标所在块都跟着标签走；`⌘T` / `⌘W` / `⌃⇥` / `⌘⇧[ ]`，标签栏在两个以上时出现）；
第十七轮补完 **标签页持久化**（`typora.session` 只记绝对路径，重启后整排标签与前台页
一起回来，正文按磁盘重读、打不开的跳过、命令行打开某篇时不恢复会话）；
第十八轮补完 **行内实时预览**（块编辑面从纯 textarea 换成「能藏标记的渲染态」：
`live.js` 算「哪几段标记该露」与「DOM 里改的一笔落在原文哪儿」，`editor.js` 给 live 元素
装一套与 textarea 同名的 `.value` / `.selectionStart` 接口，按键、自动配对、撤销、
表情补全全部沿用同一份代码；标题的 `## ` 也藏，光标到行首才现形）；
第十九轮把 **粘贴 / 拖入的图片** 接到同一套路径解析上（此前只有 `⌘⌃I` 跟随
`typora-copy-images-to`，拖进来、贴进来的图一律进 `assets/`；现在三种入口共用
`Imgman.context` + `hrefOf`，落盘目录与正文引用都按 front matter 算，顺带修掉
同一秒里连贴几张互相覆盖、以及图被丢到渲染块上时静默丢失两个缺陷）。
至此 120 个可核对点里只剩 **Windows / Linux 版**一项未做。

按 120 个可核对功能点计（另有 1 项「上传图床」明确不做，未计入）：

| 状态 | 数量 | 占比 |
| --- | --- | --- |
| ✅ 完整实现 | 119 | 99% |
| ◐ 部分实现 | 0 | 0% |
| ✗ 未实现 | 1 | 1% |

对比第一轮（49 / 12 / 59）、第二轮（86 / 14 / 20）、第三轮（93 / 15 / 12）、
第四轮（94 / 17 / 9）、第五轮（97 / 14 / 9）、第六轮（100 / 13 / 7）、
第八轮（105 / 11 / 4）、第十三轮（115 / 4 / 1）、第十四轮（116 / 3 / 1）、
第十五轮（117 / 2 / 1）、第十六轮（118 / 1 / 1）、第十八轮（119 / 0 / 1）：
**完整项 49 → 119**，部分实现 12 → 0，未实现 59 → 1（仅剩 Windows / Linux 版）。

分领域：

| 领域 | 完整 / 总数 | 判断 |
| --- | --- | --- |
| Markdown 语法 | 41 / 41 | flowchart.js、严格模式解析侧、代码高亮语言覆盖都已补齐 |
| 编辑体验 | 26 / 26 | 行内实时预览补上后，26 项全齐 |
| 文件与侧边栏 | 18 / 18 | 文件操作撤销、移动到…、最近文件固定、拖文件插入链接齐 |
| 图片 | 9 / 9（另 1 项不做） | 插入/重命名/移动/删除/root-url/居中/下载远程图齐 |
| 导出 / 导入 | 15 / 15 | 十种内置格式 + pandoc 自定义命令 + YAML 覆盖 + 四种导入 + PDF 书签 + HTML 导出主题 |
| 外观 | 6 / 6 | 六套主题、跟随系统、字体 / 行距 / 背景都可视化调 |
| 系统集成 | 4 / 5 | CLI 与原生打印补齐；仅 macOS |

---

## A. Markdown 语法（41 / 41）

| # | 功能 | 状态 | 证据 / 说明 |
| --- | --- | --- | --- |
| 1 | 段落、空行分段 | ✅ | `md.js` `parseBlocks` |
| 2 | 硬换行（`Shift+Enter`、行尾两空格） | ✅ | `editor.js` `onKeyDown`；`md.js` 行尾空格转 `<br>` |
| 3 | ATX 标题 | ✅ | 单测 `parser.test.js` |
| 4 | Setext 标题 | ✅ | 单测「setext 标题」 |
| 5 | 引用（可嵌套） | ✅ | `md.js` `case 'quote'` 递归 |
| 6 | 无序列表（`* + -`、嵌套） | ✅ | 单测 |
| 7 | 有序列表（`1.` / `1)`） | ✅ | `RE_LIST` 支持两种标记 |
| 8 | 任务列表（点击勾选） | ✅ | `editor.js` `toggleTask` |
| 9 | 围栏代码块 + 语法高亮 | ✅ | 行号、33 个语言下拉项、复制按钮；高亮覆盖全部 32 套词法（`md.js` `LANG` 方言表：注释/字符串/数字/关键字/类型/属性/注解/预处理/diff 增删），`highlight.test.js` 135 项（含「去标签还原原文」往返不变量） |
| 10 | 表格（对齐、`\|` 转义、东亚宽度对齐） | ✅ | `md.js` + `table.js`，46 项测试 |
| 11 | 表格单元格原位编辑 | ✅ | `table.js` `editCell`：单元格内 `<input>`，Enter 下一行 / Tab 下一列 / Esc 取消 |
| 12 | 数学块 `$$…$$` | ✅ | 内置 KaTeX 0.19，21 项测试 |
| 13 | 行内数学 `$…$` | ✅ | 同上 |
| 14 | 脚注定义 + 按引用顺序编号 | ✅ | `doc.js`，46 项测试 |
| 15 | 脚注悬停预览 | ✅ | `fnpop.js`，41 项测试 |
| 16 | 水平线 | ✅ | `RE_HR` |
| 17 | YAML front matter | ✅ | `case 'frontmatter'` |
| 18 | `[TOC]` | ✅ | `doc.js` 按标题树填充 |
| 19 | 标题锚点 + 文内跳转 | ✅ | GitHub slug 规则，同名去重 |
| 20 | 行内链接（含 title） | ✅ | `md.js` `readLink` |
| 21 | 引用式链接 `[a][id]` / `[a][]` / `[a]` | ✅ | `scanLinkDefs` + 每块挂 `defs`；定义行为隐藏块，序列化无损 |
| 22 | 自动链接 `<https://…>` / `<mailto:…>` | ✅ | 实测输出 `<a>` |
| 23 | 裸 URL / `www.` 自动识别 | ✅ | `readBareUrl`：尾部标点剔除、不吞 CJK/全角标点 |
| 24 | 图片（相对路径、title、尖括号路径） | ✅ | `readImage` |
| 25 | 图片尺寸 `=WxH` / `=W` / `=xH` | ✅ | 编辑器/docx/ePub/LaTeX 四处同一套换算 |
| 26 | 粗体 / 斜体 | ✅ | `inline.js` + `md.js` |
| 27 | 行内代码 | ✅ | 同上 |
| 28 | 删除线 `~~x~~` | ✅ | 同上 |
| 29 | 高亮 `==x==` | ✅ | 同上 |
| 30 | 上标 `X^2^` | ✅ | `<sup>`；docx `vertAlign=superscript`、LaTeX `\textsuperscript` |
| 31 | 下标 `H~2~O` | ✅ | `<sub>`；docx/LaTeX 同步 |
| 32 | 下划线 `<u>x</u>` | ✅ | 转真 `<u>`；docx `<w:u>`、LaTeX `\underline` |
| 33 | 行内 HTML / `<span style>` | ✅ | `INLINE_TAGS` + `sanitizeAttrs`（剥 `on*`/`javascript:`）；`<kbd>`、`<sup>`、`<br>` 均生效 |
| 34 | HTML 块（`div`/`table`/`details`/`svg`/`style`） | ✅ | 判块 + 消毒 + 配平，43 项测试 |
| 35 | 反斜杠转义 | ✅ | 实测 `\*` → `*` |
| 36 | Emoji shortcode `:smile:` | ✅ | 约 190 条映射可渲染；输入 `:名字` 弹补全下拉（↑↓/Enter/Tab 选，插入字形） |
| 37 | Callouts / GitHub Alerts（`> [!NOTE]`） | ✅ | 五种配色 + 标题行，docx/ePub/LaTeX 导出保留标题 |
| 38 | Mermaid 图 | ✅ | `diagram.js`，27 项测试 |
| 39 | flowchart.js / sequence 图 | ✅ | `flow.js`：节点 `id=>type: label`、边 `a->b` / `a(x)->b` / `a->\|x\|->b`、链式；回边 DFS 剔除后 DAG 分层，正交走线（横向只走层间间隙、纵向走画布外通道）；ePub/RevealJS 导出可内嵌 SVG。sequence 图仍只支持 mermaid |
| 40 | 引用式图片 `![a][id]` | ✅ | 与 21 同一套定义表 |
| 41 | 严格模式（`#` 后必须有空格、列表缩进严格） | ✅ | 渲染侧 + **解析侧**双档：严格档 `###Header` 不算标题、列表续行与子列表必须缩进对齐到内容列（`indent + marker 宽 + 1`）；宽松档按 Typora 默认行为容错。切档走 `Editor.reparse()` 重建块模型，两档都保持序列化无损 |

> 说明：Typora 自己**不支持**缩进式代码块（只认 GFM 围栏），本项目同样不支持，未计入差异。

---

## B. 编辑体验（26 / 26）

| # | 功能 | 状态 | 证据 / 说明 |
| --- | --- | --- | --- |
| 1 | 块级所见即所得 | ✅ | `blocks[{raw}] + gaps[]` 模型，无损序列化 |
| 2 | 行内标记即时隐藏（Typora 的 live preview） | ✅ | `live.js`（纯逻辑）+ `editor.js` 的 live 表面：进块编辑时能藏的块直接是**渲染态**（`**` 不在 DOM 里），光标进到某一段强调里才把那对标记作为 `.live-mk` 插回去；标题的 `## ` 也藏，光标到行首现形、退格一次去掉整个前缀。原文仍是唯一真源：DOM 改动按「文本前后最小差异」翻回 `raw` 再重画（`serialize(parse(src)) === src` 不变）；live 元素装了一套与 textarea 同名的 `.value` / `.selectionStart` / `setSelectionRange`，按键、自动配对、撤销、表情补全、`⌘B` 全部沿用原代码。代码/链接/公式/行内 HTML/表格/任务框/多行段落退回源码态。`live` 87 项（纯 Node）+ `livedom` 76 项（真 WKWebView） |
| 3 | 源码模式（`⌘/`） | ✅ | `srcmode.js` 双层：textarea 文字透明只留光标，下面 `<pre>` 逐行画行号与 token（围栏内按围栏语言上色）；行号 `sticky` 跟随横滚，`rAF` 合帧重画；进模式重置光标到开头 |
| 4 | 分栏模式（`⌘⇧L`） | ✅ | V1 没有此功能，属超出项 |
| 5 | 专注模式 | ✅ | 三级衰减：光标块 1.0 / 前后各一块 0.62 / 其余 0.3（标题另有 0.45 / 0.72 档），近邻由 `Caret.nearOf` 算并打 `.near`；编辑块里再给光标行垫一条淡强调色底（`.caret-line`），按压键 / 点击 / 选区变化刷新 |
| 6 | 打字机模式 | ✅ | 按「光标行」而不是整块居中：`Caret.measure` 用同字体同宽的镜像 div 量出折行后的真实行位置（文首放零宽基准抵掉 leading），`Caret.center` 把该行中线对到视口中线；`input` / `keyup` / `click` 都会重新居中，滚动时临时压掉 `scroll-behavior: smooth` 以免滞后 |
| 7 | 自动配对括号 / 引号 / Markdown 符号 | ✅ | `tryPair`：选区包裹、重复符号跳过、词边界限制；偏好项可关 |
| 8 | 智能标点（弯引号、`--`/`---`、`...`） | ✅ | `trySmart`：`--`→`–`、`---`→`—`、`...`→`…`、直角引号成对 |
| 9 | 撤销 / 重做（跨块、300 步） | ✅ | 快照栈 + 800ms 合并 |
| 10 | 查找（区分大小写、正则） | ✅ | 33 项测试 |
| 11 | 全词匹配 | ✅ | 查找栏 `⌷` 开关；`makeRe` 加 `\b` 与 CJK 邻接判断 |
| 12 | 替换当前 / 全部替换 | ✅ | 同一套快照栈 |
| 13 | 拼写检查 | ✅ | 两条腿：块内 textarea 走 WebKit 原生检查（偏好项开关）；渲染态由 `spell.js` 切词 → `Bridge.spellCheck` → 原生 `NSSpellChecker` 批量判定（与 textarea 同一个检查器，判定一致），命中词包 `.spell-bad` 用 `text-decoration: underline wavy` 画线（不占布局、不打架 `.caret-line`）；右键出建议词（`spellGuesses`）与「忽略此词」，忽略表落进偏好；判过的词进缓存并落 `localStorage`，重画不再问原生。代码（`pre`/`code`/`.katex`/`.mermaid`/`.raw-html`）与纯中文一律跳过。语言选择仍跟随系统（不做 per-doc 语言切换） |
| 14 | 字数统计 | ✅ | 状态栏可点开面板：字/字符/行/段落/阅读时间(300 字/分)/选区 |
| 15 | 视图缩放（`⌘+` / `⌘-` / `⌘0`） | ✅ | 只缩放正文区；偏好项滑块同步 |
| 16 | 表格结构编辑 | ✅ | 增删行列、对齐、插入表对话框、单元格原位编辑、列宽拖拽、**行列拖动排序**（按住手柄拖到目标行/列，上半插前/下半插后）齐 |
| 17 | 表格 `Tab` / `⌘Enter` 加行 | ✅ | 单元格内 Tab 走到行末自动补一行 |
| 18 | 代码块行号 | ✅ | `.code-gutter` 与 `pre` 并排，偏好项开关 |
| 19 | 代码块语言选择器 | ✅ | 右上角下拉，33 种语言，只改首行围栏 |
| 20 | 代码块「复制代码」 | ✅ | 右上角复制按钮；右键 Code Tools 八项：复制代码 / 复制为 HTML / 复制为 Markdown / 自动缩进整理 / 切换行注释 / 上移行 / 下移行 / 删除块。另有 `⌘/` 切注释、`⌥↑↓` 移行、块内 Tab/Shift+Tab 整段缩进（`code.js`，纯函数 110 项 + harness 47 项） |
| 21 | 复制为 Markdown（`⌘⇧C`） | ✅ | `copyAsMarkdown` |
| 22 | 粘贴为纯文本（`⌘⇧V`） | ✅ | `pastePlainText` |
| 23 | 多窗口 / 标签页 / 重开已关闭文件 | ✅ | 三样齐：`⌘⇧N` 新窗口、`⌘⇧T` 重开已关闭文件（最近 20 个）、**标签页**（`⌘T` 新建 / `⌘W` 关闭 / `⌃⇥`·`⌘⇧[ ]` 切换 / 中键关闭）。切页时正文、撤销栈、滚动位置、光标所在块都跟着标签走；同一个文件不会开出第二个标签；关掉最后一个标签不关窗口，换成一张空白文档；**重启后整排标签还原**（`typora.session` 只记 path，正文以磁盘为准，打不开的跳过，命令行打开某篇时不恢复会话） |
| 24 | 文本片段（Text Snippet） | ✅ | `snippet.js`：`触发词 => 内容`（`\n`/`\t` 转义、`$0` 光标落点），Tab 展开；偏好面板可编辑 |
| 25 | 引用块回车自动续 `>` | ✅ | `onKeyDown`：空引用行退出 |
| 26 | 选择当前行 / 单词（`⌘L` / `⌘D`） | ✅ | `selectLineAtCaret` / `selectWordAtCaret` |

---

## C. 文件与侧边栏（18 / 18）

| # | 功能 | 状态 | 证据 / 说明 |
| --- | --- | --- | --- |
| 1 | 打开文件 / 打开文件夹（`⌘O` / `⌘⌥⇧O`） | ✅ | `doOpenFile` / `doOpenFolder`；CLI 也可按路径开目录 |
| 2 | 文件树 | ✅ | `renderTree`（带 mtime/size，供排序与文章视图用） |
| 3 | 大纲（点击跳转 + 当前高亮） | ✅ | `renderOutline` / `syncOutlineByScroll` |
| 4 | 大纲过滤 / 折叠模式 | ✅ | 大纲面板顶部筛选框（实时过滤）+ 标题前折叠箭头（祖先折叠则子树隐藏） |
| 5 | 文章列表视图（Articles） | ✅ | `workbench.js` `renderArticles`，可排序、可按文件夹分组 |
| 6 | 文件排序（修改/名称/大小、按文件夹分组） | ✅ | `groupArticles`，25 项单测 |
| 7 | 文件操作（新建/重命名/复制/删除） | ✅ | 右键菜单齐全（含复制、废纸篓、**移动到…**） |
| 8 | 撤销文件操作 | ✅ | 逆操作栈（上限 20 步）：新建/重命名/副本/废纸篓/移动五类均可撤销；toast 上「撤销」按钮 + 文件菜单「撤销文件操作」。废纸篓靠原生 `trashItem(resultingItemURL:)` 拿真实落点，`fsRestore` 搬回 |
| 9 | 在 Finder 中显示 / 复制路径 | ✅ | 文件树右键 `Bridge.reveal` |
| 10 | 文件夹变动自动刷新 | ✅ | 4s 轮询 `fsList` 比对签名，变化即刷新并清搜索缓存 |
| 11 | Open Quickly（模糊搜索，`⌘⇧O`） | ✅ | 子序列匹配 + 连续/词首加分，键盘上下选 |
| 12 | 最近文件 + 固定 | ✅ | 最近 30 条（localStorage）；每行末尾图钉可「固定到列表」，固定项按固定时间倒序**置顶**、且不参与 LRU 淘汰（挤出去的只会是未固定项）。`workbench.js` 纯函数 `normRecent/sortedRecent/capRecent/touchRecent/togglePinned/pinRecent` 18 项 + `recentdom.test.js` 26 项 harness |
| 13 | 跨文件全局搜索（`⌘⇧F`） | ✅ | 逐文件异步、命中上限 300、显示行号与行文本，可跳转 |
| 14 | 拖文件到编辑器插入链接 | ✅ | `dropfile.js`：`pathsFrom` 从 `text/uri-list` / `text/plain` 抠绝对路径（WKWebView 拿不到 `File.path`），`plan` 三档退化——有路径算相对、无路径但可读文本复制进 `assets/`、都不行只链文件名并提示；空格转 `%20`、圆括号转 `%28%29`；⌥ 拖入文本文件仍是直接打开。33 项纯函数 + `dropdom.test.js` 27 项 harness |
| 15 | 相对路径 `.md` 链接应用内打开 | ✅ | `resolveLink` + `openRelLink`：当前目录 → 文件夹根 → 按文件名 |
| 16 | 链接目标不存在时自动新建文件 | ✅ | 上面同一路径，找不到时询问是否新建 |
| 17 | 自动保存 | ✅ | 0.7s 防抖写盘，可关 |
| 18 | 崩溃 / 未保存草稿恢复 | ✅ | 1.2s 防抖写 `localStorage`，启动时询问恢复 |

---

## D. 图片（9 / 9，另 1 项不做）

| # | 功能 | 状态 | 证据 / 说明 |
| --- | --- | --- | --- |
| 1 | 粘贴 / 拖入图片 | ✅ | `onPaste` / `onDrop` → `hooks.onSaveImage` → `Bridge.saveImage(data, docPath, dest)`。落盘目录与 `⌘⌃I` **同源**：`Imgman.context` 读 front matter 的 `typora-copy-images-to`（相对值按文档目录解析），引用再由 `hrefOf` 按 `typora-root-url` 换算；文档未保存时落临时目录、正文里链绝对路径；文件名撞了自动 `-2`（连贴几张不会互相覆盖）；没在编辑态就另起一段，不再静默丢图 |
| 2 | 插入本地图片对话框（`⌘⌃I`） | ✅ | `ImgMan.insertImages` + 原生 `pickImages`；多选、逐张去重命名、按 `typora-copy-images-to` 落盘 |
| 3 | 复制 / 移动到指定文件夹（`typora-copy-images-to`） | ✅ | 图片右键「移动到 / 复制到文件夹」→ `fsOp moveTo/copyTo`，引用同步改写；插入时读 front matter 的 `typora-copy-images-to` |
| 4 | 图片重命名 | ✅ | 右键「重命名图片…」：改磁盘文件名 + `ImgMan.rewrite` 批量改写引用（保留 title/尺寸写法） |
| 5 | 全部图片移动 / 复制 / 下载 | ✅ | 「整理全部图片到 assets…」批量复制并改写引用；「下载到本地…」（单张，右键）与「下载全部远程图片…」（菜单）把 `http(s)` 图片抓到 `assets/`，引用同步改成相对路径（原生 `URLSession`，不受 CORS 限制；重名自动 `-2`、按 Content-Type 补扩展名） |
| 6 | `typora-root-url` / 图片根路径 | ✅ | front matter 读 `typora-root-url` → `setBase` 改 `<base href>`，预览与导出（`resolveImage` 补绝对路径）同时生效 |
| 7 | 删除图片（连同磁盘文件） | ✅ | 右键「删除图片」：确认后 `fsTrash` 进废纸篓 + 正文引用一并移除 |
| 8 | 一次拖入多张图 | ✅ | `onDrop` 批量插入，alt 取文件名 |
| 9 | 上传图床（PicGo / iPic / 自定义） | ⊘ | 已定范围外 |
| 10 | 图片默认居中 | ✅ | 偏好设置「图片居中」→ `body.img-center`，独立成段的图片水平居中 |

---

## E. 导出 / 导入（15 / 15）

| # | 功能 | 状态 | 证据 / 说明 |
| --- | --- | --- | --- |
| 1 | 导出 HTML（样式内联、目录已填） | ✅ | `exportHTML`，字体 data URI 内联 |
| 2 | HTML (without styles) | ✅ | 导出菜单「HTML（无样式）」，只丢 `app.css`；包裹层限宽是独立选项 |
| 3 | HTML 导出选项（自定义 head/body、导出主题） | ✅ | 对话框五项：带/不带样式、**导出主题**（六套内置 + 自定义主题，写进 `<html data-theme>`，自定义主题 CSS 排在 `app.css` 之后内联，`export.js` `themePick` + `native/webexport.swift`）、图片内嵌 data URI、正文限宽、**自定义 `<head>` 片段与 `</body>` 前片段**（原样插入不转义，随偏好记忆）；不导出样式时主题下拉自动灰掉 |
| 4 | 导出 PDF（A4 分页） | ✅ | `renderPDF`，WKWebView `printOperation` |
| 5 | PDF 选项（纸张/边距/页眉页脚/h1 分页/书签） | ✅ | 五项都有（对话框 + 记忆上次选择）；书签按标题生成 outline，`pdfbook.swift` 排除目录页、折行标题归一后再落页 |
| 6 | 导出图片（PNG/JPEG） | ✅ | 整页快照：临时撑高 WebView → `takeSnapshot` → 还原 |
| 7 | 导出 Word（`.docx`） | ✅ | 自研 OOXML，真脚注、TOC 域、图片 EMU |
| 8 | 导出 ePub 3 | ✅ | 真目录、脚注回链、图片入包 |
| 9 | 导出 LaTeX（`ctexart`） | ✅ | XeLaTeX 可直接编译 |
| 10 | ODT / RTF / MediaWiki / RST / Textile / OPML / RevealJS | ✅ | 全部自研：ODT（zip+content.xml，含图片/脚注）、RTF（含表格/域）、RST（grid 表/指令）、MediaWiki、**Textile**（`h1(#id).`/`\|_.`/`bc..`/`fn1.`）、OPML、**RevealJS**（h1 横向 / h2 纵向分页，图片内嵌 data URI，离线自动降级为滚动文档） |
| 11 | 导出到上次位置 / 覆盖上次 | ✅ | 原生 `lastDir` 记住上次目录并作为面板初始位置，覆盖走系统确认 |
| 12 | 自定义导出命令 / Pandoc 导出项 | ✅ | `xcmd.js` + 原生 `runExport`：偏好面板维护命令列表（名称 / 命令 / 扩展名，上限 12 条，内置 pandoc 三件套预设），导出菜单末尾列项；执行时文档先落临时 `.md`，`{src}/{out}/{name}/{dir}/{ext}`（兼容 Typora 的 `{currentFilePath}/{outputPath}`）展开后交 `/bin/sh -c`；pandoc 缺失时给 `brew install pandoc`，输出量大也不卡（重定向到文件而非 Pipe） |
| 13 | YAML 覆盖导出设置 | ✅ | `yaml.js`：front matter 的 `title/subtitle/author/date/keywords` 覆盖元信息，`toc/toc-title` 补目录，`papersize/geometry/fontsize/linestretch/documentclass` 覆盖 LaTeX 与 PDF 纸张；LaTeX / docx / epub / odt / reveal / HTML 六个出口统一生效（会进 LaTeX preamble 的字段过白名单防注入） |
| 14 | 导入 Word / HTML（`⌘⇧I`） | ✅ | 自写 OOXML/HTML 解析器，33 + 26 项测试 |
| 15 | 导入 ODT / ePub / LaTeX / RST 等 | ✅ | ODT（`content.xml` → 标题/列表/表格/脚注/图片出包）、RST（下划线标题/code-block/grid 表/脚注）、**ePub**（解 zip → OPF spine → 逐章 HTML 转 md，图片从包内抽出、脚注还原成 `[^n]`）、**LaTeX**（`\section` 系列 / itemize / tabular / verbatim / 公式环境 / `\textbf`·`\href`·`\footnote` 一类行内命令） |

---

## F. 外观（6 / 6）

| # | 功能 | 状态 | 证据 / 说明 |
| --- | --- | --- | --- |
| 1 | 内置主题 6 套 | ✅ | GitHub / Night / Newsprint / Pixyll / Whitey / Gothic |
| 2 | 自定义 CSS 主题 | ✅ | 主题目录扫描 + `:root` 抬权 |
| 3 | 字号 / 正文宽度 | ✅ | 偏好设置实时生效 |
| 4 | 字体 / 行距 / 背景 | ✅ | 偏好设置三件套：字体（6 个本机已装预设 + 自定义字体族，`NSFont` 逐个验过）、行距（1.3–2.4 滑块，正文与标题同比缩放、代码块不参与）、背景色（`<input type="color">`，「跟随主题」一键清除）。导出的单页 HTML 写成 `<html style="--font-body:…;--leading:…;--bg:…">`，所见即导出 |
| 5 | 深色模式 | ✅ | Night / Gothic |
| 6 | 跟随系统外观自动切换 | ✅ | `matchMedia('(prefers-color-scheme: dark)')` 切 Night/GitHub |

---

## G. 系统集成（4 / 5）

| # | 功能 | 状态 | 证据 / 说明 |
| --- | --- | --- | --- |
| 1 | Finder 双击 `.md` 打开 | ✅ | `Info.plist` 注册 `net.daringfireball.markdown` |
| 2 | `open -a Typora file.md` | ✅ | `application(_:open:)`，目录走 `openFolderAt` |
| 3 | 命令行 `typora file.md` | ✅ | `bin/typora` + `install-cli.sh`：文件/目录/`-` 读 stdin/`-v`/`-h` |
| 4 | Windows / Linux 版 | ✗ | 仅 macOS（AppKit + WKWebView） |
| 5 | 原生打印对话框（`⌘P`） | ✅ | `Bridge.print` → `printOperation` + 打印面板；无原生桥时回落导出 PDF |

---

## 关键行为差异（仍然存在）

1. ~~**块内编辑显示源码**~~：第十八轮已改成行内标记即时隐藏；残余差异只有——含
   代码/链接/公式/行内 HTML/表格/任务框/多行的块仍显示原文（标记里装着真内容，藏了没法改），
   以及列表 / 引用的前缀照原样显示。
2. **链接单击即打开**：Typora 需要 `⌘ + 点击`。相对 `.md` 链接现在会在应用内打开。
3. ~~**单窗口无标签页**~~：第十六轮已补上（`⌘T` / `⌘W` / `⌃⇥` / `⌘⇧[ ]`，会话跨重启）。
4. **图片管理走右键菜单**：Typora 是悬浮工具条；这里是右键（重命名/移动/复制/删除/整理全部）。

---

## 本轮补做记录（2026-10-18 第二轮）

| 组 | 项 | 落地位置 | 测试 |
| --- | --- | --- | --- |
| P0 | 引用式链接/图片、裸 URL、上下标、Emoji、行内 HTML、Callouts、引用续行 | `md.js` / `inline.js` / `editor.js` | `syntax2` 50 项 |
| P1 | 自动配对、智能标点、字数面板、缩放、代码块行号/语言/复制、表格原位编辑+插入对话框+列宽 | `editor.js` / `ui.js` / `table.js` | `table` 46、`selbar` 32、`prefs` 30 |
| P2 | Open Quickly、全局搜索、最近文件、文件树右键、Articles、相对链接、目录监视、草稿恢复 | `workbench.js` / `ui.js` / `native/main.swift` | `workbench` 25、`note` 41 |
| P3 | 导出图片(PNG/JPEG)、HTML 无样式、PDF 纸张/边距/页眉页脚/H1 分页、原生打印、Whitey/Gothic、CLI | `native/main.swift` / `ui.js` / `app.css` / `bin/typora` | `exportui` 63、`exportopts` 28、`cli` 15 |

回归：`node test/runall.js` → **789/789**（20 个套件）。

---

## 本轮补做记录（2026-10-18 第三轮）

| 组 | 项 | 落地位置 | 测试 |
| --- | --- | --- | --- |
| 图片 | 插入本地图片对话框（`⌘⌃I`，原生多选） | `imgman.js` + `native/main.swift` `pickImages` | `imgedit` 39 项 |
| 图片 | 重命名（磁盘 + 引用同步改写） | `imgman.js` `renameImage` + `fsOp rename` | `imgman` 65 项 |
| 图片 | 移动到 / 复制到指定文件夹 | `imgman.js` `moveImage` + `fsOp moveTo/copyTo` | `imgedit` |
| 图片 | `typora-copy-images-to` | `imgman.parseFront` / `imgDir`，插入时按 front matter 落盘 | `imgman` |
| 图片 | `typora-root-url` / 图片根路径 | `imgman.rootDir` → `setBase` 改写 `<base href>`；导出 `resolveImage` 补绝对路径 | `imgman` |
| 图片 | 删除图片（连同磁盘文件） | 右键 → `fsTrash` + 引用移除 | `imgedit` |
| 图片 | 整理全部图片到 assets | `ImgMan.moveAll`：批量复制 + 引用改写（原文件保留） | `imgedit` |
| 图片 | 图片默认居中 | 偏好「图片居中」→ `body.img-center` | `imgedit` |
| 大纲 | 筛选 + 折叠 | `renderOutline` 加筛选框与折叠箭头（祖先折叠隐藏子树） | `imgedit` |

回归：`node test/runall.js` → **893/893**（21 个套件）。

---

## 本轮补做记录（2026-10-18 第四轮）

| 组 | 项 | 落地位置 | 测试 |
| --- | --- | --- | --- |
| 导出 | ODT（`mimetype` + `content.xml` + `styles.xml` + `meta.xml` + `manifest.xml`） | `odt.js`：标题 `text:h`、列表 `text:list`、表格 `table:table`、代码等宽段、**原生脚注 `text:note`**、图片进 `Pictures/` 并按 96dpi 折算 cm（宽封顶 15cm） | `odt` 53 项 |
| 导出 | RTF | `textfmt.js` `rtf`：`\uNNNN?` 转义（含负值代理项）、`\b/\i/\strike` 组、`\trowd/\cellx` 真表格、HYPERLINK 域、项目符号列表 | `textfmt` 85 项 |
| 导出 | reStructuredText | `textfmt.js` `rst`：下划线标题、`.. code-block::`、grid 表（按内容算列宽）、`.. image::`、`[#x]_` 脚注、`.. math::`、`.. contents::` | 同上 |
| 导出 | MediaWiki | `textfmt.js` `mediawiki`：`= 标题 =`、`'''粗'''`、`*`/`#` 列表、`{\| class="wikitable"`、`<syntaxhighlight>`、`<ref>` | 同上 |
| 导出 | OPML 大纲 | `textfmt.js` `opml`：标题成树（同级回退）、正文摊平进 `_note`（列表/表格/代码去标记） | 同上 |
| 导出 | 导出到上次位置 | 原生 `lastDir` 作面板初始目录（与打开/保存共用），覆盖走系统确认 | 手动 |
| 导入 | ODT → Markdown | `infmt.js` `fromOdt`：解 zip → `content.xml` → 标题/段落/列表（编号与嵌套）/表格/脚注，`Pictures/` 取成 assets 并改写路径 | `infmt` 44 项 |
| 导入 | RST → Markdown | `infmt.js` `fromRst`：下划线标题（含上划线）、code-block / math / image / contents 指令、grid 表、`[#x]_` 脚注、缩进引用、注释块丢弃 | 同上 |
| 文件 | 重开已关闭文件（`⌘⇧T`） | `ui.js` `closedStack`（最近 20 个）+ `reopenClosed`，文件已删则继续往下找 | 手动 |

回归：`node test/runall.js` → **1079/1079**（24 个套件）。

---

## 本轮补做记录（2026-10-18 第五轮）

| 组 | 项 | 落地位置 | 测试 |
| --- | --- | --- | --- |
| 导出 | Textile | `textfmt.js` `textile`：`hN(#id).` 块签名、`*粗*`/`_斜_`/`@码@`/`-删-`、`"文字":url`、`!src(alt)!`、`\|_.` 表头与 `>.` 对齐、`bc.`/`bc..` 代码、`bq.` 引用、`fn1.` 脚注、`[TOC]` 生成带锚点列表 | `textfmt` +24 项 |
| 导出 | RevealJS 幻灯片 | `export.js` `reveal`：按 pandoc 的「幻灯片层级」分片（有 h1 用 h1 横向 / h2 纵向，无 h1 则 h2 横向）、复用 ePub 的语义块渲染、`[TOC]` 真链接、脚注独立成页、图片读得到就内嵌 data URI、CDN 拿不到时用 `.no-reveal` 降级成滚动文档 | `reveal` 33 项 |
| 导入 | ePub → Markdown | `importer.js` `fromEpub`：解 zip → `META-INF/container.xml` → OPF（manifest + spine，跳过 `properties="nav"` 与 `linear="no"`）→ 逐章 HTML 转 md；`<image xlink:href>`（SVG 封面）转 `<img>`；图片按章节相对路径解出、去重、按 basename 落 `assets/`；脚注区抽成 `[^n]:` 定义 | `epub` 22 项 |
| 导入 | LaTeX → Markdown | `infmt.js` `fromLatex`：去注释、取 `\begin{document}` 内文、`\title` 作标题；`\chapter`/`\section`… 按 article/book 定级；itemize/enumerate/description（嵌套靠缩进）、tabular（剥列格式说明、`&`/`\\` 顶层切分）、verbatim/lstlisting、equation/align；行内 `\textbf`/`\emph`/`\texttt`/`\href`/`\url`/`\footnote`/`\includegraphics[width=…]`/`\cite` 与转义符号 | `infmt` +22 项 |
| 图片 | 下载远程图片 | `imgman.js` `isRemote`/`downloadName`/`remoteRefs`/`downloadAll` + 右键「下载到本地…」；原生 `imgFetch` 用 `URLSession` 抓图写盘（绕开 WKWebView 的 CORS），重名 `-2`、无扩展名按 Content-Type 补 | `imgman` +17 项 |
| 菜单 | 两处命令表 | 原生导出菜单加 Textile / RevealJS、编辑菜单加「下载全部远程图片…」；状态栏导出菜单 14 → 16 项；导入面板放开 `.epub` / `.tex` | `exportui` |

回归：`node test/runall.js` → **1212/1212**（26 个套件）。

---

## 本轮补做记录（2026-10-18 第六轮）

| 组 | 项 | 落地位置 | 测试 |
| --- | --- | --- | --- |
| 语法 | Emoji 补全下拉 | `emoji.js`：`match`（前缀 / 词段 / 中间三档打分，同分看长度再看字典序）、`triggerAt`（挡掉 12:30、http://、a::b）、`inCode`（从文档开头逐行扫围栏状态）；↑↓/Enter/Tab 选、Esc 关，插入的是字形本身 | `strict` +18 项 |
| 编辑 | Text Snippet | `snippet.js`：`触发词 => 内容`，`\n`/`\t`/`\\` 转义、`$0` 光标落点、重复触发词后者覆盖、中文触发词；`editor.js` Tab 优先展开，无选区才生效，展开走 `setValueAndCaret`（一次撤销） | `strict` +14 项 |
| 语法 | 严格模式 | `md.js` `STRICT` + `setStrict/isStrict`，`inline.js` `strictMode()` 同步（导出器吃同一套 tokenize，不会「预览字面、Word 高亮」）；关掉高亮/上下标/Emoji/wiki/Callout 的扩展解析，源码一个字符不动 | `strict` +13 项 |
| 编辑 | 表格行列拖动排序 | `table.js` `moveRow/moveCol`（对齐与列宽一起搬）+ `dropIndex`（插入位→结果下标）+ `startDrag`（4px 阈值、上半插前/下半插后、`.tbl-drop` 指示线、拖完吃掉随后的 click 防误插） | `strict` +12 项、`edit2` 53 项 |
| 导出 | HTML 导出选项 | `export.js` `htmlOptions/htmlDoc/imageRefs/applyImageMap/dataUri`；`ui.js` `openHtmlOpts` 对话框（带样式 / 图片内嵌 data URI / 正文限宽），选择记忆进偏好；原生菜单加「HTML 选项…」 | `strict` +17 项、`exportui` +8 项 |

回归：`node test/runall.js` → **1375/1375**（27 个套件）。

## 本轮补做记录（2026-10-18 第七轮）

| 组 | 项 | 落地位置 | 测试 |
| --- | --- | --- | --- |
| 语法 | 严格模式（解析侧） | `md.js` `STRICT` 双档正则：`RE_ATX`（`#` 后必须空白）与 `RE_ATX_LOOSE`（容错）；`parseListTree` 按「内容列」`colOf = indent + marker.length + 1` 判归属，空行后列表行单独判深浅，续行严格档要求缩进不小于内容列。`editor.js` 新增 `reparse()`，切档时重建块模型（保留撤销栈与脏标记） | `strictparse` 52 项 |
| 语法 | flowchart.js | `flow.js`（约 420 行）：`parse`（节点/边/链式/管道标签/`\n` 转义，语法错误报行号）、`backEdges`（DFS 剔除回边后 DAG 松弛分层）、`layout`（层内声明序 + 尺寸测量 + 正交走线 + 外包框）、`svg`（深浅双调色板）；`doc.js` 装饰流程第 7 步、`ui.js` 换主题时 `Flow.refresh()`；`export.js` `inlineFlow` 把 SVG 内嵌进 ePub / RevealJS | `flow` 58 项、`flowdom` 30 项、`export` +8 项 |

回归：`node test/runall.js` → **1594/1594**（29 个套件）。

## 本轮补做记录（2026-10-18 第八轮）

| 组 | 项 | 落地位置 | 测试 |
| --- | --- | --- | --- |
| 文件 | 文件操作撤销 | `workbench.js` 逆操作栈（`FS_UNDO_MAX=20`）：新建/重命名/副本/废纸篓/移动五类都压栈，toast 上挂「撤销」按钮（`ui.js` `toast(msg, {label, fn})` 支持按钮）；原生 `trashItem(resultingItemURL:)` 返回真实落点，新增 `fsOp: restore` 分支搬回；文件菜单加「撤销文件操作」，右键菜单补「移动到…」 | `fsundo` 31 项、`fsundodom` 41 项 |
| 导出 | YAML 覆盖导出设置 | `yaml.js`（约 143 行）：`metaOf` 解析扁平 front matter，`overrides` 归一化出 `title/subtitle/author/date/keywords/toc/tocTitle/paper/geometry/fontsize/linestretch/docclass`；`export.js`（LaTeX preamble / ePub OPF+nav / RevealJS 标题页 / HTML `<meta>`）、`docx.js`、`odt.js`、PDF 纸张（`ui.js` `exportPDF`）六处统一接入；进 preamble 的字段过白名单与字符黑名单 | `yaml` 84 项、`exportyaml` 32 项 |
| 导出 | 自定义 pandoc 导出命令 | `xcmd.js`（约 150 行）：`expand`（两套占位符别名）、`tokenize`/`firstBin`（跳过 `env`/`nohup` 与 `VAR=val`）、`check`（缺 `{out}` 硬错、shell 元字符警告）、`norm`（丢空项补 id、上限 12）、`DEFAULTS`（pandoc 三件套）；原生 `runExport`：写临时 `.md` → 保存面板 → `/bin/sh -c`，输出重定向到文件避免 Pipe 满卡死，退出码 127 翻译成安装提示 | `xcmd` 57 项、`xcmddom` 45 项 |

## 本轮补做记录（2026-10-19 第九轮）

| 组 | 项 | 落地位置 | 测试 |
| --- | --- | --- | --- |
| 编辑 | 代码块 Code Tools | `code.js`（约 660 行）：`bodyRange` / `pointToLine` / `lineOffset` / `lineEnd` / `selLines` / `shift` / `indent` / `outdent` / `toggleComment` / `moveLine` / `stripNoise` / `netBrackets` / `normalizeIndent` / `reindentBrace` / `autoIndent` / `toHtml` / `toMarkdown` / `langAliases`；右键菜单八项，`⌘/` 切注释、`⌥↑↓` 移行；`editor.js` 新增 `replaceRawRangeKeepEdit`（编辑态改 raw 不被踢出）与块内 Tab/Shift+Tab 整段缩进；`md.js` `CODE_LANGS` 加别名（`js`/`py`/`sh` 归一） | `code` 110 项、`codemod` 47 项 |
| 文件 | 最近文件固定 | `workbench.js` 纯函数 `isPinned/sortedRecent/capRecent/touchRecent/togglePinned/pinRecent`（`RECENT_MAX=30`，超限只淘汰未固定项）；`renderRecent` 改 `.recent-row` 包 `.recent-item` + `.recent-pin`（内联 SVG 图钉、`aria-pressed`、hover 或已固定才可见），落盘走 `localStorage` | `workbench` +18 项、`recentdom` 26 项 |
| 文件 | 拖文件插入链接 | 新增 `dropfile.js`（`pathsFrom` / `plan` / `linkText` / `isImage`）；`editor.js` `onDrop` 重写（图片照旧、非图片交 `hooks.onDropFile`、⌥ 仍直接打开）并新增 `insertMarkdown`（编辑态插光标处 / 否则插块后 / 源码与分栏写 textarea）；`ui.js` `insertDroppedFile` 兜底复制进 `assets/`（`fsList` 查重 + `ImgMan.uniqueName`） | `dropfile` 33 项、`dropdom` 17 项 |
| 导出 | HTML 自定义 head/body 片段 | `export.js` `htmlOptions/htmlDoc` 加 `head`/`tail`：`head` 插在 `</head>` 前、`tail` 插在 `</body>` 前，原样输出不转义；`ui.js` `PREF_DEFAULT` 加 `htmlHead/htmlTail`，`openHtmlOpts` 两个 textarea（textarea 内回车不触发导出），`htmlOptsFromPrefs` 读回偏好 | `exportyaml` +5 项、`exportui` +7 项（STEP 1b2）、`strict` 102 项 |

自动缩进不是 parser：`stripNoise` 先按语言把字符串与注释抹成等长空格（长度守恒，
下标可映射回原文），再数净括号深度重排；Python / YAML 走「只规范缩进层级、不改结构」，
按 4 空格层级向下取整，YAML 的嵌套标量不会被抬层级。真 parser 每语言一套、体积失控，
这里取「括号深度 + 行首收括号先退格」的通用算法。

回归：`node test/runall.js` → **2075/2075**（43 个套件）。

### 仍然明确的缺口（按价值排序）

1. ~~标签页~~（`⌘⇧N` 多窗口与 `⌘⇧T` 重开已有）—— **第十六轮已补上**
2. ~~行内标记即时隐藏~~（Typora 的 live preview）—— **第十八轮已补上**

第九轮把「HTML 自定义 head/body」「拖文件插链接」「最近文件固定」三项清掉了；
`E-3` 当时仍记 ◐ 是因为「导出主题」是独立能力（换一套主题 CSS 再导出），不并入
head/body 那格；第十二轮补上后 `E-3` 转 ✅，导出域 15/15。

## 本轮补做记录（2026-10-19 第十轮）

| 组 | 项 | 落地位置 | 测试 |
| --- | --- | --- | --- |
| 语法 | 高亮器语言覆盖 11 → 32 套 | `md.js` `LANG` 方言表重写：每语言一张表（行注释/块注释与多行字符串/关键字/类型/引号集合/语言专属 `pre` 正则），通用词法器统一处理注释、字符串、数字（含 CSS 单位）、单词（关键字 → 类型 → 调用），`diff` 与 `markdown` 走整行渲染；新增 token 类 `tok-type/tok-key/tok-meta/tok-ins/tok-del`（六套主题各补 5 个变量） | `highlight` 135 项（覆盖：33 个下拉项 → 32 套词法；不变量：去标签反转义必须还原原文；逐语言要点 + 别名 + 边角未闭合） |

回归：`node test/runall.js` → **2210/2210**（44 个套件）。

## 本轮补做记录（2026-10-19 第十一轮）

| 组 | 项 | 落地位置 | 测试 |
| --- | --- | --- | --- |
| 导出 | PDF 书签 | `export.js` `pdfOutline`（跳过围栏里的 `#`、`plainHeading` 剥掉 `**`/链接/脚注只留 PDF 里搜得到的纯文本）；`native/pdfbook.swift`：`tocPages` 按「一页命中 ≥2 个标题」判目录页并排除、`findPage` 从上一处命中往后搜 + `squeeze` 归一折行标题、把页 `insert` 进新建 `PDFDocument` 再挂 `outlineRoot`（PDFKit 只对自造文档写 `/Outlines`）、写临时文件后 `replaceItemAt` 原子替换；`ui.js` 对话框加「书签（用标题生成）」默认开，偏好 `pdfBook` | `pdfbook` 51 项（含 19 项 Swift 真 PDF 断言：层级/落页/目录页/折行/幂等） |
| 编辑 | 源码模式行号 + 高亮 | 新增 `srcmode.js` 双层：textarea 文字 `transparent` 只留光标，下面 `<pre>` 逐行输出行号 + token；两层共用 font/line-height/tab-size 与「padding + 46px 行号列」的严格换算；围栏状态跨行跟踪（围栏内按围栏语言上色；围栏里的 `~~~` 不会误关掉 ``` 围栏）；行号 `position: sticky` 跟随横滚；`input` 后 `rAF` 合帧重画一次；`editor.js` 进模式时重置光标与滚动到开头（赋值会把光标丢到文末，之前一进模式就对着最后一行尾部） | `srcmode` 90 项（结构/转义/往返无损/围栏/桩对象 attach）、`srcmodedom` 47 项（真 WKWebView 量文字左起点、行高节奏、六行无漂移、滚动同步、行号粘边、重进不残留） |

两处坑值得记：`attach()` 里 `return api` 的 `api` 当时在 UMD 外层闭包里，工厂内部根本没这个名字 ——
一调就抛，`Editor.init` 连带 `boot()` 全挂，而纯函数测试一片全绿（表现为十几个 harness 套件集体
2/18）。所以补了「桩对象 attach」一组：先证明它不抛、能链式返回，再谈渲染。另一处是
`#source-hl` 的左内边距必须与 textarea 的「padding + 行号列宽」严格相等，差 46px 时文字看起来
「差不多齐」，实测 `461 vs 415`。

回归：`node test/runall.js` → **2405/2405**（47 个套件）。

## 本轮补做记录（2026-10-21 第十二轮）

| 组 | 项 | 落地位置 | 测试 |
| --- | --- | --- | --- |
| 导出 | HTML 导出「导出主题」 | `export.js` 新增 `themes`（六套内置，与 `app.css` 的 `html[data-theme="…"]` 一一对应）与 `themePick(raw, base)`（`'night'` → 内置；`'user:x.css'` → 自定义主题叠在 `base` 上；未知值回落 github；文件名去掉 `\`、`/` 与前导点）；`htmlOptions` 多出 `theme`/`themeFile`，`htmlDoc` 输出 `<html data-theme="…" class="typora-export">` 与 `<body class="typora-export">`；`ui.js` 对话框加「导出主题」下拉（内置 + 自定义 optgroup，记住上次选择，不导出样式时自动灰掉），导出前 `Bridge.readTheme` 取自定义主题 CSS 并走 `tweakUserCss` 把 `:root` 抬成 `html[data-theme]`；`bridge.js` 多传 `themeCss`；新增 `native/webexport.swift` `WebExport.inject`（`app.css` 先、自定义主题后，`</style` 转义，缺 `</head>` 时退到 `<body>` 前） | `htmltheme` 74 项（纯 Node + 22 项 Swift 注入断言）、`htmlthemedom` 27 项（srcdoc iframe 里量计算样式：data-theme、背景/文字色与 `app.css` 变量逐值相等、深色比浅色暗、自定义主题压住内置、无样式导出确实没有 CSS、`overflow` 不再 hidden 且能滚、标题/正文/限宽/等宽字体）、`exportui` +21 项（下拉 6+1 项、默认跟当前主题、样式关掉时禁用、选夜间写出 `data-theme`、自定义主题 CSS 与文件名传到原生、偏好记忆） |

两件事值得记：一是指标必须落在**真的导出文档**上 —— `srcdoc` iframe 里 `data-theme` 生效、
计算色值与 `app.css` 变量逐值相等，才算「换皮」成立（只断言字符串里有没有 `data-theme="night"`
挡不住 CSS 没内联、变量没生效这类错）。二是顺手修掉一个老问题：导出的单页继承了应用外壳的
`html,body{height:100%;overflow:hidden}`，长文档在浏览器里根本滚不动；现在 `html.typora-export`
把 `height` 放开、`overflow` 改回 `visible`，`htmlthemedom` 里有对应断言（`overflow` 不是 hidden
+ 滚到 600px）。`WebExport.inject` 的样式注入顺序也有断言兜着：自定义主题必须排在 `app.css`
之后，否则内置主题的 `html[data-theme]` 变量会把它压回去。

回归：`node test/runall.js` → **2523/2523**（49 个套件）。

## 本轮补做记录（2026-10-21 第十三轮）

| 组 | 项 | 落地位置 | 测试 |
| --- | --- | --- | --- |
| 编辑 | 专注模式按光标块 + 近邻衰减 | `app/css/app.css`：非光标块 `.3` / 近邻块 `.62` / 光标块 `1.0`（标题另有 `.45` / `.72` 两档）；`app/js/caret.js` `nearOf(i, total)` 算近邻，`editor.js` `refreshFocus()` 打 `.near`（缓存 key，块没换就不碰 DOM）；编辑块里插一条 `.caret-line` 淡强调色底，高度＝行高、位置随光标行，`z-index:0` 垫在透明 textarea 底下 | `caret` 57 项（纯 Node：行号/区间/居中量/夹边界/近邻/接线/CSS）、`caredom` 34 项（真 WKWebView） |
| 编辑 | 打字机按光标行居中 | `app/js/caret.js`：`measure(ta)` 用一个与 textarea 同字体同宽度的隐藏镜像 div 量光标行的真实 y（软换行交给浏览器折），`center(ta, scrollEl)` 把该行中线对到视口中线；`editor.js` 把 `centerBlock` 换成 `centerCaret`，`input` / `keyup` / `click` / `select` 都触发 | 同上；`caredom` 里「块内挪到中间后仍居中」「随光标往下滚动位置单调增加」「最后一块不越界」 |

两个坑值得记：

1. **镜像量出来的 top 差半个行距**。`<span>` 的 `getBoundingClientRect().top` 是**字形顶**，
   不是行盒顶（行高 26.66、字号 15.5 时差 4.2px leading）。第一版直接拿它当行偏移，
   结果光标在开头也返回 `4.2`，每行都错半行。修法：文首也放一个同样的零宽标记当基准，
   两次相减把 leading 抵掉 —— 差出来的是干净的行盒，必是行高的整数倍
   （断言 `top % lineH ≈ 0` 就是这么钉住的）。
2. **`#editor-scroll` 上挂着 `scroll-behavior: smooth`**。打字机要求「打一个字，行就在中间」，
   平滑滚动会滞后一屏；直接赋 `scrollTop` 也会走动画。得在赋值前把 `scroll-behavior` 临时
   改成 `auto`、赋值后当帧改回来（不会闪）。

另外两个测试自身的坑记一下：居中用例的块必须落得够靠下（否则 `scrollTop` 被夹在 0，
`gap` 永远是负的几百像素，看着像功能失效其实是没余量）；关掉打字机后不能拿
「`scrollTop` 必须为 0」当判据 —— 进块时 `ta.focus()` 本身就会把输入框滚进视口，
要么量「移动光标前后有没有被动过」，要么别用滚动位置当指标。

回归：`node test/runall.js` → **2614/2614**（51 个套件）。

## 本轮补做记录（2026-10-21 第十四轮）

| 组 | 项 | 落地位置 | 测试 |
| --- | --- | --- | --- |
| 编辑 | 渲染态拼写波浪线 | `app/js/spell.js`（新）：`tokenize` 切词（字母 + 撇号，连字符/下划线断开，单字母与超长串不收）→ `pending` 去重并跳过缓存 → `Bridge.spellCheck` 批量问原生 → 命中词包 `<span class="spell-bad">`；`paint` 用 TreeWalker 走文本节点，`blocked()` 一路爬到根挡掉 `pre/code/kbd/samp/.katex/.mermaid/.raw-html/.editing` 等禁区；`unpaint` 拆包后 `normalize()` 合并碎文本节点。`editor.js` 在 `render()` 后整篇上色、`exitEdit` 只重画被替换的那一块 | `spell` 126 项（纯 Node 105 + Swift 21）、`spelldom` 49 项（真 WKWebView） |
| 编辑 | 原生词典桥 | `native/spell.swift`（新）：`SpellCheck.unknowns(_:ignore:)` 批量判定、`guesses(for:)` 建议词，都跑在同一条 `DispatchQueue(label:"typora.spell")` 串行队列上，算完回主线程；`main.swift` 新增 `spellCheck` / `spellGuesses` 两个方法；`bridge.js` 对应两个 Promise 包装 | `test/spell/main.swift`：21 项真词典断言（正确词不报、错拼全报、下标对齐、ignore 大小写不敏感、建议词、串行队列回调） |
| 编辑 | 右键建议 + 忽略表 | `spell.js`：`rawOffset`（最近的 `data-s` + 片段内偏移）+ `fixAt`（±3 微调 → 全篇找最近）定位，`apply` 走 `Editor.replaceRawRange` 只改那一处；菜单列建议词 + 「忽略「x」」，忽略写进 `pref.spellIgnore`（`ui.js` 持久化），同时把该词在缓存里记成「对」 | `spelldom`：菜单弹出/标题/建议项/点击替换/替换后关闭/忽略后不再标/忽略不影响别的词，另有一条「同词出现两次只改点中的那处」的回归 |
| 外观 | 波浪线与主题 | `app.css`：六套主题各加 `--spell`（`:root` 有兜底），`.spell-bad` 用 `text-decoration: underline wavy` + `text-decoration-skip-ink: none` + `text-underline-offset: 2.5px`；`.spell-menu` 菜单样式 | `spell` 里逐主题断言 `--spell` 存在、`spell` 的 CSS 断言与 `spelldom` 的计算样式（`wavy` / `underline` / `skip-ink:none` / 颜色等于主题变量） |

四个坑值得记：

1. **`data-s` 是块内偏移，不是全篇偏移。** `editor.js` 的 `blockHTML` 对每个块单独
   `MD.parse(raw)`，偏移自然从 0 起算。第一版按「全篇绝对偏移」算，被 `nearest` 兜底
   掩盖了 —— 直到补了「同一个词出现两次」的用例才露馅：第二次出现会被改到第一处。
   现在定位走 `blockIndexOf` + `rawOffset`，改写走 `replaceRawRange(i, start, end)`，
   块内区间一次到位。
2. **`NSSpellChecker` 主线程跑不动。** 实测 0.67ms/词，一千词 700ms，压主线程就是卡界面；
   它又没有文档保证线程安全。做法：单条串行队列（实测 4 线程并发调用结果也稳定，但串行
   更稳），算完 `DispatchQueue.main.async` 回主线程。测试这边还有个反直觉的坑 ——
   命令行进程里回主队列的回调永远不会执行，除非自己转 `RunLoop`；用信号量等会主线程
   自己等自己，超时后拿到空结果。
3. **系统词典的脾气要摸清再写断言。** 全大写词一律当缩写放过（`RECIEVE` 不报），
   首字母大写按专有名词放过一部分（`Recieve` 报、`Typora` 不报），而且 macOS 会把用户
   「学过」的词写进 `~/Library/Spelling`（`teh` 在这台机器上已经是正确词）。所以：
   harness 一律用桩词典，真词典断言只留 `recieve/occured/seperate` 这类铁错拼；
   真机端到端另用探针包截图核对（`bad=[0,1,3]`、7 条波浪线）。
4. **波浪线不能叠层画。** 用绝对定位的波浪线需要跟着每个词的矩形跑，行内折行、缩放、
   专注模式的 `.caret-line`（`position:absolute; z-index:0`）都会互相打架。
   `text-decoration: underline wavy` 由排版引擎画，不占布局、不影响折行，
   `text-decoration-skip-ink: none` 是必须的 —— 否则 `g/y/p` 的降部会把线咬断。

两个「看着像 bug、其实一致」的点也记一下：缩进式代码块（4 空格）本项目的解析器按
**段落**渲染（屏幕上就是正文），所以里面的词照常检查 —— 想让它不检查得先让解析器
认缩进代码，那是另一件事；分栏预览（`#split-prev`）不上色，因为 `#editor` 在分栏下
停更，左栏源码 textarea 本来就有系统原生检查。

回归：`node test/runall.js` → **2789/2789**（53 个套件）。

---

## 本轮补做记录（2026-10-21 第十五轮）

| 组 | 项 | 落地位置 | 测试 |
| --- | --- | --- | --- |
| 外观 | 字体 / 行距 / 背景 | `app/js/typography.js`（新，纯函数层）：`FONTS` 预设表（6 个本机已装字体 + 自定义）/ `pickFont` / `cleanStack` / `normLeading` / `lhScale` / `normBg` / `vars` / `styleOf`。`app.css`：`body` 行高改走 `var(--leading, 1.72)`，`h1/h2/h3` 的行高改成 `calc(1.3 * var(--lh-scale, 1))` 这类同比缩放式（默认 `--lh-scale: 1`，所以不调行距时逐像素不变） | `typography` 102 项（预设表不变量、`pickFont` 各档、字体族清洗、行距夹取与两位小数、`lhScale`、背景归一化、变量表顺序、`styleOf` 缺省省略、`htmlDoc` 接线、app.css 的正则对齐） |
| 外观 | 偏好面板三件套 | `index.html`：字体下拉 + 自定义字体族输入行（仅自定义时出现）、行距滑块（1.3–2.4 / step .02）、背景色 `<input type="color">` + 「跟随主题」。`ui.js`：`applyTypo` 把变量写到 `:root` 行内（空值 = `removeProperty`，让主题/`app.css` 的默认接管）、`syncFontRow`、`syncBgSwatch`（未自定义时禁用并显示当前主题底色） | `typodom` 59 项（真 WKWebView：宋体真落到段落而代码块仍是等宽、行高 = 倍数 × 字号、标题同比、代码块不动、自定义栈生效、换主题不冲掉自定义背景、「跟随主题」回到主题色、拖字号不丢版式、恢复默认、导出 HTML 带变量） |
| 导出 | 单页 HTML 带上版式 | `export.js`：`htmlOptions` 透传 `font/leading/bg`，`htmlDoc` 用 `Typo.styleOf` 拼成 `<html … style="--font-body:…;--leading:…;--bg:…">`。默认值不写，默认文档的 HTML 与之前一字不差 | `typography` 里 6 条（默认不写 style / 调过才带 / 三样顺序 / 无收尾分号 / 无被截断的引号）；`typodom` STEP 10 走真实偏好值再验一遍 |

三个真结果值得记：

1. **「不覆盖」不能用空串断言。** `--font-body` 在 `:root` 里有兜底，`removeProperty`
   之后 `getComputedStyle` 读到的是 `app.css` 那串系统栈，不是空串。第一版测试按
   「空串」写，直接红了；正确写法是拿运行前的值当基准比。
2. **CSSOM 序列化会改写引号。** 偏好里存的是 `custom:'Baskerville', Georgia, serif`
   （单引号，因为导出时要拼进 `style="…"` 属性），但 `getPropertyValue('--font-body')`
   读回来变成双引号 —— CSSOM 序列化字符串一律用 `"`。所以「有没有双引号」只能断言
   落进偏好的原文，不能断言计算值。
3. **顺手修掉一个会丢数据的 bug。** 「恢复默认外观」原来是重建整个 `pref` 对象
   （只留 size/width/autosave/spellcheck/base），把拼写忽略表、文本片段、自定义导出
   命令一起抹了，且不可逆。现在改成只改外观那几项 —— 由「恢复默认后 font/leading/bg
   读出来是 null」这条断言暴露出来的。

行距的边界也有明确取舍：**代码块不参与缩放**（行号列是按固定行高 1.62 对齐的，
一缩放就错行），**标题按同一比例缩放**（各标题原本的行高不同，统一 ×`--lh-scale`
既保持彼此的差，又不让松开的正文配紧凑的标题）。缩进式代码块同样按段落处理，理由
同上一轮。

回归：`node test/runall.js` → **2950/2950**（55 个套件）。

---

## 本轮补做记录（2026-10-21 第十六轮）

| 组 | 项 | 落地位置 | 测试 |
| --- | --- | --- | --- |
| 编辑 | 标签页状态机 | `app/js/tabs.js`（新，纯函数）：`make` / `create` / `add`（同 path 复用并切过去）/ `activate` / `close`（关活动页 → 右边优先，没有就左边）/ `patch` / `patchAll` / `cycle`（循环）/ `untitled`（未命名 2.md、3.md…）/ `findByPath` / `title`（脏了点圆点），上限 24 个，所有函数都不改入参 | `tabs` 67 项（增删改、同路径复用、关闭后激活谁、循环边界、未命名编号、上限、不可变） |
| 编辑 | 切页保住现场 | `editor.js` 新增 `snapshotDoc()` / `restoreDoc()` / `flushAutosave()`。快照 = 正文 + 路径 + 脏标记 + 撤销栈 + 重做栈 + 滚动位置 + 光标在哪一块；还原时重新 `MD.parse`（序列化无损），不碰撤销栈、不置脏，光标回到原块原位置 | `tabsdom` 66 项（正文/路径/撤销栈/滚动位置跨切换、`<base>` 跟着换、脏点与 `__appDirty`、`setFile` 调用） |
| 编辑 | 标签栏与快捷键 | `index.html`：`#tabbar`（`#tab-list` + `＋` 按钮）；`app.css`：约 90 行（顶部 28px 让开原生拖动条、活动页盖住下边框与正文连成一片、脏点/关闭按钮的 hover 交替）；`ui.js`：`openTab` / `switchTab` / `closeTab` / `newTab` / `cycleTab` + 中键关闭、`⌘T` / `⌘W` / `⌃⇥`·`⌃⇧⇥` / `⌘⇧]`·`⌘⇧[`；`native/main.swift`：菜单加「新建标签页 ⌘T」，「关闭窗口 ⌘W」拆成「关闭标签页 ⌘W」+「关闭窗口 ⌘⇧W」 | `tabsdom` 66 项（标签栏只在两个以上出现、DOM 顺序与状态一致、✕ / 中键 / ⌘W 关闭、⌘T / ⌃⇥ / ⌘⇧[ ] 切换、关最后一个换成空白页） |
| 文件 | 打开不再问「丢弃修改」 | `openPath` / `doOpenFile` / `doImport` 去掉 `guardDirty`（当前文档原样留在自己的标签里）；`doSaveAs` 改成「这个标签换个落点」而不是新开一个；退出保护从「当前文档脏」改成「任何一个标签脏」（`Bridge.status` 收全量） | `tabsdom`（打开文件不问、`__appDirty` 为真）+ `dropdom` 17 项（准备步骤改写成「切过去再重置正文」） |

六个真坑：1. **切页前必须把自动保存 flush 掉。** `scheduleAutosave` 的 700ms 定时器只在回调里
   `getValue()`，切页后它读到的是**新**文档 —— 会把新内容写进旧路径。`switchTab` /
   `closeTab` 之前先 `flushAutosave()` 同步落盘。顺带把自动保存成功后的
   `window.__appDirty = false` 换成 `Editor.markSaved()`：标签上的圆点会跟着灭，
   而不是留一个骗人的脏标记。
2. **负边距会被 `overflow` 裁掉。** 让活动标签盖住 `#tabbar` 的下边框，最初的写法是
   `.tab { margin-bottom: -1px }`，实测底部仍有一条灰线 —— `.tab-list` 有
   `overflow-y: hidden`，探不出去。把负边距挪到 `.tab-list` 上才对（像素取样验证：
   活动标签下方 y=116/117 从 `rgb(216,222,228)` 变成 `rgb(255,255,255)`）。
3. **⌘W 根本到不了页面。** 它原本是原生菜单「关闭窗口」的键等价物，AppKit 先处理，
   WebKit 收不到 keydown。所以菜单必须一起改；JS 里那份 keydown 只当兜底
   （浏览器 / harness 里没有菜单）。同理 ⌘T 新占了一个原本空着的键位。
4. **切页时 `scroll-behavior: smooth` 会把「跳过去」变成一段动画。** 还原滚动位置前
   临时压成 `auto`（和打字机那轮同一个坑的第二次出现）；打开新文档回文首也一样。
5. **撤销是 800ms 合并的。** 跨标签撤销的用例必须先停够 800ms 再打字，否则这次输入
   没有自己的快照，断言会误判成「撤销栈没跟着标签走」——第一次就栽在这儿。
6. **同一个键位不能挂两份原生菜单。** 给标签页接线时才发现 `⌘⇧T` 早就被挂了两次：
   「文件 → 重新打开已关闭的文件」和「编辑 → 翻译选中内容」。AppKit 按菜单栏顺序派发，
   文件在前、编辑在后，所以翻译那条**从来没被键盘触发过**（JS 兜底那份也被同一个
   chord 的 capture 监听拦着）。把翻译挪到 `⌘⇧Y` 之后两边都通了 —— 这类重复肉眼极难
   发现，得顺着 `addItem(…, "t", shift: true)` 把整个菜单树排一遍。

行为取舍：

- **关掉最后一个标签不关窗口**，换成一张空白未命名文档。关窗口交给 ⌘⇧W ——
  手一抖关掉窗口又没处找回，比多点一下更糟。
- **标签栏只在两个以上出现**，单文档时零占位（所以之前所有截图与布局断言一字不变）。
- 同一个文件已经开着就**切过去**，不重读磁盘，也不开第二个标签 —— 避免覆盖别处
  还没保存的修改。这条改动让 `dropdom` 的 `clear()` 失效（它靠「每次 openPath 都重读」），
  属于行为变更，测试改成「切过去再 `Editor.load` 重置」。
- 未保存的标签关闭时问一次（`Bridge.confirm`），关干净的标签不问。

回归：`node test/runall.js` → **3083/3083**（57 个套件）。

---

## 本轮补做记录（2026-10-22 第十七轮）

| 组 | 项 | 落地位置 | 测试 |
| --- | --- | --- | --- |
| 编辑 | 会话序列化 | `tabs.js`：`sessionOf(state)` → `{ v, paths, active }`（只收有落点的标签、去重、守 24 上限；未命名在活动页时 `active` 为 null）、`parseSession(raw)`（坏 JSON / 非对象 / 没有 `paths` 一律当没有；**只认绝对路径**，相对路径换个工作目录就指到别处；坏一条丢一条并回 `dropped` 计数） | `tabs` +29 项（存盘形状、去重、截断、坏输入、`//` 归一、存读往返） |
| 编辑 | 写盘时机 | `ui.js`：`saveSessionNow()`（串没变就不写）+ `scheduleSession()`（600ms 防抖，挂在 `renderTabs` 上 —— 切页/开关/改名/存档都会经过它）+ `beforeunload` 同步兜底 | `tabsdom` STEP 16（`localStorage` 里只有 `/ws/a.md,/ws/b.md`，`active` 是前台那篇） |
| 编辑 | 启动还原 | `ui.js`：`restoreSession()` 并发读盘 → 用 `Tabs.add` 拼回状态 → `applyTab` 只装前台那篇（其余正文留在各自 `doc` 里）；`Bridge.ready()` 带 `file` 时**让位**给命令行/双击打开的那篇；一个都打不开就 `clearSession()` 回欢迎页 | `tabsdom` STEP 17–19（整排回来、前台页对、正文按磁盘重读、被删的跳过并兜底、只有相对路径时拒绝、未命名不污染） |

两个真坑：

1. **首屏写盘会抢在「读会话」前面。** `renderTabs` 一开始就被 `refresh()` 调到，顺手排了
   一次 600ms 防抖写盘；如果原生桥 `ready()` 慢过 600ms，那次写盘会把还没读的会话
   **清成空**（此时 `tabsState` 还是空的，`paths: []`）。加 `sessionArmed` 闸门：
   首篇文档就位之前 `saveSessionNow()` 直接返回。这类「读之前先被写」的竞态在
   本地存储上没有任何报错，只表现为「偶发丢会话」，靠想是想不到的，得把写入点全部列出来。
2. **`beforeunload` 在 WKWebView 里不保证触发**（关窗口/退出都可能直接走）。所以不能
   只靠它兜底，真正保证落盘的是那 600ms 防抖 + `beforeunload` 的同步补一刀。

行为取舍：

- **只记路径，不记正文。** 重启后一律按磁盘重读 —— 没保存的改动跨重启活着会让
  「文件被别处改过」和「标签里的旧内容」打架，那种情况本来就该走草稿提示。
- **未命名标签不进会话。** 没有落点，装回去只能变成一张空白页，不如不装。
- **命令行/双击打开某篇时不恢复会话**：用户的明确意图压过上次的样子，否则你会看到
  自己点的那篇被一堆旧标签围住。
- 多窗口共用同一份 `localStorage` 会话，两个窗口各开一批时重启只回到最后写的那批 ——
  写进 README 的限制里，不假装支持。

回归：`node test/runall.js` → **3138/3138**（57 个套件）。

---

## 本轮补做记录（2026-10-22 第十八轮）

| 组 | 项 | 落地位置 | 测试 |
| --- | --- | --- | --- |
| 编辑 | 标记的区间与「该露哪几段」 | `app/js/live.js`（新，约 210 行，UMD 纯函数）：`canLive`（≤4000 字、单行、不含 `\` `` ` `` `[ ]` `$` `< >` `\|`）、`scan`（与 `md.js` 的 `renderInline` **同序同规则**：strong → del → mark → em → sup → sub，嵌套递归进去扫）、`reveal`（「严格在区间内」才算，贴着开标记之前 / 闭标记之后都在外面）、`prefix` / `prefixKind`（标题的前缀可以藏，列表与引用不藏）、`diff`（前后最小差异）、`applyEdit` + `cleanupAt`（删空一对标记时把空标记对一起清掉、光标跟着回退，纯插入不动 —— 否则会吃掉手写的连续星号） | `live` 87 项 |
| 编辑 | 渲染态直接可编辑 | `editor.js` 新增一整段「行内实时预览」：`liveInner`（`MD.renderInline` 出渲染态，标记不进 DOM）、`textMap`（DOM 文本节点 → 原文偏移，`data-s` 当锚点、标记节点不占显示坐标）、`rawAtDisplay` / `domOfRaw` / `rawAtPoint` 双向映射（片段边界上按 bias 取「后一片段开头」或「前一片段末尾」）、`syncReveal`（按光标插/拆标记，`spliceMarkers` + `splicePrefix`）、`liveTranslate`（DOM 改动按差异翻回 `raw` 再重画）、`resyncLive` / `demoteLive`（形状变了当场退回 textarea） | `livedom` 76 项（真 WKWebView） |
| 编辑 | 与既有编辑逻辑共存 | live 元素用 `Object.defineProperty` 装出 `value` / `selectionStart` / `selectionEnd` + `setSelectionRange` / `focus`（`liveSurface`），上层的按键、自动配对、智能标点、撤销**一行都不分叉**；`srcArea()` 选择器放宽成 `textarea.src, .src`；`caret.js` 的 `measure` 认识 live（`__liveCollapsed` / `__liveDisplayPos` 两个惰性函数，镜像量法照旧）；`emoji.js` / `wikilink.js` 的 `TEXTAREA` 硬判断加 `\|\| t.__live`；`⌘0` 缩放的归零判断接纳 live | `caredom` 34、`tabsdom` 92、`edit2` 53、`find` 33、`html` 43 项 |
| 编辑 | 偏好开关 | `ui.js` `PREF_DEFAULT.live`（默认开）+ `applyPrefs()` → `Editor.setLivePreview()`；`index.html` 偏好面板加「行内实时预览」一行；关掉时把当前块退回 textarea；`TyporaCmd.setLivePreview` 供脚本调用 | `prefs` 30 项 |

四个真坑：

1. **差异必须用「上一次同步时」的映射表算。** 编辑发生后 DOM 的文本已经改了，而
   `data-s` 还是上一版渲染写下的绝对偏移；拿改后的 DOM 重算映射，位置会整体错一段 ——
   删中间一个词，结果删掉了末尾的词。所以 `textMap` 的结果缓存在 `el.__map` 上，
   `liveTranslate` 只用它，不用实时的。
2. **落完必须立刻重画。** 第一版想省开销，攒 180ms 再 `resyncLive`，于是「重画 → 重算
   映射」之间的那一次按键仍然按旧偏移算，表现为「打的字跑到别处」。改成落完立刻重画
   （重画会把所有 `data-s` 重写成与新 `raw` 一致），探针从 11/14 变 14/14。
3. **显示坐标不能把标记算进去。** 标记是临时露出来的，如果 `disp` 把它也算上，同一段
   文字在「有标记 / 没标记」两种状态下会算出两套偏移，光标就会跳。`textMap` 里
   `disp` 只累加非标记节点；边界那一点按调用方意图偏置（插入点取后一片段开头、
   选区终点取前一片段末尾）。
4. **量光标位置要惰性。** 给 `Caret.measure` 的「折叠文本 + 显示层偏移」一开始是缓存在
   元素上的两个值，测试直接调 `Caret.measure` 时它们已经过期（高亮条位置差一行、居中差
   十几像素）。改成两个函数（`__liveCollapsed` / `__liveDisplayPos`），谁调都是新鲜值。

行为取舍：

- **只有行内标记与标题的 `## ` 会藏。** 列表 `- ` / `1. ` 与引用 `> ` 的前缀带缩进语义，
  藏了会失去「增删缩进」的锚点；标题藏掉之后文字直接靠左，与渲染态一致。
- **原子块一律退回源码态。** 链接的 URL、公式的 TeX、行内代码的字面量都装在「标记」里，
  藏起来就没法改；`LIVE_BAD` 选择器 + `canLive` 的字符表两道闸。
- **编辑中形状变了立刻降级。** 插进换行、`[`、`$` 之后 `canLive` 就不成立，`demoteLive`
  当场换回 textarea —— 不然渲染态与多行原文会脱节（`edit2` 的「片段展开」用例正是
  这么红的：片段把 `此致\n敬礼` 写进块里，块变多行还挂在 live 上）。
- **光标紧贴露出来的标记时，退格删的是原文。** 浏览器那一下会整块吃掉
  `contenteditable=false` 的 span，而原文一个字没变（界面与原文脱节）；`mkDelete`
  改成在原文上删，并且一次删掉整串连续标记：退格一次去掉一对 `**` 或整个 `## `。

回归：`node test/runall.js` → **3318/3318**（57 个套件）。

---

## 本轮补做记录（2026-10-22 第十九轮）

| 组 | 项 | 落地位置 | 测试 |
| --- | --- | --- | --- |
| 图片 | 粘贴 / 拖入的落盘目录 | `ui.js` 新增 `savePastedImage()` 并作为 `onSaveImage` 挂进 `Editor.init`：`Imgman.context(docPath, Editor.getText())` 读 front matter → 把 `dest`（`typora-copy-images-to`，相对值按文档目录解析成绝对）交给原生；原生写进该目录并回**绝对路径**，再由 `ImgMan.hrefOf` 换回正文引用（配了 `typora-root-url` 就按 root 目录算）。文档未保存时不给目录：原生落临时目录，正文链绝对路径 | `dropdom` 27 项（原 17） |
| 图片 | 三个入口同一套解析 | `⌘⌃I` 的 `imgImport` 本来就吃 `ctx.copyTo`；粘贴与拖入经 `hooks.onSaveImage` 走到同一个 `Imgman.context`。`bridge.saveImage(data, docPath, dest)` 的 `dest` 语义与 `imgImport` / `imgFetch` 对齐（绝对优先、相对按文档目录） | 同上 |
| 原生 | 写盘 | `native/main.swift` 的 `saveImage` 接 `dest`、`createDirectory(withIntermediateDirectories:)`、**返回绝对路径**；文件名只到秒级，撞了就 `-2` 循环避让 | `./build.sh` + 真机冒烟 |
| 编辑 | 顺手修的两处 | ① 连贴 / 连拖几张图会互相覆盖（同一秒都叫 `image-<stamp>.png`）；② 图被丢到渲染块上时 `insertAtCaret` 直接 return，图静默消失 —— 改成没在编辑态就 `insertMarkdown` 另起一段 | `dropdom` 第 8 / 11 / 12 组 |

两个真坑：

1. **`saveImage` 原来回的是相对路径 `assets/name`。** 一旦目录可变，「相对谁」就不成立了
   （`copy-images-to` 指到文档目录之外时更是如此）。所以原生侧改成一律回**绝对路径**，
   相对化交给 `ImgMan.hrefOf` —— 顺带把 `typora-root-url` 也对上了：配了 root 时引用是
   `../media/img/x.png` 而不是 `media/img/x.png`。
2. **返回值形状不统一。** 测试桩有回字符串 `'assets/x.png'` 的，有回 `{path}` 的。
   `savePastedImage` 两种都收，且**只在以 `/` 开头时才做相对化**，否则原样透传 ——
   不然老桩会被 `hrefOf` 再算一次，变成 `../../assets/x.png`。

回归：`node test/runall.js` → **3318/3318**（57 个套件）。

---

## 第二十轮维护记录（2026-10-22 改名 + 去 Typora 目录依赖）

改名不是功能，登记在这里只因为顺着查出两个真缺陷。

| 事项 | 处理 |
| --- | --- |
| 应用身份 | Typora → **OpenTypora**：`OpenTypora.app`、bundle id `local.fw.opentypora`、CLI `opentypora`、`localStorage` 前缀 `opentypora.*`（`typora.*` 首启搬移一次） |
| 用户主题目录 | 固定 `~/Library/Application Support/OpenTypora/themes`，**不再回退** `.../Typora/themes`；两个软件互不读写对方的数据目录 |
| 围栏解析 | 反引号围栏的 info string 里再出现反引号时不算开围栏（CommonMark）。README 里 `` ```` ```flow ```` `` 原先被当开围栏，后文整篇被吞进代码块 —— 这份文档的 LaTeX / Word / ePub 导出样例都因此在「跑集成测试的两个环境坑」处截断 |

- 围栏这条加了 4 条断言（`parser` 117 → 121）：内联围栏写法不吃后文、四个反引号的真围栏照常、
  波浪号围栏的 info 可以带反引号、段落中间不误判。
- 三份导出样例（`docs/exports/`）重新生成：`.tex` 46 KB → 52 KB 且以 `\end{document}` 收尾，
  `.docx` 187 KB → 280 KB，`.epub` 93 KB → 110 KB。
- `htmltheme` 加 1 条源码断言：原生 `themesDir()` 里只允许出现 `OpenTypora/themes`。

回归：`node test/runall.js` → **3318/3318**（57 个套件）。

---

## 核对方法

- 逐条比对官方功能页：Markdown Reference、File Management、Search、Images、Export、
  Code Fences、Table Editing、Outline、Word Count、Auto Pair、SmartyPants、Zoom、Strict Mode。
- 代码侧用 Grep 确认能力是否存在（如 `root-url` 全仓库仍无命中）。
- 语法侧用 Node 直接调 `MD.parse` + `renderBlock` 验证真实渲染，而不是看 README 声明。
- UI 侧用 `test/*.test.js` 生成 harness，交给 `build/shot`（WKWebView）实跑断言。
- 原生进程执行这类测不到的，用等价的 Swift 片段实跑验证（退出码 127 / 输出目录不存在 /
  两万行输出不阻塞 / stdout 可读回）。
- 回归：`node test/runall.js` → 3318/3318（57 个套件）。
