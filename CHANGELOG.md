# Changelog

All notable changes to **grapesjs-devtools** are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/) and the project follows
[Semantic Versioning](https://semver.org/).

## [1.4.1]

- **macOS hotkey** — the toggle shortcut now also binds the `⌘` variant, so
  `⌘+Shift+D` works on Mac (every `ctrl+…` combo in `hotkey` gets a `⌘+…` twin).
  The About tab shows `⌘+Shift+D` on macOS.

## [1.4.0]

Documentation, attribution and an in-panel help link.

- **Docs** — added a full [DOCS.md](./DOCS.md) (install, options, every module,
  AI setup, writing a module) and reworked the README intro.
- **Help link** — a persistent `?` in the panel header opens
  [gjs.market/services](https://gjs.market/services); the **About** tab now has a
  "Need help?" services block and doc/GitHub/gjs.market links.
- **Attribution** — the plugin is credited to
  [gjs.market](https://gjs.market), built for the whole GrapesJS community, in
  the README, the About tab, and the package description.

## [1.3.0]

AI provider flexibility and UX polish.

- **OpenAI-compatible / self-hosted backends** — the custom endpoint now has a
  "send API key" mode (`ai.sendKeyToEndpoint`). With it on, the request goes to a
  custom base URL **with** the provider's auth, so OpenRouter, Ollama, LM Studio
  and self-hosted gateways work with `provider: 'openai'`. With it off it stays a
  keyless proxy (as before). Streaming works in both modes.
- **Esc cancels** an in-progress request from the chat input.
- **Bounded history** — only the most recent turns are sent to the provider, so
  long chats don't grow token usage without limit.
- **Offline demo** — `demo/index.html` loads GrapesJS from `node_modules` instead
  of the unpkg CDN, so it works offline / behind a VPN.

## [1.2.0]

AI assistant: streaming responses and a proxy mode.

- **Streaming** — answers stream in token-by-token (SSE) for all three providers
  and are re-rendered as Markdown when complete. Toggle in the panel Settings
  (`ai.stream`, default on).
- **Proxy mode** — set `ai.endpoint` (or the Proxy field in Settings) to route
  requests through your own server. In proxy mode **no API key is sent from the
  browser** — the request is a transparent pass-through (provider-native body,
  streaming supported) and your proxy injects auth. A `x-devtools-provider`
  header identifies the provider for multi-provider proxies.

## [1.1.0]

Added an AI assistant and live panel repositioning.

- **AI module** — pick any part of the editor (a panel, a button, a manager) or
  use the current canvas selection as context, then ask a question and get a
  GrapesJS code example plus an explanation, FAQ-style. Answers render as
  Markdown with copyable code blocks. Providers: **Claude** (Anthropic), **ChatGPT**
  (OpenAI), and **Gemini** (Google), called directly from the browser via `fetch`
  (zero runtime deps). Provider/key/model are set in the panel (stored in
  localStorage) or via the `ai` plugin option. Anthropic requests use the
  `anthropic-dangerous-direct-browser-access` header and default to `claude-opus-4-8`.
- **Panel positioning** — the panel can now dock **left**, **right**, or **bottom**,
  switchable live from the header (persisted). Previously only right/bottom, option-only.

## [1.0.0]

First complete release — all ten feature modules from the spec are implemented,
verified end-to-end in a real browser, and the package is publish-ready.

### Verified against the Definition of Done

- **Light + dark themes** render correctly across every module.
- **1000+ component project:** the Components tree renders in ~30 ms (lazy
  children) and the event logger's capture path costs < 0.1 ms/event.
- **No leaks:** the editor's private event bus returns to its exact baseline
  after the panel is destroyed (all `EditorBridge` subscriptions disposed).

### Packaging

- Bumped to `1.0.0`; added `LICENSE`, `sideEffects` (CSS), `engines`,
  `repository`/`homepage`/`bugs`, and a `prepublishOnly` gate.
- GitHub Actions CI: typecheck + tests + build on push/PR.

## [0.3.0]

Added the diagnostics & tooling modules.

- **Performance & Diagnostics** — live metrics (components, CSS rules,
  selectors, editor listeners, undo stack), UndoManager controls, a canvas
  re-render timer (min/avg/max), and a baseline/compare leak detector. Private
  GrapesJS/Backbone internals degrade to `n/a` instead of throwing.
- **Canvas Tools** — an overlay layer above the canvas: highlight every
  component (colour by depth) with the selection's box model, a canvas-body
  `pointer-events` killer, and scroll-to-selected. Accounts for canvas zoom.
- **Snapshots** — capture/restore full project state (data + selection +
  device) with export, drag-and-drop import, and optional localStorage
  persistence (handles `QuotaExceededError`). Emits `devtools:snapshot:restored`.

## [0.2.0]

Added the inspection & data modules.

- **Style Inspector** — rules applying to the selection with cascade-override
  strike-through and inline editing, a searchable table of all project rules,
  and a dead-rule scanner. Public `filterBySelector()` API.
- **Storage & Data** — project-data JSON tree, structural diff between
  snapshots, export/import, live syntax-highlighted HTML/CSS, and a
  storage-event log.
- **Managers Overview** — accordion of Blocks, Traits, Selectors, Devices and
  configured Plugins; clicking a selector filters it in the Style Inspector.
- Added `ctx.selectModule(id)` for cross-module tab switching.
- New utilities: structural `json-diff` and a dependency-free HTML/CSS syntax
  highlighter (both unit-tested).

## [0.1.0]

Initial MVP — the framework plus the highest-value modules.

- **Framework** — `DevtoolsPanel` (docking, resize, tabs, dark/light theme),
  `ModuleRegistry` (lazy mount + activate/deactivate), `EditorBridge` (tracked
  subscriptions + `disposeAll()`), the `devtools:toggle` command and hotkey, and
  a Vite library build (ESM + UMD + types).
- **Component Inspector** — live tree, two-way canvas selection, inline
  attribute/trait editing, breadcrumbs, Copy JSON.
- **Event Logger** — single-listener firehose, ring buffer, virtualized list,
  group/text filters, pause/clear, stats view, payload inspection.
- **Console / REPL** — eval with `editor` and `$0` in scope, history,
  autocomplete, snippets.
- Vanilla-DOM UI with zero runtime dependencies; unit tests for the pure
  utilities (safe serializer, debounce, formatters).
