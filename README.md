# OpenTypora

[![CI](https://github.com/SingleTime/opentypora/actions/workflows/ci.yml/badge.svg)](https://github.com/SingleTime/opentypora/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

English · [简体中文](README.zh-CN.md)

A free, open-source Markdown editor for macOS, built from scratch — native shell, no Electron.

The shell is Swift/AppKit with a WKWebView; the frontend is plain HTML/CSS/JS with **no npm, no
bundler, no `node_modules`**. The whole app bundle is 5.8 MB and the release zip is about 2 MB.
MIT licensed.

![OpenTypora demo: typing inside a paragraph, Markdown markers appearing while the caret is in the block and collapsing back to formatted text when it leaves, then switching to split view and to the Night theme](docs/opentypora-demo.gif)

> An 11-second recording. `⌘⇧L`, split view and themes are the only things behind a menu — everything
> else happens directly in the text. The GIF is reproducible: `test/recdemo.js` generates the demo
> page, `test/recdemo.swift` opens the window, ffmpeg converts the screen recording.

## Why this exists

Most Markdown editors on macOS pick one of two compromises: they ship a browser engine and grow to
several hundred megabytes, or they hand you a source pane and a preview pane and call it live
preview. This one takes a third route:

- **Inline live preview.** Markers are not in the DOM. `**bold**` displays as bold text; the two
  asterisks only appear when the caret enters that span, so you can still edit them. The original
  Markdown stays the single source of truth.
- **Byte-exact round trips.** `serialize(parse(src)) === src` holds for every document, so opening
  and saving a file never produces a spurious `git diff`.
- **Native weight.** 5.8 MB bundle, no JIT-warmup, no background helper processes.

## Install

Requires macOS 12 or later (tested on 14 / 15), Apple Silicon only.

The app is **ad-hoc signed** — no Apple Developer certificate, no notarization. The system will block
it on first launch; that is about the signature, not about the software. All three paths below handle it.

### Option 1: one command

```bash
curl -fsSL https://raw.githubusercontent.com/SingleTime/opentypora/main/install.sh | bash
```

Downloads the latest release, installs it to `/Applications`, clears the quarantine attribute and
launches it. The script is [`install.sh`](install.sh) in this repo — read it before running if you
prefer; it only touches `/Applications/OpenTypora.app` and a temp directory.

### Option 2: manual

1. Download `OpenTypora-*.zip` from [Releases](https://github.com/SingleTime/opentypora/releases),
   unzip, and drag `OpenTypora.app` into `/Applications`
2. Double-click it. When macOS says it cannot verify the app, dismiss the dialog
3. **Within a minute**, open **System Settings → Privacy & Security**, scroll to the Security section,
   and click **Open Anyway** next to the blocked-app notice. Authenticate
4. Double-click again and confirm **Open**

> The **Open Anyway** button only stays for about an hour after the blocked attempt. If it is gone,
> double-click the app again and return to System Settings.

### Option 3: clear the quarantine flag in Terminal

```bash
xattr -dr com.apple.quarantine /Applications/OpenTypora.app
```

> Since macOS 15, Control-clicking an app no longer bypasses Gatekeeper — [Apple removed that path](https://developer.apple.com/news/?id=saqachfa).
> System Settings or the command above are the only options.

### Build from source

Requires macOS and Xcode Command Line Tools (for `swiftc`). No npm, no Xcode project file.

```bash
git clone https://github.com/SingleTime/opentypora.git
cd opentypora
./build.sh
cp -R build/OpenTypora.app /Applications/
```

## Screenshots

| Light (tabs) | Night |
| --- | --- |
| ![Light](docs/opentypora-tabs.png) | ![Night](docs/opentypora-tabs-night.png) |

| Inline live preview | Night |
| --- | --- |
| ![Live preview](docs/opentypora-live.png) | ![Live preview at night](docs/opentypora-live-night.png) |

## Core design

- **Block-level WYSIWYG.** A document is modelled as `blocks[{raw}] + gaps[]`. When the caret enters a
  block, that block becomes editable: blocks eligible for live preview stay rendered (markers absent
  from the DOM), everything else (code, links, math, inline HTML, tables, multi-line paragraphs)
  switches to a `<textarea>` source view and re-renders on blur. Inline spans carry `data-s` offsets,
  so clicking rendered text maps back to the exact source position.
- **Lossless serialization.** The number of blank lines between blocks is stored explicitly in `gaps`,
  which is what makes `serialize(parse(src)) === src` a byte-level guarantee instead of a goal.
- **Undo.** A document-level snapshot stack, 300 steps deep, merging keystrokes within 800 ms.
  Structural operations across blocks are undoable too.

## Features

### Markdown coverage

Headings (ATX and Setext), bold/italic, strikethrough, `==highlight==`, inline code, links, images,
blockquotes (nested), lists (nested, ordered, task), tables, fenced code, YAML front matter, thematic
breaks — plus the common dialects beyond GFM:

- Reference links `[a][id]` / `[a][]` / `[a]` and reference images, with `[id]: url "title"`
  definition lines kept as hidden blocks so serialization stays byte-exact
- Bare URLs and `www.` auto-linked, with East Asian punctuation boundaries respected — a trailing
  period or a CJK comma never ends up inside `href`
- Superscript `X^2^`, subscript `H~2~O`, underline `<u>` — mapped to `vertAlign` / `<w:u>` in DOCX
  and `\textsuperscript` / `\textsubscript` / `\underline` in LaTeX
- Inline HTML: `<span style>`, `<kbd>`, `<sup>`, `<sub>`, `<mark>`, `<br>` render directly, with `on*`
  handlers and `javascript:` URLs stripped
- Emoji shortcodes: about 190 built-in mappings (`:smile:`, `:rocket:`, `:+1:`)
- Callouts: `> [!NOTE]` / `TIP` / `IMPORTANT` / `WARNING` / `CAUTION`, each with its own colour, icon
  and title line; titles survive DOCX/ePub/LaTeX export
- Block HTML rendered as HTML — `<div>`, `<table>`, `<details>`, `<svg>`, `<style>` blocks are matched
  by container tag and closing tag, not by blank lines, so `<div>…blank line…</div>` stays one block
- Images with size hints: `![alt](a.png =300x200)`, `=300` for width only, `=x200` for height only,
  with the same conversion used in render, DOCX (EMU), ePub (`width`/`height`) and LaTeX (px × 0.75 → pt)

### Inline live preview

Enabled by default (Settings → Editing). While you edit a block you see the typeset result: the two
asterisks of `**bold**` are simply not there, the word is bold. Move the caret into that span and the
pair reappears so you can edit it. Heading prefixes (`## `) hide too, revealing at line start; one
backspace removes the whole prefix and the heading reverts to body text.

Every edit made in the rendered surface is mapped back to `raw` by minimal text diff and redrawn.
Undo, auto-pairing, smart punctuation, emoji completion and `⌘B` all keep working — the editing
surface exposes the same `.value` / `.selectionStart` interface a textarea does.

Blocks where the markers **contain real content** — code, inline code, links, math, inline HTML,
tables, task boxes, multi-line paragraphs — deliberately fall back to source view. Hiding a URL or a
TeX expression behind rendered text would make it uneditable.

### Code blocks

Line-number gutter, a 33-language dropdown that rewrites only the opening fence, one-click copy, and
a toolbar that appears on hover and hides itself when printing or exporting to an image. Syntax
highlighting covers every dropdown entry (32 distinct lexers; `shell` is `bash`) with per-language
tables for comments, multi-line strings, numbers including units (`10px`), keywords, types,
attribute names, annotations and preprocessor directives; `diff` colours by added/removed line.

Right-click **Code Tools** offers eight actions: copy code, copy as HTML with highlight spans, copy as
Markdown, auto-indent, toggle line comment, move line up/down, delete block. `⌘/` toggles comments,
`⌥↑↓` moves lines, `Tab` / `⇧Tab` re-indent a multi-line selection. Auto-indent needs no real parser:
strings and comments are first blanked to equal-length spaces (length-preserving), then reflowed by
net bracket depth. Python and YAML only normalize indent levels without restructuring.

### Math and diagrams

- KaTeX 0.19 is bundled (not fetched), so `$inline$` and `$$block$$` typeset offline: matrices,
  aligned/gather environments, `cases`, display-style limits, Greek letters, `\text` / `\mathbf`.
  Syntax errors render in red with the source kept intact instead of breaking the document. KaTeX
  emits both MathML and HTML, so screen readers and copy-as-math work.
- **Mermaid 11** for fenced blocks tagged `mermaid` — flowchart, sequence, class, state, gantt, pie
  and the rest. The 3.4 MB library is injected lazily, only when a diagram block actually exists. Rendering
  inserts an `<svg>` and hides the `<pre>`, leaving the source text node in place so character
  offsets and click-to-position keep working. Diagrams are cached by theme plus source, so they do not
  flicker while you type. Bad syntax shows the Mermaid error inline with the source still visible.
- **flowchart.js** via a built-in 420-line zero-dependency `flow.js` for fenced blocks tagged
  `flow`, for when you want a quick flowchart without loading Mermaid. Layering marks back edges by DFS and relaxes
  levels on the resulting DAG, so cycles cannot blow up the layer numbering; edges route only through
  inter-layer gaps and outside channels, never through a node.

### Tables

- Edit cells in place with an `<input>`: Enter moves down, Tab moves right, Esc cancels, the last row
  grows automatically
- Hover a cell for a "+" to insert a row or column; right-click for the full menu (insert above/below,
  insert left/right, delete row/column, set column alignment, delete table)
- Drag column widths (written back to the delimiter row); drag row/column handles to reorder them,
  with an insertion indicator
- Serialization pads by **East Asian width** (CJK counts as two), so tables containing Chinese stay
  aligned in the source; bare `|` inside cells is escaped to `\|`

### Workspace, tabs and files

- File tree with right-click new file / folder / rename / duplicate / move to Trash / reveal in Finder
- **Open Quickly** (`⌘⇧O`) with fuzzy subsequence matching; **global search** (`⌘⇧F`) scanning files
  asynchronously with line numbers, case / whole-word / regex options
- Article view sorted by date, name or size; recent view of the last 30 documents with pinning
- Directory changes picked up by polling; unsaved drafts persisted and offered for recovery on launch
- Standard relative `.md` links (`./a.md`, `../x/y.md`, `#anchor`) open inside the app
- **Tabs**: `⌘T` / `⌘W` / `⌃⇥` / `⌘⇧T` to reopen, middle-click to close, up to 24. Switching away
  stores the full working state in the tab — text, path, dirty flag, scroll position, caret block and
  character offset, undo and redo stacks — so `⌘Z` still works after switching back
- **Undoable file operations**: new, rename, duplicate, move to Trash and move-to-folder can each be
  undone from the toast button or the File menu (20-step stack)
- **Image management** by right-click: rename on disk and rewrite references, move/copy, delete,
  copy path or Markdown, download remote images into `assets/`. `typora-copy-images-to` and
  `typora-root-url` front matter keys are honoured, and `⌘⌃I`, paste and drag-and-drop all resolve
  paths through the same code

### Writing

- **Themes**: six built-in (GitHub, Night, Newsprint, Pixyll, Whitey, Gothic), plus custom themes by
  dropping CSS into `~/Library/Application Support/OpenTypora/themes` — `:root` selectors are
  automatically promoted to `html[data-theme]`
- **Focus mode** (current block 100 %, neighbours 62 %, rest 30 %), **typewriter mode** centred on the
  caret line, **source mode** (`⌘/`) with line numbers and fence-aware highlighting, **split view**
  (`⌘⇧L`) with proportional scroll sync and click-preview-to-jump-to-source
- **Spell checking**: rendered text is tokenized and checked against `NSSpellChecker` in batches, with
  red squiggles, suggestions and a per-document ignore list; decoration too — font family, line height
  (1.3–2.4), background colour, all live and persisted
- **Local translation** (`⌘⇧Y`): uses macOS Translation.framework on-device, nothing leaves the
  machine. Source language is inferred from the script to avoid the system language picker; sessions
  are reused across calls (second translation measured at 0.08 s)
- **Writing feel**: auto-pairing, smart punctuation (`--` → `–`, `---` → `—`, `...` → `…`), view zoom,
  word/character/line/paragraph counts with reading time, copy as Markdown (`⌘⇧C`), paste as plain
  text (`⌘⇧V`), select word `⌘D` / line `⌘L`
- **Text snippets**: `trigger => expansion` lines in Settings, with `\n` / `\t` escapes and `$0` for
  caret placement; Tab expands inside the editor, Chinese triggers included
- **Strict mode**: disables highlight, super/subscript, emoji, wiki links and callouts on both the
  render and the parse side, while keeping serialization lossless in both modes

### Export

The status bar's **Export ▾** menu and **File → Export** share the same set. Everything except the
optional custom commands is generated in-process, with no external binaries and no network access.

| Format | Shortcut | Notes |
| --- | --- | --- |
| HTML | `⌘⇧E` | Single file, styles and math fonts inlined as data URIs |
| HTML (no styles) | | Semantic structure only; max-width wrapper is a separate option |
| PDF | `⌘P` / `⌘⇧P` | Native print panel, or direct export. A4 / Letter / A3 / A5, margins, header and footer, H1 page breaks |
| PNG / JPEG | | Full-page image at the current window width |
| Word | `⌥⌘W` | `.docx` with Heading 1–6 styles, real footnotes, embedded images |
| ePub | `⌥⌘B` | Real `h1..h6`, nested `nav.xhtml`, footnote anchors with backlinks |
| LaTeX | `⌥⌘X` | `ctexart`, compiles directly with XeLaTeX |
| OpenDocument | `⌥⌘D` | `.odt` with `text:h` outline, native footnotes |
| RTF | | `\uNNNN?` escapes, real tables, hyperlink fields |
| reStructuredText | | `.rst` with `code-block` directives and grid tables, Sphinx-ready |
| MediaWiki | | `.wiki` with `wikitable` and `<syntaxhighlight>` |
| Textile | | `.textile` with block signatures and `.`-style tables |
| OPML | | Heading tree, body text in `_note` |
| RevealJS | | Single-file slides; `h1` horizontal, `h2` vertical |

YAML front matter overrides export settings: `title`, `subtitle`, `author`, `date`, `keywords`,
`toc`, `toc-title`, `papersize`, `geometry`, `fontsize`, `linestretch`, `documentclass`.

Custom export commands can be added in Settings (up to 12) with `{src}`, `{out}`, `{name}`, `{dir}`
and `{ext}` placeholders — enough to pipe through pandoc for formats not covered here.

Why the built-in exporters do not use pandoc: pandoc's arm64 binary unpacks to about 120 MB, whereas
DOCX, ODT and ePub are just ZIP containers. A ~100-line store-mode ZIP writer plus WordprocessingML
and OpenDocument generators keep the whole export path dependency-free and offline.

### Import

**File → Import (Word / ODT / ePub / HTML / RST / LaTeX)…** (`⌘⇧I`), entirely local, no network:

- `.docx` — unzip, read `document.xml`, restore WordprocessingML semantics: heading styles,
  bold/italic/strikethrough, inline code detected via monospace character styles, real numbering from
  `numbering.xml`, tables with `gridSpan`, hyperlinks via relationships, embedded images sized from
  `wp:extent`, real footnotes
- `.odt` — `text:h`, `text:list`, `table:table`, `text:note`, images extracted from `Pictures/`
- `.epub` — `container.xml` → OPF, chapters converted in `spine` order
- `.html` / `.rst` / `.tex`

The criterion is semantics rather than appearance: Word's `Quote` style produces a blockquote without
a redundant italic wrapper, "empty paragraph plus bottom border" produces a thematic break, and only
runs whose character style resolves to a monospace face become inline code. Unrecognized structure —
field codes, comments, tracked deletions, SmartArt, nested tables — is skipped rather than guessed at.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| New / Open / Open folder | `⌘N` / `⌘O` / `⌘⌥⇧O` |
| New tab / Close tab | `⌘T` / `⌘W` |
| Previous / next tab | `⌃⇧⇥` / `⌃⇥` (or `⌘⇧[` / `⌘⇧]`) |
| Open Quickly / Global search | `⌘⇧O` / `⌘⇧F` |
| Save / Save as | `⌘S` / `⌘⇧S` |
| Source / split / sidebar | `⌘/` / `⌘⇧L` / `⌘\` |
| Heading 1–6 / body | `⌘1`…`⌘6` / `⌘0` |
| Bold / italic / inline code / link | `⌘B` / `⌘I` / `⌘E` / `⌘K` |
| Strikethrough / highlight | `⌘⇧X` / `⌘⇧H` |
| Insert local images | `⌘⌃I` |
| Find / replace | `⌘F` / `⌘H` |
| Zoom in / out / reset | `⌘+` / `⌘-` / `⌘0` |
| Copy as Markdown / paste as plain text | `⌘⇧C` / `⌘⇧V` |
| Select word / line | `⌘D` / `⌘L` |
| Insert table | `⌘⌥T` |
| Translate selection | `⌘⇧Y` |
| Import Word / HTML | `⌘⇧I` |
| Print / export PDF | `⌘P` / `⌘⇧P` |
| Export Word / ODT / ePub / LaTeX | `⌥⌘W` / `⌥⌘D` / `⌥⌘B` / `⌥⌘X` |
| Undo / redo | `⌘Z` / `⇧⌘Z` |

## Command line

```bash
./build.sh && sudo ./install-cli.sh     # installs to /usr/local/bin/opentypora

opentypora note.md          # open a file (each argument opens its own instance)
opentypora ~/notes          # open a directory as a workspace
echo '# hi' | opentypora -  # read Markdown from stdin
opentypora -v               # version, read from Info.plist
```

The script is a thin wrapper around `open -a`; `OPENTYPORA_APP` overrides the app path.

## Project layout

```
opentypora/
├── app/                  frontend, copied into the bundle as Resources/app
│   ├── index.html
│   ├── css/app.css       layout plus six themes
│   ├── vendor/           Mermaid 11 (lazy) and KaTeX 0.19 with its woff2 fonts
│   └── js/               plain ES modules, no build step
│       ├── md.js         parse + render core (pure functions, no DOM, unit-testable in Node)
│       ├── editor.js     block editing engine: source-mode switching, caret mapping, undo
│       ├── live.js       inline live preview: eligibility, marker spans, reveal, diff, apply
│       ├── export.js     ePub / LaTeX / RevealJS generators and format dispatch
│       ├── docx.js       Markdown to WordprocessingML
│       ├── zip.js        minimal store-mode ZIP writer, zero dependencies
│       └── …             tables, images, workspace, tabs, split view, find, snippets, emoji
├── native/               Swift: main.swift (shell + bridge), makeicon, spell, translate, pdfbook
├── bin/opentypora        CLI entry point
├── install.sh            download the release and install to /Applications
├── install-cli.sh        put the CLI on PATH
├── test/                 57 suites: Node unit tests plus WKWebView integration tests
├── build.sh              icon → compile → assemble bundle → ad-hoc sign
└── docs/                 spec.md, screenshots, and sample exports
```

## Testing

```bash
node test/runall.js            # 3316/3316 across 57 suites
node test/runall.js table math # run selected suites only
```

The suites are a mix of plain Node tests for the pure modules (`md.js`, `inline.js`, exporter
generators, workspace helpers) and DOM tests that run real rendering inside an offscreen WKWebView
through `build/shot` — not mocked. Every parser test asserts that parse → serialize is byte-identical.

Feature-by-feature verification records (120 items: 119 complete, 1 not implemented), along with the
behavioural trade-offs and the pitfalls hit along the way, are in [`docs/spec.md`](docs/spec.md) (Chinese).

## Known limitations

A full list is in the [Chinese README](README.zh-CN.md#已知限制). The ones worth knowing up front:

- **Apple Silicon only** for the published builds; Intel Macs need to build from source
- **Ad-hoc signed**, so the first launch needs manual approval (see Install)
- Exports never fetch remote images: `http(s)` images degrade to a placeholder unless you download
  them into `assets/` first
- Math in DOCX is TeX source in Cambria Math, not a real equation object; ePub renders it as HTML
  super/subscript
- Wiki links `[[note]]` do not track renames — the note name is stored, not a file id, so renaming a
  target greys the link out (moving it between folders still resolves)
- HTML import takes structure only; visual-only attributes (underline, highlight, colour, size) are
  dropped rather than smuggled in as raw HTML
- The table handles live in the main editor; tables in split-preview are read-only
- ePub export produces a single `chapter.xhtml` with a nested table of contents

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) covers the prerequisites, the test suites, and the three rules a
patch has to respect (no npm, no Electron, byte-exact round trips). Bug reports are much easier to
act on with a minimal Markdown sample.

## License

MIT, see [LICENSE](LICENSE). Bundled third-party components: Mermaid (MIT) and KaTeX (MIT, including
its woff2 fonts).
