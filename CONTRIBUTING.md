# Contributing

Thanks for looking. This project has an unusual constraint set, so a few lines here save a lot of
back-and-forth.

## What the project refuses to do

These are the reasons the app is 5.8 MB, and they are not negotiable:

- **No npm, no bundler, no `node_modules`.** Frontend sources in `app/js/` are plain scripts loaded by
  `index.html`, in order. If a change needs a build step, it needs a different design here.
- **No Electron.** The shell is Swift/AppKit plus a `WKWebView`.
- **Byte-exact round trips.** `serialize(parse(src)) === src` must hold for every document. A patch
  that reformats a file, collapses blank lines, or normalises list markers breaks the core promise,
  and the parser suites will catch it.

## Prerequisites

- macOS 12+ on Apple Silicon, Xcode command line tools (`swiftc`, `iconutil`)
- Node 18+ for the test suites
- `rsync` and `python3` for the web build

## Build and run

```bash
./build.sh        # icon → compile Swift → assemble build/OpenTypora.app → ad-hoc sign
open build/OpenTypora.app
```

While working on the frontend you do not need to rebuild the app: open `app/index.html` in a browser
to iterate on layout and rendering, but remember the native bridge is absent there, so anything
touching files, folders or the clipboard has to be verified in the real app.

## Test

```bash
node test/runall.js                 # everything: 3316 assertions across 57 suites
node test/runall.js --node-only     # the ~2100 assertions that need no WKWebView
node test/runall.js table math      # selected suites
```

The harness suites (`table`, `doc`, `mermaid`, …) generate an `app/__*.html` page and render it in a
real offscreen `WKWebView` through `build/shot`. They check rendered geometry, not mocks — so they
only run on macOS after `./build.sh`.

## Web build

```bash
./build-web.sh      # app/ minus __*.html + web-src/web-shim.js → web/
```

`web/` is generated and gitignored. Two rules:

- Edit frontend behaviour in `app/`, never in `web/`.
- Browser-only adaptations belong in `web-src/web-shim.js`, which replaces `Bridge` (the native
  message-handler layer) with Web APIs. If a capability cannot exist in a browser, make it degrade
  with a visible notice instead of failing silently.

Behaviour that differs between the two targets is gated on `window.Bridge.web` — set by the shim,
absent in the native shell.

## Sending a patch

1. Open an issue first for anything larger than a bug fix. Screenshot or short recording helps.
2. Keep the diff focused. Commit messages in either Chinese or English are fine; the history uses both.
3. Run `node test/runall.js` before pushing. A patch that turns the suite red will not be merged.
4. If you change behaviour, document it — `docs/spec.md` records the decision and the trade-off
   behind each feature, in Chinese.

## Reporting a security issue

Please do not open a public issue for anything that could be exploited (path traversal in the file
bridge, unintended network requests, HTML injection through Markdown). Use GitHub's private
[security advisory](https://github.com/SingleTime/opentypora/security/advisories/new) form instead.
